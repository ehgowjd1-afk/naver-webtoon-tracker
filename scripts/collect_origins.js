/* 원작 웹소설 찾기 — 네이버웹툰 '소설원작'(details.novel) 작품마다 원작이 어느 플랫폼에 있는지.
 * 원작 작가 = 네이버 작품 정보 API의 communityArtists 중 ARTIST_NOVEL_ORIGIN(로그아웃·성인작도 열림).
 * 플랫폼별 검색(scripts/lib/origin/*.cjs) — 소설만, 원작 작가 이름 일치 + 제목 같은 작품만 받음(정확도 우선, 2026-10-20 표본 36편 검증: 틀린 연결 0).
 *   series(네이버 시리즈 웹소설) · munpia(문피아) · kakao(카카오페이지 웹소설) · ridi(리디 — 클라우드플레어 때문에 fetch→curl→python 순서로 시도)
 * 결과: docs/data/origins.json = {updated, works:{titleId:{t, a:[원작 작가], at, ck:[확인한 플랫폼], h:[{p,t,u,n?,v?,d?,ad?}]}}}
 *   h = 플랫폼마다 대표 1개(본편 연재판 우선). n=회차 수, v=권 수, d=완결, ad=19금.
 * 실행: node scripts/collect_origins.js [--max=40] [--stale=30] [--only=id,id] [--platforms=series,munpia,kakao,ridi]
 *   새 작품 → 오래된(stale일 지난) 작품 순. 클라우드 collect.yml이 매일 --max=40, 처음 채우기는 로컬에서 --max=1000.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "docs", "data");
const FILE = path.join(OUT, "origins.json");
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const MAX = +arg("max", 40), STALE = +arg("stale", 30);
const ONLY = arg("only", "") ? new Set(arg("only", "").split(",").map(Number)) : null;
const PLATFORMS = arg("platforms", "series,munpia,kakao,ridi").split(",").filter(Boolean);
const MODS = Object.fromEntries(PLATFORMS.map((p) => [p, require(`./lib/origin/${p}.cjs`)]));
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const daysSince = (d) => (Date.parse(today()) - Date.parse(d)) / 864e5;
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } };

async function originAuthors(id) {
  const r = await fetch(`https://comic.naver.com/api/article/list/info?titleId=${id}`, { headers: { "User-Agent": UA, Referer: "https://comic.naver.com/" } });
  if (!r.ok) throw new Error("info " + r.status);
  const j = await r.json();
  return { title: j.titleName || "", authors: (j.communityArtists || []).filter((a) => (a.artistTypeList || []).includes("ARTIST_NOVEL_ORIGIN")).map((a) => a.name).filter(Boolean) };
}
// 플랫폼 결과 → 대표 1개(모듈이 본편 연재판을 앞에 둠)
const normT = (x) => String(x || "").replace(/\(총[^)]*\)/g, "").replace(/[\[【《(][^\]】》)]*[\]】》)]/g, "").normalize("NFKC").toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
// 속편 거르기: 웹툰 제목 + 숫자/N부/시즌N 뿐인 소설 제목(예: S.K.T → S.K.T.2)은 다른 작품
const isSequel = (webtoon, novel) => { const w = normT(webtoon), n = normT(novel); return !!w && n !== w && n.startsWith(w) && /^(시즌|season)?\d+부?$/.test(n.slice(w.length)); };
function pick(p, hits, title) {
  const h = (hits || []).filter((x) => !isSequel(title, x.title))[0]; if (!h) return null;
  const o = { p, t: h.title, u: h.url };
  if (h.eps) o.n = h.eps; if (h.vols) o.v = h.vols; if (h.done != null) o.d = !!h.done; if (h.adult) o.ad = true;
  return o;
}

(async () => {
  const det = readJSON(path.join(OUT, "details.json"), {});
  const lookup = readJSON(path.join(OUT, "lookup.json"), { id: {} });
  const data = readJSON(FILE, { updated: "", works: {} });
  data.works = data.works || {};
  const ids = Object.keys(det).filter((id) => det[id] && det[id].novel).map(Number).filter((id) => !ONLY || ONLY.has(id));
  const need = (id) => { const w = data.works[id]; if (!w || !w.at) return 0; if (PLATFORMS.some((p) => !(w.ck || []).includes(p))) return 1; return daysSince(w.at) >= STALE ? 2 : 9; };
  const todo = ids.map((id) => [id, need(id)]).filter(([, k]) => ONLY || k < 9).sort((a, b) => a[1] - b[1] || String((data.works[a[0]] || {}).at || "").localeCompare(String((data.works[b[0]] || {}).at || ""))).slice(0, MAX).map(([id]) => id);
  console.log(`원작 찾기: 소설원작 ${ids.length}작 중 이번 ${todo.length}작 (플랫폼 ${PLATFORMS.join(",")})`);
  const down = new Set();   // 이번 실행에서 막힌 플랫폼 — 그 플랫폼은 확인 안 한 것으로 남김(다음에 다시)
  let n = 0, found = 0;
  for (const id of todo) {
    let info;
    try { info = await originAuthors(id); } catch (e) { console.error(id, "작품 정보 실패:", e.message); await sleep(1500); continue; }
    await sleep(400);
    const prev = data.works[id] || {};
    const title = info.title || (lookup.id[id] || [])[0] || prev.t || "";
    const authors = info.authors.length ? info.authors : (prev.a || []);
    const rec = { t: title, a: authors, at: today(), ck: [], h: [] };
    if (!title || !authors.length) { rec.ck = PLATFORMS.slice(); data.works[id] = rec; n++; continue; }   // 원작 작가 표기가 없는 작품 — 검색 안 함
    const res = await Promise.all(PLATFORMS.filter((p) => !down.has(p)).map(async (p) => {
      try { return [p, pick(p, await MODS[p].search(title, authors), title)]; }
      catch (e) { if (e.blocked || /403|429|blocked/i.test(e.message || "")) { down.add(p); console.error(`${p} 막힘 — 이번 실행은 건너뜀:`, e.message); } else console.error(id, p, e.message); return [p, undefined]; }
    }));
    for (const [p, h] of res) { if (h === undefined) continue; rec.ck.push(p); if (h) rec.h.push(h); }
    for (const p of PLATFORMS) if (!rec.ck.includes(p) && (prev.ck || []).includes(p)) { rec.ck.push(p); const old = (prev.h || []).find((x) => x.p === p); if (old) rec.h.push(old); }   // 이번에 못 본 플랫폼은 지난 결과 유지
    rec.h.sort((x, y) => PLATFORMS.indexOf(x.p) - PLATFORMS.indexOf(y.p));
    data.works[id] = rec; n++; if (rec.h.length) found++;
    if (n % 10 === 0) { data.updated = new Date().toISOString(); fs.writeFileSync(FILE, JSON.stringify(data)); console.log(`  ${n}/${todo.length} · 원작 찾음 ${found}`); }
  }
  for (const id of ids) if (!data.works[id]) data.works[id] = { t: (lookup.id[id] || [])[0] || "", a: [], at: "", ck: [], h: [] };   // 아직 못 본 소설원작도 목록에 넣어 둠(사이트 '원작' 뱃지·필터) — at 비어 있으면 다음 실행에서 먼저 확인
  data.updated = new Date().toISOString();
  fs.writeFileSync(FILE, JSON.stringify(data));
  const all = Object.values(data.works), byP = {};
  for (const w of all) for (const h of w.h || []) byP[h.p] = (byP[h.p] || 0) + 1;
  console.log(`완료: 이번 ${n}작 (원작 찾음 ${found}) · 전체 ${all.length}작 중 연재처 있음 ${all.filter((w) => (w.h || []).length).length} · 확인 전 ${all.filter((w) => !w.at).length} · 플랫폼별 ${JSON.stringify(byP)}${down.size ? " · 막힌 플랫폼 " + [...down].join(",") : ""}`);
})().catch((e) => { console.error("원작 찾기 실패:", e.message); process.exitCode = 1; });
