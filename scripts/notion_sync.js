// 노션 연동: 매일 '매출순' 상위 N개를 노션 데이터베이스에 한 줄씩 추가(누적)
//  - 처음 실행 시 페이지에 "매출순 누적" 표(DB)를 자동 생성
//  - 같은 날 두 번 돌려도 중복 안 됨(그날 이미 있으면 스킵)
// 사용: node scripts/notion_sync.js            (기본 상위 300)
//       node scripts/notion_sync.js --top=500
// 설정: scripts/.notion.json {token, pageId, dbId}  (git 제외)

const fs = require("fs");
const path = require("path");
const C = require("./collect.js");
const ROOT = path.join(__dirname, "..");
const D = path.join(ROOT, "docs", "data");
const CFG = path.join(__dirname, ".notion.json");
const NV = "2022-06-28";
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(CFG, "utf8")); } catch (e) { console.log("노션 설정(.notion.json) 없음 — 노션 동기화 스킵"); process.exit(0); }
if (process.env.NOTION_TOKEN) cfg.token = process.env.NOTION_TOKEN;   // Actions(클라우드)에선 시크릿에서 읽음
if (process.env.NOTION_DB_ID) cfg.dbId = process.env.NOTION_DB_ID;
if (process.env.NOTION_PAGE_ID) cfg.pageId = process.env.NOTION_PAGE_ID;
if (!cfg.token || (!cfg.pageId && !cfg.dbId)) { console.log("노션 token/page 없음 — 스킵"); process.exit(0); }
const TOPN = Number((process.argv.find(a => a.startsWith("--top=")) || "").split("=")[1] || 300);
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(D, f), "utf8")); } catch (e) { return d; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const H = { "Authorization": "Bearer " + cfg.token, "Notion-Version": NV, "Content-Type": "application/json" };
async function napi(method, url, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch("https://api.notion.com/v1" + url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429) { await sleep(1500); continue; }   // rate limit → 대기 후 재시도
    const j = await r.json();
    if (!r.ok) throw new Error(url + " " + r.status + " " + (j.message || ""));
    return j;
  }
  throw new Error(url + " 429 재시도 초과");
}
const normName = s => String(s || "").replace(/\s*\[[^\]]*\]\s*$/, "").replace(/\s+/g, "");
const UNIT = k => k === "novel" ? 100 : 320;
const isoDate = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

// 프론트 revenueFor와 동일 로직으로 '오늘' 매출순 계산
function computeRanking() {
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
    const cands = (idx[normName(name)] || []).map(c => ({ ...c, d: sd[c.pn] })).filter(x => x.kind === "comic" && x.d && x.d.dl && x.d.ep);   // 웹툰(코믹)만 — 웹소설 제외
    const best = cands[0]; if (!best) continue;
    const dl = C.parseDlNum(best.d.dl), wep = (details[id] && details[id].ep) || best.d.ep;
    if (!dl || !wep) continue;
    const total = dl * UNIT(best.kind) * 0.9 * 0.6;
    seen.add(name);
    rows.push({ name, author: info[2] || "", total: Math.round(total), per: Math.round(total / wep), dl, ep: wep, kind: best.kind, adult: adultSet.has(best.pn) });
  }
  rows.sort((a, b) => b.total - a.total);
  rows.forEach((r, i) => r.rank = i + 1);
  return rows;
}

async function ensureDb() {
  if (cfg.dbId) return cfg.dbId;
  const db = await napi("POST", "/databases", {
    parent: { type: "page_id", page_id: cfg.pageId },
    title: [{ type: "text", text: { content: "매출순 누적 (매일 갱신)" } }],
    properties: {
      "작품": { title: {} },
      "날짜": { date: {} },
      "순위": { number: {} },
      "총매출(원)": { number: { format: "number_with_commas" } },
      "회차당(원)": { number: { format: "number_with_commas" } },
      "다운수": { number: { format: "number_with_commas" } },
      "회차수": { number: {} },
      "종류": { select: { options: [{ name: "웹툰", color: "blue" }, { name: "웹소설", color: "green" }] } },
      "성인": { checkbox: {} }
    }
  });
  cfg.dbId = db.id; fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2));
  console.log("✅ 노션에 '매출순 누적' 표 생성됨");
  return db.id;
}
async function alreadySynced(dbId, date) {
  const j = await napi("POST", "/databases/" + dbId + "/query", { filter: { property: "날짜", date: { equals: date } }, page_size: 1 });
  return (j.results || []).length > 0;
}
async function clearDate(dbId, date) {   // --force: 그날 기존 행 삭제 후 다시 채움
  let cursor, ids = [];
  do { const j = await napi("POST", "/databases/" + dbId + "/query", { filter: { property: "날짜", date: { equals: date } }, page_size: 100, start_cursor: cursor }); for (const p of (j.results || [])) ids.push(p.id); cursor = j.has_more ? j.next_cursor : null; } while (cursor);
  console.log("기존 " + date + " " + ids.length + "행 삭제…");
  for (const id of ids) { try { await napi("PATCH", "/pages/" + id, { archived: true }); } catch (e) {} await sleep(130); }
}
const FORCE = process.argv.includes("--force");

(async () => {
  if (!cfg.token || !cfg.pageId) { console.log("❌ .notion.json에 token/pageId 필요"); process.exit(1); }
  const dbId = await ensureDb();
  const date = isoDate();
  const synced = await alreadySynced(dbId, date);
  if (synced && !FORCE) { console.log(date + " 이미 노션에 있음 — 스킵 (다시채우려면 --force)"); return; }
  if (synced && FORCE) await clearDate(dbId, date);
  const rows = computeRanking().slice(0, TOPN);
  console.log(date + " · 매출순 상위 " + rows.length + "개를 노션에 추가…");
  let n = 0;
  for (const r of rows) {
    try {
      await napi("POST", "/pages", {
        parent: { database_id: dbId },
        properties: {
          "작품": { title: [{ text: { content: r.name } }] },
          "날짜": { date: { start: date } },
          "순위": { number: r.rank },
          "총매출(원)": { number: r.total },
          "회차당(원)": { number: r.per },
          "다운수": { number: r.dl },
          "회차수": { number: r.ep },
          "종류": { select: { name: r.kind === "novel" ? "웹소설" : "웹툰" } },
          "성인": { checkbox: !!r.adult }
        }
      });
      n++;
    } catch (e) { console.log("  행 실패:", r.name, e.message); }
    if (n % 25 === 0 && n) console.log("  " + n + "/" + rows.length);
    await sleep(340);
  }
  console.log("🎉 완료: " + n + "개 추가 (" + date + ")");
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
