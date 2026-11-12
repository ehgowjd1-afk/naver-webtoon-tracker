/* 네이버 시리즈 앱(com.nhn.android.nbooks, 코믹스) 화면을 USB 폰으로 읽기 — 사이트 '시리즈 › 앱' 순위 · '앱 배너·이벤트'.
 *  - 랭킹: 일간·주간·월간 × 전체·순정·BL·드라마·소년·무협, 각 100위. 앱 랭킹은 웹(series.naver.com)·모바일웹과 순위가 다름
 *    (2026-11-12 일간: 앱 재혼 황후·화산귀환·울어 봐 빌어도 좋고… / 웹 화산귀환·별을 품은 소드마스터·일렉시드…) → 폰으로만 얻음.
 *  - 홈 배너(추천 탭 맨 위 슬라이드, 보통 15개)·이벤트 탭 목록: 앱에서만 나옴 → 화면을 잘라 이미지로 저장(처음 본 것만), 날마다 노출 여부를 쌓아 기간을 봄.
 * 저장: docs/data/series_app.json = {date, updated, listDates{기간_장르:날짜}, rank{DAILY|WEEKLY|MONTHLY:{전체장르|순정|BL|드라마|소년|무협:[{r,t,m,b[],dl?,id?,th?}]}},
 *         strips{기간_장르:랭킹 위 띠 문구}, names{정규화 제목:{id,th}}}
 *       docs/data/series_app_history.json = {dates[], series{기간_장르:{정규화 제목:[순위…]}}, names{정규화 제목:제목}} (최근 60일)
 *       docs/data/series_app_promo.json = {date, banners{이름:{img,days[]}}, events{키:{t,sub,left,img,det,days[]}}, today{bdate,banners[],edate,events[]}}
 *       docs/data/series_app/ — b_*.jpg 홈 배너 · e_*.jpg 이벤트 칸 · ed_*.jpg 이벤트 눌렀을 때 첫 화면 · th_*.jpg 웹에서 표지를 못 구한 작품(성인 등) 표지
 * node scripts/collect_series_app.js [--push] [--only=rank,banner,event] [--force] [--dry]
 */
const fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");
const { execFileSync } = require("child_process");
const P = require("./lib/adb_phone.cjs");
const { adb, wait, dump, tap, swipe, log } = P;

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "docs", "data");
const IMG = path.join(OUT, "series_app");
const SPKG = "com.nhn.android.nbooks";
const args = process.argv.slice(2);
const PUSH = args.includes("--push"), FORCE = args.includes("--force"), DRY = args.includes("--dry");
const ONLY = ((args.find((a) => a.startsWith("--only=")) || "").split("=")[1] || "rank,banner,event").split(",");
const TODAY = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const PERIODS = [["DAILY", "일간"], ["WEEKLY", "주간"], ["MONTHLY", "월간"]];
const GENRES = [["전체장르", "전체"], ["순정", "순정"], ["BL", "BL"], ["드라마", "드라마"], ["소년", "소년"], ["무협", "무협"]];
const TOPN = 100;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } };
const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
const hash = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 10);
const F_RANK = path.join(OUT, "series_app.json"), F_HIST = path.join(OUT, "series_app_history.json"), F_PROMO = path.join(OUT, "series_app_promo.json");

/* 화면 캡처 → 칸 잘라 JPEG(lib/crop.ps1). 잘라낸 파일은 docs/data/series_app/ */
const SHOT = path.join(os.tmpdir(), "series_app_shot.png"), JOBS = path.join(os.tmpdir(), "series_app_jobs.json");
function shot() { fs.writeFileSync(SHOT, execFileSync(P.ADB, ["exec-out", "screencap", "-p"], { maxBuffer: 64 * 1024 * 1024, timeout: 30000 })); }
function crop(jobs) {   // [{x,y,w,h,s,f}] — 마지막 shot()에서 자름
  if (!jobs.length || DRY) return;
  fs.mkdirSync(IMG, { recursive: true });
  fs.writeFileSync(JOBS, JSON.stringify(jobs.map((j) => ({ x: j.x, y: j.y, w: j.w, h: j.h, s: j.s, out: path.join(IMG, j.f) }))));
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "lib", "crop.ps1"), "-In", SHOT, "-Jobs", JOBS], { stdio: "inherit", timeout: 60000 });
}
const has = (f) => fs.existsSync(path.join(IMG, f));

/* 앱 이동 */
function openApp() {
  adb("shell", "am", "force-stop", SPKG); wait(1000);   // 늘 홈 첫 화면에서 시작(전에 열어 둔 이벤트 화면 등에서 이어지지 않게)
  adb("shell", "monkey", "-p", SPKG, "-c", "android.intent.category.LAUNCHER", "1");
  if (!P.waitFocus(/nbooks\/.*MainActivity/, 20000)) throw new Error("시리즈 앱이 안 열림");
  wait(3500);
  // 첫 화면 안내: 알림 받기 → '다음에 할게요', 이벤트 팝업 → '닫기'('이 이벤트 다시 보지 않기'는 안 누름)
  for (let k = 0; k < 4; k++) {
    const nodes = dump();
    const later = nodes.find((n) => n.t === "다음에 할게요" && n.b.length);
    if (later) { tap(later.b); wait(1500); continue; }
    if (P.dismissPopups(nodes)) continue;
    const comix = nodes.find((n) => /코믹스 탭/.test(n.d) && n.b.length);
    if (comix && !/^선택됨/.test(comix.d)) { tap(comix.b); wait(2500); continue; }   // NOVEL 쪽이 열려 있으면 COMIX로
    break;
  }
}
function bottomTab(name) {   // 아래 탭: 홈·무료박스·이벤트·검색·보관함
  const n = dump().find((x) => x.d === name && x.cls === "FrameLayout" && x.b.length && x.b[1] > 1900);
  if (!n) throw new Error(`아래 '${name}' 탭을 못 찾음`);
  tap(n.b); wait(2500);
}
function topTab(name) {      // 위 탭: 추천·랭킹·신작·단행본·연령별랭킹
  const n = dump().find((x) => x.d === name && x.cls === "LinearLayout" && x.b.length && x.b[1] < 400);
  if (!n) throw new Error(`위 '${name}' 탭을 못 찾음`);
  tap(n.b); wait(2500);
}
function tapText(t, where) {
  const n = dump().find((x) => x.t === t && x.b.length && where(x));
  if (!n) return false;
  tap(n.b); wait(2500); return true;
}
const flingTop = (n = 14) => { for (let i = 0; i < n; i++) swipe(540, 600, 540, 1800, 100); wait(1500); };

/* ── 홈 배너 ─────────────────────────────────────────── */
// 슬라이드 가운데 칸 View [43,353,1037,1115] desc = 배너 이름(운영용 이름: '정기_11/12 타임딜', '웹_요일_보스의노골적취향_드라마방영[스토리펀치,JA]' 등)
// 옆 칸 '총 배너 15개 중 7번째 배너 표시 중'. 슬라이드는 5.4초마다 저절로 넘어가고, 손으로 밀면 그때부터 다시 5.3초(2026-11-12 잼)
// → 밀고 0.7초 뒤 캡처, 그다음 화면 읽기(읽기 2.7초)까지 다음 자동 넘김 전에 끝나므로 캡처와 읽은 이름이 같은 배너
function readBanners() {
  bottomTab("홈"); topTab("추천"); flingTop(6);
  const isCen = (n) => n.cls === "View" && n.b.length && n.b[0] >= 20 && n.b[0] <= 80 && n.b[2] - n.b[0] > 800 && n.b[1] > 250 && n.b[1] < 500 && n.d && !/^총 배너/.test(n.d);
  const ind = (nodes) => { const x = nodes.find((n) => /^총 배너 \d+개 중 \d+번째/.test(n.d)); return x ? x.d.match(/^총 배너 (\d+)개 중 (\d+)번째/).slice(1).map(Number) : null; };
  const I0 = ind(dump()); if (!I0) throw new Error("홈 배너 슬라이드를 못 찾음");
  const total = I0[0], got = new Map();
  for (let k = 0; k < total * 3 && got.size < total; k++) {
    swipe(900, 730, 160, 730, 250); wait(700); shot();
    const nodes = dump(), I = ind(nodes), cen = nodes.find(isCen);
    if (!I || !cen || got.has(I[1])) continue;
    const f = "b_" + hash(cen.d) + ".jpg";
    if (!has(f)) crop([{ x: cen.b[0], y: cen.b[1], w: cen.b[2] - cen.b[0], h: cen.b[3] - cen.b[1], s: 0.5, f }]);
    got.set(I[1], { name: cen.d, img: f });
  }
  log(`  홈 배너 ${got.size}/${total}개`);
  return [...got.entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1]);
}

/* ── 이벤트 탭 ───────────────────────────────────────── */
// 칸 = 가로 전체 Button(높이 ~336), 안의 TextView: 제목 · 부제 · (저작권 줄) · 남은 기간('7일 남음'·'오늘 마감')
// 처음 본 이벤트는 칸 이미지 + 눌렀을 때 첫 화면(ed_)도 저장
function readEvents() {
  bottomTab("이벤트");
  tapText("전체", (n) => n.b[1] > 200 && n.b[1] < 360);
  flingTop(8);
  const got = new Map(); let stale = 0;
  const LEFT = /(남음|마감|상시|종료|D-\d+)$/;
  for (let i = 0; i < 50 && stale < 3; i++) {
    let nodes = dump();
    const cards = nodes.filter((n) => n.cls === "Button" && n.b.length && n.b[0] === 0 && n.b[2] >= 1000 && n.b[3] - n.b[1] > 150 && n.b[1] >= 380);
    const before = got.size, jobs = [], fresh = [];
    for (const c of cards) {
      const tv = nodes.filter((n) => n.cls === "TextView" && n.t && n.b.length && n.b[1] >= c.b[1] && n.b[3] <= c.b[3] + 2).sort((a, b) => a.b[1] - b.b[1]);
      if (!tv.length) continue;
      const left = (tv.find((n) => LEFT.test(n.t)) || {}).t || "";
      const rest = tv.filter((n) => !LEFT.test(n.t) && !/©|ⓒ|\(c\)|copyright/i.test(n.t));
      const t = (rest[0] || {}).t || "", sub = (rest[1] || {}).t || "";
      if (!t) continue;
      const key = t + " | " + sub;
      const full = c.b[3] <= 2028 && c.b[1] >= 400;
      if (!got.has(key)) got.set(key, { key, t, sub, left, img: "", det: "" });
      const e = got.get(key);
      if (!e.img && full) {
        e.img = "e_" + hash(key) + ".jpg";
        if (!has(e.img)) { jobs.push({ x: 42, y: c.b[1], w: 996, h: Math.max(100, c.b[3] - c.b[1] - 22), s: 0.5, f: e.img }); fresh.push([e, c]); }
      }
    }
    if (jobs.length) { shot(); crop(jobs); }
    // 처음 본 이벤트: 눌러서 첫 화면 저장 → 뒤로
    for (const [e, c] of fresh) {
      const f = "ed_" + hash(e.key) + ".jpg";
      if (has(f)) { e.det = f; continue; }
      tap([c.b[0], c.b[1], c.b[2], c.b[1] + 200]); wait(4000);
      if (!/MainActivity/.test(P.focus())) { shot(); crop([{ x: 0, y: 216, w: 1080, h: 1810, s: 0.4, f }]); e.det = f; }
      P.back(); wait(2000);
      if (!/nbooks\/.*MainActivity/.test(P.focus())) { P.back(); wait(2000); }
    }
    if (got.size === before) stale++; else stale = 0;
    swipe(540, 1750, 540, 750, 600); wait(1200);
  }
  for (const e of got.values()) { if (!e.det && has("ed_" + hash(e.key) + ".jpg")) e.det = "ed_" + hash(e.key) + ".jpg"; if (!e.img && has("e_" + hash(e.key) + ".jpg")) e.img = "e_" + hash(e.key) + ".jpg"; }
  log(`  이벤트 ${got.size}개`);
  return [...got.values()];
}

/* ── 랭킹 ───────────────────────────────────────────── */
// 칸 = Button desc '제목, [19세 이상 열람가,] [새 회차 업데이트,] [매일10시무료 적용,] N위, [N단계 상승|하락 | 신규 진입,] [N화 무료 | 다운로드 수 N만건 | 광고보고무료]'
// 제목에 쉼표가 들어간 작품(울어 봐, 빌어도 좋고)이 있어 처음 나오는 표시 칸 앞까지를 제목으로
const FLAG = /^(신작|19세 이상 열람가|만 \d+세 이상 열람가|새 회차 업데이트|.+ 적용|\d+위|\d+단계 (상승|하락)|신규 진입|다운로드 수 .+건|\d+[화권] 무료|광고보고 ?무료|.*무료)$/;
function parseCard(d) {
  const parts = d.split(", ");
  const k = parts.findIndex((p, i) => i > 0 && FLAG.test(p));
  if (k < 0) return null;
  const fl = parts.slice(k), rk = fl.find((x) => /^\d+위$/.test(x));
  if (!rk) return null;
  const row = { r: parseInt(rk, 10), t: parts.slice(0, k).join(", "), m: 0, b: [] };
  for (const x of fl) {
    let m;
    if ((m = x.match(/^(\d+)단계 (상승|하락)$/))) row.m = m[2] === "상승" ? +m[1] : -m[1];
    else if (x === "신규 진입") row.b.push("신규");
    else if (x === "신작") row.b.push("신작");
    else if (x === "새 회차 업데이트") row.b.push("UP");
    else if (x === "19세 이상 열람가") row.b.push("19금");
    else if (/^만 \d+세 이상 열람가$/.test(x)) row.b.push(x.replace(/^만 (\d+)세.*/, "$1세"));
    else if ((m = x.match(/^다운로드 수 (.+)건$/))) row.dl = m[1];
    else if ((m = x.match(/^(.+) 적용$/))) row.b.push(m[1]);   // 매일10시무료 등
    else if (/무료/.test(x)) row.b.push(x.replace(/^광고보고 무료$/, "광고보고무료"));   // 앱에 두 가지 표기가 섞여 나옴
  }
  return row;
}
function scrapeRank(needTh) {
  const got = new Map(); let stale = 0, strip = "";
  const done = () => { for (let r = 1; r <= TOPN; r++) if (!got.has(r)) return false; return true; };
  for (let i = 0; i < 60 && stale < 3 && !done(); i++) {
    const nodes = dump(), before = got.size, jobs = [];
    if (!i) strip = nodes.filter((n) => n.cls === "TextView" && n.t && n.b.length && n.b[1] > 450 && n.b[3] < 620 && n.b[0] > 150).map((n) => n.t).join(" · ");
    for (const c of nodes) {
      if (c.cls !== "Button" || !c.b.length || !/, \d+위(, |$)/.test(c.d)) continue;
      const row = parseCard(c.d);
      if (!row || row.r > TOPN) continue;
      if (!got.has(row.r)) got.set(row.r, row);
      // 웹에서 표지를 못 구한 작품: 표지가 화면에 다 보이면 잘라 둠(아래 떠 있는 기간 띠·위 장르 칩에 안 가릴 때)
      const k = norm(row.t), w = c.b[2] - c.b[0], h = Math.round(w * 1.4465);
      if (needTh.has(k) && c.b[1] >= 440 && c.b[1] + h <= 1870) { const f = "th_" + hash(k) + ".jpg"; jobs.push({ x: c.b[0], y: c.b[1], w, h, s: 0.5, f }); needTh.delete(k); }
    }
    if (jobs.length) { shot(); crop(jobs); }
    if (got.size === before) stale++; else stale = 0;
    swipe(540, 1750, 540, 750, 600); wait(900);
  }
  return { list: [...got.values()].sort((a, b) => a.r - b.r), strip };
}
function readRanking(prev, idx) {
  bottomTab("홈"); topTab("랭킹");
  const rank = {}, strips = {}, dates = {};
  // 표지 없는 작품(웹 순위·검색에 없거나 성인 표지 가림) — 이미 잘라 둔 것 빼고
  const needTh = new Set(); const want = (t) => { const k = norm(t); if (!(idx[k] && idx[k].th) && !has("th_" + hash(k) + ".jpg")) needTh.add(k); };
  for (const p in prev.rank || {}) for (const g in prev.rank[p]) for (const x of prev.rank[p][g]) want(x.t);
  let lastHead = "";
  for (const [pk, pl] of PERIODS) {
    rank[pk] = {};
    for (const [gk, gl] of GENRES) {
      try {
        tapText(gl, (n) => n.b[1] > 330 && n.b[1] < 470);   // 장르 칩(위에 붙어 있음)
        tapText(pl, (n) => n.b[1] > 1800);                  // 기간 띠(아래 떠 있음)
        flingTop();
        const head = () => dump().filter((n) => n.cls === "Button" && /, \d+위(, |$)/.test(n.d)).slice(0, 6).map((n) => n.d).join("|");
        let h = head();
        if (h && h === lastHead) { wait(2500); h = head(); if (h === lastHead) { tapText(gl, (n) => n.b[1] > 330 && n.b[1] < 470); tapText(pl, (n) => n.b[1] > 1800); flingTop(); h = head(); } }
        if (h && h === lastHead) { log(`  [${pl} · ${gl}] 앞 목록과 같음 — 바뀌지 않은 듯해서 건너뜀`); continue; }
        lastHead = h;
        // 처음 보는 작품도 표지 후보(웹 이름표에 표지 없는 것)
        const r = scrapeRank({ has: (k) => needTh.has(k) || (!(idx[k] && idx[k].th) && !has("th_" + hash(k) + ".jpg")), delete: (k) => needTh.delete(k) });
        if (r.list.length < 10) { log(`  [${pl} · ${gl}] ${r.list.length}개 — 버림`); continue; }
        rank[pk][gk] = r.list; strips[pk + "_" + gk] = r.strip; dates[pk + "_" + gk] = TODAY;
        const miss = []; for (let k = 1; k <= Math.min(TOPN, r.list[r.list.length - 1].r); k++) if (!r.list.some((x) => x.r === k)) miss.push(k);
        log(`  [${pl} · ${gl}] ${r.list.length}개${miss.length ? " · 빠진 순위 " + miss.join(",") : ""} · 1~3위 ${r.list.slice(0, 3).map((x) => x.t).join(", ")}`);
      } catch (e) { log(`  [${pl} · ${gl}] 실패: ${e.message}`); }
    }
  }
  return { rank, strips, dates };
}

/* 제목 → 시리즈 상품번호·표지: 클라우드가 받는 웹·모바일웹 순위(series.json) → 지난번 이름표 → 시리즈 검색(제목 완전 일치) */
function nameIndex(prev) {
  const idx = {}, S = readJSON(path.join(OUT, "series.json"), {});
  const realTh = (th) => (th && !/19over|noimg/.test(th) ? th : "");   // 웹 성인작 표지는 '19' 가림 그림 → 없는 셈 치고 앱 화면에서 자름
  for (const pf of ["web", "mobile"]) for (const c in ((S.comic || {})[pf] || {})) for (const p in S.comic[pf][c]) for (const x of S.comic[pf][c][p]) {
    const k = norm(x.t); if (!idx[k] || (!idx[k].th && realTh(x.th))) idx[k] = { id: x.id, th: realTh(x.th) };
  }
  for (const k in prev.names || {}) if (!idx[k] || (!idx[k].th && prev.names[k].th)) idx[k] = prev.names[k];
  return idx;
}
async function searchSeries(title) {
  try {
    const r = await fetch(`https://series.naver.com/search/search.series?t=all&fs=comic&q=${encodeURIComponent(title)}`, { headers: { "User-Agent": UA, Referer: "https://series.naver.com/" } });
    const h = await r.text();
    for (const m of h.matchAll(/<a href="\/comic\/detail\.series\?productNo=(\d+)" class="N=a:com\.title">([^<]+)/g)) {
      if (norm(m[2].replace(/\(총 [^)]*\)\s*$/, "")) !== norm(title)) continue;   // 검색 제목 뒤 '(총 27화/미완결)'를 떼고 비교
      const im = h.match(new RegExp(`productNo=${m[1]}" class="pic[^"]*">[\\s\\S]*?<img src="([^"]+)"`));
      return { id: +m[1], th: im && !/19over|noimg/.test(im[1]) ? im[1] : "" };
    }
    return { id: 0, th: "" };   // 검색에 없음 — 다시 찾지 않게 기록
  } catch (e) { return null; }
}

function updateHistory(rank) {
  const h = readJSON(F_HIST, { dates: [], series: {}, names: {} });
  let di = h.dates.indexOf(TODAY);
  if (di < 0) { h.dates.push(TODAY); di = h.dates.length - 1; for (const k in h.series) for (const t in h.series[k]) h.series[k][t].push(null); }
  for (const p in rank) for (const g in rank[p]) {
    const S = h.series[p + "_" + g] || (h.series[p + "_" + g] = {});
    for (const t in S) S[t][di] = null;   // 오늘 다시 받은 목록은 오늘 칸을 새로 씀
    for (const x of rank[p][g]) { const k = norm(x.t); const a = S[k] || (S[k] = Array(h.dates.length).fill(null)); a[di] = x.r; h.names[k] = x.t; }
  }
  const keep = 60; if (h.dates.length > keep) { const cut = h.dates.length - keep; h.dates = h.dates.slice(cut); for (const k in h.series) for (const t in h.series[k]) { h.series[k][t] = h.series[k][t].slice(cut); if (h.series[k][t].every((v) => v == null)) delete h.series[k][t]; } }
  if (!DRY) fs.writeFileSync(F_HIST, JSON.stringify(h));
}

(async () => {
  const t0 = Date.now();
  log("시리즈 앱(폰) 수집 시작", TODAY, ONLY.join(","));
  const prev = readJSON(F_RANK, { rank: {}, listDates: {}, names: {}, strips: {} });
  const promo = readJSON(F_PROMO, { banners: {}, events: {}, today: {} });
  const allRank = PERIODS.every(([p]) => GENRES.every(([g]) => (prev.listDates || {})[p + "_" + g] === TODAY));
  if (!FORCE && allRank && promo.today && promo.today.bdate === TODAY && promo.today.edate === TODAY) { log("오늘 다 받음 — 건너뜀"); return; }
  try { P.ensureReady(); if (!adb("shell", "pm", "list", "packages", SPKG).includes(SPKG)) throw new Error("네이버 시리즈 앱이 설치돼 있지 않음"); }
  catch (e) { log("건너뜀:", e.message); return; }
  const idx = nameIndex(prev);
  let R = null, banners = null, events = null;
  try {
    openApp();
    if (ONLY.includes("banner") && (FORCE || promo.today.bdate !== TODAY)) { try { banners = readBanners(); } catch (e) { log("  홈 배너 실패:", e.message); } }
    if (ONLY.includes("event") && (FORCE || promo.today.edate !== TODAY)) { try { events = readEvents(); } catch (e) { log("  이벤트 실패:", e.message); } }
    if (ONLY.includes("rank") && (FORCE || !allRank)) { try { R = readRanking(prev, idx); } catch (e) { log("  랭킹 실패:", e.message); } }
  } catch (e) { log("실패:", e.message); }
  finally { try { adb("shell", "am", "force-stop", SPKG); } catch (e) {} P.finish(); }

  const paths = [];
  // 배너·이벤트: 날짜별 노출 기록
  if ((banners && banners.length) || (events && events.length)) {
    if (banners && banners.length) {
      for (const b of banners) { const e = promo.banners[b.name] || (promo.banners[b.name] = { img: b.img, days: [] }); if (!e.days.includes(TODAY)) e.days.push(TODAY); if (!e.img) e.img = b.img; }
      promo.today.bdate = TODAY; promo.today.banners = banners.map((b) => b.name);
    }
    if (events && events.length) {
      for (const v of events) { const e = promo.events[v.key] || (promo.events[v.key] = { t: v.t, sub: v.sub, days: [] }); e.left = v.left; if (v.img) e.img = v.img; if (v.det) e.det = v.det; if (!e.days.includes(TODAY)) e.days.push(TODAY); }
      promo.today.edate = TODAY; promo.today.events = events.map((v) => v.key);
    }
    promo.date = TODAY; promo.updated = new Date().toISOString();
    if (!DRY) fs.writeFileSync(F_PROMO, JSON.stringify(promo));
    paths.push("docs/data/series_app_promo.json");
  }
  // 랭킹: 상품번호·표지 채우기(모르는 제목만 검색)
  if (R && Object.values(R.rank).some((g) => Object.keys(g).length)) {
    const names = { ...(prev.names || {}) };
    let searched = 0;
    for (const p in R.rank) for (const g in R.rank[p]) for (const x of R.rank[p][g]) {
      const k = norm(x.t);
      if (!idx[k] && !(k in names) && searched < 300) { const s = await searchSeries(x.t); searched++; if (s) { names[k] = s; idx[k] = s; } await new Promise((r) => setTimeout(r, 150)); }
      const e = idx[k] || names[k];
      if (e && e.id) x.id = e.id;
      const th = (e && e.th) || (has("th_" + hash(k) + ".jpg") ? "data/series_app/th_" + hash(k) + ".jpg" : "");
      if (th) x.th = th;
      if (e && e.id) names[k] = { id: e.id, th: (e && e.th) || "" };
    }
    const out = { date: TODAY, updated: new Date().toISOString(), listDates: { ...(prev.listDates || {}) }, rank: { ...(prev.rank || {}) }, strips: { ...(prev.strips || {}) }, names };
    for (const p in R.rank) { out.rank[p] = { ...(out.rank[p] || {}) }; for (const g in R.rank[p]) { out.rank[p][g] = R.rank[p][g]; out.listDates[p + "_" + g] = TODAY; out.strips[p + "_" + g] = R.strips[p + "_" + g] || ""; } }
    const n = Object.values(R.rank).reduce((s, g) => s + Object.keys(g).length, 0), noId = Object.values(R.rank).flatMap((g) => Object.values(g).flat()).filter((x) => !x.id).length;
    log(`  랭킹 ${n}개 목록 · 검색 ${searched}건 · 상품번호 못 찾은 칸 ${noId}`);
    if (!DRY) fs.writeFileSync(F_RANK, JSON.stringify(out));
    updateHistory(R.rank);
    paths.push("docs/data/series_app.json", "docs/data/series_app_history.json");
  }
  if (fs.existsSync(IMG)) paths.push("docs/data/series_app");
  log(`결과 · 배너 ${banners ? banners.length : "-"} · 이벤트 ${events ? events.length : "-"} · ${((Date.now() - t0) / 60000).toFixed(1)}분`);
  if (PUSH && !DRY && paths.length) P.pushPaths(ROOT, paths, `local: 시리즈 앱 순위·배너(폰) ${TODAY}`);
})();
