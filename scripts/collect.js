"use strict";
/* 자동 수집: 웹툰 요일별·장르(앱/웹 각각) + 시리즈 웹툰·웹소설(일/주/월).
   공개 API/페이지만 사용. 앱 「이번 주 웹툰 랭킹」(전체/여성/남성)은 앱 전용이라 수동. */
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "..", "docs", "data");
const UA_PC = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const UA_M = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const WEEKDAYS = ["mon","tue","wed","thu","fri","sat","sun","dailyPlus"];
const GENRES = ["HISTORICAL","FANTASY","ACTION","DRAMA","PURE","SENSIBILITY","DAILY","COMIC","THRILL","SPORTS"];
const PERIODS = ["DAILY","WEEKLY","MONTHLY"];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const idL = {};    // titleId -> [name, thumb, author]
const nameL = {};  // name -> titleId
const stars = {};  // titleId -> starScore

async function getJSON(url, ref){ const r = await fetch(url, { headers:{ "User-Agent":UA_PC, "Referer":ref||"https://comic.naver.com/" } }); if(!r.ok) throw new Error(url+" "+r.status); return r.json(); }
async function getText(url, ua, ref){ const r = await fetch(url, { headers:{ "User-Agent":ua, "Referer":ref } }); if(!r.ok) throw new Error(url+" "+r.status); return r.text(); }

/* 웹(comic.naver API): titleList → {r,t,a,b,id,th}, populate lookups */
function mapWeb(list){
  return list.map((t,i)=>{
    const b=[]; if(t.new)b.push("신작"); if(t.rest)b.push("휴재");
    const th=t.thumbnailUrl||"";
    if(t.titleId && !idL[t.titleId]) idL[t.titleId]=[t.titleName, th, t.author||""];
    if(t.titleName && !nameL[t.titleName]) nameL[t.titleName]=t.titleId;
    if(t.titleId!=null && t.starScore!=null) stars[t.titleId]=Math.round(t.starScore*100)/100;
    return { r:i+1, t:t.titleName, a:t.author||"", b, id:t.titleId, th };
  });
}
async function webWeekday(){ const o={}; for(const w of WEEKDAYS){ const d=await getJSON(`https://comic.naver.com/api/webtoon/titlelist/weekday?week=${w}&order=user`,"https://comic.naver.com/webtoon/weekday"); o[w]=mapWeb(d.titleList||[]); await sleep(120);} return o; }
async function webGenre(){ const o={}; for(const g of GENRES){ try{ const d=await getJSON(`https://comic.naver.com/api/webtoon/titlelist/genre?genre=${g}&order=user`,"https://comic.naver.com/webtoon?tab=genre"); o[g]=mapWeb(d.titleList||[]);}catch(e){o[g]=[];console.error("webGenre",g,e.message);} await sleep(120);} return o; }

/* 앱(m.comic HTML): nclk_v2(event,'lst.list','id','rank') → {r,id} (제목 등은 프론트에서 lookup) */
function parseMobile(html, startMarker){
  const s = startMarker ? html.slice(Math.max(0, html.indexOf(startMarker))) : html;
  const seen = new Set(), out = [];
  for (const m of s.matchAll(/nclk_v2\(event,\s*'lst\.list',\s*'(\d+)',\s*'(\d+)'\)/g)){
    const id = Number(m[1]), r = Number(m[2]);
    if (seen.has(id)) continue; seen.add(id);
    out.push({ r, id });
  }
  return out.sort((a,b)=>a.r-b.r);
}
async function appWeekday(){ const o={}; for(const w of WEEKDAYS){ try{ const h=await getText(`https://m.comic.naver.com/webtoon/weekday?week=${w}`,UA_M,"https://m.comic.naver.com/webtoon/weekday"); o[w]=parseMobile(h,"section_list_toon"); }catch(e){o[w]=[];console.error("appWeekday",w,e.message);} await sleep(120);} return o; }
async function appGenre(){ const o={}; for(const g of GENRES){ try{ const h=await getText(`https://m.comic.naver.com/webtoon/genre?genre=${g}`,UA_M,"https://m.comic.naver.com/webtoon/genre"); o[g]=parseMobile(h,"lst_genre"); }catch(e){o[g]=[];console.error("appGenre",g,e.message);} await sleep(120);} return o; }

/* 시리즈(series.naver HTML) 웹툰/웹소설: {r,t,a,m,id,th} */
function parseSeries(html, kind, baseRank){
  const items = html.split(/<li>/).filter(x => new RegExp(kind+"\\/detail\\.series\\?productNo=").test(x) && /<em class="no/.test(x));
  const out = [];
  items.forEach((it,i)=>{
    const idM = it.match(/productNo=(\d+)"\s+class="pic/);
    const tM = it.match(/class="pic[^"]*"[\s\S]*?alt="([^"]*)"/);
    const thM = it.match(/class="pic[^"]*"[\s\S]*?<img\s+src="([^"]+)"/);
    const au = [...it.matchAll(/<span class="author">([^<]+)<\/span>/g)].map(m=>m[1].trim());
    let m=0; const mv=it.match(/comic_ico (up|down)[^>]*>[^<]*<\/em><em class="comic_no">(\d+)/); if(mv) m=mv[1]==="up"?Number(mv[2]):-Number(mv[2]);
    if(idM&&tM) out.push({ r:baseRank+i+1, t:tM[1].trim(), a:au.join(" / "), m, id:Number(idM[1]), th:thM?thM[1]:"" });
  });
  return out;
}
async function series(kind){ // kind: comic | novel
  const o={};
  for(const p of PERIODS){
    let all=[];
    for(let page=1;page<=5;page++){
      const h=await getText(`https://series.naver.com/${kind}/top100List.series?rankingTypeCode=${p}&categoryCode=ALL&page=${page}`,UA_PC,"https://series.naver.com/");
      const rows=parseSeries(h,kind,all.length); if(!rows.length)break; all=all.concat(rows); await sleep(180);
    }
    o[p]=all.slice(0,100);
  }
  return o;
}

/* 작품 상세(장르·키워드·제작사·관심수·연령·요일·줄거리) — 신규 titleId만 증분 수집 */
async function collectDetails(existing){
  const details = existing || {};
  const ids = Object.keys(idL).map(Number);
  const todo = ids.filter(id => !details[id] || details[id].ep === undefined); // 신규 or 스키마 미충족
  console.log("details:", todo.length, "신규 / ", ids.length, "전체");
  const CONC = 4;
  for(let i=0;i<todo.length;i+=CONC){
    await Promise.all(todo.slice(i,i+CONC).map(async id=>{
      try{
        const d = await getJSON(`https://comic.naver.com/api/article/list/info?titleId=${id}`, `https://comic.naver.com/webtoon/list?titleId=${id}`);
        const tags = d.curationTagList || [];
        const cpName = (d.gfpAdCustomParam||{}).cpName || "";
        let ep = 0;
        try { const al = await getJSON(`https://comic.naver.com/api/article/list?titleId=${id}&page=1`, `https://comic.naver.com/webtoon/list?titleId=${id}`); ep = al.totalCount || 0; } catch(e){}
        details[id] = {
          g: (tags.find(t=>/GENRE/.test(t.curationType))||{}).tagName || "",
          k: tags.filter(t=>t.curationType==="CUSTOM_TAG").map(t=>t.tagName),
          cp: cpName.includes("_") ? cpName.split("_")[0] : cpName,
          age: (d.age&&d.age.description) || "",
          day: d.publishDescription || "",
          fav: d.favoriteCount || 0,
          ep,
          dailyplus: ((d.gfpAdCustomParam||{}).dailyPlusYn === "Y"),
          syn: (d.synopsis||"").replace(/\s+/g," ").trim().slice(0,220),
          novel: tags.some(t=>t.curationType==="NOVEL_ORIGIN")
        };
      }catch(e){ /* skip */ }
    }));
    await sleep(50);
  }
  return details;
}

/* 순위 추이 누적: history.json = {dates:[...], series:{basisKey:{id:[rank aligned to dates]}}} (최근 45일) */
function buildTodayBases(web_wd, app_wd, web_gn, app_gn, s_comic, s_novel){
  const b = {}, put = (key, arr) => { b[key] = Object.fromEntries((arr||[]).map(r => [r.id, r.r])); };
  for(const w of WEEKDAYS){ put("wd_web_"+w, web_wd[w]); put("wd_app_"+w, app_wd[w]); }
  for(const g of GENRES){ put("gn_web_"+g, web_gn[g]); put("gn_app_"+g, app_gn[g]); }
  for(const p of PERIODS){ put("series_comic_"+p, s_comic[p]); put("series_novel_"+p, s_novel[p]); }
  return b;
}
function updateHistory(hist, date, todayBases){
  if(!hist || !Array.isArray(hist.dates)) hist = { dates:[], series:{} };
  if(hist.dates[hist.dates.length-1] === date){ // 같은 날 재실행 → 마지막 덮어쓰기
    hist.dates.pop();
    for(const bk in hist.series) for(const id in hist.series[bk]) hist.series[bk][id].pop();
  }
  hist.dates.push(date); const di = hist.dates.length - 1;
  for(const [bk, ranks] of Object.entries(todayBases)){
    const S = hist.series[bk] || (hist.series[bk] = {});
    for(const id in S){ while(S[id].length < di) S[id].push(null); }
    for(const [id, rank] of Object.entries(ranks)){ if(!S[id]) S[id] = new Array(di).fill(null); S[id][di] = rank; }
    for(const id in S){ if(S[id].length <= di) S[id].push(null); }
  }
  const MAX = 45;
  if(hist.dates.length > MAX){ const cut = hist.dates.length - MAX; hist.dates.splice(0, cut); for(const bk in hist.series) for(const id in hist.series[bk]) hist.series[bk][id].splice(0, cut); }
  return hist;
}

function isoDate(){ return new Date(Date.now()+9*3600*1000).toISOString().slice(0,10); }

(async ()=>{
  const updated=new Date().toISOString(), date=isoDate();
  console.log("collecting", date, "…");
  // 웹 먼저(lookup 채움) → 앱은 lookup 참조
  const web_wd = await webWeekday();
  const web_gn = await webGenre();
  const [app_wd, app_gn, s_comic, s_novel] = await Promise.all([appWeekday(), appGenre(), series("comic"), series("novel")]);

  let existingDetails = {};
  try { existingDetails = JSON.parse(fs.readFileSync(path.join(OUT,"details.json"),"utf8")); } catch(e){}
  const details = await collectDetails(existingDetails);
  for(const id in stars){ if(details[id]) details[id].star = stars[id]; } // 평균별점 매일 갱신

  let hist = {};
  try { hist = JSON.parse(fs.readFileSync(path.join(OUT,"history.json"),"utf8")); } catch(e){}
  hist = updateHistory(hist, date, buildTodayBases(web_wd, app_wd, web_gn, app_gn, s_comic, s_novel));

  fs.writeFileSync(path.join(OUT,"weekday.json"), JSON.stringify({ updated, date, web:web_wd, app:app_wd }));
  fs.writeFileSync(path.join(OUT,"genre.json"), JSON.stringify({ updated, date, web:web_gn, app:app_gn }));
  fs.writeFileSync(path.join(OUT,"series.json"), JSON.stringify({ updated, date, comic:s_comic, novel:s_novel }));
  fs.writeFileSync(path.join(OUT,"lookup.json"), JSON.stringify({ id:idL, name:nameL }));
  fs.writeFileSync(path.join(OUT,"details.json"), JSON.stringify(details));
  fs.writeFileSync(path.join(OUT,"history.json"), JSON.stringify(hist));

  const c=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,v.length]));
  console.log("done:", JSON.stringify({ web_wd:c(web_wd), app_wd:c(app_wd), comic:c(s_comic), novel:c(s_novel), details:Object.keys(details).length, histDates:hist.dates.length, histBases:Object.keys(hist.series).length }));
})().catch(e=>{ console.error("FAILED:",e); process.exit(1); });
