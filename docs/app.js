"use strict";
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));

const WEEKDAYS = [["mon","월"],["tue","화"],["wed","수"],["thu","목"],["fri","금"],["sat","토"],["sun","일"],["dailyPlus","매일+"]];
const GENRES = [["HISTORICAL","무협/사극"],["FANTASY","판타지"],["ACTION","액션"],["DRAMA","드라마"],["PURE","순정"],["SENSIBILITY","감성"],["DAILY","일상"],["COMIC","개그"],["THRILL","스릴러"],["SPORTS","스포츠"]];
const PERIODS = [["DAILY","일간"],["WEEKLY","주간"],["MONTHLY","월간"]];

let APP=null, WEEKDAY=null, GENRE=null, SERIES=null, LOOKUP={id:{},name:{}}, WEEKS=[];
let src="app", variant=null, sub="전체", fMode="all", sMode="rank", query="";
let rowsCache=[];

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
function openModal(d){
  const url=urlFor(d), caps=SOURCES[src].caps;
  const badges=badgeHtml(d)+(caps.move?`<span class="badge ${d.m>0?"b-new":d.m<0?"b-rest":"b-fin"}">${d.m>0?"▲"+d.m:d.m<0?"▼"+Math.abs(d.m):"변동없음"}</span>`:"");
  const ctx=`${esc(SOURCES[src].label)}${variant?" · "+esc(varLabel()):""} · ${esc(subLabel(sub))} · <b>${d.r}위</b>`;
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
    <a class="mlink" href="${url}" target="_blank" rel="noopener noreferrer">네이버에서 작품 보기 →</a>`;
  document.getElementById("modal").hidden=false;
}
function wireModal(){
  const modal=document.getElementById("modal"), close=()=>{ modal.hidden=true; };
  document.getElementById("modalBack").onclick=close;
  document.getElementById("modalX").onclick=close;
  document.addEventListener("keydown", e=>{ if(e.key==="Escape"&&!modal.hidden) close(); });
  const board=document.getElementById("board");
  board.addEventListener("click", e=>{ const li=e.target.closest("[data-i]"); if(li) openModal(rowsCache[+li.dataset.i]); });
  board.addEventListener("keydown", e=>{ if(e.key==="Enter"||e.key===" "){ const li=e.target.closest("[data-i]"); if(li){ e.preventDefault(); openModal(rowsCache[+li.dataset.i]); } } });
}
function wireTheme(){
  document.getElementById("tbtn").addEventListener("click", ()=>{
    const cur=document.documentElement.getAttribute("data-theme");
    const isDark=cur?cur==="dark":matchMedia("(prefers-color-scheme:dark)").matches;
    const next=isDark?"light":"dark";
    document.documentElement.setAttribute("data-theme",next);
    try{ localStorage.setItem("wt-theme",next); }catch(e){}
  });
}
boot();
