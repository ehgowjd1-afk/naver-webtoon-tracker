/* 앱 요일별 인기순(전체·매일+·월~일)을 USB로 연결한 안드로이드 폰의 네이버웹툰 앱 화면에서 읽어 저장.
 * 신작 탭도 같이(정렬은 탭마다 따로 — 신작은 원래 업데이트순).
 * 웹툰 탭 → 정렬을 '인기순'으로(끝나면 사용자가 쓰던 정렬로 되돌림) → 탭마다 끝까지 스크롤하며 3열 목록 글자를 읽음.
 * 목록은 '따끈따끈! 업데이트 매일+' 같은 구역 제목이 나오는 곳에서 끝남(그 아래 칸은 다른 구역).
 * m.comic(모바일 웹) 인기순과 실제 앱 순서는 다름(2026-10-18 목요일 같은 자리 8/110) → 사이트 '요일별 › 앱'은 이 데이터.
 * 저장: docs/data/app_weekday.json = {date, updated, tabDates:{탭:날짜}, tabs:{all|all_f|all_m(전체 탭 여성·남성 인기순)|new|dailyPlus|mon..sun:[{r,t,a,id,th?,b[]}]}}
 *       docs/data/app_weekday_history.json = {dates:[], series:{탭:{titleId:[순위…]}}, names:{titleId:[제목,작가,썸네일]}} (최근 60일) — 사이트 달력으로 그날 순위·전날 대비 ▲▼
 *       docs/data/app_weekday_newtrack.json = 신작(런칭 18주 안)만 130일 보관(scripts/lib/app_newtrack.cjs) — 요일별 › 앱 요약의 신작 18주 추적
 *   node scripts/collect_app_weekday.js [--push] [--tabs=all,mon] [--dry] [--force]
 */
const fs = require("fs");
const path = require("path");
const P = require("./lib/adb_phone.cjs");
const { adb, wait, log, dump, tap, swipe, toTop, dismissPopups } = P;

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "docs", "data");
const args = process.argv.slice(2);
const PUSH = args.includes("--push"), DRY = args.includes("--dry"), FORCE = args.includes("--force");
const ONLY = ((args.find((a) => a.startsWith("--tabs=")) || "").slice(7)).split(",").filter(Boolean);
const TODAY = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const ALL_MAX = 500;   // 전체 탭은 2천 개가 넘어(28분) 상위 500위까지만
// 탭마다 인기순·여성 인기순·남성 인기순 셋 다(키: all · all_f · all_m, mon · mon_f · mon_m …). --gender-only = 여성·남성만(인기순은 이미 받은 날)
const SORT_KEYS = { "인기순": "", "여성 인기순": "_f", "남성 인기순": "_m" };
const ALL3 = ["인기순", "여성 인기순", "남성 인기순"];
const SORTS = args.includes("--gender-only") ? ["여성 인기순", "남성 인기순"] : ALL3;
const TABS = [["all", "전체"], ["new", "신작"], ["dailyPlus", "매일+"], ["mon", "월요 연재"], ["tue", "화요 연재"], ["wed", "수요 연재"], ["thu", "목요 연재"], ["fri", "금요 연재"], ["sat", "토요 연재"], ["sun", "일요 연재"]];
const TABNAMES = new Set(["전체", "신작", "매일+", "월요 연재", "화요 연재", "수요 연재", "목요 연재", "금요 연재", "토요 연재", "일요 연재", "완결"]);
// 탭 줄 위치는 '신작'을 빼고 잡음 — 썸네일 위 '신작' 표시도 같은 이름이라서
const ANCHORS = new Set([...TABNAMES].filter((x) => x !== "신작"));
const barNodes = (nodes) => nodes.filter((n) => ANCHORS.has(n.d) && n.b.length);
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } };

const sortNode = (nodes) => nodes.find((n) => / 기준으로 정렬$/.test(n.d) && n.b.length);
const sortLabel = (nodes) => { const s = sortNode(nodes); return s ? s.d.replace(/ 기준으로 정렬$/, "") : ""; };
function setSort(label) {   // 상단 정렬 바텀시트에서 고름(열리는 데 시간이 걸려 기다린 뒤 탭)
  let nodes = dump(); if (sortLabel(nodes) === label) return true;
  const s = sortNode(nodes); if (!s) return false;
  tap(s.b); wait(2500);
  const opt = dump().find((n) => n.cls === "TextView" && n.t === label && n.b.length);
  if (!opt) { P.back(); wait(1000); return false; }
  tap(opt.b); wait(2500);
  return sortLabel(dump()) === label;
}
function openHome() {
  adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "'webtoonkr://default?version=1'", P.PKG);
  if (!P.waitFocus(/main\.MainActivity/)) throw new Error("앱 홈이 안 열림");
  wait(2500);
  let nodes = dump(); if (dismissPopups(nodes)) nodes = dump();
  const web = nodes.find((n) => n.d === "웹툰" && n.b.length && n.b[1] > 1900);   // 아래 '웹툰' 탭
  if (web) { tap(web.b); wait(1500); }
}
// 탭 줄에서 탭 찾아 누르기(가로로 밀려 안 보이면 좌우로 밀어 봄)
function selectTab(label) {
  for (let k = 0; k < 4; k++) {
    const nodes = dump();
    const bar = barNodes(nodes), rowY = bar.length ? bar[0].b[1] : -1;   // 탭 줄과 같은 줄에 있는 것만 탭으로 봄
    const t = nodes.find((n) => n.d === label && n.b.length && n.b[1] === rowY && n.b[2] - n.b[0] > 40 && n.b[0] >= 0 && n.b[2] <= 1080);
    if (t) { tap(t.b); wait(2200); return true; }
    const any = bar[0];
    if (!any) { toTop(); continue; }
    const y = Math.round((any.b[1] + any.b[3]) / 2);
    if (k % 2 === 0) swipe(950, y, 150, y, 300); else swipe(150, y, 950, y, 300);   // 오른쪽 탭(금~일) ↔ 왼쪽 탭(전체)
    wait(800);
  }
  return false;
}
function parseItem(d) {
  const t = (d.match(/^작품명 (.+?), 작가명 /) || [])[1] || d.slice(4).split(", ")[0];
  const a = (d.match(/, 작가명 (.+?), 별점 /) || [])[1] || "";
  const b = [];
  if (/(^|, )신작(,|$)/.test(d)) b.push("신작");
  if (/휴재/.test(d)) b.push("휴재");
  if (/업데이트 회차 있음/.test(d)) b.push("UP");
  if (/만 18세 이상/.test(d)) b.push("19금");
  return { t: t.trim(), a, b };
}
// 지금 탭 목록을 끝(구역 제목)까지 읽기. lastEnd = 마지막으로 읽은 목록이 끝난 이유(짧게 읽혔을 때 로그용)
let lastEnd = "";
function scrapeTab(max = Infinity) {
  const got = new Map(); let stale = 0, ended = false, headTxt = "", i = 0;
  for (; i < 400 && !ended && stale < 3 && got.size < max; i++) {
    const nodes = dump();
    const bar = barNodes(nodes);
    const barY = bar.length ? Math.max(...bar.map((n) => n.b[3])) : 0;
    const head = nodes.find((n) => n.cls === "TextView" && n.t && n.b.length && n.b[1] > barY && n.b[1] < 2028 && n.b[2] - n.b[0] > 500);
    const endY = head ? head.b[1] : 99999; if (head) { ended = true; headTxt = head.t; }
    const items = nodes.filter((n) => n.cls === "Button" && /^작품명 /.test(n.d) && n.b.length && n.b[1] >= barY - 10 && n.b[1] < endY && n.b[3] <= 2030)
      .sort((a, b) => a.b[1] - b.b[1] || a.b[0] - b.b[0]);
    let added = 0;
    for (const n of items) { const it = parseItem(n.d); if (!got.has(it.t)) { got.set(it.t, it); added++; } }
    stale = added ? 0 : stale + 1;
    if (!ended) { swipe(540, 1900, 540, 900, 900); wait(600); }
  }
  lastEnd = ended ? `구역 제목 '${headTxt}'` : got.size >= max ? "상한" : stale >= 3 ? "3번 밀어도 새 작품 없음" : `${i}번 밀고 멈춤`;
  return [...got.values()].slice(0, max).map((x, i) => ({ r: i + 1, ...x }));
}

function updateHistory(tabs) {
  const fp = path.join(OUT, "app_weekday_history.json");
  const h = readJSON(fp, { dates: [], series: {} });
  let di = h.dates.indexOf(TODAY);
  if (di < 0) { h.dates.push(TODAY); di = h.dates.length - 1; for (const k in h.series) for (const id in h.series[k]) h.series[k][id].push(null); }
  for (const [tab, list] of Object.entries(tabs)) {
    const S = h.series[tab] || (h.series[tab] = {});
    for (const id in S) S[id][di] = null;   // 오늘 다시 받은 탭은 오늘 칸을 새로 씀
    for (const x of list) { if (!x.id) continue; const a = S[x.id] || (S[x.id] = Array(h.dates.length).fill(null)); a[di] = x.r; }
    h.names = h.names || {}; for (const x of list) if (x.id) h.names[x.id] = [x.t, x.a || "", x.th || ""];   // 지난 날짜 순위를 사이트에서 다시 그릴 때 제목·작가·썸네일
  }
  const keep = 60; if (h.dates.length > keep) { const cut = h.dates.length - keep; h.dates = h.dates.slice(cut); for (const k in h.series) for (const id in h.series[k]) { h.series[k][id] = h.series[k][id].slice(cut); if (h.series[k][id].every((v) => v == null)) delete h.series[k][id]; } }
  fs.writeFileSync(fp, JSON.stringify(h));
}

(async () => {
  const t0 = Date.now();
  log(`앱 요일별 인기순(폰) 수집 시작 ${TODAY}${DRY ? " [dry]" : ""}`);
  const prev = readJSON(path.join(OUT, "app_weekday.json"), { tabs: {}, tabDates: {} });
  const KEYS = TABS.flatMap(([k]) => ALL3.map((x) => k + SORT_KEYS[x]));
  if (!FORCE && !ONLY.length && KEYS.every((k) => (prev.tabDates || {})[k] === TODAY)) { log("오늘 다 받음 — 건너뜀"); return; }
  try { P.ensureReady(); } catch (e) { log("건너뜀:", e.message); return; }
  // 정렬은 탭마다 따로 기억됨(전체 탭만 '알아서 딱!'인 식) → 탭마다 인기순으로 바꿔 읽고, 바꾼 탭은 끝나고 원래 정렬로 되돌림
  const tabs = {}, changed = [];
  try {
    openHome();
    for (const [key, label] of TABS) {
      if (ONLY.length && !ONLY.includes(key)) continue;
      try {
        toTop();
        if (!selectTab(label)) { log(`  [${label}] 탭을 못 찾음`); continue; }
        const orig = sortLabel(dump());
        const lists = {}, ends = {};   // 정렬별로 읽은 목록·끝난 이유
        const read = (so) => {
          if (sortLabel(dump()) !== so) { if (!setSort(so)) { log(`  [${label}] 정렬을 ${so}으로 못 바꿈(지금: ${sortLabel(dump()) || "?"})`); return null; } toTop(); }
          const list = scrapeTab(key === "all" ? ALL_MAX : Infinity); ends[so] = lastEnd;
          log(`  [${label} · ${so}] ${list.length}개 · 1~3위 ${list.slice(0, 3).map((x) => x.t).join(", ")}`);
          return list;
        };
        for (const so of SORTS) { const l = read(so); if (l) lists[so] = l; }
        // 한 탭은 정렬만 다르고 작품은 같음 → 어느 정렬만 3개 이상 짧으면(스크롤이 중간에 끊김) 한 번 더 읽어 긴 쪽을 씀.
        // 2026-10-24 목요 인기순이 100에서 끊겨 101~114위가 빠짐(여성·남성은 114). 같은 탭 다른 정렬이 없을 때만 전에 받은 같은 목록 길이와 비교
        // (정렬끼리 개수가 같으면 작품이 실제로 빠진 것 — 2026-10-31 월요 125→122는 세 정렬·다시 읽기 모두 122)
        if (key !== "all") for (const so of Object.keys(lists)) {
          const lens = Object.values(lists).map((l) => l.length);
          const want = lens.length > 1 ? Math.max(...lens) : Math.max(lens[0], ((prev.tabs || {})[key + SORT_KEYS[so]] || []).length);
          if (want - lists[so].length < 3) continue;
          log(`  [${label} · ${so}] ${lists[so].length}개로 짧음(기대 ${want}, 끝난 이유: ${ends[so]}) — 한 번 더 읽음`);
          const again = read(so);
          if (again && again.length > lists[so].length) lists[so] = again;
        }
        for (const so in lists) if (lists[so].length >= 10) tabs[key + SORT_KEYS[so]] = lists[so];
        if (orig && orig !== sortLabel(dump())) changed.push([label, orig]);   // 끝나고 원래 정렬로
      } catch (e) { log(`  [${label}] 실패: ${e.message}`); }
    }
  } catch (e) { log("실패:", e.message); }
  finally {
    for (const [label, orig] of changed) {
      try { toTop(); if (orig && selectTab(label)) log(setSort(orig) ? `  [${label}] 정렬 되돌림: ${orig}` : `  ⚠ [${label}] 정렬을 ${orig}(으)로 못 되돌림`); } catch (e) {}
    }
    P.finish();
  }
  if (!Object.keys(tabs).length) { log("받은 탭 없음"); return; }

  const lookup = readJSON(path.join(OUT, "lookup.json"), { id: {}, name: {} });
  const uniq = new Map(); for (const l of Object.values(tabs)) for (const x of l) if (!uniq.has(x.t)) uniq.set(x.t, { t: x.t });
  const filled = await P.fillIds([...uniq.values()], lookup);
  const byT = new Map(filled.map((x) => [x.t, x]));
  for (const l of Object.values(tabs)) for (const x of l) { const f = byT.get(x.t); if (f && f.id) { x.id = f.id; if (f.th) x.th = f.th; } }
  log("결과", JSON.stringify(Object.fromEntries(Object.entries(tabs).map(([k, v]) => [k, v.length]))), `id없음 ${filled.filter((x) => !x.id).length}`, `${((Date.now() - t0) / 60000).toFixed(1)}분`);
  if (DRY) return;

  const out = { date: TODAY, updated: new Date().toISOString(), tabDates: { ...(prev.tabDates || {}) }, tabs: { ...(prev.tabs || {}) } };
  for (const k in tabs) { out.tabs[k] = tabs[k]; out.tabDates[k] = TODAY; }
  fs.writeFileSync(path.join(OUT, "app_weekday.json"), JSON.stringify(out));
  updateHistory(tabs);
  try { log("신작 18주 추적", JSON.stringify(require("./lib/app_newtrack.cjs").update(OUT, TODAY))); } catch (e) { log("신작 추적 실패:", e.message); }
  if (PUSH) P.pushPaths(ROOT, ["docs/data/app_weekday.json", "docs/data/app_weekday_history.json", "docs/data/app_weekday_newtrack.json"], `local: 앱 요일별 인기순(폰) ${TODAY}`);
})();
