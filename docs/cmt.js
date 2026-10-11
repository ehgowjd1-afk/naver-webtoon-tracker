"use strict";
/* 작품 상세의 '댓글' 칸 (app.js 모달이 CMT.render 를 부름)
 * ① 회차별 댓글 수 세로 막대 — 네이버웹툰 전 작품, 매일 갱신(data/ep_counts/{id%16}.json, 화면의 '댓글 N' = 답글 포함)
 *    + 하루에 달린 댓글(data/cmt_history.json — 작품 전체 댓글 수의 날짜별 누적에서 차이)
 * ② AI 댓글 분석이 있는 작품(data/cmt/{id}.json): 막대를 누르면 그 회차의 내용·반응·많이 나온 반응·불호,
 *    아래에 작품 분석·독자 분석·반응이 바뀐 회차·반복 반응 묶음. 댓글 원문은 싣지 않는다(공개 저장소).
 */
(function(){
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
  const num = n => n == null ? "-" : Number(n).toLocaleString();
  const man = v => v >= 10000 ? (Math.round(v/1000)/10) + "만" : num(v);
  const get = p => fetch(p, { cache:"no-cache" }).then(r => r.ok ? r.json() : null).catch(() => null);
  const C = { shards:{}, hist:null, idx:null, works:{}, eps:{} };
  const shard = id => C.shards[id % 16] || (C.shards[id % 16] = get(`data/ep_counts/${id % 16}.json`));
  const hist = () => C.hist || (C.hist = get("data/cmt_history.json"));
  const cidx = () => C.idx || (C.idx = get("data/cmt/index.json"));
  const work = id => C.works[id] || (C.works[id] = cidx().then(ix => (ix && ix.works && ix.works[id]) ? get(`data/cmt/${id}.json`) : null));
  const epInfo = id => C.eps[id] || (C.eps[id] = get(`data/episodes/${id}.json`));

  const MOOD = { hot:["열광","m-hot"], good:["좋음","m-good"], mixed:["갈림","m-mixed"], cold:["실망","m-cold"], flat:["밋밋","m-flat"] };
  const BUCKET = { like:["좋다는 말","b-like"], talk:["많이 하는 말","b-talk"], dislike:["불호","b-dis"] };
  const DK = ["고구마","캐릭터 답답","전개 억지"];
  const TONEGRP = [["칭찬·환호",["praise"],"t-praise"],["과몰입·투정",["char","tease","nudge"],"t-char"],["추리",["theory"],"t-theory"],["불호",["critic"],"t-critic"],["기타",["other","fan"],"t-other"]];

  // 회차 목록 합치기: 매일 센 댓글 수(ep_counts) + 회차 제목·날짜·별점(episodes) + AI 분석(cmt)
  function mergeEps(id, sh, ei, an){
    const m = new Map();
    const at = no => m.get(no) || (m.set(no, { no }), m.get(no));
    const w = sh && sh.works && sh.works[id];
    if(w) w.c.forEach((c, i) => { if(c > 0) at(w.s + i).c = c; });
    if(ei && ei.eps) for(const e of ei.eps){ const x = at(e.no); x.l = x.l || e.sub; x.d = x.d || e.date; if(e.star) x.star = e.star; if(x.c == null && e.cmt) x.c = e.cmt; }
    if(an && an.eps) for(const e of an.eps){ const x = at(e.no); x.a = e; if(e.l) x.l = e.l; if(e.d && !x.d) x.d = e.d; if(x.c == null && e.c) x.c = e.c; }
    return [...m.values()].filter(x => x.c > 0).sort((a, b) => a.no - b.no);
  }
  const label = e => e.l || `${e.no}번`;
  const kcls = e => !e.a ? "" : e.a.k === "급증" ? " k-up" : (e.a.k === "급감 직전" || e.a.k === "급감 시작") ? " k-down" : "";

  function chartHtml(eps, sel){
    const mx = Math.max(...eps.map(e => e.c)), n = eps.length, wide = n > 140;
    const bars = eps.map(e => `<button type="button" class="cbar${kcls(e)}${e.no === sel ? " sel" : ""}" data-ep="${e.no}" style="height:${Math.max(2, Math.round(e.c / mx * 100))}%" aria-label="${esc(label(e))} 댓글 ${num(e.c)}개"></button>`).join("");
    const legend = eps.some(e => e.a && e.a.k) ? `<span class="cleg"><i class="k-up"></i>댓글 급증 <i class="k-down"></i>급감 지점</span>` : "";
    return `<div class="cchart-wrap"><div class="cymax tnum">${man(mx)}</div>
      <div class="cscroll"${wide ? ` data-wide="1"` : ""}><div class="cbars" style="${wide ? `min-width:${n * 3}px` : ""}">${bars}</div></div>
      <div class="cxax"><span>${esc(label(eps[0]))}</span>${legend}<span>${esc(label(eps[n - 1]))}</span></div></div>`;
  }
  function dailyHtml(h, id){
    const w = h && h.works && h.works[id]; if(!w) return "";
    const pts = h.dates.map((d, i) => [d, w.v[i]]).filter(x => x[1] != null);
    if(pts.length < 2) return `<div class="cday-note">작품 전체 댓글 ${num(pts.length ? pts[0][1] : null)}개 · 오늘부터 매일 쌓아서 하루에 달린 댓글을 보여드려요</div>`;
    const inc = pts.slice(1).map((p, i) => [p[0], Math.max(0, p[1] - pts[i][1])]).slice(-30);
    const mx = Math.max(1, ...inc.map(x => x[1])), last = inc[inc.length - 1];
    return `<div class="cday"><div class="cdayhd"><span>하루에 달린 댓글</span><b class="tnum">${last[0].slice(5).replace("-","/")} +${num(last[1])}</b></div>
      <div class="cdaybars">${inc.map(([d, v]) => `<i style="height:${Math.max(3, Math.round(v / mx * 100))}%" title="${d} +${num(v)}"></i>`).join("")}</div></div>`;
  }
  function epPanel(e, an){
    if(!e) return "";
    const a = e.a, chips = [];
    if(a && a.x) chips.push(`<span class="cchip ${a.k === "급증" ? "k-up" : ""}">앞뒤 회차의 ${a.x}배</span>`);
    if(a && a.dr) chips.push(`<span class="cchip k-down">이후 ${a.dr}%↓</span>`);
    for(const f of (a && a.f) || []) if(f !== "댓글 급증") chips.push(`<span class="cchip">${esc(f)}</span>`);
    for(const x of (a && a.ext) || []) chips.push(`<span class="cchip c-ext">${esc(x)}</span>`);
    if(a && a.m && MOOD[a.m]) chips.unshift(`<span class="cchip ${MOOD[a.m][1]}">${MOOD[a.m][0]}</span>`);
    let h = `<div class="cep"><div class="ceph"><b>${esc(label(e))}</b><span class="tnum">${e.d ? esc(e.d) + " · " : ""}댓글 ${num(e.c)}개${e.star ? " · ★" + e.star : ""}</span></div>`;
    if(chips.length) h += `<div class="cchips">${chips.join("")}</div>`;
    if(a && (a.s || a.r)){
      if(a.s) h += `<div class="crow"><span class="ck">이 화 내용</span><span class="cv">${esc(a.s)}</span></div>`;
      if(a.r) h += `<div class="crow"><span class="ck">독자 반응</span><span class="cv">${esc(a.r)}</span></div>`;
    }
    if(a && a.t && a.t.length && an) h += `<div class="crow"><span class="ck">많이 나온 반응</span><span class="cv">${a.t.map(([i, n]) => { const t = an.themes[i]; return t ? `<span class="ctag ${BUCKET[t.b][1]}">${esc(t.l)} <b>${n}</b></span>` : ""; }).join("")}</span></div>`;
    if(a && a.dk) h += `<div class="crow"><span class="ck">불호</span><span class="cv">${a.dk.map((n, i) => n ? `<span class="ctag b-dis">${DK[i]} <b>${n}</b></span>` : "").join("")}</span></div>`;
    if(a && a.tn && a.n){
      const parts = TONEGRP.map(([lab, ks, cls]) => [lab, ks.reduce((t, k) => t + (a.tn[k] || 0), 0), cls]).filter(x => x[1]);
      const tot = parts.reduce((t, x) => t + x[1], 0) || 1;
      h += `<div class="ctone" title="이 화에서 분석한 댓글 ${a.n}개의 속뜻">${parts.map(([lab, v, cls]) => `<i class="${cls}" style="width:${v / tot * 100}%"></i>`).join("")}</div>
        <div class="ctoneleg">${parts.map(([lab, v, cls]) => `<span><i class="${cls}"></i>${lab} ${Math.round(v / tot * 100)}%</span>`).join("")}</div>`;
    }
    if(!a && an) h += `<div class="cmuted">이 회차는 AI 분석 대상이 아니었어요.</div>`;
    return h + `</div>`;
  }
  const epLinks = (nos, eps) => (nos || []).filter(no => eps.some(e => e.no === no)).slice(0, 6).map(no => { const e = eps.find(x => x.no === no); return `<button type="button" class="celink" data-ep="${no}">${esc(label(e))}</button>`; }).join("");
  function analysisHtml(an, eps){
    const A = an.analysis; let h = "";
    if(A){
      h += `<details class="csec" open><summary>📝 작품 분석</summary>`;
      if(A.summary) h += `<p class="csum">${esc(A.summary)}</p>`;
      const pts = (arr, cls, mark) => (arr || []).map(p => `<div class="cpt ${cls}"><div class="cpth"><span class="caxis">${esc(p.axis)}</span><b>${mark} ${esc(p.point)}</b></div><div class="cptw">${esc(p.why)}</div>${p.eps && p.eps.length ? `<div class="celinks">${epLinks(p.eps, eps)}</div>` : ""}</div>`).join("");
      if((A.strengths || []).length) h += `<div class="csub">먹힌 요소</div>` + pts(A.strengths, "p-good", "＋");
      if((A.weaknesses || []).length) h += `<div class="csub">안 먹힌 요소</div>` + pts(A.weaknesses, "p-bad", "－");
      if((A.turns || []).length) h += `<div class="csub">반응이 바뀐 회차</div>` + A.turns.map(t => { const e = eps.find(x => x.no === t.no); return `<div class="cturn"><button type="button" class="celink" data-ep="${t.no}">${esc(e ? label(e) : t.no + "번")}</button><div><b>${esc(t.what)}</b><span>${esc(t.effect)}</span></div></div>`; }).join("");
      h += `</details>`;
      const R = A.readers;
      if(R){
        h += `<details class="csec" open><summary>👥 독자 분석</summary>`;
        if(R.who) h += `<div class="crow"><span class="ck">독자층</span><span class="cv">${esc(R.who)}</span></div>`;
        if((R.wants || []).length) h += `<div class="crow"><span class="ck">바라는 것</span><span class="cv"><ul class="clist">${R.wants.map(x => `<li><b>${esc(x.want)}</b> — ${esc(x.why)}</li>`).join("")}</ul></span></div>`;
        if((R.splits || []).length) h += `<div class="crow"><span class="ck">갈리는 지점</span><span class="cv"><ul class="clist">${R.splits.map(x => `<li><b>${esc(x.topic)}</b> — ${esc(x.sides)}</li>`).join("")}</ul></span></div>`;
        if(R.churn) h += `<div class="crow"><span class="ck">이탈 신호</span><span class="cv">${esc(R.churn)}</span></div>`;
        h += `</details>`;
      }
    }
    const col = b => { const ts = an.themes.filter(t => t.b === b).slice(0, 8); return ts.length ? ts.map(t => `<div class="cth"><div class="cthh"><span>${esc(t.l)}</span><b class="tnum">${num(t.n)}</b></div><div class="cthe">좋아요 ${man(t.lk)} · ${t.e.slice(0, 3).map(([l, n]) => `${esc(l)} ${n}`).join(", ")}</div></div>`).join("") : `<div class="cmuted">없음</div>`; };
    const dis = an.dislike.filter(x => x.n).sort((a, b) => b.n - a.n);
    h += `<details class="csec"><summary>💬 반복되는 반응 (댓글 ${num(an.n.total)}개)</summary>
      <div class="csub"><span class="ctag b-like">좋다는 말</span></div>${col("like")}
      <div class="csub"><span class="ctag b-talk">많이 하는 말</span></div>${col("talk")}
      <div class="csub"><span class="ctag b-dis">불호</span> 고구마·캐릭터 답답·전개 억지만, 한 번 더 확인한 것</div>${dis.length ? dis.map(x => `<div class="cth"><div class="cthh"><span>${esc(DK[["goguma","stuffy","forced"].indexOf(x.k)] || x.l)}</span><b class="tnum">${num(x.n)}</b></div><div class="cthe">좋아요 ${man(x.lk)} · 몰린 회차 ${x.e.slice(0, 3).map(([l, n]) => `${esc(l)} ${n}`).join(", ")}</div></div>`).join("") : `<div class="cmuted">뚜렷한 불호 없음</div>`}
      ${col("dislike") !== `<div class="cmuted">없음</div>` ? `<div class="csub">불호 쪽 반복 반응</div>${col("dislike")}` : ""}
    </details>`;
    h += `<div class="cfoot">AI 분석 · 전 회차 베스트 댓글 ${num(an.n.best)}개 + 댓글이 튄 회차의 공개 직후 ${num(an.n.early)}개 · 휴재·작가 인사 같은 얘기 ${num(an.n.ops)}개는 뺐어요 · ${esc(an.updated)} 기준</div>`;
    return h;
  }

  async function render(el, id, name, alive){
    if(!el || id == null) return;
    id = +id;
    const [sh, h, an, ei] = await Promise.all([shard(id), hist(), work(id), epInfo(id)]);
    if(!alive()) return;
    const eps = mergeEps(id, sh, ei, an);
    const card = el.closest(".modal-card"); if(card) card.classList.toggle("wide", !!an);
    if(!eps.length){ el.hidden = true; return; }
    const tot = eps.reduce((t, e) => t + e.c, 0), top = eps.reduce((a, b) => b.c > a.c ? b : a);
    const first = an && an.analysis && (an.analysis.turns || []).find(t => eps.some(e => e.no === t.no));
    let sel = first ? first.no : (an ? (eps.filter(e => e.a && e.a.k === "급증").sort((a, b) => b.a.x - a.a.x)[0] || eps[eps.length - 1]).no : eps[eps.length - 1].no);
    const updated = sh && sh.works && sh.works[id] ? sh.works[id].at : (ei && ei.updated ? String(ei.updated).slice(0, 10) : "");
    el.innerHTML = `<div class="mrevbox cbox">
      <div class="mrevhd"><span class="mrevt">💬 회차별 댓글 수</span><span class="mrevn">${eps.length}화 · ${updated ? esc(updated) + " 기준" : ""}</span></div>
      <div class="cstat tnum">회차 평균 <b>${num(Math.round(tot / eps.length))}</b> · 가장 많은 화 <b>${esc(label(top))}</b> ${num(top.c)}개</div>
      ${chartHtml(eps, sel)}
      <div class="chint">막대를 누르면 그 회차를 볼 수 있어요${an ? " — AI가 댓글로 짐작한 내용·반응이 함께 나와요" : ""}</div>
      <div class="cepbox">${epPanel(eps.find(e => e.no === sel), an)}</div>
      ${dailyHtml(h, id)}
      ${an ? analysisHtml(an, eps) : ""}
    </div>`;
    el.hidden = false;
    const sc = el.querySelector(".cscroll[data-wide]"); if(sc) sc.scrollLeft = sc.scrollWidth;
    const pick = no => {
      sel = no;
      el.querySelectorAll(".cbar.sel").forEach(b => b.classList.remove("sel"));
      const b = el.querySelector(`.cbar[data-ep="${no}"]`); if(b){ b.classList.add("sel"); const s = b.closest(".cscroll"); if(s && s.dataset.wide) { const r = b.offsetLeft - s.clientWidth / 2; s.scrollLeft = Math.max(0, r); } }
      el.querySelector(".cepbox").innerHTML = epPanel(eps.find(e => e.no === no), an);
    };
    el.onclick = ev => { const t = ev.target.closest("[data-ep]"); if(!t) return; pick(+t.dataset.ep); if(t.classList.contains("celink")) el.querySelector(".cchart-wrap").scrollIntoView({ block:"nearest", behavior:"smooth" }); };
    el.onmouseover = ev => { const t = ev.target.closest(".cbar"); if(!t) return; const e = eps.find(x => x.no === +t.dataset.ep); const hint = el.querySelector(".chint"); if(e && hint) hint.textContent = `${label(e)} · 댓글 ${num(e.c)}개${e.d ? " · " + e.d : ""}${e.a && e.a.k ? " · " + e.a.k : ""}`; };
    el.onmouseleave = () => { const hint = el.querySelector(".chint"); if(hint) hint.textContent = `막대를 누르면 그 회차를 볼 수 있어요${an ? " — AI가 댓글로 짐작한 내용·반응이 함께 나와요" : ""}`; };
  }
  window.CMT = { render };
})();
