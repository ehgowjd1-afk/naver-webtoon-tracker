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
const FAVONLY = args.includes("--favonly"); // 성인 관심수만 갱신(다운수 재수집 스킵, cdpDate 스킵 무시)
const PRICEONLY = args.includes("--priceonly"); // 성인 단가(대여/소장 쿠키)만 수집(다운수·무료유료 스킵, cdpDate 스킵 무시)
const MAX = Number((args.find(a => a.startsWith("--max=")) || "").split("=")[1] || 30);
const STATE = path.join(__dirname, ".pw-state.json"); // 연령확인된 세션 상태(쿠키) 저장 — 자동수집 재사용용(git 제외)
const RUN_DATE = C.runDate();   // 이번 실행 기준 날짜 고정(시작 시점) — "오늘 긁음" 스탬프와 히스토리 기록 날짜 일치(밤늦게 시작해 자정 넘겨도 어긋나지 않게)
function pushData() {
  try {
    execSync(`git -C "${ROOT}" add docs/data/series_details.json docs/data/series_extra.json docs/data/revenue_history.json docs/data/details.json docs/data/ep_history.json docs/data/fav_history.json`, { stdio: "inherit" });
    execSync(`git -C "${ROOT}" commit -m "adult: 성인 시리즈 다운수 ${RUN_DATE}"`, { stdio: "inherit" });
    for (let i = 0; i < 3; i++) { try { execSync(`git -C "${ROOT}" pull --rebase --autostash -X theirs origin main`, { stdio: "inherit" }); execSync(`git -C "${ROOT}" push origin main`, { stdio: "inherit" }); console.log("푸시 완료"); return; } catch (e) { console.log("재시도", i + 1); } }
  } catch (e) { console.log("변경 없음/커밋 스킵"); }
}
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(D, f), "utf8")); } catch (e) { return d; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CHECK_PN = 10851069, CHECK_KIND = "comic"; // 성인 접근 확인용 기준작(로그인+연령확인 되면 dl 노출)

// 멈춘(hung) 탭 자동 복구: 탭이 멈춰 있으면 Playwright connectOverCDP가 그 탭에 붙으려다 전체 연결 실패.
// raw CDP(HTTP+페이지 ws)로 각 페이지 탭에 Runtime.evaluate를 보내 5초 무응답이면 Page.navigate로 강제 리로드.
const http = require("http");
function cdpJSON(pth) { return new Promise((res, rej) => { http.get("http://localhost:9222" + pth, r => { let s = ""; r.on("data", d => s += d); r.on("end", () => { try { res(JSON.parse(s)); } catch (e) { res(null); } }); }).on("error", rej); }); }
function getWS() { try { if (globalThis.WebSocket) return globalThis.WebSocket; } catch (e) {} try { return require("playwright-core/lib/utilsBundle").ws; } catch (e) {} return null; }
function pingOrReload(pg) {
  return new Promise((resolve) => {
    const WS = getWS(); if (!WS) return resolve("no-ws");
    let ws; try { ws = new WS(pg.webSocketDebuggerUrl); } catch (e) { return resolve("ws-fail"); }
    let settled = false; const fin = (v) => { if (settled) return; settled = true; try { ws.close(); } catch (e) {} resolve(v); };
    const to = setTimeout(() => { // 무응답 = 멈춤 → 리로드
      try { ws.send(JSON.stringify({ id: 2, method: "Page.navigate", params: { url: (pg.url && pg.url.startsWith("http")) ? pg.url : "https://comic.naver.com/index" } })); } catch (e) {}
      setTimeout(() => fin("reloaded(hung)"), 3000);
    }, 5000);
    ws.onopen = () => { try { ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "1", returnByValue: true } })); } catch (e) {} };
    ws.onmessage = (m) => { try { const msg = JSON.parse(m.data.toString()); if (msg.id === 1) { clearTimeout(to); fin("ok"); } } catch (e) {} };
    ws.onerror = () => { clearTimeout(to); fin("ws-err"); };
  });
}
async function healPages() {
  try {
    const pages = (await cdpJSON("/json")) || [];
    const ps = pages.filter(p => p.type === "page");
    let reloaded = false;
    for (const pg of ps) { const r = await pingOrReload(pg); if (r !== "ok") { console.log("탭 복구:", (pg.url || "").slice(0, 35), "→", r); reloaded = true; } }
    if (reloaded) await sleep(3000); // 리로드된 탭이 로드 시작하도록 잠깐 대기
  } catch (e) { console.log("healPages 스킵:", e.message); }
}

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
  // 대상 = '네이버웹툰 성인작품'(코믹)만. 웹소설은 제외(웹툰이 아니므로). 성인목록 or 아직 dl없는 코믹(신작 성인 잡기).
  let targets = [...new Set(Object.keys(pnKind).map(Number))].filter(pn => pnKind[pn] === "comic" && (adultSet.has(pn) || !(sd[pn] && sd[pn].dl)));
  // 오래 안 본 것부터(제일 stale 우선) — cap이 있으면 매 실행마다 조금씩 나눠서 부담 최소화
  targets.sort((a, b) => (extra.seen[a] || 0) - (extra.seen[b] || 0));
  if (targets.length > cap) targets = targets.slice(0, cap);
  console.log("대상 " + targets.length + "개 수집" + (cap !== Infinity ? " (이번 회차 상한 " + cap + ")" : ""));
  const today = RUN_DATE;   // 스탬프·히스토리와 같은 날짜(자정 넘김·새벽 4시 전 실행도 일관)
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
  if (got > 0) extra.cdpDate = RUN_DATE;   // 오늘 성인 수집 완료 표시(하루 여러번 시도해도 1번만 수집) — 기록한 날짜 칸과 같은 날짜(자정 넘겨 끝나도 다음날 수집을 막지 않게)
  fs.writeFileSync(path.join(D, "series_details.json"), JSON.stringify(sd));
  fs.writeFileSync(path.join(D, "series_extra.json"), JSON.stringify(extra));
  const rh = C.updateRevenueHistory(D, RUN_DATE);   // 이번에 새로 긁은 성인작만 기록 — 안 긁은 비성인작에 어제 값을 베껴 쓰지 않음
  console.log(`완료: ${got}개 다운수 확보 · 매출히스토리 ${JSON.stringify(rh)}`);
  return got;
}
/* 성인 웹툰 무료/유료 회차: CDP(로그인+연령확인) 브라우저는 성인 comic.naver article/list도 열림 → 미리보기(유료)·무료 계산.
   det[id].adult 웹툰만. det.free/paid 설정 후 ep_history 갱신(엑셀 Sheet1 무료/유료 열용). ep는 안 건드림(시리즈 회차수 기준 유지). */
async function collectAdultCharge(page, opts = {}) {
  const { dmin = 1500, dmax = 3500, cap = Infinity } = opts;
  const det = readJSON("details.json", {});
  let ids = Object.keys(det).filter(id => det[id] && det[id].adult === true);
  if (ids.length > cap) ids = ids.slice(0, cap);
  console.log("성인 웹툰 무료/유료 대상 " + ids.length + "개");
  try { await page.goto("https://comic.naver.com/", { waitUntil: "domcontentloaded", timeout: 30000 }); } catch (e) {}
  let got = 0, gotFav = 0, done = 0;
  for (const id of ids) {
    try {
      const listPage = async (p) => {   // 2페이지부터는 사람 속도로(완결 후 유료화 작품만 여러 페이지)
        if (p > 1) await sleep(400 + Math.floor(Math.random() * 500));
        return page.evaluate(async ([id, p]) => { const r = await fetch(`/api/article/list?titleId=${id}&page=${p}&sort=DESC`, { credentials: "include" }); if (!r.ok) return null; return await r.json(); }, [id, p]);
      };
      const al = await listPage(1);
      if (al && al.totalCount) {
        const sp = await C.episodeSplit(al, listPage);   // 결번 있어도 맞는 무료/유료
        det[id].ep = sp.T; det[id].epGap = sp.gap;        // 사이트 '총 N화' = 로그인 회차목록 총개수(로그아웃 댓글 추정은 결번·무댓글 최신화로 ±1 틀림) · 결번 수는 클라우드 추정 보정용
        det[id].paid = sp.paid; det[id].free = sp.free; det[id].epAt = RUN_DATE; got++;   // 오늘 긁음 스탬프
      }
      const info = await page.evaluate(async (id) => { try { const r = await fetch(`/api/article/list/info?titleId=${id}`, { credentials: "include" }); if (!r.ok) return null; return await r.json(); } catch (e) { return null; } }, id);
      if (info && info.favoriteCount != null) { det[id].fav = info.favoriteCount; det[id].favAt = RUN_DATE; gotFav++; }   // 성인 관심수 매일 갱신(info는 CDP 로그인세션에서만 열림)
    } catch (e) {}
    done++;
    if (done % 10 === 0) { fs.writeFileSync(path.join(D, "details.json"), JSON.stringify(det)); console.log("  성인 유무료 " + done + "/" + ids.length + " (유무료 " + got + " · 관심수 " + gotFav + ")"); }
    await sleep(dmin + Math.floor(Math.random() * Math.max(0, dmax - dmin)));
  }
  fs.writeFileSync(path.join(D, "details.json"), JSON.stringify(det));
  const eh = C.updateEpHistory(D, RUN_DATE, det);    // 오늘 새로 긁은 성인작 무료/유료만 기록
  const fh = C.updateFavHistory(D, RUN_DATE, det);   // 오늘 새로 긁은 성인작 관심수만 기록
  console.log(`성인 무료/유료 완료: ${got}개 · 관심수 ${gotFav}개 · ep_history ${JSON.stringify(eh)} · fav_history ${JSON.stringify(fh)}`);
  return got;
}
/* 성인 시리즈 단가(대여/소장 쿠키). volumeList.series는 성인작은 로그아웃 차단 → CDP(로그인+연령확인) 세션으로 수집.
   대여·소장 둘 다 있는 회차의 최빈값(최신화는 대여 미개방일 수 있음). 가격은 거의 안 변해 own 있으면 스킵(1회면 충분). */
function priceFromVolumes(j) {
  const vols = (j && j.resultData) || [];
  if (!vols.length) return null;
  const mode = (arr, key) => { const c = {}; arr.forEach(v => { const k = key(v); c[k] = (c[k] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]; };
  const paid = vols.filter(v => v.lendPassCount > 0 && v.buyPassCount > 0);
  if (paid.length) { const [rent, own] = mode(paid, v => v.lendPassCount + "/" + v.buyPassCount).split("/").map(Number); return { rent, own }; }
  const buyOnly = vols.filter(v => v.buyPassCount > 0);
  if (buyOnly.length) { const own = Number(mode(buyOnly, v => String(v.buyPassCount))); return { rent: Math.max(0, own - 2), own }; }
  return null;
}
async function collectAdultPrices(page, opts = {}) {
  const { cap = Infinity, dmin = 400, dmax = 900 } = opts;
  const sd = readJSON("series_details.json", {});
  const extra = readJSON("series_extra.json", { adult: [] });
  const adult = new Set((extra.adult || []).map(Number));
  let targets = Object.keys(sd).filter(pn => sd[pn] && sd[pn].kind === "comic" && sd[pn].dl && !sd[pn].own && adult.has(Number(pn)));
  if (targets.length > cap) targets = targets.slice(0, cap);
  console.log("성인 단가(쿠키) 대상 " + targets.length + "개");
  if (!targets.length) return 0;
  try { await page.goto("https://series.naver.com/", { waitUntil: "domcontentloaded", timeout: 30000 }); } catch (e) {}
  let got = 0, done = 0;
  for (const pn of targets) {
    try {
      const j = await page.evaluate(async (pn) => { try { const r = await fetch(`/comic/volumeList.series?productNo=${pn}&sortOrder=DESC&totalCount=30`, { credentials: "include" }); if (!r.ok) return null; return await r.json(); } catch (e) { return null; } }, pn);
      const p = priceFromVolumes(j);
      if (p) { sd[pn].rent = p.rent; sd[pn].own = p.own; got++; }
    } catch (e) {}
    done++;
    if (done % 20 === 0) { fs.writeFileSync(path.join(D, "series_details.json"), JSON.stringify(sd)); console.log("  성인 단가 " + done + "/" + targets.length + " (" + got + ")"); }
    await sleep(dmin + Math.floor(Math.random() * Math.max(0, dmax - dmin)));
  }
  fs.writeFileSync(path.join(D, "series_details.json"), JSON.stringify(sd));
  console.log(`성인 단가 완료: ${got}개`);
  return got;
}

(async () => {
  // --cdp: 사용자가 직접 켠 '진짜 크롬'(원격 디버깅)에 붙어서, 사람이 로그인/연령확인한 세션으로 아주 천천히 조금씩 수집 (계정 부담 최소화)
  if (CDP) {
    await healPages(); // 멈춘 탭 자동 복구(connectOverCDP가 hung 탭에 막히는 문제 방지)
    let browser;
    try { browser = await chromium.connectOverCDP("http://localhost:9222"); }
    catch (e) { console.log("❌ 디버그 크롬에 연결 실패 — 먼저 chrome_debug.bat 로 크롬을 켜고 네이버 로그인+연령확인 하세요."); process.exit(1); }
    const context = browser.contexts()[0] || await browser.newContext();
    const page = context.pages()[0] || await context.newPage();
    if (PUSH) { try { execSync(`git -C "${ROOT}" pull --rebase --autostash -X theirs origin main`, { stdio: "inherit" }); } catch (e) {} }
    if (!FAVONLY && !PRICEONLY && readJSON("series_extra.json", {}).cdpDate === RUN_DATE) { console.log("✅ 오늘 이미 성인 수집 완료 — 스킵(하루 1번)"); await browser.close(); return; }
    if (!(await adultOk(context))) { console.log("❌ 아직 성인 접근 안 됨(연령확인 대기) — 다음 재시도 때 다시 시도합니다."); await browser.close(); process.exit(2); }
    console.log(`✅ 진짜 크롬 세션으로 성인 접근 OK — ${PRICEONLY ? "단가만 수집" : FAVONLY ? "관심수만 갱신" : "최대 " + MAX + "개 수집"}(2~4.5초 간격)`);
    const got = (FAVONLY || PRICEONLY) ? 0 : await collectAll(page, { cap: MAX, dmin: 2000, dmax: 4500 }); // 매일 전체 갱신용(적당히 천천히)
    let gotCharge = 0;
    if (!PRICEONLY) { try { gotCharge = await collectAdultCharge(page, { cap: MAX, dmin: 1500, dmax: 3500 }); } catch (e) { console.log("성인 무료/유료 실패:", e.message); } }
    let gotPrice = 0;
    if (!FAVONLY) { try { gotPrice = await collectAdultPrices(page, { cap: 3000 }); } catch (e) { console.log("성인 단가 실패:", e.message); } } // 단가는 1회성(own 있으면 스킵) — 첫 실행에 전부 채움
    await browser.close(); // CDP는 disconnect만 (사용자 크롬은 그대로 열려있음)
    if (PUSH && (got > 0 || gotCharge > 0 || gotPrice > 0)) pushData();
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
