/* 올리기 직전에 원격(main)의 같은 데이터 파일과 합치기 — 수집이 도는 사이 다른 수집(성인·로컬·클라우드)이 먼저 올린 값을 덮어쓰지 않게.
 * 예전엔 `pull --rebase -X theirs`가 한 줄짜리 JSON 파일을 통째로 내 것으로 바꿔서, 겹쳐 돈 수집의 결과가 사라졌음
 * (2026-10-11: 예약 클라우드 수집이 15:20에 올라간 성인 수집 결과를 15:40에 덮음).
 * 규칙: 날짜 도장(at·favAt·epAt·cdpDate)이 더 새로운 쪽이 이김, 히스토리는 날짜별로 내 칸이 비어 있으면 원격 값으로 채움, 목록은 합집합.
 *   node scripts/merge_remote.js [원격 ref, 기본 origin/main]   (git fetch 뒤에 부름. 실패해도 수집 결과는 그대로 둠)
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DATA = process.env.MERGE_DATA || path.join(ROOT, "docs", "data");   // 시험용으로 바꿀 수 있음
const REF = process.argv[2] || "origin/main";
// 합칠 파일을 고를 수 있음: node merge_remote.js origin/main series_details.json details.json app_genre …
// 로컬 수집기는 자기가 커밋할 파일만 넘겨야 함 — 안 그러면 커밋 안 하는 파일이 수정된 채 남아 다음 pull --autostash에서 충돌(2026-10-26 origins.json 실제 발생). 없으면 전부(클라우드)
const ONLY = process.argv.slice(3).map((x) => x.replace(/^docs\/data\//, "").replace(/\/$/, ""));
const want = (name) => !ONLY.length || ONLY.includes(name);

function remoteJSON(name) {
  try { return JSON.parse(execSync(`git -C "${ROOT}" show ${REF}:docs/data/${name}`, { maxBuffer: 512 * 1024 * 1024 }).toString("utf8")); }
  catch (e) { return null; }
}
function localJSON(name) { try { return JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8")); } catch (e) { return null; } }
const newer = (a, b) => String(a || "") > String(b || "");

// series_details: {pn: {..., at}} — 다운수 도장(at)이 더 새로운 쪽, 내게 없는 작품은 추가, 단가(rent/own)는 비면 채움
function mergeSeriesDetails(mine, rem) {
  let n = 0;
  for (const k in rem) {
    const r = rem[k], m = mine[k];
    if (!m) { mine[k] = r; n++; continue; }
    if (newer(r.at, m.at)) { mine[k] = { ...m, ...r }; n++; }
    for (const f of ["rent", "own"]) if (m[f] == null && r[f] != null) mine[k][f] = r[f];
  }
  return n;
}
// series_extra: 성인 수집일(cdpDate)·확인일(seen)은 더 새로운 쪽, 목록(adult·owned)은 합집합, 이름→판본(map)·판본 연결(link)은 내게 없는 것만 추가
function mergeSeriesExtra(mine, rem) {
  let n = 0;
  if (newer(rem.cdpDate, mine.cdpDate)) { mine.cdpDate = rem.cdpDate; n++; }
  for (const key of ["adult", "owned"]) if (Array.isArray(rem[key])) { const s = new Set(mine[key] || []); for (const x of rem[key]) if (!s.has(x)) { s.add(x); n++; } mine[key] = [...s]; }
  if (rem.seen) { mine.seen = mine.seen || {}; for (const k in rem.seen) if (newer(rem.seen[k], mine.seen[k])) { mine.seen[k] = rem.seen[k]; n++; } }
  if (rem.map) { mine.map = mine.map || {}; for (const name in rem.map) { const a = mine.map[name] || (mine.map[name] = []); for (const e of rem.map[name]) if (!a.some((x) => x.pn === e.pn)) { a.push(e); n++; } } }
  if (rem.link) { mine.link = mine.link || {}; for (const name in rem.link) if (!(name in mine.link)) { mine.link[name] = rem.link[name]; n++; } }
  return n;
}
// details: 성인 수집이 넣는 값 — 관심수(favAt 도장)·총화/무료/유료(epAt 도장)는 더 새로운 쪽, 내게 없는 작품은 추가
function mergeDetails(mine, rem) {
  let n = 0;
  for (const id in rem) {
    const r = rem[id], m = mine[id];
    if (!m) { mine[id] = r; n++; continue; }
    if (newer(r.favAt, m.favAt)) { m.fav = r.fav; m.favAt = r.favAt; n++; }
    if (newer(r.epAt, m.epAt)) { for (const f of ["ep", "epAt", "epGap", "free", "paid"]) if (r[f] !== undefined) m[f] = r[f]; n++; }
  }
  return n;
}
// 히스토리 {dates, works:{id:{배열들}}}: 날짜를 합치고, 같은 날 내 칸이 비어 있으면 원격 값으로
function mergeHistory(mine, rem, rmax) {
  if (!rem || !Array.isArray(rem.dates)) return 0;
  const dates = [...new Set([...(mine.dates || []), ...rem.dates])].sort();
  const mi = new Map((mine.dates || []).map((d, i) => [d, i])), ri = new Map(rem.dates.map((d, i) => [d, i]));
  const ids = new Set([...Object.keys(mine.works || {}), ...Object.keys(rem.works || {})]);
  const works = {}; let n = 0;
  for (const id of ids) {
    const mw = (mine.works || {})[id] || {}, rw = (rem.works || {})[id] || {};
    const keys = new Set([...Object.keys(mw), ...Object.keys(rw)].filter((k) => Array.isArray(mw[k]) || Array.isArray(rw[k])));
    const w = {};
    for (const k of keys) {
      w[k] = dates.map((d) => {
        const a = mi.has(d) && mw[k] ? mw[k][mi.get(d)] : null, b = ri.has(d) && rw[k] ? rw[k][ri.get(d)] : null;
        if (a == null && b != null) { n++; return b; }
        return a == null ? null : a;
      });
    }
    works[id] = w;
  }
  let cut = Math.max(0, dates.length - rmax);
  mine.dates = dates.slice(cut);
  for (const id in works) for (const k in works[id]) works[id][k] = works[id][k].slice(cut);
  mine.works = works;
  if (newer(rem.lastFull, mine.lastFull)) mine.lastFull = rem.lastFull;
  return n;
}

// origins: {works:{id:{at,...}}} — 작품마다 확인일(at)이 더 새로운 쪽, 내게 없는 작품은 추가
function mergeOrigins(mine, rem) {
  let n = 0; mine.works = mine.works || {};
  for (const id in (rem.works || {})) { const r = rem.works[id], m = mine.works[id]; if (!m || newer(r.at, m.at)) { mine.works[id] = r; n++; } }
  return n;
}
const FILES = [
  ["series_details.json", mergeSeriesDetails],
  ["series_extra.json", mergeSeriesExtra],
  ["details.json", mergeDetails],
  ["revenue_history.json", (m, r) => mergeHistory(m, r, 150)],
  ["ep_history.json", (m, r) => mergeHistory(m, r, 150)],
  ["fav_history.json", (m, r) => mergeHistory(m, r, 150)],
  ["origins.json", mergeOrigins],
];
const out = {};
for (const [name, fn] of FILES) {
  if (!want(name)) continue;
  try {
    const mine = localJSON(name), rem = remoteJSON(name);
    if (!mine || !rem) continue;
    const n = fn(mine, rem);
    if (n) { fs.writeFileSync(path.join(DATA, name), JSON.stringify(mine)); out[name] = n; }
  } catch (e) { console.error("merge 실패(그대로 둠):", name, e.message); }
}
// 앱 장르 주간 app_genre/{주차}.json: 장르마다 폰 결과(100위·순위변동)가 검색 위젯 결과(45위)보다 우선.
// 클라우드 수집이 폰 결과가 올라가기 전에 시작하면 위젯 45위로 덮던 문제(2026-10-19 실제 발생) 방지. index.json은 주차 합집합
function mergeAppGenre(mine, rem) {
  let n = 0; mine.src = mine.src || {}; mine.charts = mine.charts || {};
  for (const g in (rem.charts || {})) {
    const rs = (rem.src || {})[g], ms = mine.src[g];
    if (!mine.charts[g] || (rs === "phone" && ms !== "phone")) { mine.charts[g] = rem.charts[g]; mine.src[g] = rs; n++; }
  }
  return n;
}
if (want("app_genre")) try {
  const ls = (cmd) => { try { return execSync(cmd).toString("utf8").split(/\r?\n/).filter(Boolean); } catch (e) { return []; } };
  const remFiles = ls(`git -C "${ROOT}" ls-tree --name-only ${REF} docs/data/app_genre/`).map((p) => p.split("/").pop());
  for (const f of remFiles) {
    const name = `app_genre/${f}`, rem = remoteJSON(name), mine = localJSON(name);
    if (!rem) continue;
    if (!mine) { fs.writeFileSync(path.join(DATA, name), JSON.stringify(rem)); out[name] = "원격 파일 가져옴"; continue; }
    if (f === "index.json") {
      const weeks = [...new Set([...(mine.weeks || []), ...(rem.weeks || [])])].sort();
      if (weeks.length !== (mine.weeks || []).length) { mine.weeks = weeks; mine.latest = weeks[weeks.length - 1]; mine.genres = mine.genres || rem.genres; fs.writeFileSync(path.join(DATA, name), JSON.stringify(mine)); out[name] = "주차 합침"; }
      continue;
    }
    const n = mergeAppGenre(mine, rem);
    if (n) { fs.writeFileSync(path.join(DATA, name), JSON.stringify(mine)); out[name] = n; }
  }
} catch (e) { console.error("merge 실패(그대로 둠): app_genre", e.message); }
console.log("원격과 합침:", JSON.stringify(out));
