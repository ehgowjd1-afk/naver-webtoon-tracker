"use strict";
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));

const WEEKDAYS = [["mon","월"],["tue","화"],["wed","수"],["thu","목"],["fri","금"],["sat","토"],["sun","일"],["dailyPlus","매일+"]];
const GENRES = [["HISTORICAL","무협/사극"],["FANTASY","판타지"],["ACTION","액션"],["DRAMA","드라마"],["PURE","로맨스"],["SENSIBILITY","감성"],["DAILY","일상"],["COMIC","개그"],["THRILL","스릴러"],["SPORTS","스포츠"]];
const PERIODS = [["DAILY","일간"],["WEEKLY","주간"],["MONTHLY","월간"]];

let APP=null, WEEKDAY=null, GENRE=null, SERIES=null, LOOKUP={id:{},name:{}}, WEEKS=[];
let src="app", variant=null, sub="전체", fMode="all", sMode="rank", query="";
let rowsCache=[];
let DETAILS=null, detailsLoading=null, HISTORY=null, historyLoading=null, KWINDEX=null;
const DAILYPLUS=new Set();

const F_MOVE=[["all","전체"],["up","상승"],["down","하락"]];
const F_APP=[["all","전체"],["up","상승"],["down","하락"],["new","신작·진입"],["streak","연속기록"],["rest","휴재"]];
const F_MIN=[["all","전체"]];
const S_MOVE=[["rank","순위순"],["up","상승폭"],["down","하락폭"]];
const dot = d => (d||"").replace(/-/g,".");

const SOURCES = {
  app:     { label:"앱 주간", variants:null, subs:()=>[["전체","100"],["여성","50"],["남성","50"]], data:(v,s)=>APP&&APP.charts[s], caps:{move:1,streak:1,badge:1,tiles:1,gap:1}, filters:F_APP, sorts:S_MOVE, note:()=>`${dot(APP.date)} · 앱 「이번 주 웹툰 랭킹」` },
  weekday: { label:"요일별", variants:[["app","앱"],["web","웹"]], subs:()=>WEEKDAYS, data:(v,s)=>WEEKDAY&&WEEKDAY[v]&&WEEKDAY[v][s], caps:{badge:1}, filters:F_MIN, sorts:[], note:v=>`${dot(WEEKDAY.date)} · 요일별 인기순 · ${v==="app"?"앱(모바일)":"웹(PC)"} · 자동` },
  genre:   { label:"장르", variants:[["app","앱"],["web","웹"]], subs:()=>GENRES, data:(v,s)=>GENRE&&GENRE[v]&&GENRE[v][s], caps:{badge:1}, filters:F_MIN, sorts:[], note:v=>`${dot(GENRE.date)} · 장르별 인기순 · ${v==="app"?"앱(모바일)":"웹(PC)"} · 자동` },
  series:  { label:"시리즈", variants:[["comic","웹툰"],["novel","웹소설"]], subs:()=>PERIODS, data:(v,s)=>SERIES&&SERIES[v]&&SERIES[v][s], caps:{move:1,tiles:1,series:1}, filters:F_MOVE, sorts:S_MOVE, note:v=>`${dot(SERIES.date)} · 네이버 시리즈 ${v==="comic"?"웹툰":"웹소설"} · 자동` },
};
const SRC_ORDER=["app","weekday","genre","series"];
const subLabel = s => (SOURCES[src].subs().find(x=>x[0]===s)||[s,s])[1];
const varLabel = () => { const vs=SOURCES[src].variants; return vs?(vs.find(x=>x[0]===variant)||["",""])[1]:""; };

async function fetchJSON(p){ const r=await fetch(p,{cache:"no-cache"}); if(!r.ok) throw new Error(p+" "+r.status); return r.json(); }

async function boot(){
  try{ const sv=localStorage.getItem("wt-theme"); if(sv)document.documentElement.setAttribute("data-theme",sv); }catch(e){}
  wireTheme(); wireModal();
  let idx;
  try{ idx=await fetchJSON("data/index.json"); }catch(e){ fail(); return; }
  WEEKS=idx.weeks.slice();
  const R=await Promise.allSettled([ fetchJSON(`data/${idx.latest}.json`), fetchJSON("data/weekday.json"), fetchJSON("data/genre.json"), fetchJSON("data/series.json"), fetchJSON("data/lookup.json") ]);
  APP=R[0].status==="fulfilled"?R[0].value:{date:idx.latest,charts:{전체:[],여성:[],남성:[]}};
  WEEKDAY=R[1].status==="fulfilled"?R[1].value:{date:"",web:{},app:{}};
  GENRE=R[2].status==="fulfilled"?R[2].value:{date:"",web:{},app:{}};
  SERIES=R[3].status==="fulfilled"?R[3].value:{date:"",comic:{},novel:{}};
  LOOKUP=R[4].status==="fulfilled"?R[4].value:{id:{},name:{}};
  try{ for(const v of ["web","app"]) (WEEKDAY[v]&&WEEKDAY[v].dailyPlus||[]).forEach(r=>DAILYPLUS.add(r.id)); }catch(e){}

  const wsel=document.getElementById("wsel");
  wsel.innerHTML=WEEKS.slice().reverse().map(w=>`<option value="${w}">${dot(w)}</option>`).join("");
  wsel.value=idx.latest;
  wsel.addEventListener("change", async ()=>{ try{ APP=await fetchJSON(`data/${wsel.value}.json`); if(src==="app") renderView(); }catch(e){} });
  if(WEEKS.length<2) wsel.style.display="none";

  renderSrcNav(); selectSrc("app");
}
function fail(){ document.getElementById("board").innerHTML=`<li class="empty">데이터를 불러오지 못했어요. 새로고침 해주세요.</li>`; }

function renderSrcNav(){
  const el=document.getElementById("srcnav");
  el.innerHTML=SRC_ORDER.map(k=>`<button class="src" role="tab" data-src="${k}" aria-selected="${k===src}">${SOURCES[k].label}</button>`).join("");
  el.addEventListener("click", e=>{ const b=e.target.closest("[data-src]"); if(b) selectSrc(b.dataset.src); });
}
function selectSrc(k){
  src=k; fMode="all"; sMode="rank"; query="";
  document.querySelectorAll("#srcnav .src").forEach(b=>b.setAttribute("aria-selected", b.dataset.src===k));
  const vs=SOURCES[k].variants; variant = vs?vs[0][0]:null;
  const vn=document.getElementById("varnav");
  if(vs){ vn.hidden=false; vn.innerHTML=vs.map(([code,lab],i)=>`<button class="var" role="tab" data-var="${code}" aria-selected="${i===0}">${lab}</button>`).join("");
    vn.onclick=e=>{ const b=e.target.closest("[data-var]"); if(!b)return; variant=b.dataset.var; [...vn.children].forEach(c=>c.setAttribute("aria-selected",c===b)); renderView(); };
  } else { vn.hidden=true; vn.innerHTML=""; }
  const subs=SOURCES[k].subs(); sub=subs[0][0];
  const sn=document.getElementById("subnav");
  sn.innerHTML=subs.map(([code,lab],i)=>`<button class="sub" role="tab" data-sub="${code}" aria-selected="${i===0}">${lab}${k==="app"?`<small>${subs[i][1]}</small>`:""}</button>`).join("");
  sn.onclick=e=>{ const b=e.target.closest("[data-sub]"); if(!b)return; sub=b.dataset.sub; [...sn.children].forEach(c=>c.setAttribute("aria-selected",c===b)); renderView(); };
  document.getElementById("q").value="";
  renderView();
}

/* enrich: 모바일 행({r,id})은 lookup으로 제목/썸네일/작가 채움. 시리즈는 자체 필드 사용 */
function enrichRow(d){
  if(SOURCES[src].caps.series) return { r:d.r, name:d.t, a:d.a||"", th:d.th||"", id:d.id, m:d.m||0, s:0, b:[] };
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
  document.getElementById("meta").innerHTML=`${esc(S.note(variant))} · <b>${esc(subLabel(sub))}</b>`;
  document.getElementById("tiles").hidden=!caps.tiles;
  document.getElementById("panels").hidden=!caps.tiles;
  document.getElementById("gapPanel").hidden=!caps.gap;
  if(caps.tiles) renderStats();
  if(caps.gap) renderGap();
  renderControls();
  renderList();
}
function renderControls(){
  const fEl=document.getElementById("filters"), sEl=document.getElementById("sorts");
  fEl.innerHTML=SOURCES[src].filters.map(([k,l])=>`<button class="chip" data-f="${k}" aria-pressed="${k===fMode}">${l}</button>`).join("");
  sEl.innerHTML=SOURCES[src].sorts.map(([k,l])=>`<button class="chip" data-s="${k}" aria-pressed="${k===sMode}">${l}</button>`).join("");
  fEl.onclick=e=>{ const b=e.target.closest("[data-f]"); if(!b)return; fMode=b.dataset.f; [...fEl.children].forEach(c=>c.setAttribute("aria-pressed",c===b)); renderList(); };
  sEl.onclick=e=>{ const b=e.target.closest("[data-s]"); if(!b)return; sMode=b.dataset.s; [...sEl.children].forEach(c=>c.setAttribute("aria-pressed",c===b)); renderList(); };
}
document.getElementById("q").addEventListener("input", e=>{ query=e.target.value.trim().toLowerCase(); renderList(); });

function renderStats(){
  const D=viewRows(), caps=SOURCES[src].caps;
  const up=[...D].filter(d=>d.m>0).sort((a,b)=>b.m-a.m), down=[...D].filter(d=>d.m<0).sort((a,b)=>a.m-b.m);
  const news=D.filter(d=>d.b.includes("신작")||d.b.includes("진입")), streaks=[...D].filter(d=>d.s>0).sort((a,b)=>b.s-a.s);
  const tu=up[0],td=down[0],ts=streaks[0];
  const tiles=[
    {lab:"▲ 최대 상승",cls:"up",big:tu?esc(tu.name):"—",sub:tu?`${tu.r}위 · ▲${tu.m}`:""},
    {lab:"▼ 최대 하락",cls:"down",big:td?esc(td.name):"—",sub:td?`${td.r}위 · ▼${Math.abs(td.m)}`:""},
    {lab:"🆕 신작·진입",cls:"acc",big:`${news.length}작품`,sub:news.slice(0,2).map(n=>n.name).join(", ")+(news.length>2?" 외":"")},
    caps.streak?{lab:"👑 최장 연속",cls:"acc",big:ts?`${ts.s}주`:"—",sub:ts?esc(ts.name):""}
               :{lab:"📈 상승 작품",cls:"acc",big:`${up.length}작품`,sub:`하락 ${down.length} · 유지 ${D.filter(d=>d.m===0).length}`}
  ];
  document.getElementById("tiles").innerHTML=tiles.map(t=>`<div class="tile"><div class="lab">${t.lab}</div><div class="big ${t.cls}">${t.big}</div><div class="sub2">${esc(t.sub)}</div></div>`).join("");
  const nU=up.length,nD=down.length,nS=D.filter(d=>d.m===0).length,tot=D.length||1;
  document.getElementById("distbar").innerHTML=`<span class="s-up" style="width:${nU/tot*100}%"></span><span class="s-down" style="width:${nD/tot*100}%"></span><span class="s-same" style="width:${nS/tot*100}%"></span>`;
  document.getElementById("distleg").innerHTML=`<span><i style="background:var(--up)"></i>상승 <b>${nU}</b></span><span><i style="background:var(--down)"></i>하락 <b>${nD}</b></span><span><i style="background:var(--same)"></i>유지 <b>${nS}</b></span>`;
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
function badgeHtml(d){
  let h=""; const b=d.b||[];
  if(DAILYPLUS.has(d.id)) h+=`<span class="badge b-daily">매일+</span>`;
  if(d.s>0) h+=`<span class="badge b-streak">${d.r===1?"연속 "+d.s+"주 1위":"연속 "+d.s+"주"}</span>`;
  if(b.includes("1위탈환")) h+=`<span class="badge b-enter">1위 탈환</span>`;
  if(b.includes("신작")) h+=`<span class="badge b-new">신작</span>`;
  if(b.includes("진입")) h+=`<span class="badge b-enter">진입</span>`;
  if(b.includes("재진입")) h+=`<span class="badge b-enter">재진입</span>`;
  if(b.includes("완결")) h+=`<span class="badge b-fin">완결</span>`;
  if(b.includes("휴재")) h+=`<span class="badge b-rest">휴재</span>`;
  if(b.includes("UP")) h+=`<span class="badge b-up">UP</span>`;
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
    return true;
  });
  if(sMode==="up") rows=[...rows].sort((a,b)=>b.m-a.m);
  else if(sMode==="down") rows=[...rows].sort((a,b)=>a.m-b.m);
  else rows=[...rows].sort((a,b)=>a.r-b.r);
  rowsCache=rows;
  const countEl=document.getElementById("count"), board=document.getElementById("board");
  const total=(SOURCES[src].data(variant,sub)||[]).length;
  countEl.textContent=`${rows.length}개 작품`+(fMode!=="all"||query?` (${subLabel(sub)} ${total}개 중)`:"");
  if(!rows.length){ board.innerHTML=`<li class="empty">조건에 맞는 작품이 없어요.</li>`; return; }
  board.innerHTML=rows.map((d,i)=>{
    const thumb=d.th?`<img class="thumb" loading="lazy" src="${esc(d.th)}" alt="">`:`<div class="thumb ph">🎬</div>`;
    return `<li class="rowli ${d.r<=3?"top"+d.r:""}" role="button" tabindex="0" data-i="${i}">
      <div class="rk tnum">${d.r}</div>${thumb}
      <div class="cell"><div class="ttl"><span class="name">${esc(d.name)}</span>${badgeHtml(d)}</div><div class="auth">${esc(d.a)}</div></div>
      ${caps.move?moveHtml(d.m):""}
    </li>`;
  }).join("");
}

const searchUrl = t => `https://search.naver.com/search.naver?query=${encodeURIComponent(t+" 웹툰")}`;
function urlFor(d){
  if(SOURCES[src].caps.series) return d.id?`https://series.naver.com/${variant}/detail.series?productNo=${d.id}`:searchUrl(d.name);
  return d.id?`https://comic.naver.com/webtoon/list?titleId=${d.id}`:searchUrl(d.name);
}
function ensureDetails(){ if(DETAILS) return Promise.resolve(DETAILS); if(!detailsLoading) detailsLoading=fetchJSON("data/details.json").then(d=>{DETAILS=d; buildKwIndex(); return d;}).catch(()=>DETAILS={}); return detailsLoading; }
function ensureHistory(){ if(HISTORY) return Promise.resolve(HISTORY); if(!historyLoading) historyLoading=fetchJSON("data/history.json").then(h=>HISTORY=h).catch(()=>HISTORY={dates:[],series:{}}); return historyLoading; }
function buildKwIndex(){ KWINDEX={}; for(const id in DETAILS){ for(const kw of (DETAILS[id].k||[])){ (KWINDEX[kw]||(KWINDEX[kw]=[])).push(Number(id)); } } }

function detailHtml(det){
  const info=[];
  if(det.g) info.push(["장르", det.g + (det.dailyplus?" · 매일+":"")]);
  if(det.cp) info.push(["제작사", det.cp==="다중"?"여러 제작사":det.cp]);
  if(det.launch) info.push(["런칭일", det.launch]);
  const publish=[det.day,det.age].filter(Boolean).join(" · "); if(publish) info.push(["연재", publish]);
  if(det.star) info.push(["평균 별점", "★ "+det.star]);
  if(det.cmt) info.push(["평균 댓글", det.cmt.toLocaleString()+"개"]);
  if(det.ep) info.push(["회차", det.ep+"화"]);
  if(det.fav) info.push(["관심", det.fav.toLocaleString()+"명"]);
  let h="";
  if(info.length) h+=`<div class="mrows">`+info.map(([k,v])=>`<div class="mrow"><span class="mk">${k}</span><span class="mv">${esc(v)}</span></div>`).join("")+`</div>`;
  const kws=(det.k||[]).slice(); if(det.novel) kws.push("소설원작");
  if(kws.length) h+=`<div class="mkw">`+kws.map(t=>`<button class="kw kwbtn" data-kw="${esc(t)}">#${esc(t)}</button>`).join("")+`</div>`;
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
    for(const [p,pl] of PERIODS){ const r=findRank(SERIES[variant]&&SERIES[variant][p],true); if(r) E.push([`${variant==="comic"?"웹툰":"웹소설"} ${pl}`, `series_${variant}_${p}`, r]); }
  } else {
    for(const c of ["전체","여성","남성"]){ const r=findRank(APP&&APP.charts[c],false); if(r) E.push([`앱주간 ${c}`, `app_${c}`, r]); }
    for(const [w,wl] of WEEKDAYS) for(const v of ["web","app"]){ const r=findRank(WEEKDAY[v]&&WEEKDAY[v][w],true); if(r) E.push([`요일 ${v==="app"?"앱":"웹"} ${wl}`, `wd_${v}_${w}`, r]); }
    for(const [g,gl] of GENRES) for(const v of ["web","app"]){ const r=findRank(GENRE[v]&&GENRE[v][g],true); if(r) E.push([`장르 ${v==="app"?"앱":"웹"} ${gl}`, `gn_${v}_${g}`, r]); }
  }
  if(!E.length) return "";
  const rows=E.map(([label,key,rank])=>{
    const hist=HISTORY&&HISTORY.series[key]&&HISTORY.series[key][d.id];
    const spark=hist?sparkSvg(hist):"";
    return `<div class="xrow"><span class="xlab">${esc(label)}</span>${spark}<span class="xrk">${rank}위</span></div>`;
  }).join("");
  return `<div class="xbasis"><div class="xhead">기준별 순위 · 추이</div>${rows}</div>`;
}
function openModal(d){
  const url=urlFor(d), caps=SOURCES[src].caps;
  const badges=badgeHtml(d)+(caps.move?`<span class="badge ${d.m>0?"b-new":d.m<0?"b-rest":"b-fin"}">${d.m>0?"▲"+d.m:d.m<0?"▼"+Math.abs(d.m):"변동없음"}</span>`:"");
  const ctx=`${esc(SOURCES[src].label)}${variant?" · "+esc(varLabel()):""} · ${esc(subLabel(sub))} · <b>${d.r}위</b>`;
  const webtoon = !caps.series && d.id!=null;
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
    <div class="mdetail" id="mdetail">${webtoon?'<div class="mloading">상세 불러오는 중…</div>':""}</div>
    <div id="mcross"></div>
    <button class="mepbtn" data-trend="1" data-id="${d.id}" data-name="${esc(d.name)}">⬇ 순위 추이 엑셀 (기준별 시트)</button>
    ${webtoon?`<button class="mepbtn" data-id="${d.id}" data-name="${esc(d.name)}">⬇ 회차별 댓글·별점 엑셀(CSV)</button>`:""}
    <a class="mlink" href="${url}" target="_blank" rel="noopener noreferrer">네이버에서 작품 보기 →</a>`;
  document.getElementById("modal").hidden=false;
  Promise.all([webtoon?ensureDetails():Promise.resolve(), ensureHistory()]).then(()=>{
    if(webtoon){ const el=document.getElementById("mdetail"); if(el) el.innerHTML = (DETAILS[d.id]?detailHtml(DETAILS[d.id]):'<div class="mloading">상세 정보 없음</div>'); }
    const cx=document.getElementById("mcross"); if(cx) cx.innerHTML=crossBasisHtml(d, caps.series);
  });
}
/* 키워드 클릭 → 그 키워드 작품 전부 */
function openKeywordList(kw){
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
function wireModal(){
  const modal=document.getElementById("modal"), close=()=>{ modal.hidden=true; };
  document.getElementById("modalBack").onclick=close;
  document.getElementById("modalX").onclick=close;
  document.addEventListener("keydown", e=>{ if(e.key==="Escape"&&!modal.hidden) close(); });
  document.getElementById("modalBody").addEventListener("click", e=>{
    const kb=e.target.closest("[data-kw]"); if(kb){ e.preventDefault(); openKeywordList(kb.dataset.kw); return; }
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
  if(src==="weekday") return "wd_"+variant+"_"+sub;
  if(src==="genre") return "gn_"+variant+"_"+sub;
  if(src==="series") return "series_"+variant+"_"+sub;
}
/* 날짜별 순위 추이 데이터: {dates:[], rankFn:(row)=>[각 날짜 순위]} */
async function trendData(){
  if(src==="app"){
    const charts={};
    for(const w of WEEKS){ try{ const d=await fetchJSON(`data/${w}.json`); charts[w]=(d.charts&&d.charts[sub])||[]; }catch(e){ charts[w]=[]; } }
    return { dates:WEEKS.slice(), rankFn:(row)=>WEEKS.map(w=>{ const r=(charts[w]||[]).find(x=>x.t===row.name); return r?r.r:""; }) };
  }
  await ensureHistory();
  const key=currentBasisKey(), dates=(HISTORY&&HISTORY.dates)||[], S=(HISTORY&&HISTORY.series[key])||{};
  return { dates, rankFn:(row)=>{ const a=S[row.id]||[]; return dates.map((_,i)=> a[i]==null?"":a[i]); } };
}
/* 엑셀(CSV) 다운로드 — 현재 화면 + 기준별 순위 + 집계 + 날짜별 순위추이 */
async function exportCSV(){
  await ensureDetails();
  const findRank=(rows,byId,d)=>{ if(!rows)return null; const row=byId?rows.find(r=>r.id===d.id):rows.find(r=>r.t===d.name); return row?row.r:null; };
  const cross=d=>{
    const E=[];
    if(SOURCES[src].caps.series){ for(const [p,pl] of PERIODS){ const r=findRank(SERIES[variant]&&SERIES[variant][p],true,d); if(r)E.push((variant==="comic"?"웹툰":"웹소설")+pl+r); } }
    else{
      for(const c of ["전체","여성","남성"]){ const r=findRank(APP&&APP.charts[c],false,d); if(r)E.push("앱"+c+r); }
      for(const [w,wl] of WEEKDAYS) for(const v of ["web","app"]){ const r=findRank(WEEKDAY[v]&&WEEKDAY[v][w],true,d); if(r)E.push("요일"+(v==="app"?"앱":"웹")+wl+r); }
      for(const [g,gl] of GENRES) for(const v of ["web","app"]){ const r=findRank(GENRE[v]&&GENRE[v][g],true,d); if(r)E.push("장르"+(v==="app"?"앱":"웹")+gl+r); }
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
const WDMAP=Object.fromEntries(WEEKDAYS), GNMAP=Object.fromEntries(GENRES), PMAP=Object.fromEntries(PERIODS);
function basisLabel(key){
  if(key.startsWith("app_")) return "앱주간 "+key.slice(4);
  if(key.startsWith("wd_web_")) return "요일 웹 "+(WDMAP[key.slice(7)]||key.slice(7));
  if(key.startsWith("wd_app_")) return "요일 앱 "+(WDMAP[key.slice(7)]||key.slice(7));
  if(key.startsWith("gn_web_")) return "장르 웹 "+(GNMAP[key.slice(7)]||key.slice(7));
  if(key.startsWith("gn_app_")) return "장르 앱 "+(GNMAP[key.slice(7)]||key.slice(7));
  if(key.startsWith("series_comic_")) return "시리즈 웹툰 "+(PMAP[key.slice(13)]||key.slice(13));
  if(key.startsWith("series_novel_")) return "시리즈 웹소설 "+(PMAP[key.slice(13)]||key.slice(13));
  return key;
}
/* 작품별 순위 추이 — 기준(basis)별 시트로 나눈 xlsx */
async function exportTrendXLSX(id, name){
  if(!window.MiniXlsx){ alert("엑셀 모듈 로딩 실패 — 새로고침 후 다시 시도해주세요."); return; }
  await ensureHistory();
  const dates=(HISTORY&&HISTORY.dates)||[], sheets=[];
  for(const [key,S] of Object.entries((HISTORY&&HISTORY.series)||{})){
    if(S[id]) sheets.push({ name:basisLabel(key), rows:[["날짜","순위"], ...dates.map((d,i)=>[d, S[id][i]==null?"":S[id][i]])] });
  }
  if(!SOURCES[src].caps.series){
    const wc={};
    for(const w of WEEKS){ try{ wc[w]=(await fetchJSON(`data/${w}.json`)).charts; }catch(e){ wc[w]={}; } }
    for(const c of ["전체","여성","남성"]){
      const rows=WEEKS.map(w=>{ const r=((wc[w]&&wc[w][c])||[]).find(x=>x.t===name); return [w, r?r.r:""]; });
      if(rows.some(r=>r[1]!=="")) sheets.push({ name:"앱주간 "+c, rows:[["주차","순위"], ...rows] });
    }
  }
  if(!sheets.length){ alert("아직 이 작품의 순위 추이 데이터가 없어요.\n(요일별·장르·시리즈는 매일, 앱주간은 매주 쌓입니다)"); return; }
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
