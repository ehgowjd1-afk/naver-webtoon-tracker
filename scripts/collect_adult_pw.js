// 성인 시리즈 '다운수' 반자동 수집 — Playwright로 로그인된 크롬 세션 사용
//
// ※ 네이버는 성인 콘텐츠에 대해 '브라우저를 새로 켤 때마다' 연령확인을 요구하고 그 인증은
//    세션이 닫히면 사라집니다. 따라서 무인(스케줄러) 자동은 불가하고, 아래처럼 반자동으로만 됩니다.
//
// 사용법:
//   node scripts/collect_adult_pw.js --verify --push
//     → 크롬 창이 열립니다. (필요시 네이버 로그인 후) 뜬 19금 작품에서 '연령확인'을 완료하세요.
//       성인 접근이 확인되면 그 세션에서 바로 다운수를 수집하고 커밋/푸시합니다. 끝나면 자동으로 닫힘.
//   node scripts/collect_adult_pw.js --verify        (수집만, 푸시 안 함)
//   node scripts/collect_adult_pw.js --test          (파이프라인 점검, 비성인)

const { chromium } = require("playwright-core");
const C = require("./collect.js");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const D = path.join(ROOT, "docs", "data");
const PROFILE = path.join(__dirname, ".pw-profile");
const args = process.argv.slice(2);
const VERIFY = args.includes("--verify");
const PUSH = args.includes("--push");
const TEST = args.includes("--test");
const AUTO = args.includes("--auto");
const CDP = args.includes("--cdp");
const MAX = Number((args.find(a => a.startsWith("--max=")) || "").split("=")[1] || 30);
const STATE = path.join(__dirname, ".pw-state.json"); // 연령확인된 세션 상태(쿠키) 저장 — 자동수집 재사용용(git 제외)
function pushData() {
  try {
    execSync(`git -C "${ROOT}" add docs/data/series_details.json docs/data/series_extra.json docs/data/revenue_history.json`, { stdio: "inherit" });
    execSync(`git -C "${ROOT}" commit -m "adult: 성인 시리즈 다운수 ${C.isoDate()}"`, { stdio: "inherit" });
    for (let i = 0; i < 3; i++) { try { execSync(`git -C "${ROOT}" pull --rebase --autostash -X theirs origin main`, { stdio: "inherit" }); execSync(`git -C "${ROOT}" push origin main`, { stdio: "inherit" }); console.log("푸시 완료"); return; } catch (e) { console.log("재시도", i + 1); } }
  } catch (e) { console.log("변경 없음/커밋 스킵"); }
}
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(D, f), "utf8")); } catch (e) { return d; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CHECK_PN = 10851069, CHECK_KIND = "comic"; // 성인 접근 확인용 기준작(로그인+연령확인 되면 dl 노출)

async function scrapeDl(page, pn, kind) {
  await page.goto(`https://series.naver.com/${kind}/detail.series?productNo=${pn}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  const pd = C.parseSeriesDetail(await page.content()); pd.kind = kind; return pd;
}
async function adultOk(ctx) {
  try { const cp = await ctx.newPage(); await cp.goto(`https://series.naver.com/${CHECK_KIND}/detail.series?productNo=${CHECK_PN}`, { waitUntil: "domcontentloaded", timeout: 20000 }); const pd = C.parseSeriesDetail(await cp.content()); await cp.close(); return !!pd.dl; } catch (e) { return false; }
}
async function collectAll(page, opts = {}) {
  const { cap = Infinity, dmin = 300, dmax = 300 } = opts;
  const sd = readJSON("series_details.json", {}), extra = readJSON("series_extra.json", { map: {}, owned: [], adult: [], seen: {} });
  extra.adult = extra.adult || []; extra.seen = extra.seen || {};
  const series = readJSON("series.json", { comic: {}, novel: {} });
  const pnKind = {};
  for (const n in extra.map) for (const e of extra.map[n]) pnKind[e.pn] = e.kind;
  for (const kind of ["comic", "novel"]) for (const pf of ["web", "mobile"]) for (const c in (series[kind] || {})[pf] || {}) for (const p in series[kind][pf][c]) for (const it of series[kind][pf][c][p]) if (!(it.id in pnKind)) pnKind[it.id] = kind;
  const adultSet = new Set(extra.adult);
  let targets = [...new Set(Object.keys(pnKind).map(Number))].filter(pn => adultSet.has(pn) || !(sd[pn] && sd[pn].dl));
  // 오래 안 본 것부터(제일 stale 우선) — cap이 있으면 매 실행마다 조금씩 나눠서 부담 최소화
  targets.sort((a, b) => (extra.seen[a] || 0) - (extra.seen[b] || 0));
  if (targets.length > cap) targets = targets.slice(0, cap);
  console.log("대상 " + targets.length + "개 수집" + (cap !== Infinity ? " (이번 회차 상한 " + cap + ")" : ""));
  const today = C.isoDate();
  let got = 0, done = 0;
  for (const pn of targets) {
    const kind = pnKind[pn] || (sd[pn] && sd[pn].kind) || "comic";
    const had = !!(sd[pn] && sd[pn].dl);
    try { const pd = await scrapeDl(page, pn, kind); if (pd.dl) { sd[pn] = C.mergeDetail(sd[pn], pd, kind); got++; if (!had) adultSet.add(pn); } } catch (e) {}
    extra.seen[pn] = today;
    done++;
    if (done % 10 === 0) { fs.writeFileSync(path.join(D, "series_details.json"), JSON.stringify(sd)); console.log("  " + done + "/" + targets.length + " (다운수 " + got + ")"); }
    await sleep(dmin + Math.floor(Math.random() * Math.max(0, dmax - dmin)));
  }
  extra.adult = [...adultSet];
  fs.writeFileSync(path.join(D, "series_details.json"), JSON.stringify(sd));
  fs.writeFileSync(path.join(D, "series_extra.json"), JSON.stringify(extra));
  const rh = C.updateRevenueHistory(D, C.isoDate());
  console.log(`완료: ${got}개 다운수 확보 · 매출히스토리 ${JSON.stringify(rh)}`);
  return got;
}

(async () => {
  // --cdp: 사용자가 직접 켠 '진짜 크롬'(원격 디버깅)에 붙어서, 사람이 로그인/연령확인한 세션으로 아주 천천히 조금씩 수집 (계정 부담 최소화)
  if (CDP) {
    let browser;
    try { browser = await chromium.connectOverCDP("http://localhost:9222"); }
    catch (e) { console.log("❌ 디버그 크롬에 연결 실패 — 먼저 chrome_debug.bat 로 크롬을 켜고 네이버 로그인+연령확인 하세요."); process.exit(1); }
    const context = browser.contexts()[0] || await browser.newContext();
    const page = context.pages()[0] || await context.newPage();
    if (PUSH) { try { execSync(`git -C "${ROOT}" pull --rebase --autostash -X theirs origin main`, { stdio: "inherit" }); } catch (e) {} }
    if (!(await adultOk(context))) { console.log("❌ 그 크롬에서 성인 접근이 안 돼요 — 네이버 로그인 + 19금 작품 '연령확인'부터 사람이 직접 해주세요."); await browser.close(); process.exit(2); }
    console.log(`✅ 진짜 크롬 세션으로 성인 접근 OK — 천천히 최대 ${MAX}개만 수집(계정 부담 최소화)`);
    const got = await collectAll(page, { cap: MAX, dmin: 4000, dmax: 9000 }); // 4~9초 간격, 소량
    await browser.close(); // CDP는 disconnect만 (사용자 크롬은 그대로 열려있음)
    if (PUSH && got > 0) pushData();
    return;
  }

  // --auto: 저장된 세션 상태(.pw-state.json) 재사용해 헤드리스로 수집 (스케줄러용, 재인증 불필요 — 상태가 살아있는 동안)
  if (AUTO) {
    let state; try { state = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch (e) { console.log("❌ 저장된 세션 없음 — 먼저 verify_adult.bat(--verify) 1회 실행하세요."); process.exit(1); }
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    const actx = await browser.newContext({ storageState: state, viewport: { width: 1280, height: 900 } });
    const apage = await actx.newPage();
    if (PUSH) { try { execSync(`git -C "${ROOT}" pull --rebase --autostash -X theirs origin main`, { stdio: "inherit" }); } catch (e) {} }
    if (!(await adultOk(actx))) { console.log("❌ 저장된 세션으로 성인 접근 불가(만료됨) — verify_adult.bat로 재인증 필요"); await browser.close(); process.exit(2); }
    console.log("✅ 저장된 세션으로 성인 접근 OK — 수집 시작");
    const got = await collectAll(apage);
    await browser.close();
    if (PUSH && got > 0) pushData();
    return;
  }

  const ctx = await chromium.launchPersistentContext(PROFILE, { channel: "chrome", headless: !VERIFY, viewport: { width: 1280, height: 900 } });
  const page = ctx.pages()[0] || await ctx.newPage();

  if (TEST) { const pd = await scrapeDl(page, 42918, "comic"); console.log("테스트(42918 화산귀환): dl=" + (pd.dl || "없음") + " → " + (pd.dl ? "✅ OK" : "❌ 실패")); await ctx.close(); return; }

  if (VERIFY) {
    if (PUSH) { try { execSync(`git -C "${ROOT}" pull --rebase --autostash -X theirs origin main`, { stdio: "inherit" }); } catch (e) {} }
    await page.goto(`https://series.naver.com/${CHECK_KIND}/detail.series?productNo=${CHECK_PN}`).catch(() => {});
    console.log("\n>>> 열린 크롬 창에서 (필요하면 네이버 로그인 후) 이 19금 작품의 '연령확인'을 완료하세요.");
    console.log(">>> 성인 접근이 확인되면 자동으로 수집을 시작합니다 (최대 6분 대기)...\n");
    let ok = false;
    for (let i = 0; i < 36; i++) { await sleep(10000); if (await adultOk(ctx)) { ok = true; break; } }
    if (!ok) { console.log("❌ 성인 접근 확인 안 됨 (연령확인 미완료) — 종료합니다."); await ctx.close(); return; }
    console.log("✅ 성인 접근 확인 — 세션 상태 저장 후 수집 시작");
    try { fs.writeFileSync(STATE, JSON.stringify(await ctx.storageState())); console.log("   세션 상태 저장 완료(.pw-state.json) — 다음부터 --auto로 재사용 시도"); } catch (e) {}
    const got = await collectAll(page);
    await ctx.close();
    if (PUSH && got > 0) pushData();
    return;
  }

  console.log("사용법: node scripts/collect_adult_pw.js --verify --push   (창에서 연령확인 후 자동 수집)");
  await ctx.close();
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
