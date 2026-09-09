// 성인 시리즈 '다운수' 자동수집 — Playwright로 로그인된 크롬 세션 사용(쿠키 만료 문제 회피)
//
// 최초 1회 (로그인):  node scripts/collect_adult_pw.js --login
//   → 크롬 창이 열립니다. 네이버 로그인 + 성인 웹툰 하나 열어 '성인 인증'까지 하고, 이 터미널에서 Enter.
// 매일 (자동):        node scripts/collect_adult_pw.js --push
//   → 저장된 세션으로 성인 시리즈 다운수 갱신 + 커밋/푸시 (run_adult_pw.bat 로 스케줄러 등록)
// 테스트:             node scripts/collect_adult_pw.js --test   (비성인 1작품으로 파이프라인 확인)

const { chromium } = require("playwright-core");
const C = require("./collect.js");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const D = path.join(ROOT, "docs", "data");
const PROFILE = path.join(__dirname, ".pw-profile");
const args = process.argv.slice(2);
const LOGIN = args.includes("--login");
const PUSH = args.includes("--push");
const TEST = args.includes("--test");

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(D, f), "utf8")); } catch (e) { return d; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch() {
  return chromium.launchPersistentContext(PROFILE, {
    channel: "chrome",
    headless: !(LOGIN),
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"]
  });
}
async function loggedIn(page) {
  await page.goto("https://series.naver.com/", { waitUntil: "domcontentloaded", timeout: 40000 }).catch(() => {});
  const h = await page.content();
  return /로그아웃|내서재|MY_NELmenu|gnb_my|nlog-logout/i.test(h);
}
async function scrapeDl(page, pn, kind) {
  await page.goto(`https://series.naver.com/${kind}/detail.series?productNo=${pn}`, { waitUntil: "domcontentloaded", timeout: 40000 });
  // 성인 인증/확인 버튼 있으면 클릭
  for (const sel of ["a:has-text('성인 인증하고')", "button:has-text('성인 인증')", "a:has-text('19세 이상')", ".btn_adult", "a:has-text('확인')"]) {
    const b = await page.$(sel).catch(() => null);
    if (b) { await b.click().catch(() => {}); await sleep(700); break; }
  }
  const html = await page.content();
  const pd = C.parseSeriesDetail(html); pd.kind = kind;
  return pd;
}

(async () => {
  const ctx = await launch();
  const page = ctx.pages()[0] || await ctx.newPage();

  if (LOGIN) {
    await page.goto("https://nid.naver.com/nidlogin.login?url=https%3A%2F%2Fseries.naver.com%2F").catch(() => {});
    console.log("\n>>> 열린 크롬 창에서 네이버에 로그인하세요.");
    console.log(">>> 그리고 성인(19금) 웹툰 하나를 열어 '성인 인증'까지 완료하세요.");
    console.log(">>> 다 되면 여기(터미널)에서 Enter 를 누르세요...\n");
    await new Promise(res => process.stdin.once("data", res));
    console.log(await loggedIn(page) ? "✅ 로그인 확인됨 — 프로필 저장 완료. 이제 --push 로 매일 자동수집 가능." : "⚠️ 로그인 확인 안 됨 — 다시 --login 시도하세요.");
    await ctx.close(); return;
  }

  if (TEST) {
    const pd = await scrapeDl(page, 42918, "comic"); // 비성인 공개작
    console.log("파이프라인 테스트 (42918 화산귀환): dl=" + (pd.dl || "없음") + " ep=" + (pd.ep || "?") + " → " + (pd.dl ? "✅ 브라우저 스크랩 정상" : "❌ 실패"));
    await ctx.close(); return;
  }

  if (!(await loggedIn(page))) {
    console.log("❌ 로그인 안 됨 — 먼저 `node scripts/collect_adult_pw.js --login` 을 실행하세요.");
    await ctx.close(); process.exit(1);
  }
  if (PUSH) { try { execSync(`git -C "${ROOT}" pull --rebase --autostash -X theirs origin main`, { stdio: "inherit" }); } catch (e) {} }

  const sd = readJSON("series_details.json", {});
  const extra = readJSON("series_extra.json", { map: {}, owned: [], adult: [] });
  extra.adult = extra.adult || [];
  const series = readJSON("series.json", { comic: {}, novel: {} });

  // 대상: 웹툰이 연동한 시리즈 pn(extra.map) + 랭킹 시리즈 pn 중, 다운수 없거나 이미 성인으로 확인된 것
  const pnKind = {};
  for (const n in extra.map) for (const e of extra.map[n]) pnKind[e.pn] = e.kind;
  for (const kind of ["comic", "novel"]) for (const pf of ["web", "mobile"]) for (const c in (series[kind] || {})[pf] || {}) for (const p in series[kind][pf][c]) for (const it of series[kind][pf][c][p]) if (!(it.id in pnKind)) pnKind[it.id] = kind;
  const adultSet = new Set(extra.adult);
  const referenced = new Set([...Object.keys(pnKind).map(Number)]);
  const targets = [...referenced].filter(pn => adultSet.has(pn) || !(sd[pn] && sd[pn].dl));

  console.log(`대상 ${targets.length}개 스크랩 (기존 성인 ${adultSet.size} + 다운수없음)`);
  let got = 0, done = 0, newAdult = 0;
  for (const pn of targets) {
    const kind = pnKind[pn] || (sd[pn] && sd[pn].kind) || "comic";
    const hadDl = !!(sd[pn] && sd[pn].dl);
    try {
      const pd = await scrapeDl(page, pn, kind);
      if (pd.dl) { sd[pn] = C.mergeDetail(sd[pn], pd, kind); got++; if (!hadDl && !adultSet.has(pn)) { adultSet.add(pn); newAdult++; } }
    } catch (e) {}
    done++;
    if (done % 20 === 0) { fs.writeFileSync(path.join(D, "series_details.json"), JSON.stringify(sd)); console.log(`  ${done}/${targets.length} (다운수 ${got})`); }
    await sleep(350);
  }
  extra.adult = [...adultSet];
  fs.writeFileSync(path.join(D, "series_details.json"), JSON.stringify(sd));
  fs.writeFileSync(path.join(D, "series_extra.json"), JSON.stringify(extra));
  const rh = C.updateRevenueHistory(D, C.isoDate());
  console.log(`완료: ${got}/${targets.length} 다운수 확보 (신규 성인 ${newAdult}) · 매출히스토리 ${JSON.stringify(rh)}`);
  await ctx.close();

  if (PUSH && got > 0) {
    try {
      execSync(`git -C "${ROOT}" add docs/data/series_details.json docs/data/series_extra.json docs/data/revenue_history.json`, { stdio: "inherit" });
      execSync(`git -C "${ROOT}" commit -m "adult(pw): 성인 시리즈 다운수 ${C.isoDate()}"`, { stdio: "inherit" });
      for (let i = 0; i < 3; i++) { try { execSync(`git -C "${ROOT}" pull --rebase --autostash -X theirs origin main`, { stdio: "inherit" }); execSync(`git -C "${ROOT}" push origin main`, { stdio: "inherit" }); console.log("푸시 완료"); break; } catch (e) { console.log("재시도", i + 1); } }
    } catch (e) { console.log("변경 없음/커밋 스킵"); }
  }
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
