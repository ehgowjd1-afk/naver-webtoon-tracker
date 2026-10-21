/* 신작 18주 추적 — 앱 요일별 인기순 기록(app_weekday_history, 60일만 보관)에서 신작만 130일까지 길게 남김.
 * 추적 대상 = 런칭 후 18주(126일) 안의 작품. 런칭일 = details.launch(yy.mm.dd), 없으면(성인작 등) 앱 '신작' 탭에 처음 보인 날(src "seen").
 * '신작' 딱지가 떨어져도 18주까지는 계속 기록 → 사이트 요일별 › 앱 요약의 '신작 18주 추적'(자리 잡는지).
 * docs/data/app_weekday_newtrack.json = {updated, dates:[], first:{id:"YYYY-MM-DD"}, src:{id:"launch"|"seen"}, series:{탭:{id:[순위…]}}}
 *   탭 = all·dailyPlus·new·mon..sun (인기순만). 날짜 칸은 dates와 같은 순서.
 * 매일 collect_app_weekday.js가 부름. 다시 만들기: node scripts/lib/app_newtrack.cjs
 */
const fs = require("fs");
const path = require("path");

const TABS = ["all", "dailyPlus", "new", "mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAYS = 126, KEEP = 130;
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } };
const launchIso = (s) => { const m = String(s || "").match(/(\d{2})\.(\d{2})\.(\d{2})/); return m ? `20${m[1]}-${m[2]}-${m[3]}` : null; };
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function update(OUT, today) {
  const H = readJSON(path.join(OUT, "app_weekday_history.json"), { dates: [], series: {} });
  const fp = path.join(OUT, "app_weekday_newtrack.json");
  const NT = readJSON(fp, { dates: [], first: {}, src: {}, series: {} });
  const det = readJSON(path.join(OUT, "details.json"), {});
  today = today || H.dates[H.dates.length - 1] || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const since = addDays(today, -DAYS);

  // 런칭일(또는 신작 탭 첫 등장일)
  const first = {}, src = {};
  const newS = (H.series && H.series.new) || {};
  const seenNew = (id) => { const a = newS[id]; if (!a) return null; const i = a.findIndex((v) => v != null); return i >= 0 ? H.dates[i] : null; };
  const cand = new Set();
  for (const t of TABS) { for (const id in ((H.series || {})[t] || {})) cand.add(id); for (const id in ((NT.series || {})[t] || {})) cand.add(id); }
  for (const id of cand) {
    const L = launchIso(det[id] && det[id].launch);
    if (L) { first[id] = L; src[id] = "launch"; continue; }
    const prevF = NT.first && NT.first[id], s = seenNew(id);
    const f = [prevF, s].filter(Boolean).sort()[0];
    if (f) { first[id] = f; src[id] = "seen"; }
  }
  const keepIds = new Set([...cand].filter((id) => first[id] && first[id] >= since && first[id] <= today));

  // 날짜 = 지난 추적 날짜 ∪ 기록 날짜, 최근 KEEP일
  const dates = [...new Set([...(NT.dates || []), ...(H.dates || [])])].sort().filter((d) => d >= addDays(today, -KEEP + 1) && d <= today);
  const hi = new Map((H.dates || []).map((d, i) => [d, i])), ni = new Map((NT.dates || []).map((d, i) => [d, i]));
  const series = {};
  for (const t of TABS) {
    const out = {};
    for (const id of keepIds) {
      const hs = ((H.series || {})[t] || {})[id], ns = ((NT.series || {})[t] || {})[id];
      if (!hs && !ns) continue;
      const arr = dates.map((d) => { if (hi.has(d) && hs) { const v = hs[hi.get(d)]; if (v != null) return v; if (hi.has(d)) return ns && ni.has(d) ? (ns[ni.get(d)] ?? null) : null; } return ns && ni.has(d) ? (ns[ni.get(d)] ?? null) : null; });
      if (arr.some((v) => v != null)) out[id] = arr;
    }
    if (Object.keys(out).length) series[t] = out;
  }
  const f2 = {}, s2 = {}; for (const id of keepIds) { f2[id] = first[id]; s2[id] = src[id]; }
  const res = { updated: new Date().toISOString(), dates, first: f2, src: s2, series };
  fs.writeFileSync(fp, JSON.stringify(res));
  return { dates: dates.length, works: keepIds.size, tabs: Object.fromEntries(Object.entries(series).map(([k, v]) => [k, Object.keys(v).length])) };
}

module.exports = { update };
if (require.main === module) console.log(JSON.stringify(update(path.join(__dirname, "..", "..", "docs", "data"))));
