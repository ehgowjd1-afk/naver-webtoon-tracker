"use strict";
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const CATS = [["전체","TOP 100"],["여성","TOP 50"],["남성","TOP 50"]];
const FILTERS = [["all","전체"],["up","상승"],["down","하락"],["new","신작·진입"],["streak","연속기록"],["rest","휴재"]];
const SORTS = [["rank","순위순"],["up","상승폭"],["down","하락폭"]];

let WEEKS = [], CHARTS = null, cat = "전체", fMode = "all", sMode = "rank", query = "";

async function fetchJSON(p){
  const r = await fetch(p, { cache: "no-cache" });
  if (!r.ok) throw new Error(p + " → " + r.status);
  return r.json();
}

/* ---------- boot ---------- */
async function boot(){
  try { const sv = localStorage.getItem("wt-theme"); if (sv) document.documentElement.setAttribute("data-theme", sv); } catch(e){}
  wireTheme(); wireControls(); renderCats();

  let idx;
  try { idx = await fetchJSON("data/index.json"); }
  catch(e){ document.getElementById("board").innerHTML = `<li class="empty">데이터를 불러오지 못했어요. 새로고침 해주세요.</li>`; return; }

  WEEKS = idx.weeks.slice();
  const wsel = document.getElementById("wsel");
  wsel.innerHTML = WEEKS.slice().reverse().map(w => `<option value="${w}">${w.replace(/-/g,".")}</option>`).join("");
  wsel.value = idx.latest || WEEKS[WEEKS.length-1];
  wsel.addEventListener("change", () => loadWeek(wsel.value));
  if (WEEKS.length < 2) wsel.style.display = "none";
  await loadWeek(wsel.value);
}

async function loadWeek(date){
  let wk;
  try { wk = await fetchJSON(`data/${date}.json`); }
  catch(e){ document.getElementById("board").innerHTML = `<li class="empty">${date} 데이터를 불러오지 못했어요.</li>`; return; }
  CHARTS = wk.charts;
  const no = WEEKS.indexOf(date) + 1;
  document.getElementById("metadate").textContent = date.replace(/-/g, ".");
  document.getElementById("metaweek").textContent = no + "주차 스냅샷";
  renderGap(); renderStats(); render();
}

/* ---------- category tabs ---------- */
function renderCats(){
  const el = document.getElementById("cats");
  el.innerHTML = CATS.map(([k,d],i) => `<button class="cat" role="tab" data-cat="${k}" aria-selected="${i===0}">${k}<span>${d}</span></button>`).join("");
  el.addEventListener("click", e => {
    const b = e.target.closest("[data-cat]"); if (!b) return;
    cat = b.dataset.cat;
    [...el.children].forEach(c => c.setAttribute("aria-selected", c === b));
    document.getElementById("metacat").textContent = cat + " " + CATS.find(c => c[0]===cat)[1];
    renderStats(); render();
  });
}

/* ---------- gender gap (여성 vs 남성) ---------- */
function renderGap(){
  const F = CHARTS["여성"] || [], M = CHARTS["남성"] || [];
  const fmap = new Map(F.map(d => [d.t, d.r])), mmap = new Map(M.map(d => [d.t, d.r]));
  const both = [...fmap.keys()].filter(t => mmap.has(t));
  const rows = both.map(t => ({ t, f: fmap.get(t), m: mmap.get(t), gap: mmap.get(t) - fmap.get(t) }))
    .sort((a,b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0,5);
  document.getElementById("gaphint").innerHTML = `남·여 TOP${Math.max(F.length,M.length)}에 <b>동시</b> 등장은 <b>${both.length}작품</b>뿐 — 나머지는 성별로 갈립니다.`;
  document.getElementById("gap").innerHTML = rows.map(r => {
    const lean = r.gap > 0 ? `<span class="lean lean-f">여성 +${r.gap}</span>` : `<span class="lean lean-m">남성 +${-r.gap}</span>`;
    return `<div class="grow"><span class="gt">${esc(r.t)}</span><span class="gr">남 ${r.m} · 여 ${r.f}</span>${lean}</div>`;
  }).join("");
}

/* ---------- stat tiles + distribution ---------- */
function renderStats(){
  const D = CHARTS[cat];
  const up = [...D].filter(d => d.m > 0).sort((a,b) => b.m - a.m);
  const down = [...D].filter(d => d.m < 0).sort((a,b) => a.m - b.m);
  const news = D.filter(d => d.b.includes("신작") || d.b.includes("진입"));
  const streaks = [...D].filter(d => d.s > 0).sort((a,b) => b.s - a.s);
  const tu = up[0], td = down[0], ts = streaks[0];
  document.getElementById("tiles").innerHTML = [
    { lab:"▲ 최대 상승", cls:"up", big: tu ? esc(tu.t) : "—", sub: tu ? `${tu.r}위 · ▲${tu.m}계단` : "" },
    { lab:"▼ 최대 하락", cls:"down", big: td ? esc(td.t) : "—", sub: td ? `${td.r}위 · ▼${Math.abs(td.m)}계단` : "" },
    { lab:"🆕 신작·진입", cls:"acc", big:`${news.length}작품`, sub: news.slice(0,2).map(n => n.t).join(", ") + (news.length>2 ? " 외" : "") },
    { lab:"👑 최장 연속", cls:"acc", big: ts ? `${ts.s}주` : "—", sub: ts ? esc(ts.t) : "" }
  ].map(t => `<div class="tile"><div class="lab">${t.lab}</div><div class="big ${t.cls}">${t.big}</div><div class="sub">${esc(t.sub)}</div></div>`).join("");
  const nU = D.filter(d => d.m>0).length, nD = D.filter(d => d.m<0).length, nS = D.filter(d => d.m===0).length, tot = D.length || 1;
  document.getElementById("distbar").innerHTML = `<span class="s-up" style="width:${nU/tot*100}%"></span><span class="s-down" style="width:${nD/tot*100}%"></span><span class="s-same" style="width:${nS/tot*100}%"></span>`;
  document.getElementById("distleg").innerHTML = `<span><i style="background:var(--up)"></i>상승 <b>${nU}</b></span><span><i style="background:var(--down)"></i>하락 <b>${nD}</b></span><span><i style="background:var(--same)"></i>유지 <b>${nS}</b></span>`;
}

/* ---------- controls ---------- */
function wireControls(){
  const fEl = document.getElementById("filters"), sEl = document.getElementById("sorts");
  fEl.innerHTML = FILTERS.map(([k,l]) => `<button class="chip" data-f="${k}" aria-pressed="${k==="all"}">${l}</button>`).join("");
  sEl.innerHTML = SORTS.map(([k,l]) => `<button class="chip" data-s="${k}" aria-pressed="${k==="rank"}">${l}</button>`).join("");
  fEl.addEventListener("click", e => { const b = e.target.closest("[data-f]"); if(!b) return; fMode = b.dataset.f; [...fEl.children].forEach(c => c.setAttribute("aria-pressed", c===b)); render(); });
  sEl.addEventListener("click", e => { const b = e.target.closest("[data-s]"); if(!b) return; sMode = b.dataset.s; [...sEl.children].forEach(c => c.setAttribute("aria-pressed", c===b)); render(); });
  document.getElementById("q").addEventListener("input", e => { query = e.target.value.trim().toLowerCase(); render(); });
}

/* ---------- list ---------- */
function moveHtml(m){
  if (m > 0) return `<span class="move m-up ${m>=10?"m-big":""}"><span class="arw">▲</span>${m}</span>`;
  if (m < 0) return `<span class="move m-down ${Math.abs(m)>=10?"m-big":""}"><span class="arw">▼</span>${Math.abs(m)}</span>`;
  return `<span class="move m-same">—</span>`;
}
function badgeHtml(d){
  let h = "";
  if (d.s > 0) h += `<span class="badge b-streak">${d.r===1 ? "연속 "+d.s+"주 1위" : "연속 "+d.s+"주"}</span>`;
  if (d.b.includes("1위탈환")) h += `<span class="badge b-enter">1위 탈환</span>`;
  if (d.b.includes("신작")) h += `<span class="badge b-new">신작</span>`;
  if (d.b.includes("진입")) h += `<span class="badge b-enter">진입</span>`;
  if (d.b.includes("재진입")) h += `<span class="badge b-enter">재진입</span>`;
  if (d.b.includes("완결")) h += `<span class="badge b-fin">완결</span>`;
  if (d.b.includes("휴재")) h += `<span class="badge b-rest">휴재</span>`;
  if (d.b.includes("UP")) h += `<span class="badge b-up">UP</span>`;
  return h;
}
function render(){
  if (!CHARTS) return;
  const D = CHARTS[cat];
  let rows = D.filter(d => {
    if (query && !(d.t.toLowerCase().includes(query) || d.a.toLowerCase().includes(query))) return false;
    if (fMode === "up") return d.m > 0;
    if (fMode === "down") return d.m < 0;
    if (fMode === "new") return d.b.includes("신작") || d.b.includes("진입") || d.b.includes("재진입");
    if (fMode === "streak") return d.s > 0;
    if (fMode === "rest") return d.b.includes("휴재");
    return true;
  });
  if (sMode === "up") rows = [...rows].sort((a,b) => b.m - a.m);
  else if (sMode === "down") rows = [...rows].sort((a,b) => a.m - b.m);
  else rows = [...rows].sort((a,b) => a.r - b.r);

  const countEl = document.getElementById("count"), board = document.getElementById("board");
  countEl.textContent = `${rows.length}개 작품` + (fMode!=="all" || query ? ` (${cat} ${D.length}개 중)` : "");
  if (!rows.length) { board.innerHTML = `<li class="empty">조건에 맞는 작품이 없어요.</li>`; return; }
  board.innerHTML = rows.map(d => `
    <li class="rowli ${d.r<=3 ? "top"+d.r : ""}">
      <div class="rk tnum">${d.r}</div>
      <div class="cell"><div class="ttl"><span class="name">${esc(d.t)}</span>${badgeHtml(d)}</div><div class="auth">${esc(d.a)}</div></div>
      ${moveHtml(d.m)}
    </li>`).join("");
}

/* ---------- theme ---------- */
function wireTheme(){
  document.getElementById("tbtn").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    const isDark = cur ? cur === "dark" : matchMedia("(prefers-color-scheme:dark)").matches;
    const next = isDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("wt-theme", next); } catch(e){}
  });
}

boot();
