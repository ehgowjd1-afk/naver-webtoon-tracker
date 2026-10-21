"use strict";
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));

const WEEKDAYS = [["mon","월"],["tue","화"],["wed","수"],["thu","목"],["fri","금"],["sat","토"],["sun","일"],["dailyPlus","매일+"]];
const PERIODS = [["DAILY","일간"],["WEEKLY","주간"],["MONTHLY","월간"]];
const SERIES_CATNAMES = { comic:["전체장르","소년","순정","드라마","무협","BL"], novel:["전체장르","로맨스","판타지","미스터리","라이트노벨","무협","로판","현판","BL"] };
const SERIES_PLATS = [["web","웹"],["mobile","모바일"]];

let APP=null, WEEKDAY=null, SERIES=null, PROMO=null, LOOKUP={id:{},name:{}}, WEEKS=[];
let ORIGINS=null;
let AGEN_WK="", APPW={};   // 앱 장르 주간: 보고 있는 주차 · 주차별 앱 주간 차트 캐시(요약 칸)   // 원작 웹소설 연재처(data/origins.json, scripts/collect_origins.js)
let AGEN=null, AGEN_IDX=null, agenLoading=null, AGENH=null, agenhLoading=null;   // 앱 장르 주간랭킹(data/app_genre/) — 탭 열 때 불러옴
const AGEN_GENRES=["판타지·무협","액션","드라마","로맨스","스릴러","일상·개그"];
let APPWD=null, APPWDH=null, appwdLoading=null;
let NTOP=[];   // 신작 탭 주간 거래액 TOP 10(요약 칸 아래)
let LW=null, lwLoading=null;   // 신작 월별: data/launch_weeks.json(론칭 주차별 다운 증가, 클라우드가 매일 갱신·영구 보관)
const CO_KEYS=[["w1","첫 주",1,false],["c2","2주 누적",2,true],["c4","4주 누적",4,true],["c8","8주 누적",8,true],["c12","12주 누적",12,true]];   // 앱 요일별 인기순(폰 화면, data/app_weekday*.json) — 요일별 › 앱
const CO_SORTS=[["c2","2주 누적 거래액"],["w1","첫 주 거래액"],["c4","4주 누적 거래액"],["last","최근 주 거래액"],["keep","유지율"],["dl2","2주 다운로드"],["fav","관심 수"],["cmt","회차 댓글"],["app","앱 주간 순위"]];
const APPWD_SUBS=[["all","전체"], ["new","신작"], ...WEEKDAYS];
const GSORTS=[["pop","인기순"],["f","여성 인기순"],["m","남성 인기순"]];   // 요일별 › 앱 정렬 칩 → 데이터 키 접미사(mon · mon_f · mon_m)
const gsuf = () => sMode==="f"?"_f":sMode==="m"?"_m":"";
const F_AWD=[["all","전체"],["up","상승"],["down","하락"],["new","신작·진입"],["orig","원작"]];
/* 요일별 › 앱 날짜 선택: AWD_DATE=""면 최신. 지난 날짜는 날짜별 순위 기록(app_weekday_history)에서 다시 만듦.
   m = 그 탭의 바로 전 수집일 순위 − 그날 순위(▲ 올라감), 전날 없던 작품은 '진입' */
let AWD_DATE="";
const awdDate = key => AWD_DATE || (APPWD&&APPWD.tabDates&&APPWD.tabDates[key]) || (APPWD&&APPWD.date) || "";
function appwdRows(key){
  if(!APPWD) return [];
  const H=APPWDH||{dates:[],series:{}}, S=H.series[key]||{}, D=awdDate(key), latest=(APPWD.tabDates&&APPWD.tabDates[key])||APPWD.date;
  const di=H.dates.indexOf(D), has=i=>{ for(const id in S) if(S[id][i]!=null) return true; return false; };
  let pi=di-1; while(pi>=0 && !has(pi)) pi--;   // 이 탭의 바로 전 수집일(정렬별로 시작일이 달라서)
  const names={}; for(const k in APPWD.tabs) for(const x of APPWD.tabs[k]) if(x.id!=null && !names[x.id]) names[x.id]=x;   // 지난 날짜 행의 제목·썸네일 보충
  let rows;
  if(D===latest && APPWD.tabs[key]) rows=APPWD.tabs[key].map(x=>({...x, b:[...(x.b||[])]}));
  else { if(di<0) return []; rows=[]; for(const id in S){ const r=S[id][di]; if(r==null) continue; const n=(H.names&&H.names[id])||names[id]; rows.push({r, id:+id, t:n?(n.t||n[0]):undefined, a:n?(n.a||n[1]||""):undefined, th:n?(n.th||n[2]||""):undefined, b:[]}); } rows.sort((a,b)=>a.r-b.r); }
  if(pi>=0) for(const x of rows){ const p=(x.id!=null&&S[x.id])?S[x.id][pi]:null; x.m=p!=null?p-x.r:0; if(p==null && x.id!=null && !x.b.includes("진입")) x.b.push("진입"); }
  return rows;
}
function renderAwDate(){   // 날짜 칸(달력) — 요일별 › 앱에서만
  const el=document.getElementById("awdate"), now=document.getElementById("awdate-now"); if(!el) return;
  const on = src==="weekday" && variant==="app" && APPWDH && APPWDH.dates.length;
  el.hidden=!on; now.hidden=!on||!AWD_DATE;
  if(!on) return;
  const ds=APPWDH.dates; el.min=ds[0]; el.max=ds[ds.length-1]; el.value=awdDate(sub+gsuf());
  el.onchange=()=>{ const v=el.value; AWD_DATE=(!v||v===((APPWD.tabDates&&APPWD.tabDates[sub+gsuf()])||APPWD.date))?"":v; renderView(); };
  now.onclick=()=>{ AWD_DATE=""; renderView(); };
}
let src="app", variant=null, sub="전체", platform="web", scat="전체장르", fMode="all", sMode="rank", query="", revWeek="";
let rowsCache=[];
let DETAILS=null, detailsLoading=null, HISTORY=null, historyLoading=null, KWINDEX=null, seriesLoading=null, promoLoading=null;
let SERIESDET=null, seriesDetLoading=null, REVHIST=null, revHistLoading=null, SERIESEXTRA=null, EPHIST=null, epHistLoading=null, FAVHIST=null, favHistLoading=null;
const DAILYPLUS=new Set();

const F_MOVE=[["all","전체"],["up","상승"],["down","하락"]];
const F_APP=[["all","전체"],["up","상승"],["down","하락"],["new","신작·진입"],["streak","연속기록"],["rest","휴재"],["orig","원작"]];
const F_MIN=[["all","전체"],["orig","원작"]];
const F_ONE=[["all","전체"]];   // 시리즈 상품 목록(원작 필터 의미 없음)
const S_MOVE=[["rank","순위순"],["up","상승폭"],["down","하락폭"]];
const S_APP=[["rank","순위순"],["up","상승폭"],["down","하락폭"],["revenue","시리즈 거래추정순"]];
const dot = d => (d||"").replace(/-/g,".");
/* 단가(원/다운) = (대여쿠키×0.9 + 소장쿠키×0.1)×100. series_details의 rent/own(수집한 쿠키값) 사용, 없으면 기본(코믹 320=대여3·소장5 / 웹소설 100). 매출=다운수×단가×0.9×0.6 */
const UNIT_PRICE = k => k==="novel" ? 100 : 320;
function unitPrice(sd, kind){ return (sd && sd.own>0 && sd.rent!=null) ? (sd.rent*0.9 + sd.own*0.1)*100 : UNIT_PRICE(kind); }
/* 웹툰 총N화(details.json ep = comic.naver 총 회차수, 미리보기 포함) — 회차당 매출의 나눗셈 기준 */
const detEp = d => (DETAILS && d && d.id!=null && DETAILS[d.id]) ? (DETAILS[d.id].ep||0) : 0;
function parseDl(s){ if(!s) return 0; s=String(s).replace(/,/g,""); let n=0,m; if(m=s.match(/([\d.]+)\s*억/)) n+=parseFloat(m[1])*1e8; if(m=s.match(/([\d.]+)\s*만/)) n+=parseFloat(m[1])*1e4; if(m=s.match(/([\d.]+)\s*천/)) n+=parseFloat(m[1])*1e3; if(!n) n=parseFloat(s)||0; return Math.round(n); }
function wonFmt(n){ if(n==null) return "-"; n=Math.round(n); if(n===0) return "0원"; const eok=Math.floor(n/1e8), man=Math.floor((n%1e8)/1e4), rest=n%1e4; const p=[]; if(eok) p.push(eok.toLocaleString()+"억"); if(man) p.push(man.toLocaleString()+"만"); if(rest||!p.length) p.push(rest.toLocaleString()); return p.join(" ")+"원"; }
const normName = s => String(s||"").replace(/\s*\[[^\]]*\]\s*$/,"").replace(/\s+/g,"");
let SNAMEIDX=null, modalSeq=0;
function seriesNameIndex(){
  if(SNAMEIDX) return SNAMEIDX;
  const idx={}; if(SERIES){ const seen=new Set(); for(const kind of ["comic","novel"]) for(const pf of ["web","mobile"]) for(const c in (SERIES[kind]||{})[pf]||{}) for(const p in SERIES[kind][pf][c]) for(const it of SERIES[kind][pf][c][p]){ if(seen.has(it.id))continue; seen.add(it.id); const n=normName(it.t); (idx[n]||(idx[n]=[])).push({pn:it.id,kind}); } }
  if(SERIESEXTRA&&SERIESEXTRA.map){ for(const n in SERIESEXTRA.map) for(const e of SERIESEXTRA.map[n]){ const a=(idx[n]||(idx[n]=[])); if(!a.some(x=>x.pn===e.pn)) a.push({pn:e.pn,kind:e.kind}); } }  // 검색으로 찾은 시리즈(랭킹에 없는 작품) 연동
  if(SERIES||SERIESEXTRA) SNAMEIDX=idx;
  return idx;
}
function revenueFor(name, epOverride, selfPn){
  if(!SERIES||!SERIESDET) return null;
  let best;
  if(selfPn){ const d=SERIESDET[selfPn]; if(!d||d.kind!=="comic"||!d.dl||!d.ep) return null; best={pn:selfPn, kind:"comic", d}; }   // 시리즈 항목 자신(시리즈 탭·검색의 시리즈 결과) — 웹툰용 판본 연결은 적용 안 함
  else {
  const cands=seriesNameIndex()[normName(name)]; if(!cands||!cands.length) return null;
  const lk=(SERIESEXTRA&&SERIESEXTRA.link)?SERIESEXTRA.link[normName(name)]:undefined;   // 수집기가 웹툰 총화와 회차수로 고른 판본(0=맞는 판본 없음 — 단행본·동명 다른 작품만 있음)
  if(lk===0) return null;
  const pool=cands.map(c=>({...c,d:SERIESDET[c.pn]})).filter(x=>x.kind==="comic"&&x.d&&x.d.dl&&x.d.ep);   // 웹툰(코믹) 시리즈만 — 웹소설 매칭 제외(코믹 없으면 시리즈없음)
  best=lk?pool.find(x=>x.pn===lk):pool[0];
  }
  if(!best) return null;
  const up=unitPrice(best.d, best.kind), dl=parseDl(best.d.dl), ep=(epOverride>0?epOverride:(best.d.ep||1)), total=dl*up;   // 단가 up=(대여×0.9+소장×0.1)×100 · 총거래액=다운수×단가
  return { full: total, per: total*0.9*0.6/ep, deal: total, up, rent:best.d.rent, own:best.d.own, dl, dlStr:best.d.dl, star:best.d.star, cmt:best.d.cmt, ep, sep:best.d.ep, kind:best.kind, pn:best.pn };  // full(총거래액)=다운수×단가 · per(회차당)=총거래액×0.9×0.6÷회차수 (유지) · 거래액 자리는 주단위 거래액(weeklyRevenue)로 표시
}

const SOURCES = {
  app:     { label:"앱 주간", variants:null, subs:()=>["전체","여성","남성"].map(k=>[k,String((APP&&APP.charts&&APP.charts[k]||[]).length)]), data:(v,s)=>APP&&APP.charts[s], caps:{move:1,streak:1,badge:1,tiles:1,gap:1}, filters:F_APP, sorts:S_APP, note:()=>`${weekLabel(APP.date)} · 앱 「이번 주 웹툰 랭킹」` },
  appgenre:{ label:"앱 장르 주간", variants:null, subs:()=>((AGEN_IDX&&AGEN_IDX.genres)||AGEN_GENRES).map(k=>[k,String((AGEN&&AGEN.charts&&AGEN.charts[k]||[]).length)]), data:(v,s)=>AGEN&&AGEN.charts&&AGEN.charts[s], caps:{move:1,streak:1,badge:1,gtiles:1}, filters:F_APP, sorts:S_APP.filter(x=>x[0]!=="revenue"), note:()=>AGEN&&AGEN.date?`${weekLabel(AGEN.date)} · 앱 「${sub} 웹툰 주간랭킹」 · ${AGEN.src&&AGEN.src[sub]==="phone"?"앱 화면 100위(폰)":"검색 위젯 45위 · 순위변동은 폰 수집 때만"}`:"앱 장르 주간랭킹 · 아직 데이터 없음" },
  // 앱 = 폰으로 읽은 실제 앱 인기순(예전 '모바일'은 m.comic 모바일 웹이라 앱과 순서가 달라서 뺌)
  weekday: { label:"요일별", variants:[["app","앱"],["web","웹"]], subs:()=>variant==="app"?APPWD_SUBS:WEEKDAYS, data:(v,s)=>v==="app"?appwdRows(s+gsuf()):(WEEKDAY&&WEEKDAY.web&&WEEKDAY.web[s]), get caps(){ return variant==="app"?{badge:1,gsort:1,move:1,wtiles:1}:{badge:1,gsort:1}; }, get filters(){ return variant==="app"?F_AWD:F_MIN; }, get sorts(){ return variant==="app"?GSORTS:[]; }, note:v=>v==="app"?(APPWD&&APPWD.date?`${dot(awdDate(sub+gsuf()))}${AWD_DATE?" (지난 날짜)":""} · 앱 ${(GSORTS.find(x=>x[0]===sMode)||GSORTS[0])[1]}(폰 화면) · ▲▼ = 전날 수집 대비 · 매일`:"앱 인기순 · 아직 데이터 없음"):`${dot(WEEKDAY.date)} · 요일별 인기순 · 웹(PC) · 자동` },
  done:    { label:"완결", variants:null, subs:()=>doneSubs(), data:(v,s)=>doneWorkSet(s), caps:{revenue:1,badge:1,done:1}, filters:F_MIN, sorts:[["fav","관심수순"],["total","총거래액순"],["per","회차당순"]], note:()=>`완결된 웹툰 · 장르·신작·성인 목록에서 옮겨 왔어요` },
  series:  { label:"시리즈", variants:[["comic","웹툰"],["novel","웹소설"]], subs:()=>PERIODS, data:(v,s)=>SERIES&&SERIES[v]&&SERIES[v][platform]&&SERIES[v][platform][scat]&&SERIES[v][platform][scat][s], caps:{move:1,tiles:1,series:1,badge:1}, filters:F_MOVE, sorts:S_MOVE, note:v=>`${dot(SERIES.date)} · 시리즈 ${v==="comic"?"웹툰":"웹소설"} · ${platform==="web"?"웹(PC)":"모바일"} · ${scat} · 자동` },
  promo:   { label:"무료·이벤트", variants:[["comic","웹툰"],["novel","웹소설"]], subs:()=>[["freeFromToday","오늘부터무료"],["timeDeal","타임딜"],["hourlyFree","매일무료"]], data:(v,s)=>PROMO&&PROMO[v]&&PROMO[v][s], caps:{badge:1,series:1}, filters:F_ONE, sorts:[], note:v=>`${dot(PROMO.date)} · 시리즈 ${v==="comic"?"웹툰":"웹소설"} · 무료·이벤트 · 자동` },
  revenue: { label:"매출순", variants:null, subs:()=>REVSUBS, data:(v,s)=>revenueWorkSet(s), caps:{revenue:1,badge:1}, filters:F_MIN, sorts:[["per","회차당순"],["total","총거래액순"],["deal","주단위거래액순"]], note:()=>`시리즈 거래 추정 · 단가=(대여×0.9+소장×0.1)×100 · 총거래액=다운수×단가 · 회차당=총거래액×0.9×0.6÷시리즈 회차수 · 주단위거래액=이번주−지난주 누적` },
  revchange:{ label:"매출 변동", variants:null, subs:()=>REVSUBS, data:(v,s)=>revenueWorkSet(s), caps:{revchange:1,badge:1}, filters:F_MIN, sorts:[["gain","거래액 많은 순"],["loss","적은 순"]], note:()=>`주단위 거래액 · ${revWeekLabel()} · 이번주−지난주 누적 거래액 (연재요일 기준)` },
  cohort:  { label:"신작 월별", variants:null, subs:()=>{ const ms=cohortMonths(); return ms.length?ms.map(m=>[m,monthLabel(m)]):[[isoToday().slice(0,7),"불러오는 중"]]; }, data:(v,s)=>cohortRows(s), caps:{cohort:1,badge:1}, filters:F_MIN, sorts:CO_SORTS, note:()=>`론칭 월별 신작 성적 · 같은 시기(론칭 후 N주) 거래액 비교 · 아래 목록은 기준을 골라 그 달 순위 · 매일 자동 갱신` },
  newworks:{ label:"신작", variants:null, subs:()=>NEWSUBS, data:(v,s)=>newWorkSet(+s), caps:{revenue:1,badge:1,newworks:1,newtiles:1}, filters:F_MIN, sorts:[["deal","주간 거래액순"],["dgain","상승폭순"],["recent","최신순"],["per","회차당순"],["total","총거래액순"]], note:()=>`런칭 최근 ${sub}일 신작 · 주간 거래액=그 주(연재요일 기준) 다운로드 증가×단가 · 상승·하락=전주 대비 · 기간 지나면 이 목록에서만 빠져요` },
};
const REVSUBS=[["전체","전체"],["adult","🔞성인"],["dailyplus","매일+"],["mon","월"],["tue","화"],["wed","수"],["thu","목"],["fri","금"],["sat","토"],["sun","일"]];
/* 성인(19금) 작품만: 웹툰 자체의 성인 플래그(details.adult = comic.naver가 막는 19금 웹툰). 새 성인신작 감지되면 매일 자동 추가 */
/* 완결: details.day 가 'N화 완결'인 웹툰 — 장르·신작·성인 매출 목록에서 빼서 '완결' 탭으로(사용자 요청 2026-10-12) */
const isDone = id => !!(id!=null && DETAILS && DETAILS[id] && /완결/.test(DETAILS[id].day||""));
const notDone = arr => (arr||[]).filter(x => !isDone(x.id!=null ? x.id : (x.t!=null ? LOOKUP.name[x.t] : null)));
function doneWorkSet(g){
  if(!DETAILS || !LOOKUP.id) return [];
  const out=[];
  for(const id in DETAILS){ if(isDone(id) && LOOKUP.id[id] && (g==="전체" || DETAILS[id].g===g)) out.push({id:+id, r:0}); }
  return out;
}
function doneSubs(){
  const c={}; if(DETAILS) for(const id in DETAILS) if(isDone(id) && LOOKUP.id[id]) c[DETAILS[id].g||"기타"]=(c[DETAILS[id].g||"기타"]||0)+1;
  return [["전체","전체"], ...Object.entries(c).sort((a,b)=>b[1]-a[1]).map(([g])=>[g,g])];
}
function adultWorkSet(){
  if(!DETAILS || !LOOKUP.id) return [];
  const out=[];
  for(const id in DETAILS){ if(DETAILS[id] && DETAILS[id].adult && LOOKUP.id[id] && !isDone(id)) out.push({id:+id, r:0}); }
  return out;
}
function revenueWorkSet(s){
  if(s==="adult") return adultWorkSet();
  if(!WEEKDAY||!WEEKDAY.web) return [];
  if(s==="dailyplus") return WEEKDAY.web.dailyPlus||[];
  if(s==="전체"){ const seen=new Set(), out=[]; for(const day of ["mon","tue","wed","thu","fri","sat","sun","dailyPlus"]) for(const it of (WEEKDAY.web[day]||[])){ if(!seen.has(it.id)){ seen.add(it.id); out.push(it); } } return out; }
  return WEEKDAY.web[s]||[];
}
/* 신작: details.launch(런칭일 "YY.MM.DD") 최근 N일 이내 웹툰. 지나면 목록에서만 빠지고 데이터는 유지 */
const NEWSUBS=[["42","6주"],["30","최근 1달"],["60","2달"],["90","3달"]];
function parseLaunch(s){ const m=String(s||"").match(/(\d{2})\.(\d{2})\.(\d{2})/); return m?new Date(2000+ +m[1], +m[2]-1, +m[3]).getTime():0; }
function newWorkSet(days){
  if(!DETAILS||!LOOKUP.id) return [];
  const cutoff=Date.now()-(days||30)*86400000, out=[];
  for(const id in DETAILS){ const lt=parseLaunch(DETAILS[id].launch); if(lt && lt>=cutoff && LOOKUP.id[id] && !isDone(id)) out.push({id:+id, r:0}); }   // 완결작은 완결 탭으로
  out.sort((a,b)=>parseLaunch(DETAILS[b.id].launch)-parseLaunch(DETAILS[a.id].launch));
  return out;
}
/* 신작 월별: 론칭 월마다 같은 시기(첫 주·2주·4주·8주·12주 누적) 거래액 = 주차별 다운 증가 × 작품 단가 */
const wonShort = v => v>=1e8 ? (v/1e8).toFixed(2).replace(/0+$/,"").replace(/[.]$/,"")+"억" : Math.round(v/1e4).toLocaleString()+"만";
function cohortVals(x){
  const sd=SERIESDET&&SERIESDET[x.pn], up=sd?unitPrice(sd,"comic"):320, w=x.w||[], o={};
  for(const [k,,n,cum] of CO_KEYS) o[k] = w.length>=n ? (cum ? w.slice(0,n).reduce((s,v)=>s+v,0) : w[n-1])*up : null;
  return o;
}
function cohortMonths(){ const s=new Set(); for(const id in (LW&&LW.works)||{}) s.add(LW.works[id].L.slice(0,7)); return [...s].sort().reverse(); }
const monthLabel = m => { const p=m.split("-"); return `${+p[1]}월`+(m===isoToday().slice(0,7)?" (진행 중)":""); };
function cohortRows(m){ const out=[]; for(const id in (LW&&LW.works)||{}){ const x=LW.works[id]; if(x.L.slice(0,7)===m) out.push({id:+id, t:x.t, r:0}); } return out; }
function cohortStats(vals){
  const a=vals.filter(v=>v!=null).sort((x,y)=>x-y); if(!a.length) return null;
  const n=a.length, top=a.slice(-10);
  return { n, mean:a.reduce((s,v)=>s+v,0)/n, med:n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2, q3:a[Math.floor(n*0.75)], top10:top.reduce((s,v)=>s+v,0)/top.length, max:a[n-1] };
}
/* 신작 월별 패널: 그 달 론칭작의 론칭 주차별 매출 순위 추이(1주차~최대 13주차≈3달, 데이터가 쌓이는 만큼 열이 늘어남).
   칸 = 그 주차까지 온 작품끼리 매긴 순위(주간: 그 주 거래액 / 누적: 1주차부터 합). ▲▼ = 앞 주차 대비 순위 변화.
   열 제목을 누르면 그 주차 순위로 줄 정렬(기본 = 가장 최근 열 중 작품 절반 이상이 온 주차). 통계 표는 아래 '통계 보기'로 접어 둠 */
/* 신작 월별 그래프 ① 순위 추이(범프 차트): 표 위쪽 8개 작품의 주차별 순위 선. 위가 1위, 15위 밖은 맨 아래 줄에 흐리게.
   색 = 검증된 8색(--s1~8)을 론칭일 순으로 배정(정렬을 바꿔도 같은 작품이 남으면 색 순서 기준은 그대로) · 범례 + 마우스 올리면 그 작품만 강조·말풍선 */
function bumpHtml(works, K, sk, basis){
  const top=works.filter(o=>o.rank[sk-1]!=null).slice(0,8);
  if(K<2||top.length<2) return "";
  const slot=new Map([...top].sort((a,b)=>a.L<b.L?-1:a.L>b.L?1:a.id-b.id).map((o,i)=>[o.id,i+1]));
  const W=760, H=310, pl=48, pr=18, pt=14, pb=38, R=15;
  const x=k=>K===1?(pl+W-pr)/2:pl+(k-1)*(W-pl-pr)/(K-1);
  const y=r=>pt+(Math.min(r,R+1)-1)*(H-pt-pb)/R;
  const grid=[1,5,10,15].map(r=>`<line class="grid" x1="${pl}" x2="${W-pr}" y1="${y(r)}" y2="${y(r)}"/><text class="ax" x="${pl-8}" y="${y(r)+4}" text-anchor="end">${r}위</text>`).join("")
    +`<text class="ax" x="${pl-8}" y="${y(R+1)+4}" text-anchor="end">15위 밖</text>`;
  const xs=Array.from({length:K},(_,i)=>`<text class="ax ${i+1===sk?"axon":""}" x="${x(i+1)}" y="${H-8}" text-anchor="middle">${i+1}주</text>`).join("");
  const band=`<rect class="band" x="${x(sk)-14}" y="${pt-8}" width="28" height="${H-pt-pb+16}" rx="6"/>`;
  const ser=top.map(o=>{
    const c=`var(--s${slot.get(o.id)})`, pts=[];
    for(let k=1;k<=K;k++){ const r=o.rank[k-1]; if(r==null) break; pts.push([k,r]); }
    const d=pts.map(([k,r],i)=>`${i?"L":"M"}${x(k).toFixed(1)},${y(r).toFixed(1)}`).join(" ");
    const dots=pts.map(([k,r])=>`<circle class="${r>R?"out":""}" cx="${x(k).toFixed(1)}" cy="${y(r).toFixed(1)}" r="4" fill="${c}"/><circle class="hit" data-sid="${o.id}" data-k="${k}" cx="${x(k).toFixed(1)}" cy="${y(r).toFixed(1)}" r="11"/>`).join("");
    return `<g class="ser" data-sid="${o.id}"><path d="${d}" stroke="${c}"/>${dots}</g>`; }).join("");
  const leg=top.map(o=>`<span data-sid="${o.id}"><i style="background:var(--s${slot.get(o.id)})"></i>${esc(o.name)} <small>${o.rank[sk-1]}위</small></span>`).join("");
  return `<div class="bump" id="bump"><div class="leg">${leg}</div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="론칭 주차별 ${basis==="cum"?"누적":"주간"} 매출 순위 추이 상위 ${top.length}개">${band}${grid}${xs}${ser}</svg><div class="tip" hidden></div></div>`;
}
function wireBump(works){
  const box=document.getElementById("bump"); if(!box) return;
  const tip=box.querySelector(".tip"), by=new Map(works.map(o=>[String(o.id),o]));
  const hl=id=>{ box.classList.toggle("hl",!!id); box.querySelectorAll(".ser").forEach(g=>g.classList.toggle("on",g.dataset.sid===id)); };
  box.onmouseover=e=>{ const t=e.target.closest("[data-sid]"); hl(t?t.dataset.sid:null);
    if(t&&t.dataset.k){ const o=by.get(t.dataset.sid), k=+t.dataset.k-1, br=box.getBoundingClientRect(), cr=t.getBoundingClientRect();
      tip.innerHTML=`<b>${esc(o.name)}</b>${k+1}주차 ${o.rank[k]}위 · 그 주 ${wonShort(o.deal[k])} · 누적 ${wonShort(o.cum[k])}`;
      tip.hidden=false; const left=Math.min(cr.left-br.left+12, br.width-tip.offsetWidth-4); tip.style.left=Math.max(0,left)+"px"; tip.style.top=(cr.top-br.top-tip.offsetHeight-6)+"px"; }
    else tip.hidden=true; };
  box.onmouseleave=()=>{ hl(null); tip.hidden=true; };
}
/* 그래프 ② 표 안 미니 그래프: 작품마다 주차별 그 주 매출의 모양(작품마다 자기 최고점 기준 — 오르는지 꺾이는지) */
function trendSpark(o){
  const v=o.deal; if(v.length<2) return "";
  const W=72, H=24, p=4, mx=Math.max(...v), mn=Math.min(...v), rng=(mx-mn)||1;
  const pts=v.map((d,i)=>[p+i*(W-2*p)/(v.length-1), H-p-(d-mn)/rng*(H-2*p)]);
  const last=pts[pts.length-1];
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${pts.map((q,i)=>(i?"L":"M")+q[0].toFixed(1)+","+q[1].toFixed(1)).join(" ")}"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.5"/></svg>`;
}
let TR_BASIS="week", TR_MODE="rank", TR_SORTK=0, TR_ALL=false, TR_MONTH="";
function renderCohort(){
  const el=document.getElementById("cohort"); if(!el||!LW) return;
  if(TR_MONTH!==sub){ TR_MONTH=sub; TR_SORTK=0; TR_ALL=false; }
  const works=cohortRows(sub).map(r=>{ const x=LW.works[r.id], sd=SERIESDET&&SERIESDET[x.pn], up=sd?unitPrice(sd,"comic"):320, w=(x.w||[]).slice(0,13);
    const deal=w.map(v=>v*up), cum=[]; deal.forEach((v,i)=>cum.push((cum[i-1]||0)+v));
    return { id:r.id, name:x.t, L:x.L, deal, cum, rank:[] }; });
  const K=Math.max(0, ...works.map(o=>o.deal.length));
  for(let k=0;k<K;k++){   // 주차별 순위 — 그 주차까지 온 작품끼리
    const val=o=>TR_BASIS==="cum"?o.cum[k]:o.deal[k];
    works.filter(o=>o.deal.length>k).sort((a,b)=>val(b)-val(a)).forEach((o,i)=>{ o.rank[k]=i+1; });
  }
  const nAt=k=>works.filter(o=>o.deal.length>k).length;
  let sk=TR_SORTK; if(!sk||sk>K){ sk=0; for(let k=K;k>=1;k--){ if(nAt(k-1)>=Math.max(1,works.length/2)){ sk=k; break; } } if(!sk) sk=Math.min(1,K); }
  const latest=o=>o.rank.length?o.rank[o.rank.length-1]:1e9;
  works.sort((a,b)=>{ const ra=a.rank[sk-1], rb=b.rank[sk-1]; if(ra!=null&&rb!=null) return ra-rb; if(ra!=null) return -1; if(rb!=null) return 1; return latest(a)-latest(b); });
  const shown=TR_ALL?works:works.slice(0,15);
  const heat=r=>r==null?"":r<=3?"t3":r<=10?"t10":"";
  const head=Array.from({length:K},(_,k)=>`<th class="tk ${k+1===sk?"on":""}" data-tk="${k+1}" title="${k+1}주차 순위로 정렬 · ${nAt(k)}개 작품">${k+1}주${k+1===sk?" ▾":""}</th>`).join("");
  const rowHtml=o=>`<tr><th class="tn" data-tid="${o.id}" title="${esc(o.name)} · 론칭 ${mdShort(o.L)}"><span>${esc(o.name)}</span><small>${mdShort(o.L)}</small></th><td class="sp" title="주차별 그 주 매출 모양">${trendSpark(o)}</td>${Array.from({length:K},(_,k)=>{
      const r=o.rank[k]; if(r==null) return `<td class="na">·</td>`;
      const p=o.rank[k-1], mv=(p!=null&&p!==r)?(p>r?`<i class="up">▲${p-r}</i>`:`<i class="dn">▼${r-p}</i>`):"";
      const v=TR_BASIS==="cum"?o.cum[k]:o.deal[k];
      const tip=`${o.name} · ${k+1}주차 ${wonShort(o.deal[k])} · 누적 ${wonShort(o.cum[k])} · ${r}위/${nAt(k)}`;
      return `<td class="${heat(r)}" title="${esc(tip)}">${TR_MODE==="rank"?`<b>${r}</b>${mv}`:`<b>${wonShort(v)}</b><i class="rk">${r}위</i>`}</td>`; }).join("")}</tr>`;
  // 통계(접어 둠): 그 달 첫 주·N주 누적 + 월별 비교
  const valsOf=m=>cohortRows(m).map(r=>LW.works[r.id]).map(cohortVals);
  const cur=valsOf(sub);
  const statRows=CO_KEYS.map(([k,lab])=>{ const st=cohortStats(cur.map(o=>o[k])); return st?`<tr><th>${lab}</th><td>${st.n}</td><td>${wonShort(st.mean)}</td><td>${wonShort(st.med)}</td><td>${wonShort(st.q3)}</td><td>${wonShort(st.top10)}</td><td>${wonShort(st.max)}</td></tr>`:""; }).join("");
  const cmpKeys=CO_KEYS.slice(0,4);
  const cmpRows=cohortMonths().map(m=>{ const V=valsOf(m); return `<tr class="${m===sub?"sel":""}"><th>${esc(monthLabel(m))}</th><td>${V.length}</td>${cmpKeys.map(([k])=>{ const st=cohortStats(V.map(o=>o[k])); return st?`<td>${wonShort(st.med)} <span class="q3">/ ${wonShort(st.q3)}</span> <span class="cn">(${st.n})</span></td>`:`<td class="na">–</td>`; }).join("")}</tr>`; }).join("");
  const chip=(attr,val,cur,lab)=>`<button class="chip" ${attr}="${val}" aria-pressed="${val===cur}">${lab}</button>`;
  el.innerHTML=`<div class="lab">${esc(monthLabel(sub))} 론칭 신작 ${works.length}개 · 론칭 주차별 매출 순위 추이 (최대 13주 ≈ 3달까지 따라감)</div>
    <div class="nbasis">${chip("data-tb","week",TR_BASIS,"주간 매출")}${chip("data-tb","cum",TR_BASIS,"누적 매출")}<span class="nsep"></span>${chip("data-tm","rank",TR_MODE,"순위")}${chip("data-tm","deal",TR_MODE,"금액")}</div>
    ${bumpHtml(works, K, sk, TR_BASIS)}
    ${K?`<div class="cowrap"><table class="trtab"><thead><tr><th class="tn">작품 · 론칭일</th><th class="sp" title="주차별 그 주 매출 모양(작품마다 자기 최고점 기준)">흐름</th>${head}</tr></thead><tbody>${shown.map(rowHtml).join("")}</tbody></table></div>`:`<div class="nempty">아직 첫 주가 지난 작품이 없어요.</div>`}
    ${works.length>15?`<button class="nmore" data-tall="1">${TR_ALL?"접기 ▴":`전체 보기 (${works.length}개) ▾`}</button>`:""}
    <div class="nnote">칸 = 그 주차까지 온 작품끼리 매긴 ${TR_BASIS==="cum"?"누적":"주간"} 매출 순위(▲▼ 앞 주차 대비) · 열 제목을 누르면 그 주차 순위로 정렬 · 진한 칸 = 3위 안, 연한 칸 = 10위 안 · 매출 = 다운로드 증가 × 작품 단가 · 매일 자동 갱신, 주차 기록은 계속 보관(다운로드 기록 2026-09-08~)</div>
    <details class="costat"><summary>통계 보기 · 평균·중앙값·상위 25% · 월별 비교</summary>
      <div class="cowrap"><table class="cotab"><thead><tr><th></th><th>작품 수</th><th>평균</th><th>중앙값</th><th>상위 25%</th><th>상위 10개 평균</th><th>최고</th></tr></thead><tbody>${statRows||`<tr><td colspan="7" class="na">아직 첫 주가 지난 작품이 없어요</td></tr>`}</tbody></table></div>
      <div class="lab" style="margin-top:12px">월별 비교 · 중앙값 / 상위 25% 진입선 (작품 수)</div>
      <div class="cowrap"><table class="cotab"><thead><tr><th>론칭 월</th><th>작품</th>${cmpKeys.map(([,lab])=>`<th>${lab}</th>`).join("")}</tr></thead><tbody>${cmpRows}</tbody></table></div>
    </details>`;
  wireBump(works);
  el.onclick=e=>{
    const tb=e.target.closest("[data-tb]"); if(tb){ TR_BASIS=tb.dataset.tb; renderCohort(); return; }
    const tm=e.target.closest("[data-tm]"); if(tm){ TR_MODE=tm.dataset.tm; renderCohort(); return; }
    const tk=e.target.closest("[data-tk]"); if(tk){ TR_SORTK=+tk.dataset.tk; renderCohort(); return; }
    if(e.target.closest("[data-tall]")){ TR_ALL=!TR_ALL; renderCohort(); return; }
    const tn=e.target.closest("[data-tid]"); if(tn){ const id=+tn.dataset.tid, row=viewRows().find(d=>d.id===id); if(row) openModal(row); }
  };
}
/* 월별 신작 순위 기준(정렬 칩). 거래액(론칭 주차) 외에 유지율·다운로드·관심 수·댓글·앱 주간 순위.
   coMetric: 높을수록 좋은 값(앱 주간 순위만 낮을수록 → asc). 없으면 null = 목록 맨 아래 '–' */
function coAppRank(d){ const f=c=>{ const r=(APP&&APP.charts&&APP.charts[c]||[]).find(x=>x.t===d.name); return r?r.r:null; }; return {all:f("전체"), f:f("여성"), m:f("남성")}; }
function coMetric(d, k){
  const x=LW&&LW.works[d.id], w=(x&&x.w)||[], det=DETAILS&&DETAILS[d.id];
  if(d._co&&d._co[k]!==undefined) return d._co[k];   // 거래액 기준(w1·c2·c4·c8·c12)
  if(k==="last"){ if(!w.length) return null; const sd=SERIESDET&&SERIESDET[x.pn], up=sd?unitPrice(sd,"comic"):320; return w[w.length-1]*up; }
  if(k==="keep") return w.length>=2&&w[0]>=15000 ? w[w.length-1]/w[0] : null;   // 최근 주 ÷ 첫 주 — 첫 주 1.5만 건(약 480만 원) 미만은 작은 기준값 착시라 제외
  if(k==="dl2") return w.length>=2 ? w[0]+w[1] : null;
  if(k==="fav") return det&&det.fav ? det.fav : null;
  if(k==="cmt") return det&&det.cmt!=null ? det.cmt : null;
  if(k==="app"){ const a=coAppRank(d); return a.all; }
  return null;
}
function cohortHtml(d){
  const k=sMode, v=coMetric(d,k), lab=(CO_SORTS.find(x=>x[0]===k)||[])[1]||"", o=d._co||{}, x=LW&&LW.works[d.id], w=(x&&x.w)||[];
  const money=CO_KEYS.filter(c=>c[0]!==k&&o[c[0]]!=null).slice(0,2).map(c=>c[1]+" "+wonShort(o[c[0]])).join(" · ");
  if(v==null){ if(k==="app"){ const a=coAppRank(d); if(a.f||a.m) return `<div class="rev"><span class="rev-full">전체 밖</span><span class="rev-per">${[a.f?"여성 "+a.f+"위":"",a.m?"남성 "+a.m+"위":""].filter(Boolean).join(" · ")}</span></div>`; } return `<div class="rev rev-none">${lab}<br>${k==="app"?"순위 밖":"대기"}</div>`; }
  let big, small;
  if(["w1","c2","c4","c8","c12","last"].includes(k)){ big=wonFmt(v); small=money||lab; }
  else if(k==="keep"){ big=Math.round(v*100)+"%"; small=`${w.length}주차 ÷ 첫 주 다운(첫 주 1.5만 건 이상만)`; }
  else if(k==="dl2"){ big=(v>=1e4?(v/1e4).toFixed(1)+"만":v.toLocaleString())+" 건"; small=`첫 주 ${w[0].toLocaleString()}건`; }
  else if(k==="fav"){ big="관심 "+(v>=1e4?(v/1e4).toFixed(1)+"만":v.toLocaleString()); small=money||"관심 수(오늘)"; }
  else if(k==="cmt"){ big="댓글 "+Math.round(v).toLocaleString(); small="최근 5화 평균"; }
  else if(k==="app"){ const a=coAppRank(d); big=`전체 ${v}위`; small=[a.f?"여성 "+a.f+"위":"",a.m?"남성 "+a.m+"위":""].filter(Boolean).join(" · ")||"앱 「이번 주 웹툰 랭킹」"; }
  return `<div class="rev" title="${esc(lab)}"><span class="rev-full">${big}</span><span class="rev-per">${esc(small)}</span></div>`;
}
function ensureLW(){ if(LW) return Promise.resolve(); if(!lwLoading) lwLoading=fetchJSON("data/launch_weeks.json").then(d=>{LW=d;}).catch(()=>{LW={works:{}};}); return lwLoading; }
const GROUPS=[["naver","네이버웹툰",["app","appgenre","weekday","revenue","newworks","cohort","revchange","done"]],["series","시리즈",["series","promo"]]];
let group="naver";
const subLabel = s => (src==="app"||src==="appgenre") ? s : (SOURCES[src].subs().find(x=>x[0]===s)||[s,s])[1];
const varLabel = () => { const vs=SOURCES[src].variants; return vs?(vs.find(x=>x[0]===variant)||["",""])[1]:""; };
const WKORD=["","첫째","둘째","셋째","넷째","다섯째","여섯째"];
function weekLabel(w){ // 그 주 월~일 날짜범위 "9/28~10/4" (파일이 월/일요일 어느쪽 명명이든 그 주 월~일 계산)
  const p=(w||"").split("-").map(Number); if(p.length<3) return dot(w);
  const mon=weekStart(w,0); return `${mdShort(mon)}~${mdShort(addDays(mon,6))}`;  // 8/30(일)→8/24~8/30
}
function weekLabels(weeks){ const map={}; weeks.forEach(w=>map[w]=weekLabel(w)); return map; }

async function fetchJSON(p){ const r=await fetch(p,{cache:"no-cache"}); if(!r.ok) throw new Error(p+" "+r.status); return r.json(); }

async function boot(){
  try{ const sv=localStorage.getItem("wt-theme"); if(sv)document.documentElement.setAttribute("data-theme",sv); }catch(e){}
  wireTheme(); wireModal(); wireGlobalSearch();
  let idx;
  try{ idx=await fetchJSON("data/index.json"); }catch(e){ fail(); return; }
  WEEKS=idx.weeks.slice();
  const R=await Promise.allSettled([ fetchJSON(`data/${idx.latest}.json`), fetchJSON("data/weekday.json"), fetchJSON("data/lookup.json") ]);
  APP=R[0].status==="fulfilled"?R[0].value:{date:idx.latest,charts:{전체:[],여성:[],남성:[]}};
  WEEKDAY=R[1].status==="fulfilled"?R[1].value:{date:"",web:{},app:{}};
  LOOKUP=R[2].status==="fulfilled"?R[2].value:{id:{},name:{}};
  try{ for(const v of ["web","app"]) (WEEKDAY[v]&&WEEKDAY[v].dailyPlus||[]).forEach(r=>DAILYPLUS.add(r.id)); }catch(e){}

  const wsel=document.getElementById("wsel"), wl=weekLabels(WEEKS);
  wsel.innerHTML=WEEKS.slice().reverse().map(w=>`<option value="${w}">${esc(wl[w])}</option>`).join("");
  wsel.value=idx.latest;
  wsel.addEventListener("change", async ()=>{ try{ APP=await fetchJSON(`data/${wsel.value}.json`); if(src==="app"){ renderSubnav(); renderView(); } }catch(e){} });

  fetchJSON("data/origins.json").then(d=>{ ORIGINS=d; if(src && !SOURCES[src].caps.series) renderList(); }).catch(()=>{ ORIGINS={works:{}}; });
  renderGroupNav();
  document.getElementById("groupnav").addEventListener("click", e=>{ const b=e.target.closest("[data-grp]"); if(b) selectGroup(b.dataset.grp); });
  document.getElementById("srcnav").addEventListener("click", e=>{ const b=e.target.closest("[data-src]"); if(b) selectSrc(b.dataset.src); });
  selectGroup("naver");
}
function fail(){ document.getElementById("board").innerHTML=`<li class="empty">데이터를 불러오지 못했어요. 새로고침 해주세요.</li>`; }
function ensureSeries(){ if(SERIES) return Promise.resolve(); if(!seriesLoading) seriesLoading=fetchJSON("data/series.json").then(d=>{SERIES=d;}).catch(()=>{SERIES={date:"",comic:{},novel:{}};}); return seriesLoading; }
/* 앱 요일별 인기순(폰) + 날짜별 순위 기록 */
function ensureAppWd(){
  if(APPWD) return Promise.resolve();
  if(!appwdLoading) appwdLoading=Promise.all([
    fetchJSON("data/app_weekday.json").then(d=>{APPWD=d;}).catch(()=>{APPWD={date:"",tabs:{},tabDates:{}};}),
    fetchJSON("data/app_weekday_history.json").then(d=>{APPWDH=d;}).catch(()=>{APPWDH={dates:[],series:{}};}),
  ]);
  return appwdLoading;
}
/* 앱 장르 주간랭킹: index.json(주차 목록) → 최신 주 파일. 주차 드롭다운(#gwsel)도 여기서 채움 */
/* 신작 18주 추적(data/app_weekday_newtrack.json — 폰 수집기가 매일, scripts/lib/app_newtrack.cjs) */
let NTRACK=null, ntLoading=null;
function ensureNewTrack(){ if(NTRACK) return Promise.resolve(); if(!ntLoading) ntLoading=fetchJSON("data/app_weekday_newtrack.json").then(d=>{NTRACK=d;}).catch(()=>{NTRACK={dates:[],first:{},src:{},series:{}};}); return ntLoading; }
function ensureAgen(){
  if(AGEN) return Promise.resolve();
  if(!agenLoading) agenLoading=fetchJSON("data/app_genre/index.json").then(async idx=>{
    AGEN_IDX=idx; AGEN_WK=idx.latest; AGEN=await fetchJSON(`data/app_genre/${idx.latest}.json`);
    const sel=document.getElementById("gwsel"), wl=weekLabels(idx.weeks);
    sel.innerHTML=idx.weeks.slice().reverse().map(w=>`<option value="${w}">${esc(wl[w])}</option>`).join("");
    sel.value=idx.latest;
    sel.onchange=async()=>{ try{ AGEN=await fetchJSON(`data/app_genre/${sel.value}.json`); AGEN_WK=sel.value; if(src==="appgenre"){ renderSubnav(); renderView(); } }catch(e){} };
  }).catch(()=>{ AGEN={date:"",src:{},charts:{}}; AGEN_IDX={weeks:[],genres:AGEN_GENRES}; });
  return agenLoading;
}
/* 앱 장르 주간 전 주차 → AGENH = {weeks:[...], series:{장르:{id:[주차별 순위]}}} (상세 스파크라인·추이 엑셀) */
function ensureAgenHist(){
  if(AGENH) return Promise.resolve();
  if(!agenhLoading) agenhLoading=ensureAgen().then(async()=>{
    const weeks=((AGEN_IDX&&AGEN_IDX.weeks)||[]).slice().sort(), series={};
    const files=await Promise.all(weeks.map(w=>fetchJSON(`data/app_genre/${w}.json`).catch(()=>null)));
    files.forEach((f,i)=>{ if(!f||!f.charts) return; for(const g in f.charts){ const S=series[g]||(series[g]={}); for(const row of f.charts[g]){ const id=row.id!=null?row.id:LOOKUP.name[row.t]; if(id==null) continue; (S[id]||(S[id]=Array(weeks.length).fill(null)))[i]=row.r; } } });
    AGENH={weeks, series};
  }).catch(()=>{ AGENH={weeks:[],series:{}}; });
  return agenhLoading;
}
function ensurePromo(){ if(PROMO) return Promise.resolve(); if(!promoLoading) promoLoading=fetchJSON("data/promo.json").then(d=>{PROMO=d;}).catch(()=>{PROMO={date:"",comic:{},novel:{}};}); return promoLoading; }
function ensureSeriesDetails(){ if(SERIESDET&&SERIESEXTRA) return Promise.resolve(); if(!seriesDetLoading) seriesDetLoading=Promise.all([
    fetchJSON("data/series_details.json").then(d=>{SERIESDET=d;}).catch(()=>{SERIESDET={};}),
    fetchJSON("data/series_extra.json").then(d=>{SERIESEXTRA=d;}).catch(()=>{SERIESEXTRA={map:{}};})
  ]).then(()=>{ SNAMEIDX=null; }); return seriesDetLoading; }
function ensureRevHist(){ if(REVHIST) return Promise.resolve(); if(!revHistLoading) revHistLoading=fetchJSON("data/revenue_history.json").then(d=>{REVHIST=d;}).catch(()=>{REVHIST={dates:[],works:{}};}); return revHistLoading; }
/* 웹툰 무료/유료 회차수 날짜별(ep_history.json) — 매출 엑셀 Sheet1 무료/유료 열용. 오늘부터 누적, 없으면 빈값 */
function ensureEpHist(){ if(EPHIST) return Promise.resolve(); if(!epHistLoading) epHistLoading=fetchJSON("data/ep_history.json").then(d=>{EPHIST=d;}).catch(()=>{EPHIST={dates:[],works:{}};}); return epHistLoading; }
/* 관심수(favoriteCount) 일별 이력 — fav_history.json {dates:[], works:{titleId:{v:[관심수]}}}. 오늘부터 누적 */
function ensureFavHist(){ if(FAVHIST) return Promise.resolve(); if(!favHistLoading) favHistLoading=fetchJSON("data/fav_history.json").then(d=>{FAVHIST=d;}).catch(()=>{FAVHIST={dates:[],works:{}};}); return favHistLoading; }
/* 웹툰(titleId) 관심수 추이 그래프 — 매출 그래프와 동일 구조, 단일 라인 */
function favChartHtml(id){
  if(id==null || !FAVHIST || !FAVHIST.works) return "";
  const w=FAVHIST.works[String(id)]; if(!w||!w.v) return "";
  const dates=FAVHIST.dates||[], pts=dates.map((dt,i)=>[dt, w.v[i]]).filter(x=>x[1]!=null), n=pts.length;
  if(!n) return "";
  const manFmt=v=> v>=10000 ? (Math.round(v/1000)/10)+"만" : v.toLocaleString();
  if(n<2){ return `<div class="mrevbox"><div class="mrevhd"><span class="mrevt">💜 관심수 추이</span><span class="mrevn">1일차 · 내일부터 그래프가 그려져요</span></div><div class="mrevempty">매일 관심수를 기록해 증가 추이를 쌓아갑니다. 오늘 첫 기록 완료 ✓ (현재 ${pts[0][1].toLocaleString()}명)</div></div>`; }
  const W=280,H=64,pad=6, xs=i=>pad+(i/(n-1||1))*(W-2*pad);
  const arr=pts.map(x=>x[1]), mn=Math.min(...arr), mx=Math.max(...arr), span=(mx-mn)||1, ys=v=>H-pad-((v-mn)/span)*(H-2*pad);
  const d="M"+pts.map((x,i)=>xs(i).toFixed(1)+","+ys(x[1]).toFixed(1)).join(" L");
  const first=pts[0][1], last=pts[n-1][1], diff=last-first, chg= diff===0?"±0":(diff>0?"▲":"▼")+manFmt(Math.abs(diff));
  const range=`${pts[0][0].slice(5)}~${pts[n-1][0].slice(5)} · ${n}일`;
  return `<div class="mrevbox">
    <div class="mrevhd"><span class="mrevt">💜 관심수 추이</span><span class="mrevn">${range}</span></div>
    <div class="mrevrow"><div class="mrevlab"><i style="background:var(--accent)"></i>관심수</div><div class="mrevval">${last.toLocaleString()}명 <small>${chg}</small></div></div>
    <svg viewBox="0 0 ${W} ${H}" class="mrevsvg" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2"/><circle cx="${xs(n-1).toFixed(1)}" cy="${ys(last).toFixed(1)}" r="2.5" fill="var(--accent)"/></svg>
  </div>`;
}
/* 다운로드수(시리즈 다운수) 일별 추이 — revenue_history dl, 관심수 그래프와 동일 구조 단일 라인 */
function dlChartHtml(name, selfPn){
  const rv=revenueFor(name, 0, selfPn); if(!rv||!REVHIST||!REVHIST.works) return "";
  const w=REVHIST.works[rv.pn]; if(!w||!w.dl) return "";
  const dates=REVHIST.dates||[], pts=dates.map((dt,i)=>[dt, w.dl[i]]).filter(x=>x[1]!=null), n=pts.length;
  if(!n) return "";
  const cnt=v=> v>=1e8 ? (Math.round(v/1e6)/100)+"억" : v>=1e4 ? (Math.round(v/1000)/10)+"만" : v.toLocaleString();
  if(n<2){ return `<div class="mrevbox"><div class="mrevhd"><span class="mrevt">📥 다운로드수 추이</span><span class="mrevn">1일차 · 내일부터 그래프가 그려져요</span></div><div class="mrevempty">매일 시리즈 다운로드수를 기록해 증가 추이를 쌓아갑니다. 오늘 첫 기록 완료 ✓ (현재 ${cnt(pts[0][1])})</div></div>`; }
  const W=280,H=64,pad=6, xs=i=>pad+(i/(n-1||1))*(W-2*pad);
  const arr=pts.map(x=>x[1]), mn=Math.min(...arr), mx=Math.max(...arr), span=(mx-mn)||1, ys=v=>H-pad-((v-mn)/span)*(H-2*pad);
  const d="M"+pts.map((x,i)=>xs(i).toFixed(1)+","+ys(x[1]).toFixed(1)).join(" L");
  const first=pts[0][1], last=pts[n-1][1], diff=last-first, chg= diff===0?"±0":(diff>0?"▲":"▼")+cnt(Math.abs(diff));
  const range=`${pts[0][0].slice(5)}~${pts[n-1][0].slice(5)} · ${n}일`;
  return `<div class="mrevbox">
    <div class="mrevhd"><span class="mrevt">📥 다운로드수 추이</span><span class="mrevn">${range}</span></div>
    <div class="mrevrow"><div class="mrevlab"><i style="background:var(--down)"></i>다운로드수</div><div class="mrevval">${cnt(last)} <small>${chg}</small></div></div>
    <svg viewBox="0 0 ${W} ${H}" class="mrevsvg" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="var(--down)" stroke-width="2"/><circle cx="${xs(n-1).toFixed(1)}" cy="${ys(last).toFixed(1)}" r="2.5" fill="var(--down)"/></svg>
  </div>`;
}
/* 특정 작품(이름)의 매출 누적 시계열: revenueFor로 시리즈 pn 찾고 REVHIST에서 dl → 총매출, 회차당은 웹툰 총N화(epOverride)로 나눔 */
function revSeriesFor(name, epOverride, selfPn){
  const rv=revenueFor(name, 0, selfPn); if(!rv||!REVHIST||!REVHIST.works) return null;
  const w=REVHIST.works[rv.pn]; if(!w) return null;
  const dates=REVHIST.dates||[];
  const price=rv.up;
  const pts=dates.map((dt,i)=>{ const dl=w.dl[i], ep=(epOverride>0?epOverride:w.ep[i]); if(dl==null||ep==null||!ep) return {dt,total:null,per:null,deal:null,dl:null,ep:null}; const total=dl*price*0.9*0.6; return {dt,total,per:total/ep,deal:dl*price,dl,ep}; });
  const has=pts.filter(p=>p.total!=null);
  return { pts, has, kind:rv.kind };
}
/* 연재요일 매핑 + 그 날짜가 속한 '연재요일 시작 주'의 시작일(YYYY-MM-DD). dow: 0=월..6=일 */
const DOW_KO={"월":0,"화":1,"수":2,"목":3,"금":4,"토":5,"일":6};
function parseDow(dayStr){ const m=String(dayStr||"").match(/[월화수목금토일]/); return m?DOW_KO[m[0]]:0; }   // 첫 연재요일(없으면 월=0)
const dowOf = d => parseDow(DETAILS && d && d.id!=null && DETAILS[d.id] ? DETAILS[d.id].day : "");
function weekStart(dtStr, dow){ dow=dow||0; const p=(dtStr||"").split("-").map(Number); const dt=new Date(p[0],p[1]-1,p[2]); const cur=(dt.getDay()+6)%7; let diff=cur-dow; if(diff<0) diff+=7; dt.setDate(dt.getDate()-diff); return dt.getFullYear()+"-"+String(dt.getMonth()+1).padStart(2,"0")+"-"+String(dt.getDate()).padStart(2,"0"); }
function addDays(s,n){ const p=(s||"").split("-").map(Number); const d=new Date(p[0],p[1]-1,p[2]+n); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
const mdShort = s => { const p=(s||"").split("-"); return p.length<3?s:(+p[1])+"/"+(+p[2]); };  // "9/9"
/* 날짜 → 일수(보간 비율용, 시간대 무관) */
const dayNum = s => { const p=(s||"").split("-").map(Number); return Date.UTC(p[0],p[1]-1,p[2])/86400000; };
/* revenue_history 의 i번째 날짜 다운수. 그날 수집 안 된 빈 칸이면 앞뒤 실제 수집값 사이를 날짜 비례로 보간(est=true).
   뒤쪽 실제값이 아직 없으면(=아직 수집 전) null → 그 날짜로 끝나는 주는 미완성. 수집기는 안 긁은 작품을 베껴 쓰지 않고 칸을 비워 둠 */
function dlAt(w, i, dates){
  if(w.dl[i]!=null) return {v:w.dl[i], est:false};
  let a=i-1; while(a>=0 && w.dl[a]==null) a--;
  let b=i+1; while(b<dates.length && w.dl[b]==null) b++;
  if(a<0 || b>=dates.length) return null;
  const da=dayNum(dates[a]), db=dayNum(dates[b]), dx=dayNum(dates[i]);
  return {v: Math.round(w.dl[a] + (w.dl[b]-w.dl[a])*(dx-da)/((db-da)||1)), est:true};
}
/* 그 주(연재요일 S ~ S+6) 실제 발생 매출.
   ★수집일 X의 다운수 = 전날(X-1)까지 누적. 따라서 주[S,S+6] 매출 = D(수집 S+7) − D(수집 S) (연속 연재요일 경계 스냅샷 차). 회차수 = 주 마감(S+7 수집)의 시리즈 회차수.
   경계일이 수집 공백이면 보간값 사용(est). 주 마감 경계에 실제/보간 값이 없으면 그 주는 아직 미완성. 전주 대비 변동은 완전한 2주가 있을 때. */
function weeklyRevenueWeeks(name, dow, selfPn){
  const rv=revenueFor(name, 0, selfPn); if(!rv||!REVHIST||!REVHIST.works) return [];
  const w=REVHIST.works[rv.pn]; if(!w) return [];
  const dates=REVHIST.dates||[], k=rv.up*0.9*0.6, dIdx={};
  dates.forEach((dt,i)=>dIdx[dt]=i);
  // 신작 데뷔 주: 시리즈 상품이 론칭과 함께 새로 생겨 론칭 1~7일 뒤에야 첫 기록이 잡힘 → 그 전 칸은 '미수집'이 아니라 0.
  // 론칭일(=연재요일 하루 전 밤 공개)·그다음 날에 시작하는 주는 시작값 0으로 계산(첫 기록이 론칭 뒤 7일 안일 때만 — 기존 작품은 해당 없음)
  const tid=selfPn?null:(LOOKUP.name&&LOOKUP.name[name]), lm=tid&&DETAILS&&DETAILS[tid]?String(DETAILS[tid].launch||"").match(/(\d{2})\.(\d{2})\.(\d{2})/):null;
  const L=lm?`20${lm[1]}-${lm[2]}-${lm[3]}`:null, fi=w.dl.findIndex(v=>v!=null);
  const fresh=!!(L&&fi>=0&&dayNum(dates[fi])-dayNum(L)>0&&dayNum(dates[fi])-dayNum(L)<=7);
  const weeks=[];
  if(fresh && dIdx[addDays(L,1)]==null && weekStart(addDays(L,1),dow)===addDays(L,1)){   // 첫 연재요일이 다운로드 기록 시작(9/9)보다 앞인 신작: 데뷔 주도 시작값 0으로
    const S=addDays(L,1), iE=dIdx[addDays(S,7)], b=iE!=null?dlAt(w,iE,dates):null;
    if(b){ const dDl=b.v, rev=dDl*k, ep=w.ep[iE]||rv.ep||1; weeks.push({ws:S, we:addDays(S,6), rev, ep, perRev:rev/ep, deal:dDl*rv.up, dDl, est:b.est}); }
  }
  for(let iS=0; iS<dates.length; iS++){ const S=dates[iS]; if(weekStart(S,dow)!==S) continue;   // 연재요일 경계 수집일
    const iE=dIdx[addDays(S,7)]; if(iE==null) continue;                      // S+7 = 다음 연재요일(=주 마감 반영 수집일)
    let a=dlAt(w,iS,dates); const b=dlAt(w,iE,dates);
    if(fresh && S>=L && S<=addDays(L,1)) a={v:0,est:false};            // 신작 데뷔 주 시작값 = 0(론칭 밤 다운로드도 데뷔 주에 넣음 — 신작 월별 1주차와 같은 값)
    if(!a||!b) continue;       // 경계 값이 없으면(수집 전/데이터 밖) 미완성
    const dDl=b.v-a.v, rev=dDl*k, ep=w.ep[iE]||w.ep[iS]||rv.ep||1;
    weeks.push({ws:S, we:addDays(S,6), rev, ep, perRev:rev/ep, deal:dDl*rv.up, dDl, est:a.est||b.est});  // deal=주단위 거래액=(이번주누적−지난주누적 다운수)×단가
  }
  return weeks;
}
function weeklyRevenue(name, dow, weekSel, selfPn){
  const weeks=weeklyRevenueWeeks(name, dow, selfPn);
  if(!weeks.length) return null;
  let idx=weeks.length-1, lag=false;
  if(weekSel){ idx=weeks.findIndex(w=>w.ws===weekSel); if(idx<0) return null; }  // 선택한 주가 이 작품엔 없으면 제외
  else {   // 기본 보기: 이번 주기 주(연재요일 기준 최신 완료 주)만 정상 표시. 한 주기 늦으면 lag 표시, 그보다 오래됐으면(수집 중단) 옛 금액을 이번 주처럼 보이지 않게 대기
    const B=weekStart(revLastFull(), dow||0), end=addDays(weeks[idx].ws,7);
    if(end < addDays(B,-7)) return null;
    lag = end < B;
  }
  const cur=weeks[idx], prev=idx>=1?weeks[idx-1]:null;
  return { rev:cur.rev, perRev:cur.perRev, deal:cur.deal, dDl:cur.dDl, ep:cur.ep, ws:cur.ws, we:cur.we, prev,
    delta: prev?cur.rev-prev.rev:null, perDelta: prev?cur.perRev-prev.perRev:null, dealDelta: prev?cur.deal-prev.deal:null,
    sortKey: cur.deal, hasPrev:!!prev,
    est: !!cur.est, estDelta: !!(cur.est || (prev && prev.est)),   // 경계일 보간 포함 여부(이번주 / 전주대비)
    lag };   // 한 주기 늦은 주(예: 성인 수집이 아직 안 돈 날) — 행에 기간 표시
}
/* 주간 대기: 주간 데이터는 있는데 지금 보는 주가 아직 수집 전인 작품(예: 클라우드 본수집 뒤 아직 안 돈 성인 수집, 수집이 멈춘 작품).
   목록에서 빼지 않고 맨 아래 '주간 대기'로 표시. 주간 데이터 자체가 없는 작품은 기존처럼 제외 */
function revWeekPending(name, dow, S){
  if(!weeklyRevenueWeeks(name, dow).length) return false;
  if(!S) return true;   // 기본 보기: weeklyRevenue가 null(최근 주기 미수집)인 작품
  const rv=revenueFor(name); if(!rv||!REVHIST||!REVHIST.works) return false;
  const w=REVHIST.works[rv.pn]; if(!w) return false;
  const dates=REVHIST.dates||[], iS=dates.indexOf(S), iE=dates.indexOf(addDays(S,7));
  return iS>=0 && iE>=0 && !!dlAt(w,iS,dates) && !dlAt(w,iE,dates);   // 선택 주: 시작 경계값은 있는데 마감 경계값이 아직 수집 전
}
/* 매출변동 탭 라벨: 전체/성인/매일+ = 주차(9월 N째주), 요일별 = 정확 날짜(9/9~9/15) */
const SUB_DOW={mon:0,tue:1,wed:2,thu:3,fri:4,sat:5,sun:6};
/* 클라우드 본수집이 끝난 마지막 날짜. 그 뒤 날짜 칸은 오전 부분수집(일부 작품만)이라 주 마감 기준으로 쓰지 않음. 없으면(구버전 데이터) 마지막 날짜 */
function revLastFull(){ const dates=(REVHIST&&REVHIST.dates)||[]; return (REVHIST&&REVHIST.lastFull) || dates[dates.length-1] || isoToday(); }
/* 그 연재요일의 완전한 주(주 마감 날짜까지 본수집이 끝난 주) 시작일 목록, 최신 먼저 */
function revWeekOptions(dow){
  const dates=(REVHIST&&REVHIST.dates)||[]; const set=new Set(dates), lastFull=revLastFull();
  const out=[];
  for(const dt of dates){ const e=addDays(dt,7); if(weekStart(dt,dow)===dt && set.has(e) && e<=lastFull) out.push(dt); }
  return out.reverse();
}
function revWeekLabel(){
  const latest=revLastFull();
  if(sub in SUB_DOW){ const S = revWeek || revWeekOptions(SUB_DOW[sub])[0] || weekStart(addDays(latest,-7), SUB_DOW[sub]); return `${mdShort(S)}~${mdShort(addDays(S,6))}`; }
  return weekLabel(addDays(latest,-1));
}
/* 매출변동 주 선택 드롭다운: 요일 서브에서만 표시, 그 요일의 완전한 주 목록 */
function renderRevWsel(){
  const sel=document.getElementById("revwsel"); if(!sel) return;
  if(src!=="revchange" || !(sub in SUB_DOW)){ sel.hidden=true; revWeek=""; return; }
  const opts=revWeekOptions(SUB_DOW[sub]);
  if(!opts.includes(revWeek)) revWeek = opts[0] || "";
  sel.hidden=false;
  sel.innerHTML = opts.length ? opts.map(S=>`<option value="${S}"${S===revWeek?" selected":""}>${mdShort(S)}~${mdShort(addDays(S,6))}</option>`).join("") : `<option value="">주 데이터 없음</option>`;
  sel.onchange=()=>{ revWeek=sel.value; renderList(); };
}
function isoToday(){ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
/* 거래액 추이: 총거래액(일별)·회차당(일별)·주단위 거래액(주차별 변동 추이) */
function revChartHtml(name, dow, selfPn){
  const rs=revSeriesFor(name, 0, selfPn);
  if(!rs) return "";
  const n=rs.has.length;
  if(n<2){ return `<div class="mrevbox"><div class="mrevhd"><span class="mrevt">💰 거래액 추이</span><span class="mrevn">${n?"1일차 · 내일부터 그래프가 그려져요":"수집 시작 전"}</span></div><div class="mrevempty">매일 새벽 자동으로 다운수·회차수를 기록해 총거래액·회차당·주단위 거래액 변화를 쌓아갑니다. ${n?"오늘 첫 기록 완료 ✓":""}</div>${n?`<button class="mepbtn" data-rev="1" data-name="${esc(name)}" data-dow="${dow||0}" data-pn="${selfPn||0}">⬇ 거래액 엑셀 (일별+주간)</button>`:""}</div>`; }
  const mkLine=(vals,color)=>{
    const W=280,H=64,pad=6, xs=v=>pad+(v/(rs.pts.length-1||1))*(W-2*pad);
    const idx=rs.pts.map((p,i)=>[i,p]).filter(x=>x[1].total!=null);
    const arr=idx.map(x=>vals(x[1])), mn=Math.min(...arr), mx=Math.max(...arr), span=(mx-mn)||1;
    const ys=v=>H-pad-((v-mn)/span)*(H-2*pad);
    const d="M"+idx.map(x=>xs(x[0]).toFixed(1)+","+ys(vals(x[1])).toFixed(1)).join(" L");
    const last=idx[idx.length-1];
    return `<svg viewBox="0 0 ${W} ${H}" class="mrevsvg" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${color}" stroke-width="2"/><circle cx="${xs(last[0]).toFixed(1)}" cy="${ys(vals(last[1])).toFixed(1)}" r="2.5" fill="${color}"/></svg>`;
  };
  // 주단위 거래액 주차별 추이선
  const weeks=weeklyRevenueWeeks(name, dow||0, selfPn);
  const mkWeekLine=()=>{
    if(!weeks.length) return `<div class="mrevempty" style="padding:6px 0">완전한 한 주가 지나면 주차별 추이가 그려져요 (연재요일 기준)</div>`;
    const W=280,H=64,pad=6, xs=i=>pad+(i/(weeks.length-1||1))*(W-2*pad);
    const arr=weeks.map(w=>w.deal), mn=Math.min(...arr,0), mx=Math.max(...arr), span=(mx-mn)||1, ys=v=>H-pad-((v-mn)/span)*(H-2*pad);
    const li=weeks.length-1;
    if(weeks.length===1) return `<svg viewBox="0 0 ${W} ${H}" class="mrevsvg" preserveAspectRatio="none"><circle cx="${xs(0).toFixed(1)}" cy="${ys(weeks[0].deal).toFixed(1)}" r="3" fill="var(--up)"/></svg>`;
    const d="M"+weeks.map((w,i)=>xs(i).toFixed(1)+","+ys(w.deal).toFixed(1)).join(" L");
    return `<svg viewBox="0 0 ${W} ${H}" class="mrevsvg" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="var(--up)" stroke-width="2"/><circle cx="${xs(li).toFixed(1)}" cy="${ys(weeks[li].deal).toFixed(1)}" r="2.5" fill="var(--up)"/></svg>`;
  };
  const first=rs.has[0], lastP=rs.has[n-1];
  const chg=(a,b)=> b===a?"±0":(b>a?"▲":"▼")+wonFmt(Math.abs(b-a));
  const range=`${rs.has[0].dt.slice(5)}~${lastP.dt.slice(5)} · ${n}일`;
  const wr=weeklyRevenue(name, dow, "", selfPn);
  const wcBanner = wr
    ? `<div class="mwc ${wr.hasPrev?(wr.dealDelta>0?"rc-up":wr.dealDelta<0?"rc-down":"rc-same"):"rc-same"}"><span class="mwclab">📊 주단위 거래액 (${mdShort(wr.ws)}~${mdShort(wr.we)}, 연재요일 기준)</span><span class="mwcval">${wr.est?"≈":""}${wonFmt(wr.deal)}</span><span class="mwcsub">${wr.hasPrev?`전주 대비 ${wr.estDelta?"≈":""}${wr.dealDelta>0?"▲":wr.dealDelta<0?"▼":"±"}${wonFmt(Math.abs(wr.dealDelta))}`:`전주 대비는 다음 주부터`}${wr.estDelta?" · ≈ 수집이 비었던 날은 앞뒤 값으로 보간한 추정치":""}</span></div>`
    : `<div class="mwc rc-same"><span class="mwclab">📊 주단위 거래액</span><span class="mwcsub">${weeks.length?"이번 주기 다운수가 아직 수집되지 않았어요 (아래 주차별 추이는 마지막 수집분까지)":"완전한 한 주가 지나면 표시돼요 (연재요일 기준, 수집 지연 반영)"}</span></div>`;
  const wLast = weeks.length?weeks[weeks.length-1]:null;
  return `<div class="mrevbox">
    <div class="mrevhd"><span class="mrevt">💰 거래액 추이</span><span class="mrevn">${range}</span></div>
    ${wcBanner}
    <div class="mrevrow"><div class="mrevlab"><i style="background:var(--accent)"></i>총거래액</div><div class="mrevval">${wonFmt(lastP.deal)} <small>${chg(first.deal,lastP.deal)}</small></div></div>
    ${mkLine(p=>p.deal,"var(--accent)")}
    <div class="mrevrow"><div class="mrevlab"><i style="background:var(--down)"></i>회차당</div><div class="mrevval">${wonFmt(lastP.per)} <small>${chg(first.per,lastP.per)}</small></div></div>
    ${mkLine(p=>p.per,"var(--down)")}
    <div class="mrevrow"><div class="mrevlab"><i style="background:var(--up)"></i>주단위 거래액</div><div class="mrevval">${wLast?(wLast.est?"≈":"")+wonFmt(wLast.deal):"–"} <small>${weeks.length>=2?((wLast.est||weeks[weeks.length-2].est)?"≈":"")+chg(weeks[weeks.length-2].deal,wLast.deal):"주차별 변동"}</small></div></div>
    ${mkWeekLine()}
    <button class="mepbtn" data-rev="1" data-name="${esc(name)}" data-dow="${dow||0}" data-pn="${selfPn||0}">⬇ 거래액 엑셀 (일별+주간)</button>
  </div>`;
}
/* 매출 누적 엑셀: Sheet1=날짜별 누적, Sheet2=주간 발생 매출(연재요일 기준)·전주 대비 변동 */
function exportRevXLSX(name, dow, selfPn){
  if(!window.MiniXlsx){ alert("엑셀 모듈 로딩 실패 — 새로고침 후 다시 시도해주세요."); return; }
  const rs=revSeriesFor(name, 0, selfPn);
  if(!rs||!rs.has.length){ alert("아직 이 작품의 거래액 데이터가 없어요.\n매일 새벽 자동으로 쌓입니다."); return; }
  const sheets=[];
  // 무료/유료(웹툰 회차목록 기준, ep_history 9/16부터 누적) 날짜별 조인. 시리즈 탭에서 열면 name이 시리즈 제목('더 복서 [독점]')이라 정규화 이름으로도 찾음
  let wid = LOOKUP.name ? LOOKUP.name[name] : null;
  if(wid==null && LOOKUP.name){ const n=normName(name); for(const k in LOOKUP.name){ if(normName(k)===n){ wid=LOOKUP.name[k]; break; } } }
  const ephMap = {};
  if(EPHIST && EPHIST.works && wid!=null && EPHIST.works[wid]){ const ew=EPHIST.works[wid], ed=EPHIST.dates||[]; ed.forEach((dt,i)=>{ ephMap[dt]={f:ew.f[i], p:ew.p[i]}; }); }
  // Sheet1: 날짜별 누적. 총회차수=시리즈 회차수(회차당 계산 기준) · 웹툰 총화/무료/유료=그날 웹툰 회차목록(무료+유료=웹툰 총화).
  // 예전엔 무료=시리즈 회차수−유료로 계산 → 시리즈 회차수가 웹툰과 다른 날(수집 시각 차이·다른 판본 매칭)엔 무료가 틀리거나 0이 됐음
  const rows=[["날짜","다운수","총회차수(시리즈)","웹툰 총화","무료회차","유료회차","총거래액(원)","회차당(원)"]];
  for(const p of rs.pts){ if(p.total==null) continue; const e=ephMap[p.dt]||{}; const has=e.p!=null&&e.f!=null;
    rows.push([p.dt, p.dl, p.ep, has?e.f+e.p:"", has?e.f:"", has?e.p:"", Math.round(p.deal), Math.round(p.per)]); }
  sheets.push({name:"일별 누적", rows});
  // Sheet2: 주간 발생 매출(연재요일 주간) + 전주 대비 변동 금액·비율
  const weeks=weeklyRevenueWeeks(name, dow||0, selfPn);
  const wk=[["주간(연재요일 기준)","주단위 거래액(원)","전주대비(원)","전주대비(%)","비고"]];
  weeks.forEach((c,i)=>{ const p=i>0?weeks[i-1]:null;
    const dDeal=p?c.deal-p.deal:null, pctDeal=(p&&p.deal)?(dDeal/p.deal*100):null;
    wk.push([`${mdShort(c.ws)}~${mdShort(c.we)}`, Math.round(c.deal),
      p?Math.round(dDeal):"", pctDeal!=null?(pctDeal>=0?"+":"")+pctDeal.toFixed(1)+"%":"",
      c.est?"주 경계일 보간(수집 공백 추정)":(p&&p.est?"전주 경계일 보간(추정)":"")]);
  });
  if(wk.length===1) wk.push(["완전한 한 주가 끝나면 표시됩니다 (연재요일 기준, 수집 지연 반영)","","","",""]);
  sheets.push({name:"주간 발생매출", rows:wk});
  MiniXlsx.downloadMulti(sheets, name+"_매출");
}
function seriesDetailHtml(sd){
  const info=[];
  if(sd.g) info.push(["장르", sd.g]);
  if(sd.ep) info.push(["회차", sd.ep+"화"+(sd.status?" · "+sd.status:"")]);
  if(sd.dl) info.push(["다운로드", sd.dl]);
  if(sd.star) info.push(["평점", "★ "+sd.star]);
  if(sd.cmt) info.push(["댓글", sd.cmt+"개"]);
  let h="";
  if(info.length) h+=`<div class="mrows">`+info.map(([k,v])=>`<div class="mrow"><span class="mk">${k}</span><span class="mv">${esc(v)}</span></div>`).join("")+`</div>`;
  const kws=(sd.k||[]);
  if(kws.length) h+=`<div class="mkw">`+kws.map(t=>`<span class="kw">#${esc(t)}</span>`).join("")+`</div>`;
  if(sd.syn) h+=`<p class="msyn">${esc(sd.syn)}</p>`;
  return h||'<div class="mloading">상세 정보 없음</div>';
}
function setupSeriesCtl(){
  const cats=SERIES_CATNAMES[variant]||["전체장르"];
  if(!cats.includes(scat)) scat=cats[0];
  const pn=document.getElementById("platnav");
  pn.innerHTML=SERIES_PLATS.map(([c,l])=>`<button class="var" role="tab" data-plat="${c}" aria-selected="${c===platform}">${l}</button>`).join("");
  pn.onclick=e=>{ const b=e.target.closest("[data-plat]"); if(!b)return; platform=b.dataset.plat; [...pn.children].forEach(c=>c.setAttribute("aria-selected",c===b)); renderView(); };
  const cs=document.getElementById("scatsel");
  cs.innerHTML=cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
  cs.value=scat;
  cs.onchange=()=>{ scat=cs.value; renderView(); };
}

function renderGroupNav(){
  document.getElementById("groupnav").innerHTML=GROUPS.map(([k,lab])=>`<button class="grp" role="tab" data-grp="${k}" aria-selected="${k===group}">${lab}</button>`).join("");
}
function selectGroup(g){
  group=g;
  document.querySelectorAll("#groupnav .grp").forEach(b=>b.setAttribute("aria-selected", b.dataset.grp===g));
  const srcs=(GROUPS.find(x=>x[0]===g)||GROUPS[0])[2];
  const srcrow=document.getElementById("srcrow"), sn=document.getElementById("srcnav");
  if(srcs.length>1){ srcrow.hidden=false; sn.innerHTML=srcs.map(k=>`<button class="src" role="tab" data-src="${k}" aria-selected="false">${SOURCES[k].label}</button>`).join(""); }
  else { srcrow.hidden=true; sn.innerHTML=""; }
  selectSrc(srcs[0]);
}
function selectSrc(k){
  src=k; fMode="all"; sMode=((SOURCES[k].caps.revenue||SOURCES[k].caps.revchange||SOURCES[k].caps.cohort)&&SOURCES[k].sorts[0]&&SOURCES[k].sorts[0][0])?SOURCES[k].sorts[0][0]:"rank"; query="";
  document.querySelectorAll("#srcnav .src").forEach(b=>b.setAttribute("aria-selected", b.dataset.src===k));
  document.getElementById("wsel").style.display=(k==="app"&&WEEKS.length>1)?"":"none";
  document.getElementById("gwsel").style.display=(k==="appgenre"&&AGEN_IDX&&AGEN_IDX.weeks.length>1)?"":"none";
  const vs=SOURCES[k].variants; variant = vs?vs[0][0]:null;
  if(SOURCES[k].caps.gsort) sMode="pop";   // 요일별 › 앱: 인기순부터
  const vn=document.getElementById("varnav");
  if(vs){ vn.hidden=false; vn.innerHTML=vs.map(([code,lab],i)=>`<button class="var" role="tab" data-var="${code}" aria-selected="${i===0}">${lab}</button>`).join("");
    vn.onclick=e=>{ const b=e.target.closest("[data-var]"); if(!b)return; variant=b.dataset.var; [...vn.children].forEach(c=>c.setAttribute("aria-selected",c===b)); if(k==="series") setupSeriesCtl();
      const ss=SOURCES[k].subs(); if(!ss.some(x=>x[0]===sub)){ sub=ss[0][0]; } renderSubnav();   // 요일별 앱/웹은 서브 탭이 다름(앱만 '전체')
      renderView(); };
  } else { vn.hidden=true; vn.innerHTML=""; }
  document.getElementById("seriesctl").hidden = k!=="series";
  const subs=SOURCES[k].subs(); sub=subs[0][0];
  const sn=document.getElementById("subnav");
  renderSubnav();
  sn.onclick=e=>{ const b=e.target.closest("[data-sub]"); if(!b)return; sub=b.dataset.sub; renderSubnav(); renderView(); };
  document.getElementById("q").value="";
  if(k==="series" && !SERIES){ document.getElementById("board").innerHTML=`<li class="empty">시리즈 불러오는 중…</li>`; ensureSeries().then(()=>{ setupSeriesCtl(); renderView(); }); return; }
  if(k==="cohort" && (!LW||!SERIESDET||!DETAILS)){ document.getElementById("board").innerHTML=`<li class="empty">불러오는 중…</li>`; Promise.all([ensureLW(), ensureSeriesDetails(), ensureDetails()]).then(()=>{ if(src!=="cohort") return; sub=SOURCES.cohort.subs()[0][0]; renderSubnav(); renderView(); }); return; }
  if(k==="weekday" && !APPWD){ document.getElementById("board").innerHTML=`<li class="empty">불러오는 중…</li>`; ensureAppWd().then(()=>{ if(src==="weekday"){ renderSubnav(); renderView(); } }); return; }
  if(k==="appgenre" && !AGEN){ document.getElementById("board").innerHTML=`<li class="empty">불러오는 중…</li>`; ensureAgen().then(()=>{ if(src!=="appgenre") return; document.getElementById("gwsel").style.display=(AGEN_IDX&&AGEN_IDX.weeks.length>1)?"":"none"; renderSubnav(); renderView(); }); return; }
  if(k==="promo" && !PROMO){ document.getElementById("board").innerHTML=`<li class="empty">불러오는 중…</li>`; ensurePromo().then(()=>renderView()); return; }
  if((k==="revenue"||k==="newworks"||k==="revchange"||k==="done") && (!SERIES||!SERIESDET||!DETAILS||((k==="revchange"||k==="newworks")&&!REVHIST))){ document.getElementById("board").innerHTML=`<li class="empty">${k==="newworks"?"신작":k==="revchange"?"매출 변동":k==="done"?"완결":"매출"} 데이터 불러오는 중…</li>`; Promise.all([ensureSeries(),ensureSeriesDetails(),ensureDetails(),ensureRevHist()]).then(()=>{ SNAMEIDX=null; renderView(); }); return; }
  if(k==="series") setupSeriesCtl();
  renderView();
}

function renderSubnav(){
  const subs=SOURCES[src].subs();
  const wk=src==="app"||src==="appgenre";   // 차트 이름 + 작품 수
  document.getElementById("subnav").innerHTML=subs.map(([code,lab])=>`<button class="sub" role="tab" data-sub="${code}" aria-selected="${code===sub}">${wk?code:lab}${wk?`<small>${lab}</small>`:""}</button>`).join("");
}
/* enrich: 모바일 행({r,id})은 lookup으로 제목/썸네일/작가 채움. 시리즈는 자체 필드 사용 */
function enrichRow(d){
  if(SOURCES[src].caps.series) return { r:d.r, name:d.t, a:d.a||"", th:d.th||"", id:d.id, m:d.m||0, s:0, b:d.b||[] };
  let id = d.id!=null ? d.id : (d.t!=null ? LOOKUP.name[d.t] : null);
  const info = id!=null ? LOOKUP.id[id] : null; // [name, thumb, author]
  return {
    r:d.r,
    name: d.t!=null ? d.t : (info?info[0]:"#"+id),
    a: (d.a!=null&&d.a!=="") ? d.a : (info?info[2]:""),
    th: d.th || (info?info[1]:""),
    id, m:d.m||0, s:d.s||0, b:d.b||[]
  };
}
function viewRows(){ return (SOURCES[src].data(variant,sub)||[]).map(enrichRow); }

function renderView(){
  const S=SOURCES[src], caps=S.caps;
  renderRevWsel();   // 매출변동 주 선택 드롭다운(요일 서브에서만) — revWeek 확정 후 meta/list
  renderAwDate();    // 요일별 › 앱 날짜(달력)
  document.getElementById("meta").innerHTML=`${esc(S.note(variant))} · <b>${esc(subLabel(sub))}</b>`;
  document.getElementById("tiles").hidden=!(caps.tiles||caps.newtiles||caps.gtiles||caps.wtiles);
  document.getElementById("wpanels").hidden=!caps.wtiles;
  document.getElementById("gpanels").hidden=!caps.gtiles;
  document.getElementById("panels").hidden=!caps.tiles;
  document.getElementById("ntop").hidden=!caps.newtiles;
  document.getElementById("cohort").hidden=!caps.cohort; if(caps.cohort) renderCohort();
  document.getElementById("gapPanel").hidden=!caps.gap;
  if(caps.tiles) renderStats(); else if(caps.newtiles) renderNewTiles(); else if(caps.gtiles) renderGenreSummary(); else if(caps.wtiles) renderWeekdaySummary();
  if(caps.gap) renderGap();
  renderControls();
  renderList();
}
function renderControls(){
  const fEl=document.getElementById("filters"), sEl=document.getElementById("sorts");
  fEl.innerHTML=SOURCES[src].filters.map(([k,l])=>`<button class="chip" data-f="${k}" aria-pressed="${k===fMode}">${l}</button>`).join("");
  sEl.innerHTML=SOURCES[src].sorts.map(([k,l])=>`<button class="chip" data-s="${k}" aria-pressed="${k===sMode}">${l}</button>`).join("");
  fEl.onclick=e=>{ const b=e.target.closest("[data-f]"); if(!b)return; fMode=b.dataset.f; [...fEl.children].forEach(c=>c.setAttribute("aria-pressed",c===b)); renderList(); };
  sEl.onclick=e=>{ const b=e.target.closest("[data-s]"); if(!b)return; sMode=b.dataset.s; [...sEl.children].forEach(c=>c.setAttribute("aria-pressed",c===b));
    if(SOURCES[src].caps.gsort){ renderView(); return; }   // 요일별 › 앱 정렬은 데이터 자체가 바뀜 → 설명 줄까지 다시
    if(sMode==="revenue" && (!SERIES||!SERIESDET||!DETAILS)){ document.getElementById("board").innerHTML=`<li class="empty">시리즈 매출 데이터 불러오는 중…</li>`; Promise.all([ensureSeries(),ensureSeriesDetails(),ensureDetails()]).then(()=>{ SNAMEIDX=null; renderList(); }); return; }
    renderList(); };
}
document.getElementById("q").addEventListener("input", e=>{ query=e.target.value.trim().toLowerCase(); renderList(); });

function renderStats(){
  const D=viewRows(), caps=SOURCES[src].caps;
  const up=[...D].filter(d=>d.m>0).sort((a,b)=>b.m-a.m), down=[...D].filter(d=>d.m<0).sort((a,b)=>a.m-b.m);
  const news=D.filter(d=>d.b.includes("신작")||d.b.includes("진입")||d.b.includes("신규")), streaks=[...D].filter(d=>d.s>0).sort((a,b)=>b.s-a.s);
  const tu=up[0],td=down[0],ts=streaks[0];
  const tiles=[
    {lab:"▲ 최대 상승",cls:"up",big:tu?esc(tu.name):"—",sub:tu?`${tu.r}위 · ▲${tu.m}`:""},
    {lab:"▼ 최대 하락",cls:"down",big:td?esc(td.name):"—",sub:td?`${td.r}위 · ▼${Math.abs(td.m)}`:""},
    {lab:"🆕 신작·진입",cls:"acc",big:`${news.length}작품`,sub:news.slice(0,2).map(n=>n.name).join(", ")+(news.length>2?" 외":"")},
    caps.streak?{lab:"👑 최장 연속",cls:"acc",big:ts?`${ts.s}주`:"—",sub:ts?esc(ts.name):""}
               :{lab:"📈 상승 작품",cls:"acc",big:`${up.length}작품`,sub:`하락 ${down.length} · 유지 ${D.filter(d=>d.m===0).length}`}
  ];
  document.getElementById("tiles").innerHTML=tiles.map(t=>`<div class="tile"><div class="lab">${t.lab}</div><div class="big ${t.cls}">${t.big}</div><div class="sub2">${esc(t.sub)}</div></div>`).join("");
  // 전체 앱주간 랭킹 작품이 남/여 순위 어디에 올랐나: 남성만 / 동시 / 여성만 (전체 차트 기준)
  const AL=(APP&&APP.charts["전체"])||[], MS=new Set(((APP&&APP.charts["남성"])||[]).map(x=>x.t)), FS=new Set(((APP&&APP.charts["여성"])||[]).map(x=>x.t));
  let mo=0,fo=0,bo=0; for(const x of AL){ const im=MS.has(x.t),iff=FS.has(x.t); if(im&&iff)bo++; else if(im)mo++; else if(iff)fo++; }
  const gtot=AL.length||1, pc=n=>Math.round(n/gtot*100);
  document.getElementById("distbar").innerHTML=`<span style="background:var(--down);width:${mo/gtot*100}%"></span><span style="background:var(--same);width:${bo/gtot*100}%"></span><span style="background:var(--up);width:${fo/gtot*100}%"></span>`;
  document.getElementById("distleg").innerHTML=`<span><i style="background:var(--down)"></i>남성순위 <b>${pc(mo)}%</b></span><span><i style="background:var(--same)"></i>동시 <b>${pc(bo)}%</b></span><span><i style="background:var(--up)"></i>여성순위 <b>${pc(fo)}%</b></span>`;
}
/* 신작 요약 타일 — 지금 보는 기간(6주 등) 신작 중 주간 거래액 1위 · 전주 대비 최대 상승/하락 · 상승률 1위 */
function renderNewTiles(){
  const rows=viewRows().map(d=>({d, wr:weeklyRevenue(d.name, dowOf(d), "")})).filter(x=>x.wr);
  const day=d=>{ const lt=parseLaunch(DETAILS&&DETAILS[d.id]&&DETAILS[d.id].launch); return lt?Math.floor((Date.now()-lt)/86400000)+1:null; };
  const pick=(arr,f)=>arr.filter(x=>f(x)!=null&&isFinite(f(x))).sort((a,b)=>f(b)-f(a))[0];
  const best=pick(rows,x=>x.wr.deal>0?x.wr.deal:null);
  const up=pick(rows,x=>x.wr.dealDelta>0?x.wr.dealDelta:null);
  const dn=pick(rows,x=>x.wr.dealDelta<0?-x.wr.dealDelta:null);
  const rate=x=>(x.wr.prev&&x.wr.prev.deal>=1e6&&x.wr.dealDelta>0)?x.wr.dealDelta/x.wr.prev.deal:null;   // 전주 100만 원 이상인 작품만(작은 기준값 착시 방지)
  const rt=pick(rows,rate);
  const nm=x=>x?esc(x.d.name):"—", dd=x=>(x&&day(x.d))?` · 론칭 ${day(x.d)}일차`:"";
  const tiles=[
    {lab:"💰 주간 거래액 1위",cls:"acc",big:nm(best),sub:best?`${wonFmt(best.wr.deal)}${dd(best)}`:"아직 한 주가 안 쌓였어요"},
    {lab:"▲ 최대 상승 (전주 대비)",cls:"up",big:nm(up),sub:up?`▲${wonFmt(up.wr.dealDelta)} · 이번주 ${wonFmt(up.wr.deal)}`:"2주 이상 쌓인 작품 없음"},
    {lab:"▼ 최대 하락 (전주 대비)",cls:"down",big:nm(dn),sub:dn?`▼${wonFmt(-dn.wr.dealDelta)} · 이번주 ${wonFmt(dn.wr.deal)}`:"하락한 작품 없음"},
    {lab:"📈 상승률 1위",cls:"up",big:nm(rt),sub:rt?`+${Math.round(rate(rt)*100)}% · 이번주 ${wonFmt(rt.wr.deal)}${dd(rt)}`:"전주 100만 원 이상 중 상승 없음"}
  ];
  document.getElementById("tiles").innerHTML=tiles.map(t=>`<div class="tile"><div class="lab">${t.lab}</div><div class="big ${t.cls}">${t.big}</div><div class="sub2">${esc(t.sub)}</div></div>`).join("");
  renderNtop();
}
/* 신작 거래액 TOP 10 판(요약 칸 아래). 기준: 이번 주(작품별 연재요일 주) 또는 론칭일에 맞춘 N주차(그 주만 / N주 누적).
   론칭 N주차 = 론칭일 L부터 7일씩. 수집일 X의 다운수 = X-1까지 누적이라 N주차 다운 = D(L+7N) − D(L+7(N-1)).
   신작 시리즈는 론칭 1~3일 뒤에 처음 잡히고 그 전엔 상품이 없으므로 론칭일 누적=0으로 봄(첫 기록이 론칭 뒤 7일 안일 때만). 누르면 작품 상세, '전체 보기'로 펼침 */
let NTOP_BASIS="now", NTOP_MODE="week", NTOP_ALL=false;
const launchIso = d => { const m=String(DETAILS&&DETAILS[d.id]&&DETAILS[d.id].launch||"").match(/(\d{2})\.(\d{2})\.(\d{2})/); return m?`20${m[1]}-${m[2]}-${m[3]}`:null; };
function launchWeekDeals(d){
  const rv=revenueFor(d.name); if(!rv||!REVHIST||!REVHIST.works) return [];
  const w=REVHIST.works[rv.pn], L=launchIso(d); if(!w||!L) return [];
  const dates=REVHIST.dates||[], idx={}; dates.forEach((x,i)=>idx[x]=i);
  const fi=w.dl.findIndex(v=>v!=null); if(fi<0) return [];
  const lag=dayNum(dates[fi])-dayNum(L), fresh=lag>0&&lag<=7;   // 론칭 뒤 7일 안에 처음 잡힌 새 상품
  const L1=addDays(L,1);   // 연재요일 주(론칭 다음날 시작)에 맞춤 — 일반 주간 거래액·신작 월별과 같은 구간
  const at=dt=>{ if(fresh && dt<=L1) return {v:0,est:false}; const i=idx[dt]; if(i==null||i<fi) return null; return dlAt(w,i,dates); };
  const out=[];
  for(let k=1;k<=6;k++){ const a=at(addDays(L1,7*(k-1))), b=at(addDays(L1,7*k)); if(!a||!b) break; const dDl=b.v-a.v; out.push({k, dDl, deal:dDl*rv.up, est:a.est||b.est}); }
  return out;
}
function renderNtop(){
  const el=document.getElementById("ntop"); if(!el) return;
  const day=d=>{ const lt=parseLaunch(DETAILS&&DETAILS[d.id]&&DETAILS[d.id].launch); return lt?Math.floor((Date.now()-lt)/86400000)+1:null; };
  const N=NTOP_BASIS==="now"?0:+NTOP_BASIS;
  let items;
  if(!N){
    items=viewRows().map(d=>{ const wr=weeklyRevenue(d.name, dowOf(d), ""); return wr&&wr.deal>0?{d, v:wr.deal, est:wr.est, ch:wr.dealDelta, chLab:"전주", tip:`${mdShort(wr.ws)}~${mdShort(wr.we)} 주`}:null; }).filter(Boolean);
  } else {
    items=viewRows().map(d=>{ const W=launchWeekDeals(d); if(W.length<N) return null; const cur=W[N-1], prev=W[N-2];
      const v=NTOP_MODE==="cum"?W.slice(0,N).reduce((s,x)=>s+x.deal,0):cur.deal;
      const L=launchIso(d);
      return {d, v, est:W.slice(0,N).some(x=>x.est), ch:NTOP_MODE==="cum"?null:(prev?cur.deal-prev.deal:null), chLab:`${N-1}주차`, tip:NTOP_MODE==="cum"?`론칭 ${mdShort(L)} · 1~${N}주 ${mdShort(addDays(L,1))}~${mdShort(addDays(L,7*N))}`:`론칭 ${mdShort(L)} · ${N}주차 ${mdShort(addDays(L,7*(N-1)+1))}~${mdShort(addDays(L,7*N))}`}; }).filter(x=>x&&x.v>0);
  }
  items.sort((a,b)=>b.v-a.v);
  NTOP=NTOP_ALL?items:items.slice(0,10);
  const title=!N?"주간 거래액":NTOP_MODE==="cum"?`론칭 ${N}주 누적 거래액`:`론칭 ${N}주차 거래액`;
  const rowHtml=(x,i)=>{ const c=x.ch==null?"same":x.ch>0?"up":x.ch<0?"down":"same";
    const ct=NTOP_MODE==="cum"&&N?"":x.ch==null?(N===1?"첫 주":`${x.chLab} 없음`):(x.ch>0?"▲":x.ch<0?"▼":"±")+wonFmt(Math.abs(x.ch));
    return `<button class="nrow ${i<3?"top":""}" data-k="${i}" title="${esc(x.d.name)} · ${esc(x.tip)}${x.ch!=null?" · "+x.chLab+" 대비":""}"><span class="nr">${i+1}</span><span class="nt">${esc(x.d.name)}</span><span class="nd">${x.est?"≈":""}${wonFmt(x.v)}</span><span class="nc ${c}">${ct}</span><span class="nl">${day(x.d)?day(x.d)+"일차":""}</span></button>`; };
  const chips=[["now","이번 주"],...[1,2,3,4,5,6].map(k=>[String(k),k+"주차"])].map(([k,l])=>`<button class="chip" data-nb="${k}" aria-pressed="${k===NTOP_BASIS}">${l}</button>`).join("");
  const modes=N?`<span class="nsep"></span><button class="chip" data-nm="week" aria-pressed="${NTOP_MODE==="week"}">그 주만</button><button class="chip" data-nm="cum" aria-pressed="${NTOP_MODE==="cum"}">${N}주 누적</button>`:"";
  const note=!N?"작품마다 자기 연재요일 기준 최근 한 주 · 전주 대비":`론칭일에 맞춘 비교 · 론칭 ${N*7}일 넘은 신작 ${items.length}개${NTOP_MODE==="cum"?` · 론칭 후 ${N}주 합계`:N===1?" · 론칭 첫 7일":` · ${N-1}주차 대비`}`;
  el.innerHTML=`<div class="lab">${title} ${NTOP_ALL?"전체":"TOP 10"} · 런칭 ${sub}일 이내 신작</div><div class="nbasis">${chips}${modes}</div><div class="nnote">${esc(note)}</div>`
    +(NTOP.length?`<div class="nlist" style="--nrows:${Math.max(1,Math.ceil(NTOP.length/2))}">${NTOP.map(rowHtml).join("")}</div>`:`<div class="nempty">${N?`론칭 ${N*7}일이 지난 신작이 아직 없어요.`:"아직 한 주가 쌓인 신작이 없어요."}</div>`)
    +(items.length>10?`<button class="nmore" data-nall="1">${NTOP_ALL?"접기 ▴":`전체 보기 (${items.length}개) ▾`}</button>`:"");
  el.onclick=e=>{
    const nb=e.target.closest("[data-nb]"); if(nb){ NTOP_BASIS=nb.dataset.nb; renderNtop(); return; }
    const nm=e.target.closest("[data-nm]"); if(nm){ NTOP_MODE=nm.dataset.nm; renderNtop(); return; }
    if(e.target.closest("[data-nall]")){ NTOP_ALL=!NTOP_ALL; renderNtop(); return; }
    const b=e.target.closest("[data-k]"); if(b&&NTOP[+b.dataset.k]) openModal({...NTOP[+b.dataset.k].d, _rk:+b.dataset.k+1});
  };
}
/* 앱 장르 주간 요약 — 이 장르 순위 작품 중 앱 주간(전체·여성·남성) TOP100에 든 작품, 주간 거래액 상위, 여성/남성 선호.
   탭을 열 때마다 그 주(앱 장르 주차와 같은 앱 주간 파일) 데이터로 다시 계산. 매출·요일 데이터는 처음 한 번 불러온 뒤 다시 그림 */
const DOWK=["mon","tue","wed","thu","fri","sat","sun"];
function appChartsFor(wk){
  const w=WEEKS.filter(x=>x<=wk).pop()||WEEKS[WEEKS.length-1];   // 앱 장르 주차와 같거나 바로 전 앱 주간
  if(!w) return null;
  if(APP&&APP.date===w) return APP.charts;
  if(APPW[w]) return APPW[w].charts||null;
  if(APPW[w]===undefined){ APPW[w]=null; fetchJSON(`data/${w}.json`).then(d=>{ APPW[w]=d; if(src==="appgenre") renderGenreSummary(); }).catch(()=>{ APPW[w]={charts:{}}; }); }
  return null;
}
let gsumLoading=null, GENT_ALL=false;
/* 남녀 선호 판정(요약 칸 공통, 사용자 기준 2026-10-22) — 여성·남성 인기순 순위 차가 50 이내면 '동시'(앱 주간·요일 전체 탭 기준. 작은 탭은 목록 크기의 10%),
   차이가 50보다 크면 높은 쪽(여성 +차/남성 +차), 다른 쪽 순위가 없거나 100위 밖이면 '여성만/남성만'(486위 같은 숫자는 '100위 밖'으로 표시). 둘 다 없으면 c:"o" */
const GENDER_TOL = 50;
const genderT = () => GENDER_TOL;
function genderClass(f, m, N, tol){
  tol = tol || GENDER_TOL;
  const CAP=Math.max(100, N||0), out=v=>v==null||v>CAP, show=(v,lab)=>v==null?`${lab} 순위 없음`:v>CAP?`${lab} ${CAP}위 밖`:`${lab} ${v}`;
  const txt=`${show(m,"남")} · ${show(f,"여")}`;
  if(f==null && m==null) return {c:"o", txt, tag:null};
  if(f!=null && m!=null && Math.abs(m-f)<=tol) return {c:"b", txt, tag:["b","동시"]};
  const fBetter = f!=null && (m==null || f<m);
  if(fBetter) return {c:"f", txt, tag:["f", out(m)?"여성만":"여성 +"+(m-f)]};
  return {c:"m", txt, tag:["m", out(f)?"남성만":"남성 +"+(f-m)]};
}
function genreLean(d, C){
  const rk=(arr)=>{ const x=(arr||[]).find(y=>y.t===d.name); return x?x.r:null; };
  const a=C?rk(C["전체"]):null, f=C?rk(C["여성"]):null, m=C?rk(C["남성"]):null;
  if(a||f||m){ const g=genderClass(f, m, 100); return { a, f, m, wk:true, c:g.c, txt:(a?"전 "+a+" · ":"")+g.txt, tag:g.tag }; }
  // 앱 주간 밖이면 앱 요일 탭(여성·남성 인기순 TOP30)으로 선호만 봄
  const day=DOWK[dowOf(d)], T=APPWD&&APPWD.tabs;
  const wf=T&&T[day+"_f"]?((T[day+"_f"].find(y=>y.id===d.id)||{}).r||null):null, wm=T&&T[day+"_m"]?((T[day+"_m"].find(y=>y.id===d.id)||{}).r||null):null;
  if(wf||wm){ const g=genderClass(wf, wm, 30); return { a, f:null, m:null, wk:false, c:g.c, txt:g.c==="o"?"":"요일 "+g.txt, tag:g.tag }; }
  return { a, f:null, m:null, wk:false, c:"o", txt:"", tag:null };
}
/* 오른쪽 패널 보조 지표: 전주 대비 거래액 상승 TOP3 · 원작 웹툰 비율(목록 상위 N) */
function moneyUpHtml(list, leanFn){
  const ups=list.filter(x=>x.wr&&x.wr.dealDelta>0).sort((a,b)=>b.wr.dealDelta-a.wr.dealDelta).slice(0,3);
  return ups.length?ups.map(x=>{ const l=leanFn(x); return `<div class="grow"><span class="gt" title="${esc(x.d.name)}">${x.d.r}. ${esc(x.d.name)}</span><span class="gr">▲${wonFmt(x.wr.dealDelta)} · 이번 주 ${wonFmt(x.wr.deal)}</span>${leanTag(l&&l.tag)}</div>`; }).join(""):`<div class="gmore">전주보다 거래액이 오른 작품이 없어요</div>`;
}
function origStatHtml(rows, N, label){
  const top=rows.slice(0,N); if(!top.length) return "";
  const o=top.filter(d=>isOrig(d.id)), pc=Math.round(o.length/top.length*100);
  return `<div class="obar"><span style="width:${pc}%"></span></div><div class="otxt"><b>${label} ${top.length}작 중 ${o.length}작(${pc}%)</b>이 웹소설 원작${o.length?` · 상위: ${o.slice(0,3).map(d=>esc(d.name)).join(", ")}`:""}</div>`;
}
function leanTag(t){ return t?`<span class="lean ${t[0]==="f"?"lean-f":t[0]==="m"?"lean-m":"lean-b"}">${esc(t[1])}</span>`:""; }
function renderGenreSummary(){
  if(src!=="appgenre") return;
  if(!gsumLoading) gsumLoading=Promise.all([ensureSeries(),ensureSeriesDetails(),ensureDetails(),ensureRevHist(),ensureAppWd()]).then(()=>{ if(src==="appgenre") renderGenreSummary(); }).catch(()=>{});
  const D=viewRows(), C=appChartsFor(AGEN_WK||(AGEN_IDX&&AGEN_IDX.latest)||""), ready=!!(SERIES&&SERIESDET&&DETAILS&&REVHIST);
  const L=D.map(d=>({d, ln:genreLean(d,C), wr: ready?weeklyRevenue(d.name, dowOf(d), ""):null }));
  const ent=L.filter(x=>x.ln.wk).sort((x,y)=>Math.min(x.ln.a||999,x.ln.m||999,x.ln.f||999)-Math.min(y.ln.a||999,y.ln.m||999,y.ln.f||999));
  const mo=ent.filter(x=>x.ln.c==="m").length, fo=ent.filter(x=>x.ln.c==="f").length, bo=ent.filter(x=>x.ln.c==="b").length, tot=D.length||1;
  const money=L.filter(x=>x.wr&&x.wr.deal>0).sort((x,y)=>y.wr.deal-x.wr.deal), top=money[0];
  const up=[...D].filter(d=>d.m>0).sort((a,b)=>b.m-a.m)[0], news=D.filter(d=>d.b.includes("신작")).length;
  const leanBig = !ent.length ? "—" : mo>fo*1.5 ? "남성 쪽" : fo>mo*1.5 ? "여성 쪽" : "고르게";
  const tiles=[
    {lab:"📊 앱 주간 TOP100 진입", cls:"acc", big: C?`${ent.length}작품`:"불러오는 중", sub: ent.slice(0,2).map(x=>x.d.name).join(", ")+(ent.length>2?" 외":"")},
    {lab:"💰 주간 거래액 1위", cls:"acc", big: top?esc(top.d.name):(ready?"—":"불러오는 중"), sub: top?`${wonFmt(top.wr.deal)} · 장르 ${top.d.r}위${top.ln.wk?" · 앱주간 "+(top.ln.a?"전체 "+top.ln.a+"위":"진입"):""}`:""},
    {lab:"♂♀ 앱 주간 진입작 성향", cls: leanBig==="남성 쪽"?"down":leanBig==="여성 쪽"?"up":"acc", big: leanBig, sub: ent.length?`남성 ${mo} · 동시 ${bo} · 여성 ${fo} (동시=순위 50위 차 이내)`:"앱 주간에 든 작품 없음"},
    up?{lab:"▲ 장르 최대 상승", cls:"up", big: esc(up.name), sub: `${up.r}위 · ▲${up.m}`}
      :{lab:"🆕 신작", cls:"acc", big: `${news}작품`, sub: "순위변동은 폰 수집 주에만"}
  ];
  document.getElementById("tiles").innerHTML=tiles.map(t=>`<div class="tile"><div class="lab">${t.lab}</div><div class="big ${t.cls}">${t.big}</div><div class="sub2">${esc(t.sub)}</div></div>`).join("");
  // 왼쪽: 이 장르 100작 중 앱 주간 진입 분포 + 진입작 목록
  const no=tot-mo-fo-bo, pc=n=>Math.round(n/tot*100);
  document.getElementById("gdistbar").innerHTML=`<span style="background:var(--down);width:${mo/tot*100}%"></span><span style="background:var(--same);width:${bo/tot*100}%"></span><span style="background:var(--up);width:${fo/tot*100}%"></span><span style="background:var(--surface-2);width:${Math.max(0,no)/tot*100}%"></span>`;
  document.getElementById("gdistleg").innerHTML=`<span><i style="background:var(--down)"></i>남성순위 <b>${pc(mo)}%</b></span><span><i style="background:var(--same)"></i>동시(비슷한 순위) <b>${pc(bo)}%</b></span><span><i style="background:var(--up)"></i>여성순위 <b>${pc(fo)}%</b></span><span><i style="background:var(--surface-2);border:1px solid var(--border)"></i>앱 주간 남녀 밖 <b>${pc(Math.max(0,no))}%</b></span>`;
  document.getElementById("gentlab").textContent=`앱 주간 TOP100에 든 작품 · ${ent.length}작`;
  document.getElementById("gent").innerHTML=ent.length?ent.slice(0,GENT_ALL?ent.length:8).map(x=>`<div class="grow"><span class="gt" title="${esc(x.d.name)}">${x.d.r}. ${esc(x.d.name)}</span><span class="gr">${esc(x.ln.txt)}</span>${leanTag(x.ln.tag)}</div>`).join("")+(ent.length>8?`<button class="gmorebtn" id="gentmore">${GENT_ALL?"접기":"외 "+(ent.length-8)+"작 더 보기"}</button>`:""):`<div class="gmore">${C?"이번 주 앱 주간 TOP100에 든 작품이 없어요":"앱 주간 순위 불러오는 중…"}</div>`;
  const gm=document.getElementById("gentmore"); if(gm) gm.onclick=()=>{ GENT_ALL=!GENT_ALL; renderGenreSummary(); };
  document.getElementById("gmoneyup").innerHTML=!ready?"":moneyUpHtml(money, x=>x.ln);
  document.getElementById("gorig").innerHTML=origStatHtml(D, 100, "이 장르 TOP100");
  // 오른쪽: 주간 거래액 TOP 5 + 선호 성별
  document.getElementById("gmoney").innerHTML=!ready?`<div class="gmore">매출 데이터 불러오는 중…</div>`:money.length?money.slice(0,5).map(x=>`<div class="grow"><span class="gt" title="${esc(x.d.name)}">${x.d.r}. ${esc(x.d.name)}</span><span class="gr">${wonFmt(x.wr.deal)}${x.ln.txt?" · "+esc(x.ln.txt):""}</span>${leanTag(x.ln.tag)}</div>`).join("")+`<div class="gmore">시리즈 다운로드로 추정한 그 주(연재요일 기준) 거래액 · 성향 = 앱 주간 남/여 순위, 밖이면 앱 요일 남/여 순위</div>`:`<div class="gmore">이 장르에 주간 거래액이 잡힌 작품이 없어요</div>`;
}
/* 요일별 › 앱 요약 — 지금 탭(전체·신작·매일+·월~일)의 인기순과 여성·남성 인기순(같은 날 폰 수집)으로.
   남녀 분포 = 인기순 TOP N 작품이 여성·남성 인기순 TOP N에 드는지(전체 100·매일+ 50·신작 20·요일 30). 최대 상승·하락 = 전날 수집 대비.
   신작 18주 추적 = 런칭 18주 안 작품의 이 탭 순위 기록(신작 딱지가 떨어져도 계속) → 자리 잡는지. 탭·날짜 바꿀 때마다 다시 계산 */
const WD_TOPN = k => k==="all"?100 : k==="dailyPlus"?50 : k==="new"?20 : 30;
/* 신작 추적 미니 차트 — 위가 높은 순위. 첫 기록·지금 순위 숫자, 최고 순위 점선, 시작·끝 날짜, 점마다 '날짜 N위'(마우스) */
function trackChart(ranks, dates){
  const pts=ranks.map((v,i)=>[i,v]).filter(p=>p[1]!=null);
  if(!pts.length) return `<span class="tch"></span>`;
  const W=190, H=46, L=4, R=34, T=9, B=13, n=Math.max(1,ranks.length-1);
  const best=Math.min(...pts.map(p=>p[1])), worst=Math.max(...pts.map(p=>p[1])), span=Math.max(10,worst-best);   // 세로 폭은 최소 10계단 — 1계단 변화가 큰 출렁임처럼 보이지 않게
  const X=i=>L+(i/n)*(W-L-R), Y=v=>T+((v-best)/span)*(H-T-B);
  const md=s=>s?s.slice(5).replace("-","/"):"";
  const line=pts.length>1?`<path d="M${pts.map(([i,v])=>X(i).toFixed(1)+","+Y(v).toFixed(1)).join(" L")}" fill="none" stroke="var(--accent)" stroke-width="1.6"/>`:"";
  const dots=pts.map(([i,v],k)=>`<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="${k===pts.length-1?3:2}" fill="var(--accent)"><title>${md(dates[i])} ${v}위</title></circle>`).join("");
  const [fi,fv]=pts[0], [li,lv]=pts[pts.length-1];
  const guide=(best<fv&&best<lv)?`<line x1="${L}" x2="${W-R}" y1="${Y(best).toFixed(1)}" y2="${Y(best).toFixed(1)}" stroke="var(--border-strong)" stroke-dasharray="2 3"/><text x="${W-R+4}" y="${(Y(best)+3).toFixed(1)}" class="tcl">최고 ${best}</text>`:"";
  const firstLab=pts.length>1?`<text x="${(X(fi)+3).toFixed(1)}" y="${(Y(fv)-3.5).toFixed(1)}" class="tcl">${fv}위</text>`:"";
  const lastLab=`<text x="${(X(li)+5).toFixed(1)}" y="${(Y(lv)+(guide&&Math.abs(Y(lv)-Y(best))<8?10:3.5)).toFixed(1)}" class="tcl tcl-now">${lv}위</text>`;
  const axis=`<text x="${L}" y="${H-1}" class="tcd">${md(dates[pts[0][0]])}</text>${pts.length>1?`<text x="${(W-R).toFixed(1)}" y="${H-1}" class="tcd" text-anchor="end">${md(dates[li])}</text>`:""}`;
  return `<svg class="tch" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(md(dates[fi])+" "+fv+"위 → "+md(dates[li])+" "+lv+"위, 최고 "+best+"위")}">${guide}${line}${dots}${firstLab}${lastLab}${axis}</svg>`;
}
let wsLoading=null, WTRACK_ALL=false;
function renderWeekdaySummary(){
  if(!(src==="weekday"&&variant==="app")) return;
  if(!wsLoading) wsLoading=Promise.all([ensureSeries(),ensureSeriesDetails(),ensureDetails(),ensureRevHist(),ensureNewTrack()]).then(()=>{ if(src==="weekday"&&variant==="app") renderWeekdaySummary(); }).catch(()=>{});
  const k=sub, N=WD_TOPN(k), tabL=(APPWD_SUBS.find(x=>x[0]===k)||[k,k])[1];
  const B=appwdRows(k).map(enrichRow);
  const Fm=new Map(appwdRows(k+"_f").map(x=>[x.id,x.r])), Mm=new Map(appwdRows(k+"_m").map(x=>[x.id,x.r]));
  const hasG=Fm.size&&Mm.size, ready=!!(SERIES&&SERIESDET&&DETAILS&&REVHIST);
  const TOL=k==="all"?GENDER_TOL:Math.max(5, Math.round(B.length*0.1));   // 전체(500위) 50 · 요일·신작·매일+는 목록의 10%(요일 ~12·신작 ~6)
  const lean=d=>{ if(!hasG) return {txt:"", tag:null}; const g=genderClass(Fm.get(d.id), Mm.get(d.id), N, TOL); return g.c==="o"?{txt:`남녀 TOP${N} 밖`, tag:null}:g; };
  // 타일
  const lim=k==="all"?100:k==="dailyPlus"?60:1e9, BM=B.filter(d=>d.r<=lim);   // 전체(500)·매일+는 상위권 안에서만(꼬리 출렁임 제외)
  const up=[...BM].filter(d=>d.m>0).sort((a,b)=>b.m-a.m)[0], dn=[...BM].filter(d=>d.m<0).sort((a,b)=>a.m-b.m)[0];
  const NTs=(NTRACK&&NTRACK.series&&NTRACK.series[k])||{}, NTF=(NTRACK&&NTRACK.first)||{}, NTD=(NTRACK&&NTRACK.dates)||[];
  const curR=new Map(B.map(d=>[d.id,d]));
  // 추적 대상 = 첫 주(런칭일 또는 이 탭 첫 기록일부터 7일) 순위가 TOP TN 안이었던 신작 — 그 뒤 떨어져도 18주까지 계속(전체 TOP100, 그 밖 탭 TOP50)
  const TN=k==="all"?100:50;
  const entryOf=id=>{ const a=NTs[id], i0=a.findIndex(v=>v!=null); if(i0<0) return null; const st=Math.max(Date.parse(NTD[i0]), Date.parse(NTF[id]||NTD[i0])); let b=null; NTD.forEach((d,i)=>{ const t=Date.parse(d); if(a[i]!=null && t>=st && t<st+7*864e5) b=b==null?a[i]:Math.min(b,a[i]); }); return b; };
  const trk=Object.keys(NTs).map(id=>{ const d=curR.get(+id)||{r:null, id:+id, name:(LOOKUP.id[id]||["#"+id])[0]}; return {id:+id, d, ranks:NTs[id], entry:entryOf(id)}; })
    .filter(x=>x.entry!=null && x.entry<=TN).sort((a,b)=>(a.d.r??1e9)-(b.d.r??1e9) || a.entry-b.entry);
  const money=ready?B.map(d=>({d, wr:weeklyRevenue(d.name, dowOf(d), "")})).filter(x=>x.wr&&x.wr.deal>0).sort((a,b)=>b.wr.deal-a.wr.deal):[];
  const best=trk[0];
  const tiles=[
    {lab:"▲ 최대 상승 (전날 대비"+(lim<1e9?", "+lim+"위 안":"")+")", cls:"up", big: up?esc(up.name):"—", sub: up?`${up.r}위 · ▲${up.m}`:"오르내린 작품 없음"},
    {lab:"▼ 최대 하락 (전날 대비"+(lim<1e9?", "+lim+"위 안":"")+")", cls:"down", big: dn?esc(dn.name):"—", sub: dn?`${dn.r}위 · ▼${Math.abs(dn.m)}`:"오르내린 작품 없음"},
    {lab:`🆕 신작 (첫 주 TOP${TN} 진입)`, cls:"acc", big: NTRACK?`${trk.length}작품`:"불러오는 중", sub: best&&best.d.r?`최고 ${best.d.name} ${best.d.r}위`:""},
    {lab:"💰 주간 거래액 1위", cls:"acc", big: money[0]?esc(money[0].d.name):(ready?"—":"불러오는 중"), sub: money[0]?`${wonFmt(money[0].wr.deal)} · ${tabL} ${money[0].d.r}위`:""}
  ];
  document.getElementById("tiles").innerHTML=tiles.map(t=>`<div class="tile"><div class="lab">${t.lab}</div><div class="big ${t.cls}">${t.big}</div><div class="sub2">${esc(t.sub)}</div></div>`).join("");
  // 남녀 분포 + 온도차
  const top=B.slice(0,N); let mo=0,fo=0,bo=0,no=0; const sideF=[], sideM=[];
  for(const d of top){ const f=Fm.get(d.id), m=Mm.get(d.id), g=genderClass(f, m, N, TOL); if(g.c==="b")bo++; else if(g.c==="m"){ mo++; sideM.push({d,f,m,g}); } else if(g.c==="f"){ fo++; sideF.push({d,f,m,g}); } else no++; }
  // 치우친 작품: 다른 성별 TOP N 밖인 '한쪽만'을 먼저, 그다음 순위 차 큰 순 — 여성 쪽 3 + 남성 쪽 3
  const outN=v=>v==null||v>N;
  const skew=(arr,key,other)=>[...arr.filter(x=>outN(x[other])).sort((a,b)=>a[key]-b[key]), ...arr.filter(x=>!outN(x[other])).sort((a,b)=>Math.abs(b.m-b.f)-Math.abs(a.m-a.f))].slice(0,3);
  const tot=top.length||1, pc=n=>Math.round(n/tot*100);
  document.getElementById("wdistlab").textContent=`${tabL} 인기순 TOP${N} · 남녀 순위 분포`;
  document.getElementById("wdistbar").innerHTML=hasG?`<span style="background:var(--down);width:${mo/tot*100}%"></span><span style="background:var(--same);width:${bo/tot*100}%"></span><span style="background:var(--up);width:${fo/tot*100}%"></span><span style="background:var(--surface-2);width:${no/tot*100}%"></span>`:"";
  document.getElementById("wdistleg").innerHTML=hasG?`<span><i style="background:var(--down)"></i>남성순위 <b>${pc(mo)}%</b></span><span><i style="background:var(--same)"></i>동시(비슷한 순위) <b>${pc(bo)}%</b></span><span><i style="background:var(--up)"></i>여성순위 <b>${pc(fo)}%</b></span>${no?`<span><i style="background:var(--surface-2);border:1px solid var(--border)"></i>남녀 순위 없음 <b>${pc(no)}%</b></span>`:""}`:`<span>이 날짜엔 여성·남성 인기순 수집 기록이 없어요</span>`;
  document.getElementById("wgaphint").innerHTML=hasG?`인기순 TOP${N} 중 여성·남성 인기순 차이가 ${TOL}위 이내인 <b>동시</b> 작품은 <b>${bo}작품</b> · 한쪽으로 치우친 작품:`:"";
  const grow=x=>`<div class="grow"><span class="gt" title="${esc(x.d.name)}">${x.d.r}. ${esc(x.d.name)}</span><span class="gr">${esc(x.g.txt)}</span>${leanTag(x.g.tag)}</div>`;
  document.getElementById("wgap").innerHTML=hasG?(skew(sideF,"f","m").map(grow).join("")+skew(sideM,"m","f").map(grow).join("")||`<div class="gmore">치우친 작품 없음</div>`):"";
  // 주간 거래액 TOP5 + 선호
  document.getElementById("wmoney").innerHTML=!ready?`<div class="gmore">매출 데이터 불러오는 중…</div>`:money.length?money.slice(0,5).map(x=>{ const l=lean(x.d); return `<div class="grow"><span class="gt" title="${esc(x.d.name)}">${x.d.r}. ${esc(x.d.name)}</span><span class="gr">${wonFmt(x.wr.deal)}${l.txt?" · "+l.txt:""}</span>${leanTag(l.tag)}</div>`; }).join("")+`<div class="gmore">시리즈 다운로드로 추정한 그 주(연재요일 기준) 거래액 · 성향 = 이 탭 여성·남성 인기순 차이</div>`:`<div class="gmore">이 탭에 주간 거래액이 잡힌 작품이 없어요</div>`;
  document.getElementById("wmoneyup").innerHTML=!ready?"":moneyUpHtml(money, x=>lean(x.d));
  document.getElementById("worig").innerHTML=origStatHtml(B, N, `인기순 TOP${N}`);
  // 신작 18주 추적
  const wkOf=id=>{ const f=NTF[id]; if(!f) return ""; const dd=Math.floor((Date.parse(awdDate(k))-Date.parse(f))/864e5); return (NTRACK.src&&NTRACK.src[id]==="seen")?`첫 확인 ${f.slice(5).replace("-","/")}`:`${Math.floor(dd/7)+1}주차`; };
  const show=WTRACK_ALL?trk:trk.slice(0,10);
  document.getElementById("wtracklab").textContent=`신작 18주 추적 · ${tabL} 첫 주 TOP${TN} 진입 ${trk.length}작`;
  document.getElementById("wtrack").innerHTML=!NTRACK?`<div class="gmore">불러오는 중…</div>`:!trk.length?`<div class="gmore">이 탭에 첫 주 TOP${TN}에 들었던 신작이 없어요</div>`:show.map(x=>{
    const vals=x.ranks.filter(v=>v!=null), first=vals[0], diff=(first!=null&&x.d.r!=null)?first-x.d.r:0;
    const chg=x.d.r==null?`<span class="tchg down">목록 밖</span>`:vals.length>1?(diff>0?`<span class="tchg up">▲${diff}</span>`:diff<0?`<span class="tchg down">▼${-diff}</span>`:`<span class="tchg">유지</span>`):`<span class="tchg">첫 기록</span>`;
    return `<div class="trow"><span class="trk">${x.d.r??"–"}</span><span class="tname" title="${esc(x.d.name)}">${esc(x.d.name)}</span><span class="twk">${esc(wkOf(x.id))}<br><span class="tent">첫 주 ${x.entry}위</span></span>${trackChart(x.ranks, NTD)}${chg}</div>`;
  }).join("")+(trk.length>10?`<button class="gmorebtn" id="wtrackmore">${WTRACK_ALL?"접기":"외 "+(trk.length-10)+"작 더 보기"}</button>`:"")+`<div class="gmore">런칭 첫 주에 이 탭 TOP${TN}에 들었던 신작만 · 떨어져도 런칭 18주까지 계속 추적 · 첫 주 = 런칭일(기록 전 런칭이면 첫 기록일)부터 7일 · 기록은 ${NTD.length?NTD[0].slice(5).replace("-","/"):"-"}부터(매일 쌓임)</div>`;
  const tm=document.getElementById("wtrackmore"); if(tm) tm.onclick=()=>{ WTRACK_ALL=!WTRACK_ALL; renderWeekdaySummary(); };
}
function renderGap(){
  if(!APP) return;
  const F=APP.charts["여성"]||[], M=APP.charts["남성"]||[];
  const fm=new Map(F.map(d=>[d.t,d.r])), mm=new Map(M.map(d=>[d.t,d.r]));
  const both=[...fm.keys()].filter(t=>mm.has(t));
  const rows=both.map(t=>({t,f:fm.get(t),m:mm.get(t),gap:mm.get(t)-fm.get(t)})).sort((a,b)=>Math.abs(b.gap)-Math.abs(a.gap)).slice(0,5);
  document.getElementById("gaphint").innerHTML=`남·여 TOP${Math.max(F.length,M.length)}에 <b>동시</b> 등장은 <b>${both.length}작품</b>뿐 — 나머지는 성별로 갈립니다.`;
  document.getElementById("gap").innerHTML=rows.map(r=>{ const lean=r.gap>0?`<span class="lean lean-f">여성 +${r.gap}</span>`:`<span class="lean lean-m">남성 +${-r.gap}</span>`; return `<div class="grow"><span class="gt">${esc(r.t)}</span><span class="gr">남 ${r.m} · 여 ${r.f}</span>${lean}</div>`; }).join("");
}

function moveHtml(m){
  if(m>0) return `<span class="move m-up ${m>=10?"m-big":""}"><span class="arw">▲</span>${m}</span>`;
  if(m<0) return `<span class="move m-down ${Math.abs(m)>=10?"m-big":""}"><span class="arw">▼</span>${Math.abs(m)}</span>`;
  return `<span class="move m-same">—</span>`;
}
const ORIG_P={series:"네이버 시리즈",munpia:"문피아",kakao:"카카오페이지",ridi:"리디"};
const origOf = id => (id!=null && ORIGINS && ORIGINS.works && ORIGINS.works[id]) || null;
const isOrig = id => !!(origOf(id) || (id!=null && DETAILS && DETAILS[id] && DETAILS[id].novel));
function badgeHtml(d){
  let h=""; const b=d.b||[];
  if(DAILYPLUS.has(d.id)) h+=`<span class="badge b-daily">매일+</span>`;
  if(!SOURCES[src].caps.series && isOrig(d.id)){ const o=origOf(d.id), ps=o&&o.h&&o.h.length?o.h.map(x=>ORIG_P[x.p]||x.p).join("·"):""; h+=`<span class="badge b-orig" title="${esc("원작 웹소설"+(o&&o.a&&o.a.length?" · "+o.a.join(", "):"")+(ps?" · "+ps:""))}">원작</span>`; }
  if(d.s>0) h+=`<span class="badge b-streak">${d.r===1?"연속 "+d.s+"주 1위":"연속 "+d.s+"주"}</span>`;
  if(b.includes("1위탈환")) h+=`<span class="badge b-enter">1위 탈환</span>`;
  if(b.includes("신작")) h+=`<span class="badge b-new">신작</span>`;
  if(b.includes("진입")) h+=`<span class="badge b-enter">진입</span>`;
  if(b.includes("재진입")) h+=`<span class="badge b-enter">재진입</span>`;
  if(b.includes("신규")) h+=`<span class="badge b-new">신규</span>`;
  if(b.includes("완결")) h+=`<span class="badge b-fin">완결</span>`;
  if(b.includes("휴재")) h+=`<span class="badge b-rest">휴재</span>`;
  if(b.includes("UP")) h+=`<span class="badge b-up">UP</span>`;
  if(b.includes("19금")) h+=`<span class="badge b-adult">19금</span>`;
  if(b.includes("매일무료")) h+=`<span class="badge b-free">매일무료</span>`;
  if(b.includes("에디션")) h+=`<span class="badge b-ed">에디션</span>`;
  b.filter(x=>/[화권]\s*무료/.test(x)).forEach(fr=>{ h+=`<span class="badge b-free">${esc(fr)}</span>`; });
  const dl=b.find(x=>/남음/.test(x)); if(dl) h+=`<span class="badge b-deadline">${esc(dl)}</span>`;
  return h;
}
function renderList(){
  const caps=SOURCES[src].caps;
  let rows=viewRows().filter(d=>{
    if(query && !((d.name||"").toLowerCase().includes(query) || (d.a||"").toLowerCase().includes(query))) return false;
    if(fMode==="up") return d.m>0;
    if(fMode==="down") return d.m<0;
    if(fMode==="new") return d.b.includes("신작")||d.b.includes("진입")||d.b.includes("재진입");
    if(fMode==="streak") return d.s>0;
    if(fMode==="rest") return d.b.includes("휴재");
    if(fMode==="orig") return isOrig(d.id);
    return true;
  });
  if(caps.cohort){   // 신작 월별: 고른 기간(첫 주·N주 누적) 거래액 큰 순, 그 기간이 안 지난 작품은 뒤로
    rows.forEach(d=>{ const x=LW&&LW.works[d.id]; d._co=x?cohortVals(x):{}; d._cv=coMetric(d,sMode); });
    const asc=sMode==="app", v=d=>d._cv!=null?d._cv:(asc?1e9:-1);   // 앱 주간 순위는 작은 순
    rows=[...rows].sort((a,b)=>asc?v(a)-v(b):v(b)-v(a)); let rk=0; rows.forEach(d=>{ d._rk = d._cv!=null ? ++rk : "–"; });
  }
  else if(caps.revchange){
    rows=rows.map(d=>{ d._wr=weeklyRevenue(d.name, dowOf(d), revWeek); d._pend=!d._wr && revWeekPending(d.name, dowOf(d), revWeek); return d; }).filter(d=>d._wr||d._pend);
    rows=[...rows].sort((a,b)=> (!a._wr||!b._wr) ? ((!a._wr)-(!b._wr)) : sMode==="loss" ? (a._wr.sortKey-b._wr.sortKey) : (b._wr.sortKey-a._wr.sortKey));   // 주간 대기는 맨 뒤
    let rk=0; rows.forEach(d=>{ d._rk = d._wr ? ++rk : "–"; });
  }
  else if(caps.done && sMode==="fav"){
    const fv=d=>(DETAILS&&DETAILS[d.id]&&DETAILS[d.id].fav)||0;
    rows=[...rows].sort((a,b)=>fv(b)-fv(a));
    rows.forEach((d,i)=>{ d._rk=i+1; });
  }
  else if(caps.newworks && sMode==="dgain"){   // 전주 대비 주간 거래액 증가 큰 순(2주 미만 작품은 뒤로)
    rows.forEach(d=>{ d._wd=weeklyRevenue(d.name, dowOf(d), ""); });
    const g=d=>(d._wd&&d._wd.dealDelta!=null)?d._wd.dealDelta:-Infinity;
    rows=[...rows].sort((a,b)=>g(b)-g(a)); rows.forEach((d,i)=>{ d._rk=i+1; });
  }
  else if(caps.revenue && sMode==="recent"){
    const lt=d=>parseLaunch(DETAILS&&DETAILS[d.id]&&DETAILS[d.id].launch);
    rows=[...rows].sort((a,b)=>lt(b)-lt(a));
    rows.forEach((d,i)=>{ d._rk=i+1; });
  }
  else if(caps.revenue || sMode==="revenue" || sMode==="per" || sMode==="total" || sMode==="deal"){
    rows.forEach(d=>{ d._wd=weeklyRevenue(d.name, dowOf(d), ""); });   // 거래액 자리 = 주단위 거래액(이번주)
    if(sMode==="deal") rows=[...rows].sort((a,b)=>((b._wd?b._wd.deal:-1)-(a._wd?a._wd.deal:-1)));   // 주단위거래액순
    else { const key = sMode==="total" ? "full" : "per"; rows=[...rows].sort((a,b)=>{ const ra=revenueFor(a.name),rb=revenueFor(b.name); return (rb?rb[key]:-1)-(ra?ra[key]:-1); }); }
    if(caps.revenue) rows.forEach((d,i)=>{ d._rk=i+1; });
  }
  else if(sMode==="up") rows=[...rows].sort((a,b)=>b.m-a.m);
  else if(sMode==="down") rows=[...rows].sort((a,b)=>a.m-b.m);
  else rows=[...rows].sort((a,b)=>a.r-b.r);
  rowsCache=rows;
  const countEl=document.getElementById("count"), board=document.getElementById("board");
  const total=(SOURCES[src].data(variant,sub)||[]).length;
  const revNote = caps.revchange
    ? `<b>주단위 거래액</b> ${esc(revWeekLabel())} · 이번주−지난주 누적 거래액 · 전주 대비(<span style="color:var(--up)">▲</span>/<span style="color:var(--down)">▼</span>)은 완전한 2주부터`
    : `단가=(대여×0.9+소장×0.1)×100 · 총거래액=다운수×단가 · 회차당=총거래액×0.9×0.6÷시리즈 회차수 · 주단위거래액=이번주−지난주 누적`;
  countEl.innerHTML=`${rows.length}개 작품`+(fMode!=="all"||query?` (${subLabel(sub)} ${total}개 중)`:"")+((sMode==="revenue"||caps.revenue||caps.revchange)?` · <span style="color:var(--faint)">${revNote}</span>`:"");
  if(!rows.length){ board.innerHTML=`<li class="empty">${(caps.gsort&&variant==="app"&&AWD_DATE&&!(SOURCES[src].data(variant,sub)||[]).length)?"이 날짜는 이 탭·정렬의 수집 기록이 없어요 — 달력에서 다른 날을 골라 주세요.":(caps.gsort&&variant==="app"&&!(SOURCES[src].data(variant,sub)||[]).length)?"이 정렬은 아직 수집 전이에요 — 매일 아침 폰 수집 때 함께 쌓여요.":caps.revchange?"아직 완전한 한 주가 안 끝났어요. 연재요일별로 순차 표시돼요(수 9/16, 목 9/17 …). 수집 다운수가 전날 누적이라 주 마감 다음날부터 잡힙니다.":"조건에 맞는 작품이 없어요."}</li>`; return; }
  const showRev = caps.revenue || sMode==="revenue";
  board.innerHTML=rows.map((d,i)=>{
    const rk = (caps.revenue||caps.revchange||caps.cohort) ? (d._rk||i+1) : d.r;
    const thumb=d.th?`<img class="thumb" loading="lazy" src="${esc(d.th)}" alt="">`:`<div class="thumb ph">🎬</div>`;
    return `<li class="rowli ${rk<=3?"top"+rk:""}" role="button" tabindex="0" data-i="${i}">
      <div class="rk tnum">${rk}</div>${thumb}
      <div class="cell"><div class="ttl"><span class="name">${esc(d.name)}</span>${badgeHtml(d)}</div><div class="auth">${esc(d.a)}${caps.done&&DETAILS&&DETAILS[d.id]?` · <span style="color:var(--muted)">${esc(DETAILS[d.id].day||"")}${DETAILS[d.id].fav?" · 관심 "+DETAILS[d.id].fav.toLocaleString():""}</span>`:""}${(caps.newworks||caps.cohort)&&DETAILS&&DETAILS[d.id]&&DETAILS[d.id].launch?` · <span style="color:var(--accent)">🆕 ${esc(DETAILS[d.id].launch)}</span>`:""}</div></div>
      ${caps.cohort ? cohortHtml(d) : (caps.revchange || (caps.newworks && (sMode==="deal"||sMode==="dgain"))) ? revChangeHtml(d) : showRev ? revHtml(d) : (caps.move?moveHtml(d.m):"")}
    </li>`;
  }).join("");
}
function revHtml(d){
  const r=revenueFor(d.name);
  if(!r) return `<div class="rev rev-none">시리즈<br>없음</div>`;
  const wd = (d._wd!==undefined) ? d._wd : weeklyRevenue(d.name, dowOf(d), "");
  const weekly = wd ? (wd.est?"≈":"")+wonFmt(wd.deal)+(wd.lag?` (${mdShort(wd.ws)}~ 주)`:"") : "–";   // 주단위 거래액(이번주) · ≈=수집 공백 보간 추정 · 한 주기 늦으면 기간 표시
  const big = sMode==="total" ? wonFmt(r.full) : sMode==="deal" ? weekly : wonFmt(r.per);
  const bigLab = sMode==="total" ? "총거래액" : sMode==="deal" ? "주단위거래액" : "회차당";
  const others = sMode==="total" ? [["회차당",wonFmt(r.per)],["주단위",weekly]] : sMode==="deal" ? [["회차당",wonFmt(r.per)],["총거래액",wonFmt(r.full)]] : [["총거래액",wonFmt(r.full)],["주단위",weekly]];
  const small = others.map(([k,v])=>k+" "+v).join(" · ");
  return `<div class="rev" title="${bigLab} · 시리즈 다운 ${r.dl.toLocaleString()} × 단가 ${Math.round(r.up)}원 · 주단위=이번주 거래액"><span class="rev-full">${big}</span><span class="rev-per">${small}</span></div>`;
}
/* 매출변동 행: 그 주(연재요일 주간) 발생 매출 — 회차당 기준 정렬, 총·회차당 병기. 전주 대비 변동은 완전한 2주부터 */
function revChangeHtml(d){
  const wr=d._wr||weeklyRevenue(d.name, dowOf(d), revWeek);
  if(!wr) return `<div class="rev rev-none">주간<br>대기</div>`;
  const range=`${mdShort(wr.ws)}~${mdShort(wr.we)}`;
  const big=(wr.est?"≈":"")+wonFmt(wr.deal);  // 주단위 거래액(이번주−지난주 누적) · ≈=수집 공백 보간 추정
  if(wr.hasPrev){
    const up=wr.dealDelta>0, dn=wr.dealDelta<0, cls=up?"rc-up":dn?"rc-down":"rc-same";
    const dd=(wr.estDelta?"≈":"")+((!up&&!dn)?"±0원":(up?"▲":"▼")+wonFmt(Math.abs(wr.dealDelta)));
    const estNote=wr.estDelta?" · ≈ 수집이 비었던 날은 앞뒤 값으로 보간한 추정치":"";
    const lagTxt=wr.lag?` · ${range}`:"";   // 한 주기 늦은 주면 기간을 행에 보여줌(이번 주 금액으로 오해하지 않게)
    return `<div class="rev rc ${cls}" title="${range} 주단위 거래액 ${big} · 전주 대비 ${up?"+":dn?"-":""}${wonFmt(Math.abs(wr.dealDelta))} · 총 발생매출 ${wonFmt(wr.rev)}${estNote}${wr.lag?" · 이번 주기 수집 전이라 직전 주":""}"><span class="rev-full">${big}</span><span class="rev-per">전주대비 ${dd}${lagTxt}</span></div>`;
  }
  return `<div class="rev" title="${range} 주단위 거래액 ${big}${wr.est?" · ≈ 수집 공백 보간 추정치":""}"><span class="rev-full">${big}</span><span class="rev-per">${wr.lag?range:"이번주"} · 전주대비 다음주부터</span></div>`;
}

const searchUrl = t => `https://search.naver.com/search.naver?query=${encodeURIComponent(t+" 웹툰")}`;
function urlFor(d){
  if(SOURCES[src].caps.series) return d.id?`https://series.naver.com/${variant}/detail.series?productNo=${d.id}`:searchUrl(d.name);
  return d.id?`https://comic.naver.com/webtoon/list?titleId=${d.id}`:searchUrl(d.name);
}
function ensureDetails(){ if(DETAILS) return Promise.resolve(DETAILS); if(!detailsLoading) detailsLoading=fetchJSON("data/details.json").then(d=>{DETAILS=d; buildKwIndex(); return d;}).catch(()=>DETAILS={}); return detailsLoading; }
function ensureHistory(){ if(HISTORY) return Promise.resolve(HISTORY); if(!historyLoading) historyLoading=fetchJSON("data/history.json").then(h=>HISTORY=h).catch(()=>HISTORY={dates:[],series:{}}); return historyLoading; }
function buildKwIndex(){ KWINDEX={}; for(const id in DETAILS){ for(const kw of (DETAILS[id].k||[])){ (KWINDEX[kw]||(KWINDEX[kw]=[])).push(Number(id)); } } }

function origHtml(id, det){
  const o=origOf(id); if(!o && !(det&&det.novel)) return "";
  const au=o&&o.a&&o.a.length?`<span class="oau">원작 ${esc(o.a.join(", "))}</span>`:"";
  const links=(o&&o.h||[]).map(h=>{ const meta=[h.n?h.n.toLocaleString()+"화":(h.v?h.v+"권":""), h.d?"완결":"", h.ad?"19금":""].filter(Boolean).join(" · "); return `<a class="olink" href="${esc(h.u)}" target="_blank" rel="noopener noreferrer" title="${esc(h.t)}">${esc(ORIG_P[h.p]||h.p)}${meta?` <span class="ometa">${esc(meta)}</span>`:""}</a>`; }).join("");
  const none=(!o||!(o.ck||[]).length)?`<span class="onone">연재처 확인 전</span>`:(!links?`<span class="onone">${esc((o.ck||[]).map(p=>ORIG_P[p]||p).join("·"))}에서 못 찾음</span>`:"");
  const ttl=(o&&o.h&&o.h[0]&&o.h[0].t)?` <span class="otitle">「${esc(o.h[0].t.replace(/\s*\[[^\]]*\]\s*/g," ").trim())}」</span>`:"";
  return `<div class="morig"><div class="ohead">원작 웹소설${ttl}${au}</div><div class="olinks">${links}${none}</div></div>`;
}
function detailHtml(det, name, id){
  const info=[];
  if(det.g) info.push(["장르", det.g + (det.dailyplus?" · 매일+":"")]);
  if(det.cp) info.push(["제작사", det.cp==="다중"?"여러 제작사":det.cp]);
  if(det.launch) info.push(["런칭일", det.launch]);
  const publish=[det.day,det.age].filter(Boolean).join(" · "); if(publish) info.push(["연재", publish]);
  if(det.star) info.push(["평균 별점", "★ "+det.star]);
  if(det.cmt) info.push(["평균 댓글", det.cmt.toLocaleString()+"개"]);
  if(det.ep) info.push(["회차(총 N화)", det.ep+"화"]);
  if(det.fav) info.push(["관심", det.fav.toLocaleString()+"명"]);
  const rv = name ? revenueFor(name) : null;
  if(rv){ info.push(["시리즈 다운로드", rv.dlStr+" ("+(rv.kind==="comic"?"웹툰":"웹소설")+")"]); info.push(["단가", Math.round(rv.up).toLocaleString()+"원/다운"+(rv.own?" (대여 "+rv.rent+"·소장 "+rv.own+"쿠키, 대여90%)":" (기본 대여3·소장5)")]); info.push(["거래 추정", "총거래액 "+wonFmt(rv.full)+" · 회차당 "+wonFmt(rv.per)+" (시리즈 "+rv.ep+"화)"]); const wd=weeklyRevenue(name, parseDow(det.day), ""); if(wd) info.push(["주단위 거래액", (wd.est?"≈":"")+wonFmt(wd.deal)+" ("+mdShort(wd.ws)+"~"+mdShort(wd.we)+")"+(wd.hasPrev?" · 전주대비 "+(wd.estDelta?"≈":"")+(wd.dealDelta>0?"▲":wd.dealDelta<0?"▼":"±")+wonFmt(Math.abs(wd.dealDelta)):"")]); }
  let h="";
  if(info.length) h+=`<div class="mrows">`+info.map(([k,v])=>`<div class="mrow"><span class="mk">${k}</span><span class="mv">${esc(v)}</span></div>`).join("")+`</div>`;
  const kws=(det.k||[]).slice(); if(det.novel) kws.push("소설원작");
  if(kws.length) h+=`<div class="mkw">`+kws.map(t=>`<button class="kw kwbtn" data-kw="${esc(t)}">#${esc(t)}</button>`).join("")+`</div>`;
  if(id!=null) h+=origHtml(id, det);
  if(det.syn) h+=`<p class="msyn">${esc(det.syn)}</p>`;
  return h;
}
/* 순위 추이 스파크라인 (rank 배열 → svg) */
function sparkSvg(ranks){
  const pts=ranks.map((v,i)=>[i,v]).filter(p=>p[1]!=null);
  if(pts.length<2) return "";
  const W=64,H=20,maxR=Math.max(...pts.map(p=>p[1])),minR=Math.min(...pts.map(p=>p[1]));
  const n=ranks.length-1||1, span=(maxR-minR)||1;
  const xy=pts.map(([i,v])=>[ (i/n)*(W-2)+1, ((v-minR)/span)*(H-4)+2 ]); // 순위 낮을수록 위
  const d="M"+xy.map(p=>p[0].toFixed(1)+","+p[1].toFixed(1)).join(" L");
  const last=xy[xy.length-1];
  return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="1.5"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2" fill="var(--accent)"/></svg>`;
}
/* 기준별 순위(겹치는 순위) — 이 작품이 오른 모든 랭킹 + 스파크라인 */
function crossBasisHtml(d, isSeries){
  const findRank=(rows,byId)=>{ if(!rows)return null; const row=byId?rows.find(r=>r.id===d.id):rows.find(r=>r.t===d.name); return row?row.r:null; };
  const E=[];
  if(isSeries){
    if(src!=="series" || !SERIES) return "";
    const base=SERIES[variant]&&SERIES[variant][platform]&&SERIES[variant][platform][scat];
    for(const [p,pl] of PERIODS){ const r=findRank(base&&base[p],true); if(r) E.push([`${variant==="comic"?"웹툰":"웹소설"} ${platform==="web"?"웹":"모바일"} ${pl}`, `series_${variant}_${platform}_${p}`, r]); }
  } else {
    for(const c of ["전체","여성","남성"]){ const r=findRank(APP&&APP.charts[c],false); if(r) E.push([`앱주간 ${c}`, `app_${c}`, r]); }
    if(AGEN&&AGEN.charts) for(const g in AGEN.charts){ const r=findRank(AGEN.charts[g],false)||findRank(AGEN.charts[g],true); if(r) E.push([`앱 장르 주간 ${g}`, `agen_${g}`, r]); }   // 상세 열 때 불러옴(ensureAgenHist)
    if(APPWD&&APPWD.tabs) for(const [w,wl] of APPWD_SUBS){ const r=findRank(APPWD.tabs[w],true); if(r) E.push([`요일 앱 ${wl}`, `awd_${w}`, r]); }
    for(const [w,wl] of WEEKDAYS){ const r=findRank(WEEKDAY.web&&WEEKDAY.web[w],true); if(r) E.push([`요일 웹 ${wl}`, `wd_web_${w}`, r]); }
  }
  if(!E.length) return "";
  const rows=E.map(([label,key,rank])=>{
    const hist=key.startsWith("awd_") ? (APPWDH&&APPWDH.series[key.slice(4)]&&APPWDH.series[key.slice(4)][d.id]) : key.startsWith("agen_") ? (AGENH&&AGENH.series[key.slice(5)]&&AGENH.series[key.slice(5)][d.id]) : (HISTORY&&HISTORY.series[key]&&HISTORY.series[key][d.id]);
    const spark=hist?sparkSvg(hist):"";
    return `<div class="xrow"><span class="xlab">${esc(label)}</span>${spark}<span class="xrk">${rank}위</span></div>`;
  }).join("");
  return `<div class="xbasis"><div class="xhead">기준별 순위 · 추이</div>${rows}</div>`;
}
function openModal(d){
  document.querySelector(".modal-card").classList.remove("wide");   // 댓글 분석 있는 작품만 넓게(cmt.js가 다시 켬)
  const url=urlFor(d), caps=SOURCES[src].caps;
  const badges=badgeHtml(d)+(caps.move?`<span class="badge ${d.m>0?"b-new":d.m<0?"b-rest":"b-fin"}">${d.m>0?"▲"+d.m:d.m<0?"▼"+Math.abs(d.m):"변동없음"}</span>`:"");
  const ctx=`${esc(SOURCES[src].label)}${variant?" · "+esc(varLabel()):""} · ${esc(subLabel(sub))}${(typeof d._rk==="number"?d._rk:d.r)?` · <b>${typeof d._rk==="number"?d._rk:d.r}위</b>`:""}`;   // 매출·신작 목록은 정렬 순서(_rk), 랭킹은 원래 순위
  const webtoon = !caps.series && d.id!=null;
  const isSeries = caps.series && d.id!=null;
  document.getElementById("modalBody").innerHTML=`
    <div class="mtop">
      ${d.th?`<img class="mthumb" src="${esc(d.th)}" alt="">`:`<div class="mthumb"></div>`}
      <div style="min-width:0">
        <div class="mrank">${ctx}</div>
        <div class="mtitle">${esc(d.name)}</div>
        <div class="mauth">${esc(d.a)}</div>
        <div class="mbadges">${badges}</div>
      </div>
    </div>
    <div class="mdetail" id="mdetail">${webtoon||isSeries?'<div class="mloading">상세 불러오는 중…</div>':""}</div>
    <div id="mrev" class="mrev" hidden></div>
    <div id="mdl" class="mrev" hidden></div>
    <div id="mfav" class="mrev" hidden></div>
    ${webtoon?'<div id="mcmt" hidden></div>':""}
    <div id="mcross"></div>
    <button class="mepbtn" data-trend="1" data-id="${d.id}" data-name="${esc(d.name)}">⬇ 순위 추이 엑셀 (기준별 시트)</button>
    ${webtoon?`<button class="mepbtn" data-id="${d.id}" data-name="${esc(d.name)}">⬇ 회차별 댓글·별점 엑셀(CSV)</button>`:""}
    <a class="mlink" href="${url}" target="_blank" rel="noopener noreferrer">네이버에서 작품 보기 →</a>`;
  document.getElementById("modal").hidden=false;
  const myTok=++modalSeq;
  Promise.all([webtoon?ensureDetails():isSeries?ensureSeriesDetails():Promise.resolve(), ensureHistory(), isSeries?Promise.resolve():ensureAppWd(), isSeries?Promise.resolve():ensureAgenHist()]).then(()=>{
    if(modalSeq!==myTok) return;
    const el=document.getElementById("mdetail");
    if(webtoon && el) el.innerHTML = (DETAILS[d.id]?detailHtml(DETAILS[d.id], d.name, d.id):'<div class="mloading">상세 정보 없음</div>');
    else if(isSeries && el) el.innerHTML = (SERIESDET&&SERIESDET[d.id])?seriesDetailHtml(SERIESDET[d.id]):'<div class="mloading">상세 수집 중 — 매일 추가됩니다</div>';
    const cx=document.getElementById("mcross"); if(cx) cx.innerHTML=crossBasisHtml(d, caps.series);
  });
  // 웹툰: 연동된 시리즈 다운수는 SERIES(지연) 로드 후 상세에 주입 (초기 표시 안 막음)
  if(webtoon){ Promise.all([ensureDetails(), ensureSeries(), ensureSeriesDetails()]).then(()=>{
    if(modalSeq!==myTok) return; const el=document.getElementById("mdetail");
    if(el && DETAILS[d.id]) el.innerHTML = detailHtml(DETAILS[d.id], d.name, d.id);
  }); }
  // 매출 누적 그래프 (웹툰=매칭 시리즈 / 시리즈=자기 자신)
  if(webtoon||isSeries){ Promise.all([ensureSeries(), ensureSeriesDetails(), ensureRevHist(), ensureEpHist(), webtoon?ensureDetails():Promise.resolve()]).then(()=>{
    if(modalSeq!==myTok) return; SNAMEIDX=SNAMEIDX||seriesNameIndex(); const box=document.getElementById("mrev");
    if(box){ const html=revChartHtml(d.name, dowOf(d), isSeries?d.id:0); box.innerHTML=html; box.hidden=!html; }
    const dlb=document.getElementById("mdl"); if(dlb){ const dh=dlChartHtml(d.name, isSeries?d.id:0); dlb.innerHTML=dh; dlb.hidden=!dh; }
  }); }
  // 관심수 추이 (웹툰만)
  if(webtoon){ ensureFavHist().then(()=>{ if(modalSeq!==myTok) return; const fb=document.getElementById("mfav"); if(fb){ const h=favChartHtml(d.id); fb.innerHTML=h; fb.hidden=!h; } }); }
  // 회차별 댓글 수 막대(전 웹툰, 매일) + AI 댓글 분석(분석된 작품만) — cmt.js
  if(webtoon && window.CMT) CMT.render(document.getElementById("mcmt"), d.id, d.name, ()=>modalSeq===myTok);
}
/* 키워드 클릭 → 그 키워드 작품 전부 */
function openKeywordList(kw){
  document.querySelector(".modal-card").classList.remove("wide");
  const ids=(KWINDEX&&KWINDEX[kw])||[];
  const items=ids.map(id=>({id, info:LOOKUP.id[id]})).filter(x=>x.info)
    .sort((a,b)=>((DETAILS[b.id]||{}).fav||0)-((DETAILS[a.id]||{}).fav||0));
  document.getElementById("modalBody").innerHTML=`
    <div class="klhead"><span class="klt">#${esc(kw)}</span><span class="klc">${items.length}작품</span></div>
    <div class="kllist">${items.map(x=>{
      const det=DETAILS[x.id]||{};
      return `<a class="klrow" href="https://comic.naver.com/webtoon/list?titleId=${x.id}" target="_blank" rel="noopener noreferrer">
        <img class="klthumb" loading="lazy" src="${esc(x.info[1]||"")}" alt="">
        <span class="klname">${esc(x.info[0])}<small>${esc(det.g||"")}${det.star?" · ★"+det.star:""}</small></span></a>`;
    }).join("")}</div>`;
  document.getElementById("modal").hidden=false;
}
/* 검색결과 → 작품 상세 모달 (현재 화면과 무관, 자립형) */
function openWorkModal(w){
  document.querySelector(".modal-card").classList.remove("wide");
  const isWt = w.kind==="webtoon";
  const url = isWt ? `https://comic.naver.com/webtoon/list?titleId=${w.id}` : `https://series.naver.com/${w.kind}/detail.series?productNo=${w.id}`;
  const label = isWt ? "네이버웹툰" : ("시리즈 "+(w.kind==="comic"?"웹툰":"웹소설"));
  document.getElementById("modalBody").innerHTML=`
    <div class="mtop">
      ${w.th?`<img class="mthumb" src="${esc(w.th)}" alt="">`:`<div class="mthumb"></div>`}
      <div style="min-width:0">
        <div class="mrank">${esc(label)}</div>
        <div class="mtitle">${esc(w.name)}</div>
        <div class="mauth">${esc(w.a||"")}</div>
      </div>
    </div>
    <div class="mdetail" id="mdetail"><div class="mloading">상세 불러오는 중…</div></div>
    <div id="mrev" class="mrev" hidden></div>
    <div id="mdl" class="mrev" hidden></div>
    <div id="mfav" class="mrev" hidden></div>
    ${isWt?'<div id="mcmt" hidden></div>':""}
    <a class="mlink" href="${url}" target="_blank" rel="noopener noreferrer">네이버에서 작품 보기 →</a>`;
  document.getElementById("modal").hidden=false;
  const myTok=++modalSeq;
  (isWt?Promise.all([ensureDetails(),ensureSeries(),ensureSeriesDetails()]):ensureSeriesDetails()).then(()=>{
    if(modalSeq!==myTok) return;
    const el=document.getElementById("mdetail"); if(!el) return;
    if(isWt) el.innerHTML = DETAILS[w.id]?detailHtml(DETAILS[w.id], w.name, w.id):'<div class="mloading">상세 정보 없음</div>';
    else el.innerHTML = (SERIESDET&&SERIESDET[w.id])?seriesDetailHtml(SERIESDET[w.id]):'<div class="mloading">상세 수집 중 — 매일 추가됩니다</div>';
  });
  Promise.all([ensureSeries(), ensureSeriesDetails(), ensureRevHist(), ensureEpHist(), isWt?ensureDetails():Promise.resolve()]).then(()=>{
    if(modalSeq!==myTok) return; SNAMEIDX=SNAMEIDX||seriesNameIndex(); const box=document.getElementById("mrev");
    if(box){ const html=revChartHtml(w.name, isWt?dowOf(w):0, isWt?0:w.id); box.innerHTML=html; box.hidden=!html; }
    const dlb=document.getElementById("mdl"); if(dlb){ const dh=dlChartHtml(w.name, isWt?0:w.id); dlb.innerHTML=dh; dlb.hidden=!dh; }
  });
  if(isWt){ ensureFavHist().then(()=>{ if(modalSeq!==myTok) return; const fb=document.getElementById("mfav"); if(fb){ const h=favChartHtml(w.id); fb.innerHTML=h; fb.hidden=!h; } }); }
  if(isWt && window.CMT) CMT.render(document.getElementById("mcmt"), w.id, w.name, ()=>modalSeq===myTok);
}
/* 전체 작품 검색: 웹툰(LOOKUP) + 시리즈(SERIES) 통합 인덱스 */
let GINDEX=null;
function buildGIndex(){
  const a=[];
  for(const id in (LOOKUP.id||{})){ const v=LOOKUP.id[id]; if(v&&v[0]) a.push({kind:"webtoon", id:+id, name:v[0], th:v[1]||"", a:v[2]||""}); }
  if(SERIES){ const seen=new Set(); for(const k of ["comic","novel"]) for(const pf of ["web","mobile"]) for(const c in (SERIES[k]||{})[pf]||{}) for(const p in SERIES[k][pf][c]) for(const it of SERIES[k][pf][c][p]){ if(!seen.has("s"+it.id)){ seen.add("s"+it.id); a.push({kind:k, id:it.id, name:it.t, th:it.th||"", a:it.a||""}); } } }
  return a;
}
function wireGlobalSearch(){
  const q=document.getElementById("gq"), box=document.getElementById("gresults");
  if(!q) return;
  q.addEventListener("focus", ()=>{ ensureDetails(); ensureSeriesDetails(); ensureSeries().then(()=>{ GINDEX=null; if(q.value.trim()) q.dispatchEvent(new Event("input")); }); }, {once:false});
  q.addEventListener("input", ()=>{
    const v=q.value.trim().toLowerCase();
    if(!v){ box.hidden=true; box.innerHTML=""; return; }
    if(!GINDEX) GINDEX=buildGIndex();
    const res=GINDEX.filter(x=>x.name.toLowerCase().includes(v)).slice(0,16);
    box.hidden=false;
    if(!res.length){ box.innerHTML=`<div class="gnone">검색 결과 없어요</div>`; box._res=[]; return; }
    box.innerHTML=res.map((x,i)=>`<button class="gres" data-gi="${i}"><img loading="lazy" src="${esc(x.th)}" alt=""><span style="min-width:0"><span class="gn">${esc(x.name)}</span><span class="gm">${x.kind==="webtoon"?"웹툰":x.kind==="comic"?"시리즈 웹툰":"시리즈 웹소설"}${x.a?" · "+esc(x.a):""}</span></span></button>`).join("");
    box._res=res;
  });
  box.addEventListener("click", e=>{ const b=e.target.closest("[data-gi]"); if(!b)return; const w=(box._res||[])[+b.dataset.gi]; if(w){ box.hidden=true; q.value=""; openWorkModal(w); } });
  document.addEventListener("click", e=>{ if(!e.target.closest(".gsearch")) box.hidden=true; });
  q.addEventListener("keydown", e=>{ if(e.key==="Escape"){ box.hidden=true; q.blur(); } });
}
function wireModal(){
  const modal=document.getElementById("modal"), close=()=>{ modal.hidden=true; };
  document.getElementById("modalBack").onclick=close;
  document.getElementById("modalX").onclick=close;
  document.addEventListener("keydown", e=>{ if(e.key==="Escape"&&!modal.hidden) close(); });
  document.getElementById("modalBody").addEventListener("click", e=>{
    const kb=e.target.closest("[data-kw]"); if(kb){ e.preventDefault(); openKeywordList(kb.dataset.kw); return; }
    const rb=e.target.closest("[data-rev]"); if(rb){ exportRevXLSX(rb.dataset.name, +rb.dataset.dow||0, +rb.dataset.pn||0); return; }
    const tb=e.target.closest("[data-trend]"); if(tb){ exportTrendXLSX(+tb.dataset.id, tb.dataset.name); return; }
    const ep=e.target.closest(".mepbtn"); if(ep && ep.dataset.id){ exportEpisodeCSV(+ep.dataset.id, ep.dataset.name); }
  });
  const board=document.getElementById("board");
  board.addEventListener("click", e=>{ const li=e.target.closest("[data-i]"); if(li) openModal(rowsCache[+li.dataset.i]); });
  board.addEventListener("keydown", e=>{ if(e.key==="Enter"||e.key===" "){ const li=e.target.closest("[data-i]"); if(li){ e.preventDefault(); openModal(rowsCache[+li.dataset.i]); } } });
}
/* 현재 화면의 basisKey */
function currentBasisKey(){
  if(src==="app") return "app_"+sub;
  if(src==="weekday") return variant==="app" ? "awd_"+sub : "wd_web_"+sub;
  if(src==="series") return "series_"+variant+"_"+platform+"_"+sub;
}
/* 날짜별 순위 추이 데이터: {dates:[], rankFn:(row)=>[각 날짜 순위]} */
async function trendData(){
  if(src==="app"){
    const charts={};
    for(const w of WEEKS){ try{ const d=await fetchJSON(`data/${w}.json`); charts[w]=(d.charts&&d.charts[sub])||[]; }catch(e){ charts[w]=[]; } }
    return { dates:WEEKS.slice(), rankFn:(row)=>WEEKS.map(w=>{ const r=(charts[w]||[]).find(x=>x.t===row.name); return r?r.r:""; }) };
  }
  if(src==="appgenre"){   // 앱 장르 주간: 주차 파일마다 이 장르 순위
    const weeks=(AGEN_IDX&&AGEN_IDX.weeks)||[], charts={};
    for(const w of weeks){ try{ const d=await fetchJSON(`data/app_genre/${w}.json`); charts[w]=(d.charts&&d.charts[sub])||[]; }catch(e){ charts[w]=[]; } }
    return { dates:weeks.slice(), rankFn:(row)=>weeks.map(w=>{ const r=(charts[w]||[]).find(x=>x.t===row.name); return r?r.r:""; }) };
  }
  await ensureHistory();
  const key=currentBasisKey();
  if(key&&key.startsWith("awd_")){ await ensureAppWd(); const ad=(APPWDH&&APPWDH.dates)||[], AS=(APPWDH&&APPWDH.series[key.slice(4)])||{}; return { dates:ad, rankFn:(row)=>{ const a=AS[row.id]||[]; return ad.map((_,i)=> a[i]==null?"":a[i]); } }; }
  const dates=(HISTORY&&HISTORY.dates)||[], S=(HISTORY&&HISTORY.series[key])||{};
  return { dates, rankFn:(row)=>{ const a=S[row.id]||[]; return dates.map((_,i)=> a[i]==null?"":a[i]); } };
}
/* 엑셀(CSV) 다운로드 — 현재 화면 + 기준별 순위 + 집계 + 날짜별 순위추이 */
async function exportCSV(){
  await ensureDetails(); await ensureAgen();
  const findRank=(rows,byId,d)=>{ if(!rows)return null; const row=byId?rows.find(r=>r.id===d.id):rows.find(r=>r.t===d.name); return row?row.r:null; };
  const cross=d=>{
    const E=[];
    if(src==="series"){ const base=SERIES&&SERIES[variant]&&SERIES[variant][platform]&&SERIES[variant][platform][scat]; for(const [p,pl] of PERIODS){ const r=findRank(base&&base[p],true,d); if(r)E.push((variant==="comic"?"웹툰":"웹소설")+(platform==="web"?"웹":"모바일")+pl+r); } }
    else{
      for(const c of ["전체","여성","남성"]){ const r=findRank(APP&&APP.charts[c],false,d); if(r)E.push("앱"+c+r); }
      if(APPWD&&APPWD.tabs) for(const [w,wl] of APPWD_SUBS){ const r=findRank(APPWD.tabs[w],true,d); if(r)E.push("요일앱"+wl+r); }
      for(const [w,wl] of WEEKDAYS){ const r=findRank(WEEKDAY.web&&WEEKDAY.web[w],true,d); if(r)E.push("요일웹"+wl+r); }
      if(AGEN&&AGEN.charts) for(const g in AGEN.charts){ const r=findRank(AGEN.charts[g],false,d)||findRank(AGEN.charts[g],true,d); if(r)E.push("앱장르"+g+r); }
    }
    return E.join(" · ");
  };
  const trend=await trendData();
  const q=s=>`"${String(s==null?"":s).replace(/"/g,'""')}"`;
  const head=["순위","작품","작가","장르","제작사","런칭일","평균별점","평균댓글","회차수","관심수","매일+","키워드","기준별순위(겹침)", ...trend.dates.map(d=>d+" 순위")];
  const lines=[head.join(",")];
  for(const d of rowsCache){
    const det=(!SOURCES[src].caps.series && DETAILS[d.id])||{};
    lines.push([d.r,q(d.name),q(d.a),q(det.g||""),q(det.cp==="다중"?"여러 제작사":(det.cp||"")),q(det.launch||""),det.star||"",det.cmt||"",det.ep||"",det.fav||"",DAILYPLUS.has(d.id)?"Y":"",q((det.k||[]).join(" ")),q(cross(d)), ...trend.rankFn(d)].join(","));
  }
  const blob=new Blob(["﻿"+lines.join("\r\n")],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download=`웹툰랭킹_${src}${variant?"_"+variant:""}_${sub}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
}
/* 작품별 회차 댓글·별점 CSV */
async function exportEpisodeCSV(id, name){
  let data;
  try{ data = await fetchJSON(`data/episodes/${id}.json`); }
  catch(e){ alert("이 작품의 회차별 데이터는 아직 수집 전이에요.\n전체 작품 백필이 진행 중이라 며칠에 걸쳐 채워집니다."); return; }
  const q=s=>`"${String(s==null?"":s).replace(/"/g,'""')}"`;
  const head=["회차번호","회차","날짜","별점","댓글수","유료"];
  const lines=[head.join(",")];
  for(const e of (data.eps||[])) lines.push([e.no,q(e.sub),q(e.date||""),e.star||"",e.cmt!=null?e.cmt:"",e.charge?"Y":""].join(","));
  const blob=new Blob(["﻿"+lines.join("\r\n")],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`${name}_회차별.csv`;
  document.body.appendChild(a); a.click(); a.remove();
}
/* basisKey → 사람이 읽는 라벨 */
const WDMAP=Object.fromEntries(WEEKDAYS), PMAP=Object.fromEntries(PERIODS);
function basisLabel(key){
  if(key.startsWith("app_")) return "앱주간 "+key.slice(4);
  if(key.startsWith("wd_web_")) return "요일 웹 "+(WDMAP[key.slice(7)]||key.slice(7));
  if(key.startsWith("wd_app_")) return "요일 모바일웹 "+(WDMAP[key.slice(7)]||key.slice(7));   // 예전 m.comic 기록(엑셀에만)
  if(key.startsWith("awd_")){ const m=key.slice(4).match(/^(.*?)(?:_(f|m))?$/), t=m[1], sx=m[2]==="f"?" 여성":m[2]==="m"?" 남성":"", s=APPWD_SUBS.find(x=>x[0]===t); return "요일 앱 "+(s?s[1]:t)+sx; }
  if(key.startsWith("series_comic_")||key.startsWith("series_novel_")){ const svc=key.startsWith("series_comic_")?"웹툰":"웹소설"; const parts=key.slice(13).split("_"); const p=parts.pop(); const pf=parts.join("_"); return "시리즈 "+svc+(pf?" "+(pf==="web"?"웹":pf==="mobile"?"모바일":pf):"")+" "+(PMAP[p]||p); }
  return key;
}
/* 작품별 순위 추이 — 기준(basis)별 시트로 나눈 xlsx */
async function exportTrendXLSX(id, name){
  if(!window.MiniXlsx){ alert("엑셀 모듈 로딩 실패 — 새로고침 후 다시 시도해주세요."); return; }
  await ensureHistory();
  const dates=(HISTORY&&HISTORY.dates)||[], sheets=[];
  for(const [key,S] of Object.entries((HISTORY&&HISTORY.series)||{})){
    if(key.startsWith("gn_")) continue;   // 웹·모바일 장르 순위는 2026-10-20부터 안 씀(앱 장르 주간으로 대체)
    if(S[id]) sheets.push({ name:basisLabel(key), rows:[["날짜","순위"], ...dates.map((d,i)=>[d, S[id][i]==null?"":S[id][i]])] });
  }
  if(!SOURCES[src].caps.series){
    await ensureAppWd();   // 앱 요일별(폰) 날짜별 순위
    const ad=(APPWDH&&APPWDH.dates)||[];
    for(const [tab,S] of Object.entries((APPWDH&&APPWDH.series)||{})) if(S[id]) sheets.push({ name:basisLabel("awd_"+tab), rows:[["날짜","순위"], ...ad.map((d,i)=>[d, S[id][i]==null?"":S[id][i]])] });
    const wc={};
    for(const w of WEEKS){ try{ wc[w]=(await fetchJSON(`data/${w}.json`)).charts; }catch(e){ wc[w]={}; } }
    for(const c of ["전체","여성","남성"]){
      const rows=WEEKS.map(w=>{ const r=((wc[w]&&wc[w][c])||[]).find(x=>x.t===name); return [w, r?r.r:""]; });
      if(rows.some(r=>r[1]!=="")) sheets.push({ name:"앱주간 "+c, rows:[["주차","순위"], ...rows] });
    }
    await ensureAgenHist();   // 앱 장르 주간(주차별)
    for(const [g,S] of Object.entries((AGENH&&AGENH.series)||{})) if(S[id]) sheets.push({ name:"앱 장르 주간 "+g, rows:[["주차","순위"], ...AGENH.weeks.map((w,i)=>[w, S[id][i]==null?"":S[id][i]])] });
  }
  if(!sheets.length){ alert("아직 이 작품의 순위 추이 데이터가 없어요.\n(요일별·시리즈는 매일, 앱주간·앱 장르 주간은 매주 쌓입니다)"); return; }
  MiniXlsx.downloadMulti(sheets, name+"_순위추이");
}
function wireTheme(){
  document.getElementById("tbtn").addEventListener("click", ()=>{
    const cur=document.documentElement.getAttribute("data-theme");
    const isDark=cur?cur==="dark":matchMedia("(prefers-color-scheme:dark)").matches;
    const next=isDark?"light":"dark";
    document.documentElement.setAttribute("data-theme",next);
    try{ localStorage.setItem("wt-theme",next); }catch(e){}
  });
  const dl=document.getElementById("dlbtn"); if(dl) dl.addEventListener("click", exportCSV);
}
boot();
