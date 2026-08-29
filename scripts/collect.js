"use strict";
/* 네이버웹툰 요일별·장르별 + 시리즈 일/주/월 자동 수집.
   공개 API/페이지만 사용(로그인 불필요). GitHub Actions에서 매일 실행.
   앱 「이번 주 웹툰 랭킹」(전체/여성/남성)은 앱 전용이라 여기서 수집 불가 → 수동. */
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "docs", "data");
const UA_PC = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const WEEKDAYS = [["mon","월"],["tue","화"],["wed","수"],["thu","목"],["fri","금"],["sat","토"],["sun","일"],["dailyPlus","매일+"]];
const GENRES = [["HISTORICAL","무협/사극"],["FANTASY","판타지"],["ACTION","액션"],["DRAMA","드라마"],["PURE","순정"],["SENSIBILITY","감성"],["DAILY","일상"],["COMIC","개그"],["THRILL","스릴러"],["SPORTS","스포츠"]];
const SERIES_PERIODS = [["DAILY","일간"],["WEEKLY","주간"],["MONTHLY","월간"]];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const lookup = {}; // titleName -> [titleId, thumb]

async function getJSON(url, referer){
  const r = await fetch(url, { headers: { "User-Agent": UA_PC, "Referer": referer || "https://comic.naver.com/" } });
  if (!r.ok) throw new Error(url + " → " + r.status);
  return r.json();
}
async function getText(url){
  const r = await fetch(url, { headers: { "User-Agent": UA_PC, "Referer": "https://series.naver.com/" } });
  if (!r.ok) throw new Error(url + " → " + r.status);
  return r.text();
}

/* 웹툰 titleList → {r,t,a,b,id,th}, and populate lookup */
function mapWebtoon(list){
  return list.map((t, i) => {
    const b = [];
    if (t.new) b.push("신작");
    if (t.rest) b.push("휴재");
    const th = t.thumbnailUrl || "";
    if (t.titleName && !lookup[t.titleName]) lookup[t.titleName] = [t.titleId, th];
    return { r: i + 1, t: t.titleName, a: t.author || "", b, id: t.titleId, th };
  });
}
async function collectWeekday(){
  const days = {};
  for (const [code] of WEEKDAYS){
    const d = await getJSON(`https://comic.naver.com/api/webtoon/titlelist/weekday?week=${code}&order=user`, "https://comic.naver.com/webtoon/weekday");
    days[code] = mapWebtoon(d.titleList || []);
    await sleep(150);
  }
  return days;
}
async function collectGenre(){
  const genres = {};
  for (const [code] of GENRES){
    try {
      const d = await getJSON(`https://comic.naver.com/api/webtoon/titlelist/genre?genre=${code}&order=user`, "https://comic.naver.com/webtoon?tab=genre");
      genres[code] = mapWebtoon(d.titleList || []);
    } catch(e){ genres[code] = []; console.error("genre", code, e.message); }
    await sleep(150);
  }
  return genres;
}

/* 시리즈 웹툰 일/주/월: HTML 파싱 → {r,t,a,m,id,th} */
function parseSeriesPage(html, baseRank){
  const items = html.split(/<li>/).filter(x => /comic\/detail\.series\?productNo=/.test(x) && /<em class="no/.test(x));
  const out = [];
  items.forEach((it, i) => {
    const idM = it.match(/productNo=(\d+)"\s+class="pic/);
    const titleM = it.match(/class="pic[^"]*"[\s\S]*?alt="([^"]*)"/);
    const thM = it.match(/class="pic[^"]*"[\s\S]*?<img\s+src="([^"]+)"/);
    const authors = [...it.matchAll(/<span class="author">([^<]+)<\/span>/g)].map(m => m[1].trim());
    let m = 0;
    const mv = it.match(/comic_ico (up|down)[^>]*>[^<]*<\/em><em class="comic_no">(\d+)/);
    if (mv) m = mv[1] === "up" ? Number(mv[2]) : -Number(mv[2]);
    if (idM && titleM) out.push({ r: baseRank + i + 1, t: titleM[1].trim(), a: authors.join(" / "), m, id: Number(idM[1]), th: thM ? thM[1] : "" });
  });
  return out;
}
async function collectSeries(){
  const periods = {};
  for (const [code] of SERIES_PERIODS){
    let all = [];
    for (let page = 1; page <= 5; page++){
      const html = await getText(`https://series.naver.com/comic/top100List.series?rankingTypeCode=${code}&categoryCode=ALL&page=${page}`);
      const rows = parseSeriesPage(html, all.length);
      if (!rows.length) break;
      all = all.concat(rows);
      await sleep(200);
    }
    periods[code] = all.slice(0, 100);
  }
  return periods;
}

function isoDate(){
  const now = new Date(Date.now() + 9 * 3600 * 1000); // KST
  return now.toISOString().slice(0, 10);
}

(async () => {
  const updated = new Date().toISOString();
  const date = isoDate();
  console.log("collecting", date, "…");

  const [days, genres, series] = await Promise.all([collectWeekday(), collectGenre(), collectSeries()]);

  fs.writeFileSync(path.join(OUT, "weekday.json"), JSON.stringify({ updated, date, order: "user(인기순)", days }));
  fs.writeFileSync(path.join(OUT, "genre.json"), JSON.stringify({ updated, date, order: "user(인기순)", genres }));
  fs.writeFileSync(path.join(OUT, "series.json"), JSON.stringify({ updated, date, category: "웹툰(전체)", periods: series }));
  fs.writeFileSync(path.join(OUT, "lookup.json"), JSON.stringify(lookup));

  const counts = {
    weekday: Object.fromEntries(Object.entries(days).map(([k,v]) => [k, v.length])),
    genre: Object.fromEntries(Object.entries(genres).map(([k,v]) => [k, v.length])),
    series: Object.fromEntries(Object.entries(series).map(([k,v]) => [k, v.length])),
    lookup: Object.keys(lookup).length,
  };
  console.log("done:", JSON.stringify(counts));
})().catch(e => { console.error("FAILED:", e); process.exit(1); });
