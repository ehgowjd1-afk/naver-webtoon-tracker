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
const idL = {};   // titleId -> [name, thumb, author]
const nameL = {}; // name -> titleId

async function getJSON(url, ref){ const r = await fetch(url, { headers:{ "User-Agent":UA_PC, "Referer":ref||"https://comic.naver.com/" } }); if(!r.ok) throw new Error(url+" "+r.status); return r.json(); }
async function getText(url, ua, ref){ const r = await fetch(url, { headers:{ "User-Agent":ua, "Referer":ref } }); if(!r.ok) throw new Error(url+" "+r.status); return r.text(); }

/* 웹(comic.naver API): titleList → {r,t,a,b,id,th}, populate lookups */
function mapWeb(list){
  return list.map((t,i)=>{
    const b=[]; if(t.new)b.push("신작"); if(t.rest)b.push("휴재");
    const th=t.thumbnailUrl||"";
    if(t.titleId && !idL[t.titleId]) idL[t.titleId]=[t.titleName, th, t.author||""];
    if(t.titleName && !nameL[t.titleName]) nameL[t.titleName]=t.titleId;
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

function isoDate(){ return new Date(Date.now()+9*3600*1000).toISOString().slice(0,10); }

(async ()=>{
  const updated=new Date().toISOString(), date=isoDate();
  console.log("collecting", date, "…");
  // 웹 먼저(lookup 채움) → 앱은 lookup 참조
  const web_wd = await webWeekday();
  const web_gn = await webGenre();
  const [app_wd, app_gn, s_comic, s_novel] = await Promise.all([appWeekday(), appGenre(), series("comic"), series("novel")]);

  fs.writeFileSync(path.join(OUT,"weekday.json"), JSON.stringify({ updated, date, web:web_wd, app:app_wd }));
  fs.writeFileSync(path.join(OUT,"genre.json"), JSON.stringify({ updated, date, web:web_gn, app:app_gn }));
  fs.writeFileSync(path.join(OUT,"series.json"), JSON.stringify({ updated, date, comic:s_comic, novel:s_novel }));
  fs.writeFileSync(path.join(OUT,"lookup.json"), JSON.stringify({ id:idL, name:nameL }));

  const c=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,v.length]));
  console.log("done:", JSON.stringify({ web_wd:c(web_wd), app_wd:c(app_wd), web_gn:c(web_gn), app_gn:c(app_gn), comic:c(s_comic), novel:c(s_novel), lookup:Object.keys(idL).length }));
})().catch(e=>{ console.error("FAILED:",e); process.exit(1); });
