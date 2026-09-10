// 노션 연동 v3: 작품당 '한 줄'(최신값, 매일 제자리 갱신) + 각 작품 페이지 안에 날짜별 '누적 기록'
//  - 메인 표 컬럼: 작품 · 순위 · 회차당(원) · 총매출(원) · 전일대비(%) · 다운수 · 회차수 · 성인 · 갱신일
//  - 전일대비(%): 어제 대비 다운수/매출 증감률(+오름/-내림)
//  - 각 작품 페이지: revenue_history로 날짜별 기록 backfill + 오늘치 포함, 매일 1줄 추가
// 사용: node scripts/notion_sync.js [--top=300] [--force]
// 설정: scripts/.notion.json {token, pageId, dbId, schema}  (git 제외)

const fs = require("fs");
const path = require("path");
const C = require("./collect.js");
const ROOT = path.join(__dirname, "..");
const D = path.join(ROOT, "docs", "data");
const CFG = path.join(__dirname, ".notion.json");
const NV = "2022-06-28";
const SCHEMA = "v3";
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(CFG, "utf8")); } catch (e) { console.log("노션 설정(.notion.json) 없음 — 스킵"); process.exit(0); }
if (process.env.NOTION_TOKEN) cfg.token = process.env.NOTION_TOKEN;
if (process.env.NOTION_PAGE_ID) cfg.pageId = process.env.NOTION_PAGE_ID;
if (!cfg.token || !cfg.pageId) { console.log("노션 token/pageId 없음 — 스킵"); process.exit(0); }
const TOPN = Number((process.argv.find(a => a.startsWith("--top=")) || "").split("=")[1] || 300);
const FORCE = process.argv.includes("--force");
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(D, f), "utf8")); } catch (e) { return d; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const H = { "Authorization": "Bearer " + cfg.token, "Notion-Version": NV, "Content-Type": "application/json" };
async function napi(method, url, body) {
  for (let a = 0; a < 5; a++) {
    const r = await fetch("https://api.notion.com/v1" + url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429) { await sleep(1500); continue; }
    const j = await r.json();
    if (!r.ok) throw new Error(url + " " + r.status + " " + (j.message || ""));
    return j;
  }
  throw new Error(url + " 429 초과");
}
const normName = s => String(s || "").replace(/\s*\[[^\]]*\]\s*$/, "").replace(/\s+/g, "");
const UNIT = k => k === "novel" ? 100 : 320;
const isoDate = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const won = n => Number(n || 0).toLocaleString();

// 전일대비 %: revenue_history에 기록된 '가장 최근 두 날' 다운수 증감(항상 실제 변화 표시)
function lastChange(revhist, pn) {
  const w = revhist.works && revhist.works[pn]; if (!w) return null;
  const vals = (w.dl || []).filter(x => x != null);
  if (vals.length < 2) return null;
  const prev = vals[vals.length - 2], last = vals[vals.length - 1];
  return prev > 0 ? Math.round((last - prev) / prev * 1000) / 10 : null;
}
function computeRanking(revhist, today) {
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
    const change = lastChange(revhist, best.pn);   // 전일대비 % (최근 두 날 기록 기준)
    seen.add(name);
    rows.push({ name, total: Math.round(total), per: Math.round(total / wep), dl, ep: wep, adult: adultSet.has(best.pn), pn: best.pn, change });
  }
  rows.sort((a, b) => b.total - a.total);
  rows.forEach((r, i) => r.rank = i + 1);
  return rows;
}
function historyFor(revhist, pn) {
  const w = revhist.works && revhist.works[pn]; if (!w) return [];
  const dates = revhist.dates || [], out = [];
  for (let i = 0; i < dates.length; i++) { const dl = w.dl[i]; if (dl == null) continue; out.push({ date: dates[i], dl, total: Math.round(dl * 320 * 0.9 * 0.6) }); }
  return out;
}
const histLine = h => `${h.date} · 다운수 ${won(h.dl)} · 총매출 ${won(h.total)}원`;
function props(r, date) {
  const p = {
    "작품": { title: [{ text: { content: r.name } }] },
    "순위": { number: r.rank },
    "회차당(원)": { number: r.per },
    "총매출(원)": { number: r.total },
    "전일대비(%)": { number: r.change == null ? null : r.change },
    "다운수": { number: r.dl },
    "회차수": { number: r.ep },
    "성인": { checkbox: !!r.adult },
    "갱신일": { date: { start: date } }
  };
  return p;
}
async function appendBlocks(pageId, lines) {
  for (let i = 0; i < lines.length; i += 90) {
    const children = lines.slice(i, i + 90).map(t => ({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ text: { content: t } }] } }));
    await napi("PATCH", "/blocks/" + pageId + "/children", { children });
    await sleep(340);
  }
}
async function ensureDb() {
  if (cfg.dbId && cfg.schema === SCHEMA) return cfg.dbId;
  if (cfg.dbId) { try { await napi("PATCH", "/blocks/" + cfg.dbId, { archived: true }); console.log("이전 표 보관처리"); } catch (e) {} }
  const db = await napi("POST", "/databases", {
    parent: { type: "page_id", page_id: cfg.pageId },
    title: [{ type: "text", text: { content: "매출순 (작품당 1행·페이지 안 누적)" } }],
    properties: {
      "작품": { title: {} }, "순위": { number: {} },
      "회차당(원)": { number: { format: "number_with_commas" } },
      "총매출(원)": { number: { format: "number_with_commas" } },
      "전일대비(%)": { number: {} },
      "다운수": { number: { format: "number_with_commas" } },
      "회차수": { number: {} }, "성인": { checkbox: {} }, "갱신일": { date: {} }
    }
  });
  cfg.dbId = db.id; cfg.schema = SCHEMA; fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2));
  console.log("✅ 새 표 생성 (" + SCHEMA + ")");
  return db.id;
}
async function loadRows(dbId) {
  const map = {}; let cursor;
  do {
    const j = await napi("POST", "/databases/" + dbId + "/query", { page_size: 100, start_cursor: cursor });
    for (const p of (j.results || [])) { const nm = p.properties["작품"].title[0]?.plain_text; const up = p.properties["갱신일"]?.date?.start; if (nm) map[nm] = { id: p.id, updated: up }; }
    cursor = j.has_more ? j.next_cursor : null;
  } while (cursor);
  return map;
}

(async () => {
  const dbId = await ensureDb();
  const date = isoDate();
  const revhist = readJSON("revenue_history.json", { dates: [], works: {} });
  const rows = computeRanking(revhist, date).slice(0, TOPN);
  const existing = await loadRows(dbId);
  console.log(date + " · 매출순 상위 " + rows.length + "개 (기존 " + Object.keys(existing).length + "행) 갱신…");
  let upd = 0, cre = 0;
  for (const r of rows) {
    try {
      const ex = existing[r.name];
      if (ex) {
        await napi("PATCH", "/pages/" + ex.id, { properties: props(r, date) });
        if (FORCE || ex.updated !== date) await appendBlocks(ex.id, [histLine({ date, dl: r.dl, total: r.total })]);
        upd++;
      } else {
        const page = await napi("POST", "/pages", { parent: { database_id: dbId }, properties: props(r, date) });
        const hist = historyFor(revhist, r.pn);
        if (!hist.some(h => h.date === date)) hist.push({ date, dl: r.dl, total: r.total });   // 오늘치 포함
        await appendBlocks(page.id, ["📈 날짜별 누적 기록", ...hist.map(histLine)].slice(0, 100));
        cre++;
      }
    } catch (e) { console.log("  실패:", r.name, e.message); }
    if ((upd + cre) % 25 === 0) console.log("  " + (upd + cre) + "/" + rows.length);
    await sleep(340);
  }
  console.log(`🎉 완료: 갱신 ${upd} · 신규 ${cre} (${date})`);
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
