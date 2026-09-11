// 노션 연동 v4: 두 개의 표
//  1) '매출순' — 작품당 1행(최신값, 회차당 순위). 매일 제자리 갱신 + 전일대비(%)
//  2) '일별기록' — 작품×날짜 데이터(회차당·총매출·다운수). '매출순'과 관계(relation)로 연결
//     → 각 작품 페이지 안에 그 작품의 날짜별 기록이 '표'로 뜨고, 이 표로 노션 차트를 만들 수 있음
// 사용: node scripts/notion_sync.js [--top=300] [--force]
// 설정: scripts/.notion.json {token, pageId, masterDbId, histDbId, schema}  (git 제외)

const fs = require("fs");
const path = require("path");
const C = require("./collect.js");
const ROOT = path.join(__dirname, "..");
const D = path.join(ROOT, "docs", "data");
const CFG = path.join(__dirname, ".notion.json");
const NV = "2022-06-28";
const SCHEMA = "v4";
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(CFG, "utf8")); } catch (e) { console.log("노션 설정 없음 — 스킵"); process.exit(0); }
if (process.env.NOTION_TOKEN) cfg.token = process.env.NOTION_TOKEN;
if (process.env.NOTION_PAGE_ID) cfg.pageId = process.env.NOTION_PAGE_ID;
if (!cfg.token || !cfg.pageId) { console.log("노션 token/pageId 없음 — 스킵"); process.exit(0); }
const TOPN = Number((process.argv.find(a => a.startsWith("--top=")) || "").split("=")[1] || 300);
const FORCE = process.argv.includes("--force");
const REHIST = process.argv.includes("--rehist");   // 일별기록 전체 삭제 후 재작성(컬럼 추가 등 반영용)
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(D, f), "utf8")); } catch (e) { return d; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TBLF = path.join(__dirname, ".notion_tables.json");   // {페이지id: {tid:표블록id, last:마지막추가날짜}} — git 제외
let tables = {}; try { tables = JSON.parse(fs.readFileSync(TBLF, "utf8")); } catch (e) {}
const saveTables = () => { try { fs.writeFileSync(TBLF, JSON.stringify(tables)); } catch (e) {} };
const H = { "Authorization": "Bearer " + cfg.token, "Notion-Version": NV, "Content-Type": "application/json" };
async function napi(method, url, body) {
  let lastErr;
  for (let a = 0; a < 6; a++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 20000);   // 20초 넘게 응답 없으면 중단하고 재시도(무한 hang 방지)
    try {
      const r = await fetch("https://api.notion.com/v1" + url, { method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: ac.signal });
      clearTimeout(t);
      if (r.status === 429 || r.status >= 500) { await sleep(1500); continue; }
      const j = await r.json();
      if (!r.ok) throw new Error(url + " " + r.status + " " + (j.message || ""));
      return j;
    } catch (e) { clearTimeout(t); lastErr = e; if (e.name === "AbortError") { console.log("  (응답 지연 재시도 " + (a + 1) + ") " + url); await sleep(1000); continue; } throw e; }
  }
  throw new Error(url + " 재시도 초과 " + (lastErr && lastErr.message || ""));
}
const normName = s => String(s || "").replace(/\s*\[[^\]]*\]\s*$/, "").replace(/\s+/g, "");
const UNIT = k => k === "novel" ? 100 : 320;
const isoDate = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

function lastChange(revhist, pn) {   // 전일대비 %: 기록된 최근 두 날 다운수 증감
  const w = revhist.works && revhist.works[pn]; if (!w) return null;
  const vals = (w.dl || []).filter(x => x != null);
  if (vals.length < 2) return null;
  const prev = vals[vals.length - 2], last = vals[vals.length - 1];
  return prev > 0 ? Math.round((last - prev) / prev * 1000) / 10 : null;
}
function tier(per) { return per >= 1e8 ? "1억원 이상" : per >= 5e7 ? "5천만~1억" : per >= 2e7 ? "2천만~5천만" : per >= 1e7 ? "1천만~2천만" : "1천만 미만"; }
function computeRanking(revhist) {
  const series = readJSON("series.json", { comic: {}, novel: {} });
  const sd = readJSON("series_details.json", {});
  const details = readJSON("details.json", {});
  const lookup = readJSON("lookup.json", { id: {}, name: {} });
  const extra = readJSON("series_extra.json", { map: {}, adult: [] });
  const idx = {};
  for (const kind of ["comic", "novel"]) for (const pf of ["web", "mobile"]) for (const c in (series[kind] || {})[pf] || {}) for (const p in series[kind][pf][c]) for (const it of series[kind][pf][c][p]) { const n = normName(it.t); (idx[n] || (idx[n] = [])).push({ pn: it.id, kind }); }
  for (const n in (extra.map || {})) for (const e of extra.map[n]) (idx[n] || (idx[n] = [])).push(e);
  const adultSet = new Set(extra.adult || []);
  const rows = [], seen = new Set();
  for (const id in (lookup.id || {})) {
    const info = lookup.id[id]; if (!info || !info[0]) continue;
    const name = info[0]; if (seen.has(name)) continue;
    const cands = (idx[normName(name)] || []).map(c => ({ ...c, d: sd[c.pn] })).filter(x => x.kind === "comic" && x.d && x.d.dl && x.d.ep);
    const best = cands[0]; if (!best) continue;
    const dl = C.parseDlNum(best.d.dl), wep = (details[id] && details[id].ep) || best.d.ep;
    if (!dl || !wep) continue;
    const total = dl * UNIT(best.kind) * 0.9 * 0.6;
    seen.add(name);
    rows.push({ name, total: Math.round(total), per: Math.round(total / wep), dl, ep: wep, adult: adultSet.has(best.pn), pn: best.pn, change: lastChange(revhist, best.pn) });
  }
  rows.sort((a, b) => b.per - a.per);   // ★ 회차당 매출 기준 순위
  rows.forEach((r, i) => r.rank = i + 1);
  return rows;
}
// revenue_history에서 pn의 날짜별 [{date, dl, total, per}]  (per=총매출/현재 웹툰회차수, 근사)
function historyFor(revhist, pn, ep) {   // change = '회차당' 전일대비 증감(원). ep 고정이라 회차당=총매출/ep
  const w = revhist.works && revhist.works[pn]; if (!w) return [];
  const dates = revhist.dates || [], out = []; let prevPer = null;
  for (let i = 0; i < dates.length; i++) { const dl = w.dl[i]; if (dl == null) continue; const total = Math.round(dl * 320 * 0.9 * 0.6); const per = ep ? Math.round(total / ep) : 0; out.push({ date: dates[i], dl, total, per, ep, change: prevPer == null ? null : per - prevPer }); prevPer = per; }
  return out;
}
function withToday(hist, r, date) {   // 오늘치가 없으면 오늘(현재값) 추가(전일대비=어제 회차당과의 차)
  if (hist.some(h => h.date === date)) return hist;
  const lastPer = hist.length ? hist[hist.length - 1].per : null;
  return [...hist, { date, dl: r.dl, total: r.total, per: r.per, ep: r.ep, change: lastPer == null ? null : r.per - lastPer }];
}
function masterProps(r, date) {
  return {
    "작품": { title: [{ text: { content: r.name } }] },
    "순위": { number: r.rank },
    "회차당(원)": { number: r.per },
    "회차당구간": { select: { name: tier(r.per) } },
    "총매출(원)": { number: r.total },
    "전일대비(%)": { number: r.change == null ? null : r.change },
    "다운수": { number: r.dl },
    "회차수": { number: r.ep },
    "성인": { checkbox: !!r.adult },
    "갱신일": { date: { start: date } }
  };
}
function histProps(name, masterId, h) {
  return {
    "기록": { title: [{ text: { content: name + " · " + h.date } }] },
    "작품": { relation: [{ id: masterId }] },
    "날짜": { date: { start: h.date } },
    "회차당(원)": { number: h.per },
    "전일대비(원)": { number: h.change == null ? null : h.change },
    "총매출(원)": { number: h.total },
    "다운수": { number: h.dl },
    "회차수": { number: h.ep || null }
  };
}

// ── 작품 페이지 안에 넣는 '날짜별 기록' 표(네이티브 표 블록) ──────────────
const comma = n => Number(n).toLocaleString("en-US");
const cell = (txt, color) => [{ type: "text", text: { content: String(txt) }, ...(color ? { annotations: { color } } : {}) }];
const headerRow = { type: "table_row", table_row: { cells: [cell("날짜"), cell("회차당"), cell("전일대비"), cell("회차수"), cell("다운수")] } };
function tableRow(h) {   // 전일대비: ▲상승=빨강, ▼하락=파랑 (한국 관행)
  const chg = h.change == null ? cell("—", "gray") : h.change > 0 ? cell("▲" + comma(h.change), "red") : h.change < 0 ? cell("▼" + comma(-h.change), "blue") : cell("0", "gray");
  return { type: "table_row", table_row: { cells: [cell(h.date), cell(comma(h.per)), chg, cell(h.ep == null ? "—" : h.ep), cell(comma(h.dl))] } };
}
async function pageChildren(pid) { const out = []; let c; do { const j = await napi("GET", "/blocks/" + pid + "/children?page_size=100" + (c ? "&start_cursor=" + c : "")); out.push(...(j.results || [])); c = j.has_more ? j.next_cursor : null; } while (c); return out; }
async function clearOurBlocks(pid) {   // 우리가 넣은 heading('📅…')·표만 지움(사용자 다른 내용 보존)
  for (const b of await pageChildren(pid)) {
    const ours = b.type === "table" || (b.type === "heading_3" && ((b.heading_3.rich_text[0] || {}).plain_text || "").startsWith("📅"));
    if (ours) { try { await napi("PATCH", "/blocks/" + b.id, { archived: true }); } catch (e) {} await sleep(160); }
  }
}
async function buildTable(pid, hist) {
  await clearOurBlocks(pid);
  const rows = hist.slice(-99).map(tableRow);   // 표 블록은 한 번에 최대 100행 → 최근 99일 + 헤더
  const res = await napi("PATCH", "/blocks/" + pid + "/children", {
    children: [
      { object: "block", type: "heading_3", heading_3: { rich_text: [{ type: "text", text: { content: "📅 날짜별 기록" } }] } },
      { object: "block", type: "table", table: { table_width: 5, has_column_header: true, has_row_header: false, children: [headerRow, ...rows] } }
    ]
  });
  const tbl = (res.results || []).find(b => b.type === "table");
  return tbl ? tbl.id : null;
}
async function syncTable(pid, hist, date) {   // 신규/재작성=통째로, 그 외=쌓인 날짜만 추가
  if (!hist.length) return "empty";
  const last = hist[hist.length - 1].date, st = tables[pid];
  if (REHIST || !st || !st.tid) { const tid = await buildTable(pid, hist); if (tid) tables[pid] = { tid, last }; return "build"; }
  const newRows = hist.filter(h => h.date > st.last);
  if (!newRows.length) return "skip";
  try { await napi("PATCH", "/blocks/" + st.tid + "/children", { children: newRows.map(tableRow) }); st.last = last; return "append"; }
  catch (e) { const tid = await buildTable(pid, hist); if (tid) tables[pid] = { tid, last }; return "rebuild"; }
}
async function ensureDbs() {
  if (cfg.masterDbId && cfg.histDbId && cfg.schema === SCHEMA) return;
  for (const k of ["dbId", "masterDbId", "histDbId"]) if (cfg[k]) { try { await napi("PATCH", "/blocks/" + cfg[k], { archived: true }); } catch (e) {} }
  console.log("이전 표 정리…");
  const master = await napi("POST", "/databases", {
    parent: { type: "page_id", page_id: cfg.pageId }, title: [{ type: "text", text: { content: "매출순 (작품당 1행)" } }],
    properties: {
      "작품": { title: {} }, "순위": { number: {} },
      "회차당(원)": { number: { format: "number_with_commas" } },
      "회차당구간": { select: { options: [{ name: "1억원 이상", color: "red" }, { name: "5천만~1억", color: "orange" }, { name: "2천만~5천만", color: "yellow" }, { name: "1천만~2천만", color: "green" }, { name: "1천만 미만", color: "gray" }] } },
      "총매출(원)": { number: { format: "number_with_commas" } },
      "전일대비(%)": { number: {} },
      "다운수": { number: { format: "number_with_commas" } },
      "회차수": { number: {} }, "성인": { checkbox: {} }, "갱신일": { date: {} }
    }
  });
  const hist = await napi("POST", "/databases", {
    parent: { type: "page_id", page_id: cfg.pageId }, title: [{ type: "text", text: { content: "일별기록 (작품×날짜)" } }],
    properties: {
      "기록": { title: {} },
      "작품": { relation: { database_id: master.id, type: "dual_property", dual_property: {} } },
      "날짜": { date: {} },
      "회차당(원)": { number: { format: "number_with_commas" } },
      "전일대비(원)": { number: { format: "number_with_commas" } },
      "총매출(원)": { number: { format: "number_with_commas" } },
      "다운수": { number: { format: "number_with_commas" } },
      "회차수": { number: {} }
    }
  });
  cfg.masterDbId = master.id; cfg.histDbId = hist.id; cfg.schema = SCHEMA; delete cfg.dbId;
  fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2));
  console.log("✅ 새 표 2개 생성 (매출순 + 일별기록)");
}
async function loadMaster() {
  const map = {}; let cursor;
  do {
    const j = await napi("POST", "/databases/" + cfg.masterDbId + "/query", { page_size: 100, start_cursor: cursor });
    for (const p of (j.results || [])) { const nm = p.properties["작품"].title[0]?.plain_text; const up = p.properties["갱신일"]?.date?.start; if (nm) map[nm] = { id: p.id, updated: up }; }
    cursor = j.has_more ? j.next_cursor : null;
  } while (cursor);
  return map;
}

(async () => {
  await ensureDbs();
  const date = isoDate();
  const revhist = readJSON("revenue_history.json", { dates: [], works: {} });
  const rows = computeRanking(revhist).slice(0, TOPN);
  const existing = await loadMaster();
  if (REHIST) {   // 일별기록 전체 삭제(컬럼 추가/구조변경 반영 위해 재작성)
    let cursor, ids = [];
    do { const j = await napi("POST", "/databases/" + cfg.histDbId + "/query", { page_size: 100, start_cursor: cursor }); for (const p of (j.results || [])) ids.push(p.id); cursor = j.has_more ? j.next_cursor : null; } while (cursor);
    console.log("기존 일별기록 " + ids.length + "행 삭제…");
    for (const id of ids) { try { await napi("PATCH", "/pages/" + id, { archived: true }); } catch (e) {} await sleep(130); }
  }
  console.log(date + " · 회차당 순 상위 " + rows.length + "개 (기존 " + Object.keys(existing).length + "행)…");
  let upd = 0, cre = 0, hrows = 0, tbuilt = 0, tapp = 0;
  for (const r of rows) {
    try {
      const ex = existing[r.name];
      let masterId, wasUpdated;
      if (ex) { await napi("PATCH", "/pages/" + ex.id, { properties: masterProps(r, date) }); masterId = ex.id; wasUpdated = ex.updated; upd++; }
      else { const page = await napi("POST", "/pages", { parent: { database_id: cfg.masterDbId }, properties: masterProps(r, date) }); masterId = page.id; wasUpdated = null; cre++; }
      // 일별기록: 신규작품은 과거+오늘 전부, 기존작품은 오늘치만(이미 오늘 했으면 스킵)
      let hist;
      if (REHIST || !ex) { hist = withToday(historyFor(revhist, r.pn, r.ep), r, date); }
      else if (FORCE || wasUpdated !== date) { const hs = historyFor(revhist, r.pn, r.ep); const lastT = hs.length ? hs[hs.length - 1].total : null; hist = [{ date, dl: r.dl, total: r.total, per: r.per, ep: r.ep, change: lastT == null ? null : r.total - lastT }]; }
      else hist = [];
      for (const h of hist) { await napi("POST", "/pages", { parent: { database_id: cfg.histDbId }, properties: histProps(r.name, masterId, h) }); hrows++; await sleep(340); }
      // 작품 페이지 안에 '날짜별 기록' 표(전 기간) 반영
      const fullHist = withToday(historyFor(revhist, r.pn, r.ep), r, date);
      const act = await syncTable(masterId, fullHist, date);
      if (act === "build" || act === "rebuild") tbuilt++; else if (act === "append") tapp++;
    } catch (e) { console.log("  실패:", r.name, e.message); }
    if ((upd + cre) % 25 === 0) { console.log("  " + (upd + cre) + "/" + rows.length + " (기록행 " + hrows + " · 표 신규" + tbuilt + "/추가" + tapp + ")"); saveTables(); }
    await sleep(340);
  }
  saveTables();
  console.log(`🎉 완료: 매출순 갱신 ${upd}·신규 ${cre} · 일별기록 ${hrows}행 · 페이지내 표 신규 ${tbuilt}·추가 ${tapp} (${date})`);
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
