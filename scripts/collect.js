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
/* 시리즈 회차별 대여/소장 쿠키 → 대표 단가 등급. volumeList.series(JSON) 사용.
   최신화(DESC)는 대여 미개방(lendPassCount=0)일 수 있어 → 대여·소장 둘 다 있는 회차의 최빈값을 대표로.
   그런 회차가 없으면 소장 최빈값에서 대여=소장−2 추정(관측된 표준등급: 3/5, 2/4). 성인작은 로그아웃 차단(JSON 아님)이라 null → CDP에서 수집. */
function _mode(arr, key){ const c={}; arr.forEach(v=>{ const k=key(v); c[k]=(c[k]||0)+1; }); return Object.entries(c).sort((a,b)=>b[1]-a[1])[0][0]; }
async function fetchVolumePrice(pn, kind){
  try{
    const b = await getText(`https://series.naver.com/${kind}/volumeList.series?productNo=${pn}&sortOrder=DESC&totalCount=30`, UA_PC, "https://series.naver.com/");
    const j = JSON.parse(b); const vols = j.resultData||[];
    const paid = vols.filter(v=>v.lendPassCount>0 && v.buyPassCount>0);
    if(paid.length){ const [rent,own] = _mode(paid, v=>v.lendPassCount+"/"+v.buyPassCount).split("/").map(Number); return {rent, own}; }
    const buyOnly = vols.filter(v=>v.buyPassCount>0);
    if(buyOnly.length){ const own = Number(_mode(buyOnly, v=>String(v.buyPassCount))); return {rent:Math.max(0, own-2), own}; }
    return null;
  }catch(e){ return null; }
}
/* 코믹 시리즈 단가(대여/소장 쿠키)를 없는 것부터 채움. 가격은 거의 안 변해 1회 수집으로 충분 → own 있으면 스킵. 성인은 제외(CDP). */
async function fillVolumePrices(sd, extra, cap){
  cap = cap || 500;
  const adult = new Set(((extra&&extra.adult)||[]).map(String));
  let n=0, got=0;
  for(const pn in sd){
    if(n>=cap) break;
    const d=sd[pn];
    if(!d || d.kind!=="comic" || !d.dl || d.own) continue;
    if(adult.has(String(pn))) continue;
    n++;
    const p = await fetchVolumePrice(pn, "comic");
    if(p){ d.rent=p.rent; d.own=p.own; got++; }
    await sleep(250);
  }
  return got;
}
async function collectSeriesDetails(seriesData, existing){
  const det = existing || {};
  const seen = new Set(), order = [];
  for(const kind of ["comic","novel"]) for(const pf of ["web","mobile"]) for(const cat in (seriesData[kind]||{})[pf]||{}) for(const p in seriesData[kind][pf][cat]) for(const it of seriesData[kind][pf][cat][p]){ if(!seen.has(it.id)){ seen.add(it.id); order.push([it.id, kind]); } }
  const rankedN = order.length;
  // ★랭킹 밖 '검색연동' 작품(신작 등)도 매일 갱신 — 랭킹에만 의존하면 랭킹 밖 작품 다운수가 안 바뀌던 사각지대 해소
  let adultSet = new Set();
  try{ const se = JSON.parse(fs.readFileSync(path.join(OUT, "series_extra.json"), "utf8"));
    if(se.map) for(const nm in se.map) for(const e of (se.map[nm]||[])){ if(e && e.pn!=null && !seen.has(e.pn)){ seen.add(e.pn); order.push([e.pn, e.kind||"comic"]); } }
    adultSet = new Set((se.adult||[]).map(String));
  }catch(e){}
  // 매일 전체 재수집(갱신) — 다운수가 새벽 4시(KST)에 바뀌므로. 실패/빈응답이면 기존값 유지.
  const CAP = 4000; let done = 0, refreshed = 0, dlFresh = 0, dlKnown = 0;
  for(const [id, kind] of order){
    if(done >= CAP) break;
    let fresh = false;
    try{ const h = await getText(`https://series.naver.com/${kind}/detail.series?productNo=${id}`, UA_PC, "https://series.naver.com/"); const pd = parseSeriesDetail(h); pd.kind = kind; fresh = !!pd.dl;
      if(pd.dl||pd.g||pd.ep||pd.syn){ det[id] = mergeDetail(det[id], pd, kind); refreshed++; }   // 로그아웃 재수집이 19금/검색작의 기존 dl을 지우지 않도록 병합(빈값이면 기존 유지)
      else if(!det[id]){ det[id] = pd; } }
    catch(e){ /* 기존값 유지 */ }
    if(!adultSet.has(String(id)) && det[id] && det[id].dl){ dlKnown++; if(fresh) dlFresh++; }   // 정상 판정용: 다운수가 있어야 할 비성인 작품 중 이번에 실제로 긁은 수
    done++; await sleep(80);
  }
  collectSeriesDetails.stats = { dlFresh, dlKnown, done, order: order.length };
  console.log("series details:", refreshed, "갱신 / 시도", done, "/ 대상", order.length, "(랭킹", rankedN, "+ 연동", order.length - rankedN, ") / 총", Object.keys(det).length, "/ 다운수 새로 긁음", dlFresh, "/", dlKnown);
  return det;
}

// 검색연동: 시리즈 미연동 웹툰을 '시리즈 통합검색'(로그아웃 공개, 클라우드 가능)으로 찾아 series_extra.map에 연결.
// 랭킹에 없는 신작도 연결 → collectSeriesDetails가 매일 다운수 갱신. map 키=normName(프론트 연동키와 동일).
const _normName  = s => String(s||"").replace(/\s*\[[^\]]*\]\s*$/, "").replace(/\s+/g, "");
const _normMatch = s => { s=String(s||""); let p; do{ p=s; s=s.replace(/\s*[\[(<][^\])>]*[\])>]\s*$/, ""); }while(s!==p); return s.replace(/\s+/g,"").toLowerCase(); };
async function searchLinkWebtoons(seriesData, sd, extra, cap=400){
  extra.map = extra.map || {}; extra.owned = extra.owned || [];
  const ownedSet = new Set(extra.owned);
  const idx = {};
  for(const kind of ["comic","novel"]) for(const pf of ["web","mobile"]) for(const c in (seriesData[kind]||{})[pf]||{}) for(const p in seriesData[kind][pf][c]) for(const it of seriesData[kind][pf][c][p]){ const n=_normName(it.t); (idx[n]||(idx[n]=[])).push({pn:it.id,kind}); }
  const hasComic = n => (idx[n]||[]).some(x=>x.kind==="comic"&&sd[x.pn]&&sd[x.pn].dl&&sd[x.pn].ep) || (extra.map[n]||[]).some(x=>x.kind==="comic"&&sd[x.pn]&&sd[x.pn].dl&&sd[x.pn].ep);
  const src = Object.keys(idL).length ? idL : (()=>{ try{ return JSON.parse(fs.readFileSync(path.join(OUT,"lookup.json"),"utf8")).id||{}; }catch(e){ return {}; } })();
  const wt = Object.entries(src).map(([id,v])=>({id:+id, name:Array.isArray(v)?v[0]:(v&&v.name)})).filter(x=>x.name);
  let searched=0, found=0;
  for(const w of wt){
    if(searched>=cap) break;
    const key=_normName(w.name);
    if(hasComic(key)) continue;   // 코믹 연결 완료 → 스킵. 미연결이면 코믹 나올 때까지 매일 재검색
    searched++;
    try{
      const h=await getText(`https://series.naver.com/search/search.series?t=all&q=${encodeURIComponent(w.name)}`, UA_PC, "https://series.naver.com/");
      const res=parseSeriesSearch(h);
      const nm=_normMatch(w.name);
      const hit=res.find(r=>r.kind==="comic"&&_normMatch(r.title)===nm);   // 웹툰은 코믹만 연결(웹소설 오연결 방지)
      if(hit){
        try{ const dh=await getText(`https://series.naver.com/${hit.kind}/detail.series?productNo=${hit.pn}`, UA_PC, "https://series.naver.com/"); const pd=parseSeriesDetail(dh); pd.kind=hit.kind; if(pd.dl||pd.g||pd.ep||pd.syn){ sd[hit.pn]=mergeDetail(sd[hit.pn], pd, hit.kind); if(pd.dl) found++; } }catch(e){}
        const a=extra.map[key]||(extra.map[key]=[]);
        if(!a.some(x=>x.pn===hit.pn)) a.push({pn:hit.pn, kind:hit.kind});
        ownedSet.add(hit.pn);
      }
    }catch(e){}
    await sleep(120);
  }
  extra.owned=[...ownedSet]; extra.updated=new Date().toISOString();
  console.log("검색연동:", searched, "건 검색 /", found, "신규 다운수 연동");
  return { searched, found };
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
          fav: d.favoriteCount || 0, favAt: runDate(),
          ep, launch,
          dailyplus: ((d.gfpAdCustomParam||{}).dailyPlusYn === "Y"),
          syn: (d.synopsis||"").replace(/\s+/g," ").trim().slice(0,220),
          novel: tags.some(t=>t.curationType==="NOVEL_ORIGIN")
        };
      }catch(e){ /* skip */ }
    }));
    await sleep(50);
  }
  // 기존 작품 회차수(ep) 매일 갱신 — article/list totalCount("총 N화"). 랭킹에서 빠진 작품·검색전용 작품까지 details 전체 갱신(회차당 매출 기준값이라 최신 유지).
  const todoSet = new Set(todo);
  const refresh = Object.keys(details).map(Number).filter(id => !todoSet.has(id));
  let rf = 0, rfa = 0;
  for(let i=0;i<refresh.length;i+=CONC){
    await Promise.all(refresh.slice(i,i+CONC).map(async id=>{
      try{
        const al = await getJSON(`https://comic.naver.com/api/article/list?titleId=${id}&page=1&sort=DESC`, `https://comic.naver.com/webtoon/list?titleId=${id}`);   // DESC: 총화 + 최신공개화 + charge(유료) 한 번에
        details[id].adult = false;   // article/list 열림 = 비성인
        if(al.totalCount){ details[id].ep = al.totalCount; rf++;
          const sp = await episodeSplit(al, p => getJSON(`https://comic.naver.com/api/article/list?titleId=${id}&page=${p}&sort=DESC`, `https://comic.naver.com/webtoon/list?titleId=${id}`));   // 번호 빠짐(결번) 있어도 맞는 무료/유료
          details[id].paid = sp.paid; details[id].free = sp.free; details[id].epAt = runDate();   // 오늘 긁음 스탬프
          try{ const info = await getJSON(`https://comic.naver.com/api/article/list/info?titleId=${id}`, `https://comic.naver.com/webtoon/list?titleId=${id}`); if(info && info.favoriteCount!=null){ details[id].fav = info.favoriteCount; details[id].favAt = runDate(); } }catch(e){}  // 관심수 매일 갱신(fav_history 추이용)
        }
        else { details[id].adult = true; try{ const info = await getJSON(`https://comic.naver.com/api/article/list/info?titleId=${id}`, `https://comic.naver.com/webtoon/list?titleId=${id}`); if(info && info.favoriteCount!=null){ details[id].fav = info.favoriteCount; details[id].favAt = runDate(); } }catch(_){}  const ep = await probeEpByComments(id); if(ep){ details[id].ep = adultEp(details[id], ep); details[id].cmtNo = ep; rfa++; } }
      }catch(e){ if(/ 40\d/.test(e.message)){ details[id].adult = true; try{ const info = await getJSON(`https://comic.naver.com/api/article/list/info?titleId=${id}`, `https://comic.naver.com/webtoon/list?titleId=${id}`); if(info && info.favoriteCount!=null){ details[id].fav = info.favoriteCount; details[id].favAt = runDate(); } }catch(_){}  try{ const ep = await probeEpByComments(id); if(ep){ details[id].ep = adultEp(details[id], ep); details[id].cmtNo = ep; rfa++; } }catch(_){} } }   // 401/403 = 성인/차단 웹툰: article/list는 막혀도 info(관심수)·댓글API(회차수)는 로그아웃으로 열림 → fav 매일 갱신
    }));
    await sleep(50);
  }
  console.log("details ep 갱신:", rf, "일반 +", rfa, "성인(댓글API) /", refresh.length);
  return details;
}

/* 회차 구성: 총화(미리보기 포함)·유료·무료·공개 최신 번호·결번 수. 회차 번호가 1부터 빠짐없이 이어진다고 가정하지 않음
   (예: 울어봐 54번 결번 → 최신 88화가 no=89). 미리보기 = 총화 − 공개 회차수(pageInfo.totalRows), 유료 = 미리보기 + 공개목록 중 charge(기다무 등).
   최신 페이지(20개)가 전부 유료면 다음 페이지까지 셈(완결 후 유료화 작품 — 예전엔 20화에서 잘림, 최대 80페이지). fetchPage(p) = 같은 작품 DESC p페이지 JSON(로그아웃 getJSON / 성인은 CDP fetch). */
async function episodeSplit(al, fetchPage){
  const T = al.totalCount || 0, pi = al.pageInfo || {}, folder = al.chargeFolderArticleList || [];
  const previews = Math.max(0, pi.totalRows != null ? T - pi.totalRows : folder.length);
  let list = al.articleList || [], pubPaid = list.filter(a => a.charge).length;
  for(let p = 2; list.length && list.every(a => a.charge) && p <= Math.min(pi.totalPages || 1, 80); p++){
    let nx = null; try{ nx = await fetchPage(p); }catch(e){}
    list = (nx && nx.articleList) || []; pubPaid += list.filter(a => a.charge).length;
  }
  const paid = Math.min(T, previews + pubPaid);
  const pubNo = ((al.articleList || [])[0] || {}).no || 0;
  const maxNo = Math.max(pubNo, ...folder.map(a => a.no || 0));
  return { T, paid, free: T - paid, pubNo, gap: Math.max(0, maxNo - T) };
}
/* 성인작 총화(로그아웃): 댓글 추정치는 '댓글 달린 최대 번호'라 결번이면 +1, 최신 유료화에 댓글 없으면 −1로 틀림.
   성인 수집(CDP 로그인)이 매일 넣는 실제 총화(ep)·결번 수(epGap)를 기준으로 두고, 결번만큼 뺀 추정치가 더 클 때만(새 회차) 올림. 다음 CDP 수집이 다시 실제값으로 맞춤.
   평균 댓글(collectComments)은 예전처럼 댓글 추정 번호(cmtNo) 기준 최근 5화. */
function adultEp(det, probe){ const est = probe - (det.epGap || 0); return Math.max(det.ep || 0, est); }
/* 성인/차단 웹툰 회차수: article/list가 막혔을 때 댓글 count API로 최대 회차 추정(로그아웃 공개). 미리보기 제외 공개회차 기준. */
async function probeEpByComments(id){
  let maxNo=0;
  for(let s=1;s<=500;s+=30){
    const pageIds=[]; for(let n=s;n<=s+29;n++) pageIds.push(`webtoon_${id}_${n}`);
    const qs=pageIds.map(p=>"pageIds="+p).join("&");
    let list=[];
    try{ const r=await fetch(`https://comic.naver.com/comment/api/community/v1/pages/activity/count/?${qs}`, { headers:{ "User-Agent":UA_PC, "Service-Ticket-Id":"comic_webtoon", "Referer":"https://comic.naver.com/" } }); const d=await r.json(); list=(d.result&&d.result.countList)||[]; }catch(e){ break; }
    let batchMax=0; for(const c of list){ const m=String(c.pageId).match(/_(\d+)$/); if(m && (c.activePostCount||0)>0){ const no=+m[1]; if(no>maxNo) maxNo=no; if(no>batchMax) batchMax=no; } }
    if(batchMax===0) break;   // 이 배치에 활동 회차 없음 → 최신회차 지났으니 종료
    await sleep(120);
  }
  return maxNo;
}
/* 평균 댓글수: 각 작품 최근 5회차 댓글수(activePostCount) 평균 — wcc 배치 API. 매일 갱신 */
async function collectComments(details){
  const ids = Object.keys(details).filter(id => details[id].ep > 0).map(Number);
  const B = 10; // 작품 10개 = pageId 50개/배치
  let done = 0;
  for(let i=0;i<ids.length;i+=B){
    const batch = ids.slice(i,i+B);
    const pageIds = [];
    for(const id of batch){ const ep = (details[id].adult && details[id].cmtNo) || details[id].ep; for(let no=Math.max(1,ep-4); no<=ep; no++) pageIds.push(`webtoon_${id}_${no}`); }
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
/* 데이터 날짜: 네이버 다운수는 새벽 4시(KST)에 전날분까지 갱신되므로 00:00~03:59 실행은 아직 전날 데이터 → 전날 날짜로 기록(KST−4시간 = UTC+5) */
const dataDate = ms => new Date(ms + 5*3600*1000).toISOString().slice(0,10);
/* 이번 실행의 히스토리 기준 날짜 — 프로세스당 1회 고정. 수집 스탬프(at/favAt/epAt)와 히스토리 기록 날짜를 같은 값으로 맞춤(실행 중 자정을 넘겨도 어긋나지 않게) */
let _runDate = null;
function runDate(){ return _runDate || (_runDate = dataDate(Date.now())); }
/* 클라우드 본수집이 정상인지: 시리즈 상세에서 다운수를 새로 긁은 비율(성인 제외)이 절반 이상일 때만 그 날짜를 '완료'로 표시 */
const fullRunOK = st => !!(st && st.dlKnown > 0 && st.dlFresh >= st.dlKnown * 0.5);
function parseDlNum(s){ if(!s) return 0; s=String(s).replace(/,/g,""); let n=0,m; if(m=s.match(/([\d.]+)\s*억/)) n+=parseFloat(m[1])*1e8; if(m=s.match(/([\d.]+)\s*만/)) n+=parseFloat(m[1])*1e4; if(m=s.match(/([\d.]+)\s*천/)) n+=parseFloat(m[1])*1e3; if(!n) n=parseFloat(s)||0; return Math.round(n); }
/* 히스토리 파일 읽기: 없으면 빈 구조. 있는데 못 읽으면(병합 충돌 표시 등) 예외 → 호출측이 덮어쓰지 않음(빈 기록으로 수백 일치를 날리는 사고 방지) */
function readHistory(fp){
  if(!fs.existsSync(fp)) return { dates:[], works:{} };
  const h = JSON.parse(fs.readFileSync(fp, "utf8"));
  if(!h || typeof h!=="object" || !Array.isArray(h.dates) || !h.works) throw new Error(fp+" 형식 이상 — 덮어쓰지 않음");
  return h;
}
// 매출 누적 히스토리: 시리즈 productNo 기준 dl(다운수)+ep(회차수)만 저장 → 총매출/회차당은 클라에서 계산
// ★오늘 실제로 새로 긁은 작품(series_details.at === date)만 기록. 안 긁은 작품에 전날 값을 베껴 쓰지 않고 칸을 비워 둠
//   → 프론트가 앞뒤 실제 수집값으로 보간하거나, 뒤쪽 값이 아직 없으면 그 주를 미완성으로 처리(오전 부분수집 착시·수집공백 계단 방지)
// opts.full: 클라우드 본수집이 정상 완료(fullRunOK) — 이 날짜를 rh.lastFull로 표시(프론트 주 선택 목록 기준)
function updateRevenueHistory(dir, date, opts){
  opts = opts || {};
  let sd={}; try{ sd=JSON.parse(fs.readFileSync(path.join(dir,"series_details.json"),"utf8")); }catch(e){ return null; }
  const rh = readHistory(path.join(dir,"revenue_history.json"));   // 파일이 깨져 있으면 예외 → 덮어쓰지 않음(150일치 유실 방지)
  if(!rh.dates) rh.dates=[]; if(!rh.works) rh.works={};
  if(!rh.dates.includes(date)) rh.dates.push(date);
  const di=rh.dates.indexOf(date);
  let wrote=0;
  for(const pn in sd){ const d=sd[pn], dl=parseDlNum(d.dl), ep=d.ep; if(!dl||!ep) continue;
    if(d.at!==date) continue;   // 오늘 안 긁은 작품 → 기록 안 함(베껴 쓰기 금지)
    const w=rh.works[pn]||(rh.works[pn]={dl:[],ep:[]});
    while(w.dl.length<di){ w.dl.push(null); w.ep.push(null); }
    w.dl[di]=dl; w.ep[di]=ep; wrote++;
  }
  for(const pn in rh.works){ const w=rh.works[pn]; while(w.dl.length<=di){ w.dl.push(null); w.ep.push(null); } }
  if(opts.full && wrote>0){ if(!rh.lastFull || date>rh.lastFull) rh.lastFull=date; }   // 정상 판정은 호출측(main: fullRunOK — 이번 실행이 실제로 긁은 비율)에서
  const RMAX=150; if(rh.dates.length>RMAX){ const cut=rh.dates.length-RMAX; rh.dates.splice(0,cut); for(const pn in rh.works){ rh.works[pn].dl.splice(0,cut); rh.works[pn].ep.splice(0,cut); } }
  fs.writeFileSync(path.join(dir,"revenue_history.json"), JSON.stringify(rh));
  return { dates:rh.dates.length, works:Object.keys(rh.works).length, wrote, lastFull:rh.lastFull||null };
}
/* 웹툰 무료/유료 회차수 날짜별 기록 → ep_history.json {dates:[], works:{titleId:{f:[무료],p:[유료]}}}. 매출 엑셀 Sheet1의 무료/유료 열용. 오늘부터 누적(성인작은 article/list 막혀 제외) */
function updateEpHistory(dir, date, details){
  if(!details){ try{ details=JSON.parse(fs.readFileSync(path.join(dir,"details.json"),"utf8")); }catch(e){ return null; } }
  const eh = readHistory(path.join(dir,"ep_history.json"));   // 깨져 있으면 예외 → 덮어쓰지 않음
  if(!eh.dates) eh.dates=[]; if(!eh.works) eh.works={};
  if(!eh.dates.includes(date)) eh.dates.push(date);
  const di=eh.dates.indexOf(date);
  for(const id in details){ const d=details[id]; if(d.free==null && d.paid==null) continue;
    if(d.epAt!==date) continue;   // 오늘 무료/유료를 새로 긁은 작품만 기록(베껴 쓰기 금지)
    const w=eh.works[id]||(eh.works[id]={f:[],p:[]});
    while(w.f.length<di){ w.f.push(null); w.p.push(null); }
    w.f[di]=d.free!=null?d.free:null; w.p[di]=d.paid!=null?d.paid:null;
  }
  for(const id in eh.works){ const w=eh.works[id]; while(w.f.length<=di){ w.f.push(null); w.p.push(null); } }
  const RMAX=150; if(eh.dates.length>RMAX){ const cut=eh.dates.length-RMAX; eh.dates.splice(0,cut); for(const id in eh.works){ eh.works[id].f.splice(0,cut); eh.works[id].p.splice(0,cut); } }
  fs.writeFileSync(path.join(dir,"ep_history.json"), JSON.stringify(eh));
  return { dates:eh.dates.length, works:Object.keys(eh.works).length };
}
/* 관심수(favoriteCount) 날짜별 이력 → fav_history.json {dates:[], works:{titleId:{v:[관심수]}}}. 오늘부터 누적(다운수처럼 매일 증가 추이) */
function updateFavHistory(dir, date, details){
  if(!details){ try{ details=JSON.parse(fs.readFileSync(path.join(dir,"details.json"),"utf8")); }catch(e){ return null; } }
  const fh = readHistory(path.join(dir,"fav_history.json"));   // 깨져 있으면 예외 → 덮어쓰지 않음
  if(!fh.dates) fh.dates=[]; if(!fh.works) fh.works={};
  if(!fh.dates.includes(date)) fh.dates.push(date);
  const di=fh.dates.indexOf(date);
  for(const id in details){ const fav=details[id].fav; if(fav==null) continue;
    if(details[id].favAt!==date) continue;   // 오늘 관심수를 새로 긁은 작품만 기록(베껴 쓰기 금지)
    const w=fh.works[id]||(fh.works[id]={v:[]});
    while(w.v.length<di) w.v.push(null);
    w.v[di]=fav;
  }
  for(const id in fh.works){ const w=fh.works[id]; while(w.v.length<=di) w.v.push(null); }
  const RMAX=150; if(fh.dates.length>RMAX){ const cut=fh.dates.length-RMAX; fh.dates.splice(0,cut); for(const id in fh.works) fh.works[id].v.splice(0,cut); }
  fs.writeFileSync(path.join(dir,"fav_history.json"), JSON.stringify(fh));
  return { dates:fh.dates.length, works:Object.keys(fh.works).length };
}

// 재수집 병합: 빈값이면 기존 유지(로그아웃이 19금/검색작 dl 안 지움)
function mergeDetail(old, pd, kind){ old=old||{}; const m={ g:pd.g||old.g||"", k:(pd.k&&pd.k.length)?pd.k:(old.k||[]), dl:pd.dl||old.dl||"", star:pd.star||old.star||"", cmt:pd.cmt||old.cmt||"", ep:pd.ep||old.ep||0, status:pd.status||old.status||"", syn:pd.syn||old.syn||"", kind:kind||pd.kind||old.kind };
  const rent=(pd.rent!=null)?pd.rent:old.rent; if(rent!=null) m.rent=rent;   // 단가(대여/소장 쿠키) 보존 — 재수집 때 지우지 않음
  const own=(pd.own!=null)?pd.own:old.own; if(own!=null) m.own=own;
  const at = pd.dl ? runDate() : old.at; if(at) m.at=at;   // 다운수를 이번에 새로 긁었으면 "오늘 긁음" 스탬프 — updateRevenueHistory는 스탬프가 오늘인 작품만 기록
  return m; }
// 시리즈 통합검색 결과 파싱 → [{pn, kind, title}]
function parseSeriesSearch(html){
  const out=[], re=/<a href="\/(comic|novel)\/detail\.series\?productNo=(\d+)" class="N=a:(?:com|nov)\.title">([\s\S]*?)<\/a>/g;
  let m; while(m=re.exec(html)){ const kind=m[1], pn=Number(m[2]); const title=m[3].replace(/<[^>]*>/g,"").replace(/\s+/g," ").trim(); if(title) out.push({pn, kind, title}); }
  return out;
}
module.exports = { seriesAll, parseSeries, parseSeriesMobile, SERIES_CATS, collectPromo, parsePromo, parseSeriesDetail, collectSeriesDetails, searchLinkWebtoons, parseDlNum, updateRevenueHistory, updateEpHistory, updateFavHistory, isoDate, runDate, dataDate, fullRunOK, readHistory, mergeDetail, episodeSplit, adultEp, parseSeriesSearch, probeEpByComments, fetchVolumePrice, fillVolumePrices };
if (require.main === module) (async ()=>{
  const updated=new Date().toISOString(), date=isoDate();   // 랭킹·요일·장르 기록 날짜(기존 그대로)
  const hdate=runDate();   // 다운수·관심수·무료유료 히스토리 날짜(새벽 4시 전 실행이면 전날) — 수집 스탬프와 같은 값
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
  // 검색연동(신작 등 미연동 웹툰을 시리즈에 연결) → collectSeriesDetails가 이어서 다운수 갱신. PC 없이 클라우드에서 매일.
  try {
    let sd={}; try{ sd=JSON.parse(fs.readFileSync(path.join(OUT,"series_details.json"),"utf8")); }catch(e){}
    let extra={updated:"",map:{},owned:[]}; try{ extra=JSON.parse(fs.readFileSync(path.join(OUT,"series_extra.json"),"utf8")); }catch(e){}
    await searchLinkWebtoons({comic:s_comic, novel:s_novel}, sd, extra);
    fs.writeFileSync(path.join(OUT,"series_details.json"), JSON.stringify(sd));
    fs.writeFileSync(path.join(OUT,"series_extra.json"), JSON.stringify(extra));
  } catch(e){ console.error("search-link failed:", e.message); }
  try {
    let sd={}; try{ sd=JSON.parse(fs.readFileSync(path.join(OUT,"series_details.json"),"utf8")); }catch(e){}
    sd=await collectSeriesDetails({comic:s_comic, novel:s_novel}, sd);
    // 단가(대여/소장 쿠키) — 없는 코믹부터 매일 일부 채움(비성인; 성인은 CDP). 가격은 거의 안 변해 1회로 충분.
    try{ let extra={}; try{ extra=JSON.parse(fs.readFileSync(path.join(OUT,"series_extra.json"),"utf8")); }catch(e){} const got=await fillVolumePrices(sd, extra, 500); if(got) console.log("단가(쿠키) 신규 수집:", got); }catch(e){ console.error("price fill failed:", e.message); }
    fs.writeFileSync(path.join(OUT,"series_details.json"), JSON.stringify(sd));
  } catch(e){ console.error("series details failed:", e.message); }
  try { const full = fullRunOK(collectSeriesDetails.stats);   // 본수집 정상 여부 = 이번 실행이 비성인 다운수를 절반 이상 실제로 긁었는지
    const rh = updateRevenueHistory(OUT, hdate, {full}); if(rh) console.log("revenue history:", JSON.stringify(rh), "full:", full, JSON.stringify(collectSeriesDetails.stats||null)); } catch(e){ console.error("revenue history failed:", e.message); }   // 오늘 긁은 작품만 기록 + 정상이면 완료 날짜(lastFull) 표시
  fs.writeFileSync(path.join(OUT,"lookup.json"), JSON.stringify({ id:idL, name:nameL }));
  fs.writeFileSync(path.join(OUT,"details.json"), JSON.stringify(details));
  try { const eh = updateEpHistory(OUT, hdate, details); if(eh) console.log("ep(무료/유료) history:", JSON.stringify(eh)); } catch(e){ console.error("ep history failed:", e.message); }
  try { const fh = updateFavHistory(OUT, hdate, details); if(fh) console.log("fav(관심수) history:", JSON.stringify(fh)); } catch(e){ console.error("fav history failed:", e.message); }
  fs.writeFileSync(path.join(OUT,"history.json"), JSON.stringify(hist));

  try { await collectEpisodes(details, updated); } catch(e){ console.error("episodes failed:", e.message); } // best-effort 백필

  const c=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,v.length]));
  const sc=s=>{let n=0,items=0;for(const pf of["web","mobile"])for(const cat in s[pf])for(const p in s[pf][cat]){n++;items+=s[pf][cat][p].length;}return{rankings:n,items};};
  console.log("done:", JSON.stringify({ web_wd:c(web_wd), app_wd:c(app_wd), comic:sc(s_comic), novel:sc(s_novel), details:Object.keys(details).length, histDates:hist.dates.length, histBases:Object.keys(hist.series).length }));
})().catch(e=>{ console.error("FAILED:",e); process.exit(1); });
