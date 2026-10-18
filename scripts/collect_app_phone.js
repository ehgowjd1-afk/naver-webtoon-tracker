/* 앱 「장르 웹툰 주간랭킹 TOP 100」을 USB로 연결한 안드로이드 폰(네이버웹툰 앱) 화면에서 읽어 docs/data/app_genre/에 저장.
 * 장르마다: 검색 위젯 1~3위 작품 → 앱 작품 화면 열기(모바일 웹 '앱으로 보기' 링크 webtoonkr://contentList) → 줄거리 펼쳐
 *   '#장르랭킹 N위/TOP N' 태그 누름 → 랭킹 화면을 끝까지 스크롤하며 uiautomator로 화면 글자를 읽음(앱 서버는 안 건드림).
 * 클라우드 수집(collect.js)이 같은 파일에 위젯 1~45위를 쓰고, 이 폰 결과(100위+순위변동·연속주·뱃지)가 있으면 그걸 우선함 → scripts/lib/app_genre.cjs
 * 준비: 폰 개발자 옵션 → USB 디버깅 켬 + PC 허용. 화면 잠금(PIN·패턴)이 걸려 있으면 건너뜀 → 이 폰은 잠금 없음 + '충전 중 화면 켜짐 유지' 권장.
 *   node scripts/collect_app_phone.js [--push] [--genre=FANTASY,ROMANCE] [--dry]
 */
const fs = require("fs");
const path = require("path");
const G = require("./lib/app_genre.cjs");
const { PKG, adb, wait, log, dump, waitFocus, tap, swipe, back, toTop, dismissPopups, ensureReady, finish, fillIds, pushPaths } = require("./lib/adb_phone.cjs");

const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "docs", "data", "app_genre");
const args = process.argv.slice(2);
const PUSH = args.includes("--push"), DRY = args.includes("--dry");
const ONLY = ((args.find((a) => a.startsWith("--genre=")) || "").slice(8)).split(",").filter(Boolean);
const TODAY = G.kstToday();

// 작품 화면 열고 그 장르 랭킹 태그 누르기 → 랭킹 화면이면 true
function openGenreRanking(label, ids) {
  const key = G.norm(label) + "랭킹";
  const findTag = (nodes) => nodes.find((n) => /^#/.test(n.d) && G.norm(n.d).includes(key) && n.b.length);
  for (const id of ids) {
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `'webtoonkr://contentList?version=2&league=WEBTOON&titleId=${id}'`, PKG);
    if (!waitFocus(/TitleHomeActivity/)) { log(`  #${id} 작품 화면이 안 열림`); continue; }
    wait(2000);
    for (let i = 0; i < 4; i++) swipe(540, 700, 540, 1900, 250);   // 작품 화면 맨 위로(빠른 스와이프는 안쪽 목록만 굴러감)
    wait(1200);
    let nodes = dump(); if (dismissPopups(nodes)) nodes = dump();
    let tag = findTag(nodes);
    if (!tag) {   // 줄거리가 접혀 있으면 태그가 숨어 있음 → 작가명 줄 바로 아래 줄거리 줄을 눌러 펼치기(글자가 비어 잡히는 작품도 있어 위치로 찾음)
      const title = nodes.find((n) => n.cls === "Button" && /^작품명 /.test(n.d) && n.b.length);
      const tabs = nodes.find((n) => n.t === "살짝 보기" && n.b.length);
      const syn = title && nodes.find((n) => n.cls === "Button" && n.b.length && n.b[2] - n.b[0] > 800 && n.b[1] >= title.b[3] + 40 && (!tabs || n.b[3] <= tabs.b[1]));
      if (syn) { tap(syn.b); wait(1500); nodes = dump(); tag = findTag(nodes); }
    }
    if (!tag) { log(`  #${id} 에 '${label}랭킹' 태그 없음`); back(); wait(1000); continue; }
    tap(tag.b);
    if (!waitFocus(/CurationActivity/)) { log(`  #${id} 태그 눌렀는데 랭킹 화면이 안 열림`); back(); wait(1000); continue; }
    wait(2500);
    const head = dump().find((n) => /주간랭킹/.test(n.t));
    if (head && G.norm(head.t).includes(G.norm(label))) return true;
    log(`  #${id} 열린 화면 제목이 다름: ${head ? head.t : "?"}`); back(); wait(1000); back(); wait(1000);
  }
  return false;
}

// 랭킹 화면 한 장 읽기: 가로 전체 칸(ViewGroup) 안의 글자를 y좌표로 묶음(칸마다 노드 순서가 달라서)
function parseBoxes(nodes) {
  const boxes = nodes.filter((n) => n.cls === "ViewGroup" && n.b[0] === 0 && n.b[2] === 1080 && n.b[3] - n.b[1] > 120 && n.b[3] - n.b[1] < 360).map((n) => ({ y1: n.b[1], y2: n.b[3] }));
  const items = boxes.map(() => ({ flags: "" }));
  for (const n of nodes) {
    if (!n.b.length) continue;
    const cy = (n.b[1] + n.b[3]) / 2, i = boxes.findIndex((bx) => cy >= bx.y1 && cy < bx.y2); if (i < 0) continue;
    const it = items[i]; let m;
    it.flags += " " + n.d;
    if (n.cls !== "TextView") continue;
    if ((m = n.d.match(/^(\d+) 위$/))) it.r = +m[1];
    else if (/^작품명 /.test(n.d)) it.t = n.t;
    else if (/^작가명 /.test(n.d)) it.a = n.t;
    else if ((m = n.d.match(/^(\d+) 계단 (상승|하락)$/))) it.m = m[2] === "상승" ? +m[1] : -m[1];
    else if (n.t && n.t.length < 25 && /주 연속|TOP\d+|진입|NEW|신규/.test(n.t)) it.badge = n.t;
  }
  return items.filter((it) => it.r && it.t).map((it) => {
    const b = [], s = +((it.badge || "").match(/(\d+)주 연속/) || [])[1] || 0;
    if (/재진입/.test(it.badge || "")) b.push("재진입"); else if (/진입/.test(it.badge || "")) b.push("진입");
    if (/신작/.test(it.flags)) b.push("신작");
    if (/휴재/.test(it.flags)) b.push("휴재");
    if (/업데이트 회차 있음/.test(it.flags)) b.push("UP");
    return { r: it.r, t: it.t, a: it.a || "", m: it.m || 0, s, b };
  });
}
function scrapeRanking() {
  toTop(); const got = new Map(); let stale = 0;
  for (let i = 0; i < 90 && stale < 3; i++) {
    let added = 0;
    for (const it of parseBoxes(dump())) {
      const o = got.get(it.r);
      if (!o) { got.set(it.r, it); added++; continue; }
      if (!o.m && it.m) o.m = it.m;   // 칸 아래가 잘린 채 처음 읽힌 경우 다시 볼 때 채움
      if (!o.s && it.s) o.s = it.s;
      for (const x of it.b) if (!o.b.includes(x)) o.b.push(x);
      if (!o.a && it.a) o.a = it.a;
    }
    stale = added ? 0 : stale + 1;
    if (got.has(100)) break;
    swipe(540, 1800, 540, 1000, 1200); wait(1000);
  }
  return [...got.values()].sort((a, b) => a.r - b.r);
}

(async () => {
  const t0 = Date.now();
  log(`앱 장르 주간랭킹(폰) 수집 시작 ${TODAY}${DRY ? " [dry]" : ""}`);
  // 순위는 월요일에 한 번 바뀜 → 이번 주(가장 최근 월요일) 파일에 6개 장르가 모두 폰 결과로 있으면 그 주는 끝(--force로 강제)
  if (!args.includes("--force") && !ONLY.length) {
    try {
      const idx = JSON.parse(fs.readFileSync(path.join(DIR, "index.json"), "utf8"));
      const f = JSON.parse(fs.readFileSync(path.join(DIR, `${idx.latest}.json`), "utf8"));
      if (idx.latest === G.lastMonday(TODAY) && G.GENRES.every(([, l]) => f.src && f.src[l] === "phone")) { log(`이번 주(${idx.latest}) 6개 장르 다 받음 — 건너뜀`); return; }
    } catch (e) {}
  }
  try { ensureReady(); } catch (e) { log("건너뜀:", e.message); return; }
  let lookup = { name: {} }; try { lookup = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "data", "lookup.json"), "utf8")); } catch (e) {}
  const result = {};
  for (const [code, label] of G.GENRES) {
    if (ONLY.length && !ONLY.includes(code)) continue;
    try {
      let wl = []; try { wl = await G.fetchWidgetGenre(code); } catch (e) { log(`  위젯 실패(${e.message}) — 저장된 지난 순위로 작품 고름`); }
      const ids = wl.slice(0, 3).map((x) => x.id).filter(Boolean);
      if (!ids.length) { try { const idx = JSON.parse(fs.readFileSync(path.join(DIR, "index.json"), "utf8")); const f = JSON.parse(fs.readFileSync(path.join(DIR, `${idx.latest}.json`), "utf8")); for (const x of (f.charts[label] || []).slice(0, 3)) { const id = x.id || (lookup.name || {})[x.t]; if (id) ids.push(id); } } catch (e) {} }
      log(`[${label}] 진입 작품 후보 ${ids.join(",") || "없음"}`);
      if (!ids.length || !openGenreRanking(label, ids)) { result[label] = "랭킹 화면 진입 실패"; continue; }
      const list = scrapeRanking();
      back(); wait(1200); back(); wait(1200);
      const wId = {}; for (const x of wl) wId[G.norm(x.t)] = x.id;
      await fillIds(list, lookup, wId);
      const missing = Array.from({ length: Math.min(100, (list[list.length - 1] || {}).r || 0) }, (_, i) => i + 1).filter((r) => !list.some((x) => x.r === r));
      log(`  ${list.length}개 읽음${missing.length ? ` · 빠진 순위 ${missing.join(",")}` : ""} · 1위 ${list[0] ? list[0].t : "-"}`);
      if (list.length < 45) { result[label] = `읽은 수 부족(${list.length}) — 저장 안 함`; continue; }
      if (wl.length >= 10 && !G.sameRanking(list, wl)) log("  ⚠ 위젯 1~45위와 순서가 다름(위젯이 아직 지난주일 수 있음)");
      if (DRY) { result[label] = `${list.length}개(dry)`; continue; }
      const r = G.saveGenre(DIR, label, list, "phone", TODAY);
      result[label] = `${list.length}개 → ${r.week}`;
    } catch (e) { result[label] = "실패 " + e.message; log(`  실패: ${e.message}`); try { back(); back(); } catch (_) {} }
  }
  finish();
  log("결과", JSON.stringify(result), `${((Date.now() - t0) / 60000).toFixed(1)}분`);

  if (PUSH && !DRY && Object.values(result).some((v) => /→/.test(v))) pushPaths(ROOT, ["docs/data/app_genre"], `local: 앱 장르 주간랭킹(폰) ${TODAY}`);
})();
