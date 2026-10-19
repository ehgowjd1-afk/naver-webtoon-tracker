/* 앱 「장르 웹툰 주간랭킹 TOP 100」(판타지·무협·액션·드라마·로맨스·스릴러·일상·개그) 공통 모듈.
 * 두 수집이 같은 주차 파일에 씀:
 *   - 클라우드(collect.js): 네이버 통합검색 위젯 → 장르마다 1~45위(제목·작가·titleId, 순위변동 없음). PC 없이 매일.
 *   - 폰(collect_app_phone.js, ADB): 앱 화면 → 1~100위 + 순위변동·연속주·뱃지. 폰 결과가 있으면 위젯 결과로 덮지 않음.
 *   위젯 1~45위는 앱 화면과 같은 자리 45/45 일치 확인(2026-10-18, 판타지·무협).
 * 파일: docs/data/app_genre/{주차}.json = {date, updated, src:{장르:"phone"|"widget"}, charts:{장르:[{r,t,a,id,m,s,b[]}]}}
 *       docs/data/app_genre/index.json = {weeks:[], latest, genres:[장르…]}
 * 주차 = 앱 주간 파일과 같은 규칙(순위가 나온 월요일 날짜). 네이버가 월요일에 새 순위를 내므로,
 *   받아 온 1~45위가 그 장르의 마지막 저장 주와 같으면 그 주, 다르면 '가장 최근 월요일(KST)'을 새 주로 씀.
 */
const fs = require("fs");
const path = require("path");

const GENRES = [["FANTASY", "판타지·무협"], ["ACTION", "액션"], ["DRAMA", "드라마"], ["ROMANCE", "로맨스"], ["THRILLER", "스릴러"], ["HUMOR", "일상·개그"]];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const norm = (s) => String(s || "").replace(/[\s​·・:,.!?'"‘’“”~\-]/g, "").toLowerCase();
const dec = (s) => String(s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 검색 위젯(key=webtoonGenre) → [{r,t,a,id}] 최대 45개
async function fetchWidgetGenre(code) { return fetchWidgetList("webtoonGenre", code); }
// 같은 위젯의 다른 목록(key=webtoonWeek, u1=TOTAL|FEMALE|MALE = 앱 이번 주 웹툰 랭킹 1~45위)
async function fetchWidgetList(key, u1) {
  const out = [];
  for (const start of [0, 15, 30]) {
    const url = `https://ts-proxy.naver.com/content/nqapirender.nhn?key=${key}&where=nexearch&pkid=47&display=15&start=${start}&u1=${u1}`;
    const r = await fetch(url, { headers: { "User-Agent": UA, Referer: "https://search.naver.com/" } });
    if (!r.ok) throw new Error(`widget ${key} ${u1} ${r.status}`);
    const j = await r.json();
    const lis = String(j.html || "").split("<li>").slice(1);
    if (!lis.length) break;
    for (const li of lis) {
      const t = dec((li.match(/<strong class="name">\s*<a[^>]*>([^<]*)<\/a>/) || li.match(/alt="(.*?) 이미지"/) || [])[1]);
      const a = dec((li.match(/<span class="sub_text[^"]*">([^<]*)<\/span>/) || [])[1]);
      const id = Number((li.match(/webtoon%2F(\d+)%2F/) || [])[1]) || null;
      if (t) out.push({ r: out.length + 1, t, a, id });
    }
    await sleep(150);
  }
  return out;
}

function kstToday() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
function lastMonday(d) { const t = new Date(d + "T00:00:00Z"); const back = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - back); return t.toISOString().slice(0, 10); }
const readJSON = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return dflt; } };

// 1~45위 제목이 (거의) 같으면 같은 주 순위로 봄 — 폰/위젯 표기 차이(공백 등)는 norm으로 흡수
function sameRanking(a, b) {
  const n = Math.min(45, a.length, b.length); if (n < 10) return false;
  let same = 0; for (let i = 0; i < n; i++) if (norm(a[i].t) === norm(b[i].t)) same++;
  return same / n >= 0.9;
}

function pickWeek(dir, label, list, today) {
  const idx = readJSON(path.join(dir, "index.json"), { weeks: [] });
  for (const w of [...(idx.weeks || [])].sort().reverse()) {
    const f = readJSON(path.join(dir, `${w}.json`), null);
    const prev = f && f.charts && f.charts[label];
    if (!prev || !prev.length) continue;
    return sameRanking(prev, list) ? w : lastMonday(today);
  }
  return lastMonday(today);
}

// 한 장르 저장. src="phone"이면 항상 씀, "widget"이면 그 주에 폰 결과가 이미 있으면 건너뜀. 반환: {week, wrote}
function saveGenre(dir, label, list, src, today) {
  fs.mkdirSync(dir, { recursive: true });
  today = today || kstToday();
  const week = pickWeek(dir, label, list, today);
  const fp = path.join(dir, `${week}.json`);
  const f = readJSON(fp, { date: week, updated: "", src: {}, charts: {} });
  f.src = f.src || {}; f.charts = f.charts || {};
  if (src === "widget" && f.src[label] === "phone") return { week, wrote: false };
  f.charts[label] = list; f.src[label] = src; f.updated = today; f.date = week;
  fs.writeFileSync(fp, JSON.stringify(f));
  const idx = readJSON(path.join(dir, "index.json"), { weeks: [] });
  idx.weeks = [...new Set([...(idx.weeks || []), week])].sort();
  idx.latest = idx.weeks[idx.weeks.length - 1];
  idx.genres = GENRES.map((g) => g[1]);
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(idx));
  return { week, wrote: true };
}

// 클라우드용: 6개 장르 위젯 1~45위 저장
async function collectWidgetAll(dataDir, today) {
  const dir = path.join(dataDir, "app_genre"), res = {};
  for (const [code, label] of GENRES) {
    try {
      const list = (await fetchWidgetGenre(code)).map((x) => ({ r: x.r, t: x.t, a: x.a, id: x.id, m: 0, s: 0, b: [] }));
      if (list.length < 10) { res[label] = `skip(${list.length})`; continue; }
      const r = saveGenre(dir, label, list, "widget", today);
      res[label] = `${list.length}@${r.week}${r.wrote ? "" : "(폰 결과 유지)"}`;
    } catch (e) { res[label] = "fail " + e.message; }
  }
  return res;
}

module.exports = { GENRES, norm, fetchWidgetGenre, fetchWidgetList, kstToday, lastMonday, sameRanking, pickWeek, saveGenre, collectWidgetAll };
