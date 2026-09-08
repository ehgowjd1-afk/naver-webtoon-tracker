// 로컬 전용 수집기 (본인 PC에서 실행) — 클라우드(Actions)로는 못 하는 것 처리
//  (1) '시리즈 없음' 웹툰을 네이버 시리즈 통합검색으로 찾아 다운수 연동
//  (2) 쿠키가 있으면 19금(성인) 포함 다운수를 매일 갱신
//
// 사용법:
//   node scripts/collect_local.js            (수집만, 커밋/푸시 안 함 — 확인용)
//   node scripts/collect_local.js --push     (수집 후 자동 커밋+푸시 — 스케줄러용)
//   옵션 --max=800 : 이번 실행에서 새로 검색할 웹툰 최대 수(기본 800)
//
// 쿠키(선택, 19금 다운수용): scripts/naver_cookie.txt 파일(깃 제외)에 붙여넣기,
//   또는 환경변수 NAVER_COOKIE. 로그인된 네이버에서 F12→Network→series.naver.com 요청→
//   Request Headers의 Cookie 값 전체를 복사. 없으면 비성인 작품만 처리됩니다.

const C = require("./collect.js");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const D = path.join(ROOT, "docs", "data");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const args = process.argv.slice(2);
const PUSH = args.includes("--push");
const MAXNEW = Number((args.find(a => a.startsWith("--max=")) || "").split("=")[1] || 800);

function loadCookie() {
  if (process.env.NAVER_COOKIE) return process.env.NAVER_COOKIE.trim();
  try { return fs.readFileSync(path.join(__dirname, "naver_cookie.txt"), "utf8").trim(); } catch (e) { return ""; }
}
const COOKIE = loadCookie();
function headers() { const h = { "User-Agent": UA, "Referer": "https://series.naver.com/" }; if (COOKIE) h["Cookie"] = COOKIE; return h; }
async function getText(url) { const r = await fetch(url, { headers: headers() }); return r.text(); }

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(D, f), "utf8")); } catch (e) { return d; } };
const normName  = s => String(s || "").replace(/\s*\[[^\]]*\]\s*$/, "").replace(/\s+/g, "");                     // 프론트와 동일(연동 키)
const normMatch = s => String(s || "").replace(/\s*[\[(<][^\])>]*[\])>]\s*$/, "").replace(/\s+/g, "").toLowerCase(); // 검색결과 매칭용(괄호도 제거)

(async () => {
  const t0 = Date.now();
  if (PUSH) { try { execSync(`git -C "${ROOT}" pull --rebase --autostash -X theirs origin main`, { stdio: "inherit" }); } catch (e) { console.log("초기 pull 스킵:", e.message); } }
  console.log(`로컬수집 시작 · 쿠키 ${COOKIE ? "있음(19금 다운수 갱신 가능)" : "없음(비성인만)"} · push=${PUSH}`);

  const series = readJSON("series.json", { comic: {}, novel: {} });
  const sd     = readJSON("series_details.json", {});
  const lookup = readJSON("lookup.json", { id: {}, name: {} });
  const extra  = readJSON("series_extra.json", { updated: "", searched: [], map: {}, owned: [] });
  extra.searched = extra.searched || []; extra.map = extra.map || {}; extra.owned = extra.owned || [];
  const searchedSet = new Set(extra.searched), ownedSet = new Set(extra.owned);

  // 랭킹작 normName -> [{pn,kind}]
  const idx = {};
  for (const kind of ["comic", "novel"]) for (const pf of ["web", "mobile"]) for (const c in (series[kind] || {})[pf] || {}) for (const p in series[kind][pf][c]) for (const it of series[kind][pf][c][p]) { const n = normName(it.t); (idx[n] || (idx[n] = [])).push({ pn: it.id, kind }); }
  const resolves = n => (idx[n] || []).some(x => sd[x.pn] && sd[x.pn].dl && sd[x.pn].ep) || (extra.map[n] || []).some(x => sd[x.pn] && sd[x.pn].dl && sd[x.pn].ep);

  function flush() { extra.searched = [...searchedSet]; extra.owned = [...ownedSet]; extra.updated = new Date().toISOString(); fs.writeFileSync(path.join(D, "series_details.json"), JSON.stringify(sd)); fs.writeFileSync(path.join(D, "series_extra.json"), JSON.stringify(extra)); }
  async function scrapeDetail(pn, kind) { try { const h = await getText(`https://series.naver.com/${kind}/detail.series?productNo=${pn}`); const pd = C.parseSeriesDetail(h); pd.kind = kind; if (pd.dl || pd.g || pd.ep || pd.syn) { sd[pn] = C.mergeDetail(sd[pn], pd, kind); return pd; } } catch (e) {} return null; }

  // (1) 시리즈 없음 웹툰 → 통합검색 연동
  const wt = Object.entries(lookup.id || {}).map(([id, v]) => ({ id: +id, name: v && v[0] })).filter(x => x.name);
  let searched = 0, found = 0;
  for (const w of wt) {
    if (searched >= MAXNEW) break;
    const key = normName(w.name);
    if (searchedSet.has(key)) continue;
    if (resolves(key)) { searchedSet.add(key); continue; }
    searched++;
    try {
      const h = await getText(`https://series.naver.com/search/search.series?t=all&q=${encodeURIComponent(w.name)}`);
      const res = C.parseSeriesSearch(h);
      const nm = normMatch(w.name);
      const hit = res.find(r => r.kind === "comic" && normMatch(r.title) === nm) || res.find(r => r.kind === "novel" && normMatch(r.title) === nm);
      searchedSet.add(key);
      if (hit) {
        const pd = await scrapeDetail(hit.pn, hit.kind);
        const a = extra.map[key] || (extra.map[key] = []);
        if (!a.some(x => x.pn === hit.pn)) a.push({ pn: hit.pn, kind: hit.kind });
        ownedSet.add(hit.pn);
        if (pd && pd.dl) found++;
      }
    } catch (e) {}
    await sleep(120);
    if (searched % 50 === 0) { console.log(`  검색 ${searched}건… (다운수 연동 ${found})`); flush(); }
  }
  console.log(`검색 완료: ${searched}건 시도, ${found} 다운수 확보`);

  // (2) owned(검색작+19금) 다운수 갱신
  const pnKind = {}; for (const n in extra.map) for (const e of extra.map[n]) pnKind[e.pn] = e.kind;
  let refreshed = 0, newDl = 0;
  const owned = [...ownedSet];
  for (const pn of owned) {
    const kind = pnKind[pn] || (sd[pn] && sd[pn].kind) || "comic";
    const before = sd[pn] && sd[pn].dl;
    const pd = await scrapeDetail(pn, kind);
    if (pd && pd.dl) { refreshed++; if (!before) newDl++; }
    await sleep(120);
  }
  console.log(`owned 다운수 갱신: ${refreshed}/${owned.length}${COOKIE ? ` (신규 확보 ${newDl})` : ""}`);

  flush();
  const rh = C.updateRevenueHistory(D, C.isoDate());
  console.log(`저장 완료 · 매출히스토리 ${JSON.stringify(rh)} · 연동맵 ${Object.keys(extra.map).length}작품 · owned ${extra.owned.length} · searched ${extra.searched.length} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  if (PUSH) {
    try {
      execSync(`git -C "${ROOT}" add docs/data/series_details.json docs/data/series_extra.json docs/data/revenue_history.json`, { stdio: "inherit" });
      execSync(`git -C "${ROOT}" commit -m "local: 시리즈 검색연동+다운수 갱신 ${C.isoDate()}"`, { stdio: "inherit" });
      for (let i = 0; i < 3; i++) { try { execSync(`git -C "${ROOT}" pull --rebase --autostash -X theirs origin main`, { stdio: "inherit" }); execSync(`git -C "${ROOT}" push origin main`, { stdio: "inherit" }); console.log("푸시 완료"); break; } catch (e) { console.log("재시도", i + 1); } }
    } catch (e) { console.log("변경 없음/커밋 스킵"); }
  }
})();
