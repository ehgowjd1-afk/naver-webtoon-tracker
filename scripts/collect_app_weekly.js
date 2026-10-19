/* 앱 「이번 주 웹툰 랭킹」(전체·여성·남성 각 100위 + 순위변동·연속주·뱃지)을 USB 연결 폰의 네이버웹툰 앱 화면에서 읽어
 * docs/data/{주차}.json(사이트 '앱 주간' 탭, 예전엔 매주 손으로 넣던 파일) + index.json에 저장.
 * 검색 위젯(webtoonWeek) 1~3위 작품 화면 → 줄거리 펼쳐 '#주간랭킹 N위/TOP 10' 태그 → 랭킹 화면 정렬(전체/여성/남성)을 바꿔 가며 끝까지 읽기.
 * 주차 = 순위가 나온 월요일(기존 파일 이름 규칙). 1~45위가 지난주 파일과 거의 같으면 아직 안 바뀐 것 → 저장 안 함.
 * 그 주 파일이 이미 있으면 --force 없이는 건너뜀(손으로 넣은 파일 보호).
 *   node scripts/collect_app_weekly.js [--push] [--dry] [--force]
 */
const fs = require("fs");
const path = require("path");
const G = require("./lib/app_genre.cjs");
const P = require("./lib/adb_phone.cjs");
const { openRankingByTag, scrapeRanking } = require("./collect_app_phone.js");
const { wait, log, dump, tap } = P;

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "docs", "data");
const args = process.argv.slice(2);
const PUSH = args.includes("--push"), DRY = args.includes("--dry"), FORCE = args.includes("--force");
const TODAY = G.kstToday();
const CHARTS = ["전체", "여성", "남성"];
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return d; } };

const sortNode = (nodes) => nodes.find((n) => /^(전체|여성|남성) 기준으로 정렬$/.test(n.d) && n.b.length);
function setChart(label) {   // 랭킹 화면 왼쪽 위 정렬(전체/여성/남성) — 바텀시트라 열고 기다린 뒤 고름
  let s = sortNode(dump()); if (!s) return false;
  if (s.d.startsWith(label + " ")) return true;
  tap(s.b); wait(2500);
  const opt = dump().find((n) => n.cls === "TextView" && n.t === label && n.b.length && n.b[1] > 900);
  if (!opt) { P.back(); wait(1000); return false; }
  tap(opt.b); wait(4000);
  s = sortNode(dump());
  return !!(s && s.d.startsWith(label + " "));
}

(async () => {
  const t0 = Date.now(), week = G.lastMonday(TODAY);
  log(`앱 이번 주 웹툰 랭킹(폰) 수집 시작 ${TODAY} → ${week} 주차${DRY ? " [dry]" : ""}`);
  const idx = readJSON(path.join(OUT, "index.json"), { weeks: [], depth: {} });
  if (!FORCE && fs.existsSync(path.join(OUT, `${week}.json`))) { log(`${week} 주차 파일이 이미 있음 — 건너뜀(--force로 덮어쓰기)`); return; }
  let wl = []; try { wl = await G.fetchWidgetList("webtoonWeek", "TOTAL"); } catch (e) { log("위젯 실패:", e.message); }
  const prevWeek = (idx.weeks || []).filter((w) => w < week).sort().pop();
  const prev = prevWeek ? readJSON(path.join(OUT, `${prevWeek}.json`), null) : null;
  if (!FORCE && prev && wl.length >= 40 && G.sameRanking(wl, prev.charts["전체"] || [])) { log(`검색 위젯 1~45위가 ${prevWeek} 주차와 같음 — 아직 이번 주 순위 전, 건너뜀`); return; }
  try { P.ensureReady(); } catch (e) { log("건너뜀:", e.message); return; }
  const ids = wl.slice(0, 3).map((x) => x.id).filter(Boolean);
  if (!ids.length) { log("진입할 작품을 못 찾음"); return; }
  const charts = {};
  try {
    if (!openRankingByTag("주간랭킹", (t) => /이번 주 웹툰 랭킹/.test(t), ids, "주간랭킹")) { log("이번 주 웹툰 랭킹 화면 진입 실패"); return; }
    for (const c of CHARTS) {
      if (!setChart(c)) { log(`  [${c}] 정렬을 못 바꿈`); continue; }
      const list = scrapeRanking();
      const miss = Array.from({ length: 100 }, (_, i) => i + 1).filter((r) => !list.some((x) => x.r === r));
      log(`  [${c}] ${list.length}개${miss.length ? ` · 빠진 순위 ${miss.join(",")}` : ""} · 1~3위 ${list.slice(0, 3).map((x) => x.t).join(", ")}`);
      if (list.length >= 90) charts[c] = list;
    }
    setChart("전체");   // 화면을 원래(전체)로
  } catch (e) { log("실패:", e.message); }
  finally { P.back(); wait(1000); P.back(); wait(1000); P.finish(); }
  if (!CHARTS.every((c) => charts[c])) { log("세 차트를 다 못 읽음 — 저장 안 함", JSON.stringify(Object.fromEntries(Object.entries(charts).map(([k, v]) => [k, v.length])))); return; }
  if (prev && G.sameRanking(charts["전체"], prev.charts["전체"] || [])) { log(`읽은 순위가 ${prevWeek} 주차와 같음 — 아직 안 바뀜, 저장 안 함`); return; }
  if (wl.length >= 40 && !G.sameRanking(charts["전체"], wl)) log("  ⚠ 검색 위젯 1~45위와 순서가 다름");
  log("결과", JSON.stringify(Object.fromEntries(CHARTS.map((c) => [c, charts[c].length]))), `${((Date.now() - t0) / 60000).toFixed(1)}분`);
  if (DRY) return;
  fs.writeFileSync(path.join(OUT, `${week}.json`), JSON.stringify({ date: week, charts }));
  idx.weeks = [...new Set([...(idx.weeks || []), week])].sort(); idx.latest = idx.weeks[idx.weeks.length - 1];
  idx.depth = Object.fromEntries(CHARTS.map((c) => [c, charts[c].length]));
  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(idx));
  log(`저장: docs/data/${week}.json + index.json`);
  if (PUSH) P.pushPaths(ROOT, [`docs/data/${week}.json`, "docs/data/index.json"], `local: 앱 이번 주 웹툰 랭킹(폰) ${week}`);
})();
