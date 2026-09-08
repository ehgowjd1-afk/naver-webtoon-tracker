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

/* 시리즈 카테고리(장르) 코드→이름. 웹툰/웹소설 목록 다름 */
const SERIES_CATS = {
  comic: [["ALL","전체장르"],["90","소년"],["99","순정"],["93","드라마"],["88","무협"],["107","BL"]],
  novel: [["ALL","전체장르"],["201","로맨스"],["202","판타지"],["203","미스터리"],["205","라이트노벨"],["206","무협"],["207","로판"],["208","현판"],["209","BL"]]
};
function seriesBadges(it){ // 완결/무료 뱃지 (신규 상승/하락은 별도)
  const b=[]; const info=(it.match(/info comic_wt"[\s\S]*?<\/p>/)||[""])[0]||it;
  if(/완결/.test(info) && !/미완결/.test(info)) b.push("완결");
  const free=(it.match(/free_info[\s\S]*?<span>\s*([^<]*?무료)\s*<\/span>/)||it.match(/(\d+[화권]\s*무료)/)||[])[1];
  if(free) b.push(free.trim());
  return b;
}
/* PC 웹(series.naver HTML): {r,t,a,m,id,th,b} */
function parseSeries(html, kind, baseRank){
  const items = html.split(/<li>/).filter(x => new RegExp(kind+"\\/detail\\.series\\?productNo=").test(x) && /<em class="no/.test(x));
  const out = [];
  items.forEach((it,i)=>{
    const idM = it.match(/productNo=(\d+)"\s+class="pic/);
    const tM = it.match(/class="pic[^"]*"[\s\S]*?alt="([^"]*)"/);
    const thM = it.match(/class="pic[^"]*"[\s\S]*?<img\s+src="([^"]+)"/);
    const au = [...it.matchAll(/<span class="author">([^<]+)<\/span>/g)].map(m=>m[1].trim());
    let m=0; const mv=it.match(/comic_ico (up|down)[^>]*>[^<]*<\/em><em class="comic_no">(\d+)/); if(mv) m=mv[1]==="up"?Number(mv[2]):-Number(mv[2]);
    const b=seriesBadges(it); if(/comic_ico new/.test(it)) b.unshift("신규");
    if(idM&&tM) out.push({ r:baseRank+i+1, t:tM[1].trim(), a:au.join(" / "), m, id:Number(idM[1]), th:thM?thM[1]:"", b });
  });
  return out;
}
/* 모바일 웹(m.series HTML): {r,t,a,m,id,th,b} — 순위 PC와 다름 */
function parseSeriesMobile(html, kind, baseRank){
  const items = html.split(/<li class="lst">/).filter(x => new RegExp(kind+"\\/detail\\.series\\?productNo=").test(x) && /top_num/.test(x));
  const out=[];
  items.forEach((it,i)=>{
    const idM = it.match(/detail\.series\?productNo=(\d+)/);
    const tM = it.match(/class="tit comic_tit">\s*([^<]+?)\s*</) || it.match(/alt="([^"]*)"/);
    const thM = it.match(/comic_top_bok[\s\S]*?<img\s+src="([^"]+)"/);
    const au = [...it.matchAll(/<span class="author">([^<]+)<\/span>/g)].map(m=>m[1].trim());
    let m=0; const mv=it.match(/comic_ico (up|down)"[^>]*>[^<]*<\/em>\s*<em class="comic_no">(\d+)/); if(mv) m=mv[1]==="up"?+mv[2]:-(+mv[2]);
    const uds=(it.match(/top_uds"[\s\S]*?<\/span>/)||[""])[0];
    const b=seriesBadges(it); if(/comic_ico new/.test(uds)) b.unshift("신규");
    if(idM&&tM) out.push({ r:baseRank+i+1, t:tM[1].trim(), a:au.join(" / "), m, id:Number(idM[1]), th:thM?thM[1]:"", b });
  });
  return out;
}
/* 통합: 웹툰/웹소설 × 웹/모바일 × 카테고리 × 일/주/월 */
async function seriesAll(kind){
  const out = { web:{}, mobile:{} };
  for(const [code,name] of SERIES_CATS[kind]){
    out.web[name]={}; out.mobile[name]={};
    for(const p of PERIODS){
      let wall=[];
      for(let page=1;page<=5;page++){ try{ const h=await getText(`https://series.naver.com/${kind}/top100List.series?rankingTypeCode=${p}&categoryCode=${code}&page=${page}`,UA_PC,"https://series.naver.com/"); const rows=parseSeries(h,kind,wall.length); if(!rows.length)break; wall=wall.concat(rows);}catch(e){console.error("series web",kind,name,p,page,e.message);break;} await sleep(130); }
      out.web[name][p]=wall.slice(0,100);
      let mall=[];
      for(let page=1;page<=6;page++){ try{ const h=await getText(`https://m.series.naver.com/${kind}/top100List.series?rankingTypeCode=${p}&categoryCode=${code}&page=${page}`,UA_M,"https://m.series.naver.com/"); const rows=parseSeriesMobile(h,kind,mall.length); if(!rows.length)break; mall=mall.concat(rows);}catch(e){console.error("series mobile",kind,name,p,page,e.message);break;} await sleep(130); }
      out.mobile[name][p]=mall.slice(0,100);
    }
  }
  return out;
}

/* 시리즈 프로모션(무료·이벤트): 오늘부터무료/타임딜/매일무료 — m.series 큐레이션 목록 */
function parsePromo(html, kind){
  const items = html.split(/<li class="lst">/).filter(x => new RegExp(kind+"\\/detail\\.series\\?productNo=").test(x));
  const out=[];
  items.forEach((it,i)=>{
    const idM = it.match(/detail\.series\?productNo=(\d+)/);
    let t=""; const tb=it.match(/<h5 class="tit">([\s\S]*?)<\/h5>/); if(tb) t=tb[1].replace(/<span class="u_hc">[\s\S]*?<\/span>/g,"").replace(/<[^>]+>/g,"").replace(/&nbsp;/g," ").replace(/\s+/g," ").trim();
    if(!t){ const al=it.match(/alt="([^"]*)"/); t=al?al[1].trim():""; }
    const thM = it.match(/thmb_list_img[\s\S]*?<img[^>]*\ssrc="([^"]+)"/);
    const au = [...it.matchAll(/<span class="author">([^<]+)<\/span>/g)].map(m=>m[1].trim()).join(" / ");
    const catM = it.match(/info_writer">\s*([^<|&]+?)\s*(?:&nbsp;|\||<)/);
    const remain = (it.match(/date_remain">\s*([^<]+?)\s*</)||[])[1] || "";
    const free = (it.match(/free_info[\s\S]*?<span>\s*([^<]*?무료)\s*<\/span>/)||[])[1] || "";
    const b=[]; if(/<span class="new2">/.test(it))b.push("신규"); if(/adult2/.test(it))b.push("19금"); if(/ico_onlyfree/.test(it))b.push("매일무료"); if(/ico_edition/.test(it))b.push("에디션"); if(/완결/.test(it)&&!/미완결/.test(it))b.push("완결"); if(free)b.push(free.trim()); if(remain)b.push(remain.trim());
    if(idM&&t) out.push({ r:i+1, t, a:au, cat:catM?catM[1].trim():"", th:thM?thM[1]:"", id:Number(idM[1]), m:0, b });
  });
  return out;
}
async function collectPromo(){
  const TYPES=[["freeFromToday","freeFromTodayList"],["timeDeal","timeDealList"],["hourlyFree","hourlyFreeList"]];
  const out={};
  for(const kind of ["comic","novel"]){
    out[kind]={};
    for(const [key,page] of TYPES){
      try{ const h=await getText(`https://m.series.naver.com/${kind}/${page}.series`,UA_M,"https://m.series.naver.com/"); out[kind][key]=parsePromo(h,kind); }
      catch(e){ out[kind][key]=[]; console.error("promo",kind,key,e.message); }
      await sleep(120);
    }
  }
  return out;
}

/* 시리즈 작품 상세: detail.series의 og:description(회차·장르·키워드·줄거리) + 본문(다운수·평점·댓글수) */
function parseSeriesDetail(html){
  const ogm = html.match(/<meta property="og:description" content="([^"]*)"/);
  const desc = (ogm ? ogm[1] : "").replace(/&#034;/g,'"').replace(/&quot;/g,'"').replace(/&amp;/g,"&").replace(/&#039;/g,"'");
  const parts = desc.split(/줄거리\s*:/);
  const meta = parts[0] || "", syn = (parts[1] || "").trim();
  const epm = meta.match(/(\d+)\s*화\s*(연재중|완결)?/);
  const ep = epm ? Number(epm[1]) : 0, status = epm && epm[2] ? epm[2] : "";
  const tags = [...meta.matchAll(/#([^\s,#]+)/g)].map(m => m[1]);   // [SERVICE, 장르, kw...]
  const g = tags[1] || "", k = tags.slice(2);
  const dl = (html.match(/btn_download"><span>([^<]+)</) || [])[1] || "";
  const star = (html.match(/score_area[\s\S]*?<em>([^<]+)</) || [])[1] || "";
  const cmt = (html.match(/commentCount">([^<]+)</) || [])[1] || "";
  return { g, k, dl, star, cmt, ep, status, syn };
}
async function collectSeriesDetails(seriesData, existing){
  const det = existing || {};
  const seen = new Set(), order = [];
  for(const kind of ["comic","novel"]) for(const pf of ["web","mobile"]) for(const cat in (seriesData[kind]||{})[pf]||{}) for(const p in seriesData[kind][pf][cat]) for(const it of seriesData[kind][pf][cat][p]){ if(!seen.has(it.id)){ seen.add(it.id); order.push([it.id, kind]); } }
  // 매일 전체 재수집(갱신) — 다운수가 새벽 4시(KST)에 바뀌므로. 실패/빈응답이면 기존값 유지.
  const CAP = 2500; let done = 0, refreshed = 0;
  for(const [id, kind] of order){
    if(done >= CAP) break;
    try{ const h = await getText(`https://series.naver.com/${kind}/detail.series?productNo=${id}`, UA_PC, "https://series.naver.com/"); const pd = parseSeriesDetail(h); pd.kind = kind;
      if(pd.dl||pd.g||pd.ep||pd.syn){ det[id] = mergeDetail(det[id], pd, kind); refreshed++; }   // 로그아웃 재수집이 19금/검색작의 기존 dl을 지우지 않도록 병합(빈값이면 기존 유지)
      else if(!det[id]){ det[id] = pd; } }
    catch(e){ /* 기존값 유지 */ }
    done++; await sleep(80);
  }
  console.log("series details:", refreshed, "갱신 / 시도", done, "/ 대상", order.length, "/ 총", Object.keys(det).length);
  return det;
}

/* 작품 상세(장르·키워드·제작사·관심수·연령·요일·줄거리) — 신규 titleId만 증분 수집 */
async function collectDetails(existing){
  const details = existing || {};
  const ids = Object.keys(idL).map(Number);
  const todo = ids.filter(id => !details[id] || details[id].ep === undefined || details[id].launch === undefined); // 신규 or 스키마 미충족
  console.log("details:", todo.length, "신규 / ", ids.length, "전체");
  const CONC = 4;
  for(let i=0;i<todo.length;i+=CONC){
    await Promise.all(todo.slice(i,i+CONC).map(async id=>{
      try{
        const d = await getJSON(`https://comic.naver.com/api/article/list/info?titleId=${id}`, `https://comic.naver.com/webtoon/list?titleId=${id}`);
        const tags = d.curationTagList || [];
        const cpName = (d.gfpAdCustomParam||{}).cpName || "";
        let ep = 0, launch = "";
        try { const al = await getJSON(`https://comic.naver.com/api/article/list?titleId=${id}&page=1&sort=ASC`, `https://comic.naver.com/webtoon/list?titleId=${id}`); ep = al.totalCount || 0; const first = (al.articleList||[])[0]; launch = first ? (first.serviceDateDescription||"") : ""; } catch(e){}
        details[id] = {
          g: (tags.find(t=>/GENRE/.test(t.curationType))||{}).tagName || "",
          k: tags.filter(t=>t.curationType==="CUSTOM_TAG").map(t=>t.tagName),
          cp: (function(){ const p = cpName.includes("_") ? cpName.split("_")[0] : cpName; return p==="다중" ? "여러 제작사" : p; })(),
          age: (d.age&&d.age.description) || "",
          day: d.publishDescription || "",
          fav: d.favoriteCount || 0,
          ep, launch,
          dailyplus: ((d.gfpAdCustomParam||{}).dailyPlusYn === "Y"),
          syn: (d.synopsis||"").replace(/\s+/g," ").trim().slice(0,220),
          novel: tags.some(t=>t.curationType==="NOVEL_ORIGIN")
        };
      }catch(e){ /* skip */ }
    }));
    await sleep(50);
  }
  // 기존 작품 회차수(ep) 매일 갱신 — article/list totalCount. (회차·댓글평균 정확도) 장르/키워드/제작사는 잘 안 바뀌어 유지.
  const todoSet = new Set(todo);
  const refresh = ids.filter(id => details[id] && !todoSet.has(id));
  let rf = 0;
  for(let i=0;i<refresh.length;i+=CONC){
    await Promise.all(refresh.slice(i,i+CONC).map(async id=>{
      try{ const al = await getJSON(`https://comic.naver.com/api/article/list?titleId=${id}&page=1&sort=ASC`, `https://comic.naver.com/webtoon/list?titleId=${id}`); if(al.totalCount){ details[id].ep = al.totalCount; rf++; } if(!details[id].launch){ const first=(al.articleList||[])[0]; if(first) details[id].launch=first.serviceDateDescription||""; } }catch(e){}
    }));
    await sleep(50);
  }
  console.log("details ep 갱신:", rf, "/", refresh.length);
  return details;
}

/* 평균 댓글수: 각 작품 최근 5회차 댓글수(activePostCount) 평균 — wcc 배치 API. 매일 갱신 */
async function collectComments(details){
  const ids = Object.keys(details).filter(id => details[id].ep > 0).map(Number);
  const B = 10; // 작품 10개 = pageId 50개/배치
  let done = 0;
  for(let i=0;i<ids.length;i+=B){
    const batch = ids.slice(i,i+B);
    const pageIds = [];
    for(const id of batch){ const ep = details[id].ep; for(let no=Math.max(1,ep-4); no<=ep; no++) pageIds.push(`webtoon_${id}_${no}`); }
    const qs = pageIds.map(p=>"pageIds="+p).join("&");
    try{
      const r = await fetch(`https://comic.naver.com/comment/api/community/v1/pages/activity/count/?${qs}`, { headers:{ "User-Agent":UA_PC, "Service-Ticket-Id":"comic_webtoon", "Referer":"https://comic.naver.com/" } });
      const d = await r.json();
      const byId = {};
      for(const c of ((d.result&&d.result.countList)||[])){ const m = c.pageId.match(/webtoon_(\d+)_/); if(m){ (byId[m[1]]||(byId[m[1]]=[])).push(c.activePostCount||0); } }
      for(const id of batch){ const arr = byId[id]||[]; details[id].cmt = arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : 0; }
    }catch(e){ /* skip batch */ }
    done += batch.length;
    await sleep(120);
  }
  console.log("comments:", done, "작품 평균댓글 수집");
}

/* 회차별 댓글수·별점 전수 수집(백필): 하루 N작품씩 회전. article/list(별점·날짜) + wcc(댓글수).
   episodes/{titleId}.json = {id,name,updated,eps:[{no,sub,star,cmt,date,charge}]} (최근 최대 600화) */
async function collectEpisodes(details, updated){
  const EP_TITLES_PER_RUN = 120, EP_MAXPAGES = 30; // 최근 600화
  const EPDIR = path.join(OUT, "episodes");
  fs.mkdirSync(EPDIR, { recursive:true });
  let idx = {}; try { idx = JSON.parse(fs.readFileSync(path.join(OUT,"episodes_index.json"),"utf8")); } catch(e){}
  const ids = Object.keys(details).filter(id => details[id].ep > 0).map(Number);
  ids.sort((a,b) => ((idx[a]&&idx[a].u)||0) - ((idx[b]&&idx[b].u)||0)); // 안 된/오래된 것 먼저
  const todo = ids.slice(0, EP_TITLES_PER_RUN);
  for(const id of todo){
    try{
      const pages = Math.min(Math.ceil(details[id].ep/20), EP_MAXPAGES);
      const eps = [];
      for(let p=1; p<=pages; p++){
        const al = await getJSON(`https://comic.naver.com/api/article/list?titleId=${id}&page=${p}&sort=DESC`, `https://comic.naver.com/webtoon/list?titleId=${id}`);
        for(const a of (al.articleList||[])) eps.push({ no:a.no, sub:a.subtitle||"", star:Math.round((a.starScore||0)*100)/100, date:a.serviceDateDescription||"", charge:!!a.charge });
        await sleep(70);
      }
      const nos = eps.map(e=>e.no);
      for(let i=0; i<nos.length; i+=50){
        const qs = nos.slice(i,i+50).map(no=>"pageIds=webtoon_"+id+"_"+no).join("&");
        try{
          const r = await fetch(`https://comic.naver.com/comment/api/community/v1/pages/activity/count/?${qs}`, { headers:{ "User-Agent":UA_PC, "Service-Ticket-Id":"comic_webtoon", "Referer":"https://comic.naver.com/" } });
          const d = await r.json();
          const cm = {}; for(const c of ((d.result&&d.result.countList)||[])){ const m = c.pageId.match(/_(\d+)$/); if(m) cm[+m[1]] = c.activePostCount||0; }
          for(const e of eps){ if(e.no in cm) e.cmt = cm[e.no]; }
        }catch(e){}
        await sleep(90);
      }
      eps.sort((a,b)=>a.no-b.no);
      fs.writeFileSync(path.join(EPDIR, id+".json"), JSON.stringify({ id, name:(idL[id]&&idL[id][0])||"", updated, eps }));
      idx[id] = { u: Date.now(), n: eps.length };
    }catch(e){ console.error("episodes", id, e.message); }
  }
  fs.writeFileSync(path.join(OUT,"episodes_index.json"), JSON.stringify(idx));
  console.log("episodes:", todo.length, "작품 처리 · 누적", Object.keys(idx).length, "/", ids.length);
}

/* 순위 추이 누적: history.json = {dates:[...], series:{basisKey:{id:[rank aligned to dates]}}} (최근 45일) */
function buildTodayBases(web_wd, app_wd, web_gn, app_gn, s_comic, s_novel){
  const b = {}, put = (key, arr) => { b[key] = Object.fromEntries((arr||[]).map(r => [r.id, r.r])); };
  for(const w of WEEKDAYS){ put("wd_web_"+w, web_wd[w]); put("wd_app_"+w, app_wd[w]); }
  for(const g of GENRES){ put("gn_web_"+g, web_gn[g]); put("gn_app_"+g, app_gn[g]); }
  for(const p of PERIODS){
    put("series_comic_web_"+p, s_comic.web["전체장르"]&&s_comic.web["전체장르"][p]);
    put("series_comic_mobile_"+p, s_comic.mobile["전체장르"]&&s_comic.mobile["전체장르"][p]);
    put("series_novel_web_"+p, s_novel.web["전체장르"]&&s_novel.web["전체장르"][p]);
    put("series_novel_mobile_"+p, s_novel.mobile["전체장르"]&&s_novel.mobile["전체장르"][p]);
  }
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
function parseDlNum(s){ if(!s) return 0; s=String(s).replace(/,/g,""); let n=0,m; if(m=s.match(/([\d.]+)\s*억/)) n+=parseFloat(m[1])*1e8; if(m=s.match(/([\d.]+)\s*만/)) n+=parseFloat(m[1])*1e4; if(m=s.match(/([\d.]+)\s*천/)) n+=parseFloat(m[1])*1e3; if(!n) n=parseFloat(s)||0; return Math.round(n); }
// 매출 누적 히스토리: 시리즈 productNo 기준 dl(다운수)+ep(회차수)만 저장 → 총매출/회차당은 클라에서 계산
function updateRevenueHistory(dir, date){
  let sd={}; try{ sd=JSON.parse(fs.readFileSync(path.join(dir,"series_details.json"),"utf8")); }catch(e){ return null; }
  let rh={dates:[],works:{}}; try{ rh=JSON.parse(fs.readFileSync(path.join(dir,"revenue_history.json"),"utf8")); }catch(e){}
  if(!rh.dates) rh.dates=[]; if(!rh.works) rh.works={};
  if(!rh.dates.includes(date)) rh.dates.push(date);
  const di=rh.dates.indexOf(date);
  for(const pn in sd){ const d=sd[pn], dl=parseDlNum(d.dl), ep=d.ep; if(!dl||!ep) continue;
    const w=rh.works[pn]||(rh.works[pn]={dl:[],ep:[]});
    while(w.dl.length<di){ w.dl.push(null); w.ep.push(null); }
    w.dl[di]=dl; w.ep[di]=ep;
  }
  for(const pn in rh.works){ const w=rh.works[pn]; while(w.dl.length<=di){ w.dl.push(null); w.ep.push(null); } }
  const RMAX=150; if(rh.dates.length>RMAX){ const cut=rh.dates.length-RMAX; rh.dates.splice(0,cut); for(const pn in rh.works){ rh.works[pn].dl.splice(0,cut); rh.works[pn].ep.splice(0,cut); } }
  fs.writeFileSync(path.join(dir,"revenue_history.json"), JSON.stringify(rh));
  return { dates:rh.dates.length, works:Object.keys(rh.works).length };
}

// 재수집 병합: 빈값이면 기존 유지(로그아웃이 19금/검색작 dl 안 지움)
function mergeDetail(old, pd, kind){ old=old||{}; return { g:pd.g||old.g||"", k:(pd.k&&pd.k.length)?pd.k:(old.k||[]), dl:pd.dl||old.dl||"", star:pd.star||old.star||"", cmt:pd.cmt||old.cmt||"", ep:pd.ep||old.ep||0, status:pd.status||old.status||"", syn:pd.syn||old.syn||"", kind:kind||pd.kind||old.kind }; }
// 시리즈 통합검색 결과 파싱 → [{pn, kind, title}]
function parseSeriesSearch(html){
  const out=[], re=/<a href="\/(comic|novel)\/detail\.series\?productNo=(\d+)" class="N=a:(?:com|nov)\.title">([\s\S]*?)<\/a>/g;
  let m; while(m=re.exec(html)){ const kind=m[1], pn=Number(m[2]); const title=m[3].replace(/<[^>]*>/g,"").replace(/\s+/g," ").trim(); if(title) out.push({pn, kind, title}); }
  return out;
}
module.exports = { seriesAll, parseSeries, parseSeriesMobile, SERIES_CATS, collectPromo, parsePromo, parseSeriesDetail, collectSeriesDetails, parseDlNum, updateRevenueHistory, isoDate, mergeDetail, parseSeriesSearch };
if (require.main === module) (async ()=>{
  const updated=new Date().toISOString(), date=isoDate();
  console.log("collecting", date, "…");
  // 웹 먼저(lookup 채움) → 앱은 lookup 참조
  const web_wd = await webWeekday();
  const web_gn = await webGenre();
  const [app_wd, app_gn, s_comic, s_novel] = await Promise.all([appWeekday(), appGenre(), seriesAll("comic"), seriesAll("novel")]);

  let existingDetails = {};
  try { existingDetails = JSON.parse(fs.readFileSync(path.join(OUT,"details.json"),"utf8")); } catch(e){}
  const details = await collectDetails(existingDetails);
  for(const id in stars){ if(details[id]) details[id].star = stars[id]; } // 평균별점 매일 갱신
  await collectComments(details); // 평균댓글수 매일 갱신

  let hist = {};
  try { hist = JSON.parse(fs.readFileSync(path.join(OUT,"history.json"),"utf8")); } catch(e){}
  hist = updateHistory(hist, date, buildTodayBases(web_wd, app_wd, web_gn, app_gn, s_comic, s_novel));

  fs.writeFileSync(path.join(OUT,"weekday.json"), JSON.stringify({ updated, date, web:web_wd, app:app_wd }));
  fs.writeFileSync(path.join(OUT,"genre.json"), JSON.stringify({ updated, date, web:web_gn, app:app_gn }));
  fs.writeFileSync(path.join(OUT,"series.json"), JSON.stringify({ updated, date, comic:s_comic, novel:s_novel }));
  try { const promo = await collectPromo(); fs.writeFileSync(path.join(OUT,"promo.json"), JSON.stringify({ updated, date, comic:promo.comic, novel:promo.novel })); } catch(e){ console.error("promo failed:", e.message); }
  try { let sd={}; try{ sd=JSON.parse(fs.readFileSync(path.join(OUT,"series_details.json"),"utf8")); }catch(e){} sd=await collectSeriesDetails({comic:s_comic, novel:s_novel}, sd); fs.writeFileSync(path.join(OUT,"series_details.json"), JSON.stringify(sd)); } catch(e){ console.error("series details failed:", e.message); }
  try { const rh = updateRevenueHistory(OUT, date); if(rh) console.log("revenue history:", JSON.stringify(rh)); } catch(e){ console.error("revenue history failed:", e.message); }
  fs.writeFileSync(path.join(OUT,"lookup.json"), JSON.stringify({ id:idL, name:nameL }));
  fs.writeFileSync(path.join(OUT,"details.json"), JSON.stringify(details));
  fs.writeFileSync(path.join(OUT,"history.json"), JSON.stringify(hist));

  try { await collectEpisodes(details, updated); } catch(e){ console.error("episodes failed:", e.message); } // best-effort 백필

  const c=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,v.length]));
  const sc=s=>{let n=0,items=0;for(const pf of["web","mobile"])for(const cat in s[pf])for(const p in s[pf][cat]){n++;items+=s[pf][cat][p].length;}return{rankings:n,items};};
  console.log("done:", JSON.stringify({ web_wd:c(web_wd), app_wd:c(app_wd), comic:sc(s_comic), novel:sc(s_novel), details:Object.keys(details).length, histDates:hist.dates.length, histBases:Object.keys(hist.series).length }));
})().catch(e=>{ console.error("FAILED:",e); process.exit(1); });
