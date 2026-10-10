/* 네이버웹툰 회차 댓글 분석 — 시범 실행 (작품 1~3개) · 리디 트래커 cmt_pilot.mjs 2판('반복되는 반응을 있는 그대로 세기')의 네이버판
 *
 * ① 수집(로그인 없음, 2초 간격): 회차 목록·공개일 → 회차별 댓글 수 → 전 회차 '베스트 댓글'(공감순 최대 15) →
 *    댓글 수가 튄 회차(급증: 앞뒤 5화 둘 다의 2배↑ 상위 5개 / 급감: 다음 4화가 40%↓인 지점 3개와 그 다음 화)는 '공개 직후 첫 500개'.
 *    작성자 닉네임·아이디는 읽자마자 버린다. 작품 밖 원인(휴재 직전·복귀, 동시 공개, 미리보기)을 표시한다.
 * ② 1단계 AI(Sonnet, 일괄): 작품마다 '반복되는 반응' 묶음(좋다는 말 / 많이 하는 말 / 불호)을 정한다.
 * ③ 2단계 AI(Haiku, 일괄): 댓글마다 해당 묶음 + 속뜻 + 직접 드러난 니즈. 개수·좋아요·회차는 프로그램이 센다.
 *    '불호' 묶음엔 속뜻이 진짜 작품 불만이고 확신도가 낮지 않은 것만 (프로그램이 강제).
 * ④ 숫자 판정(cmt_judge) ⑤ 3단계 AI(Sonnet, 일괄): 참고용 니즈 맵.
 * ⑥ 결과: cmt_out/result.json(숫자·표시·묶음 — 댓글 원문 없음, AI 글이 원문과 12자 넘게 겹치면 가림) +
 *    cmt_out/full.enc.json(원문 포함 — 공개 열쇠로 잠금, 사용자 컴퓨터에서만 열림). 이 달 AI 사용액은 state/ai_state.json 에 더한다.
 *
 *   node scripts/cmt/cmt_pilot.mjs --ids 769209,793275 [--limit-usd 30] [--cap-usd 3] [--wait-min 100] [--collect-only]
 *   CMT_MOCK=1 이면 AI 대신 가짜 답으로 끝까지 돌려 본다 (돈 안 듦). 이어받기 없음(다시 모으면 표본이 바뀜).
 *   돈: 일괄을 보내는 즉시 예상 비용을 이 달 사용액에 먼저 더하고, 결과를 받으면 실제 금액으로 맞춘다.
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import * as N from "./naver_cmt.mjs";
import { CFG } from "./cmt_config.mjs";
import * as AI from "./cmt_ai.mjs";
import { judge } from "./cmt_judge.mjs";
import { createBatcher, costOf as rawCost } from "./batch.mjs";
const require = createRequire(import.meta.url);
const { seal } = require("../ai/comments_ai.js");

const STATE = "state/ai_state.json";
const OUT = "cmt_out";
const HAIKU = { model: "claude-haiku-5-5", effort: "medium" };
const SONNET = { model: "claude-sonnet-5-5", effort: "medium" };
const EST_PER_COMMENT = 0.0001;   // 2단계: 댓글 1개당 예상(일괄, 여유 있게)
const EST_THEME_WORK = 0.15;      // 1단계: 작품 1개당 예상
const EST_NEEDS_WORK = 0.15;      // 3단계: 작품 1개당 예상
const EST_RECHECK_PER = 0.0006;   // 불호 재확인: 댓글 1개당 예상(Sonnet)
const MOCK = !!process.env.CMT_MOCK;

const args = { ids: [], limitUsd: 30, capUsd: 3, waitMin: 100, collectOnly: false, summary: null };
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i], v = () => process.argv[++i];
  if (k === "--ids") args.ids = v().split(",").map((s) => s.trim()).filter(Boolean);
  else if (k === "--limit-usd") args.limitUsd = Number(v());
  else if (k === "--cap-usd") args.capUsd = Number(v());
  else if (k === "--wait-min") args.waitMin = Number(v());
  else if (k === "--collect-only") args.collectOnly = true;
  else if (k === "--summary") args.summary = v();
  else throw new Error("모르는 옵션: " + k);
}
for (const k of ["limitUsd", "capUsd", "waitMin"]) if (!Number.isFinite(args[k]) || args[k] <= 0) throw new Error(`${k} 값이 숫자가 아닙니다`);
if (!args.ids.length || args.ids.length > 3 || args.ids.some((x) => !/^\d{3,9}$/.test(x))) throw new Error("--ids 에 작품 번호(titleId) 1~3개를 쉼표로 넣어 주세요");
const T_START = Date.now();
const MONTH = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
const log = (...a) => console.log(...a);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const clip = (t, n) => N.cut(String(t).trim().replace(/\s+/g, " "), n);

// ---------------- ① 수집 ----------------
async function collect(id) {
  const info = N.workInfo(id);
  const s = await N.fetchSeries(id);
  const eps = s.episodes;
  log(`■ ${info.title} (${id}) — 회차 ${eps.length}개${s.adult ? " (성인: 번호만)" : ""}`);
  const counts = await N.fetchCounts(id, eps.map((e) => e.no));
  for (const e of eps) { e.count = counts[e.no] ?? null; e.ext = []; e.ratio = null; if (e.preview) e.ext.push("미리보기(유료)"); }
  // 급증·급감 판정: 공개 회차(미리보기 X, 댓글 있음), 최신 몇 화 제외
  const pub = eps.filter((e) => !e.preview && (e.count || 0) > 0);
  const usable = pub.slice(0, Math.max(0, pub.length - CFG.skipLatest));
  const c = usable.map((e) => e.count);
  usable.forEach((e, i) => {
    const p = med(c.slice(Math.max(0, i - CFG.baseEps), i)), q = med(c.slice(i + 1, i + 1 + CFG.baseEps));
    if (i < 3 || !p || !q) return;
    e.base = Math.max(p, q);
    if (e.base >= CFG.minBase) e.ratio = Math.round((e.count / e.base) * 100) / 100;
  });
  usable.filter((e) => e.ratio != null && e.ratio >= CFG.spikeX).sort((a, b) => b.ratio - a.ratio).slice(0, CFG.spikesPerWork).forEach((e) => { e.deep = "급증"; });
  const drops = [];
  for (let i = CFG.dropWin - 1; i < usable.length - CFG.dropWin; i++) {
    const bf = med(c.slice(i - CFG.dropWin + 1, i + 1)), af = med(c.slice(i + 1, i + 1 + CFG.dropWin));
    if (bf >= CFG.minBase && af / bf <= CFG.dropX) drops.push({ i, r: af / bf });
  }
  const kept = [];
  drops.sort((a, b) => a.r - b.r).forEach((x) => { if (!kept.some((y) => Math.abs(y.i - x.i) <= 3) && kept.length < CFG.dropsPerWork) kept.push(x); });
  for (const x of kept) {
    const e = usable[x.i]; e.drop = Math.round((1 - x.r) * 100); e.deep ||= "급감 직전";
    const nx = usable[x.i + 1]; if (nx) nx.deep ||= "급감 시작";
  }
  // 작품 밖 원인: 공개일 간격 (같은 날 = 동시 공개, 평소의 2배↑ = 휴재)
  const dated = pub.filter((e) => e.date);
  const gaps = dated.slice(1).map((e, i) => (Date.parse(e.date) - Date.parse(dated[i].date)) / 864e5).filter((g) => g > 0);
  const medGap = med(gaps) || 7;
  dated.forEach((e, i) => {
    if (!i) return;
    const g = (Date.parse(e.date) - Date.parse(dated[i - 1].date)) / 864e5;
    if (g === 0) e.ext.push("여러 화 동시 공개");
    else if (g >= CFG.hiatusX * medGap) { e.ext.push(`휴재 후 복귀(${g}일 만)`); dated[i - 1].ext.push(`휴재 직전(다음 화까지 ${g}일)`); }
  });
  // 전 회차 베스트 → 튄 회차 공개 직후
  let k = 0;
  for (const e of eps) {
    const b = await N.fetchBest(id, e.no);
    e.label = e.label || b.label || `${e.no}번`;
    e._best = b.comments.slice(0, CFG.bestPerEp);
    e.analyzed = e._best.length > 0;
    if (++k % 40 === 0) log(`  베스트 ${k}/${eps.length}화`);
  }
  for (const e of eps.filter((x) => x.deep)) {
    const r = await N.fetchEarly(id, e.no, CFG.earlyN);
    e._early = r.comments; e.firstAt = r.firstAt;
    log(`  ${e.label} (${e.deep}${e.ratio ? ` ${e.ratio}배` : ""}${e.drop ? ` 이후 ${e.drop}%↓` : ""}) 공개 직후 ${r.comments.length}개`);
  }
  return { id, ...info, adult: s.adult, episodes: eps };
}

// ---------------- ② 분석 대상(표본 없음: 베스트 전부 + 튄 회차 첫 댓글 전부) ----------------
function pickSample(w) {
  let n = 0;
  w.sample = [];
  for (const e of w.episodes) {
    const seen = new Set();
    for (const c of e._best || []) { seen.add(c.cid); w.sample.push({ ...c, n: ++n, no: e.no, label: e.label, pick: "best" }); }
    for (const c of e._early || []) if (!seen.has(c.cid)) w.sample.push({ ...c, n: ++n, no: e.no, label: e.label, pick: "early" });
  }
}

// ---------------- 일괄 처리(batch.mjs) ----------------
const costOf = (model, u) => (MOCK ? 0 : rawCost(model, u));
function mockAnswer(customId, body) {
  const ns = [...body.matchAll(/#(\d+) \[/g)].map((m) => Number(m[1]));
  if (customId.startsWith("t-")) return { themes: [
    { bucket: "like", label: "작화·연출이 미쳤다", def: "작화 칭찬", refs: ns.slice(0, 3) },
    { bucket: "talk", label: "다음 화 기다림·휴재 아쉬움", def: "기다림", refs: ns.slice(3, 5) },
    { bucket: "talk", label: "주인공에게 화내기", def: "인물 타박", refs: ns.slice(5, 7) },
    { bucket: "dislike", label: "전개가 늘어진다", def: "전개 진지한 비판", refs: ns.slice(7, 9) }] };
  if (customId.startsWith("h-")) return { comments: ns.map((n, i) => ({ n, th: [["T1"], ["T2"], ["T3"], ["T4"], [], ["T1", "T9"]][i % 6],
    tn: ["praise", "miss", "char", "critic", "other", "tease"][i % 6], nd: i % 3 ? [] : ["hero_revenge"], st: i % 3 ? "none" : "met", nn: i % 7 ? "" : "신규 니즈",
    ac: ["none", "stay", "churn", "pay"][i % 4], cf: ["hi", "mid", "lo"][i % 3] })) };
  if (customId.startsWith("r-")) return { items: ns.map((n, i) => ({ n, v: ["goguma", "stuffy", "forced", "immersion", "light", "ops", "other"][i % 7] })) };
  return { needs: [{ axis: "hero", need: "응징·사이다", state: "met", evidence: "가짜", size: "중", why: "가짜", refs: ns.slice(0, 3).concat([999999]) }] };
}

// ---------------- ③ 1단계: 반복되는 반응 찾기 ----------------
function themeText(w, perBest, perEarly) {
  const lines = [`[작품] ${w.title} / 웹툰 / ${w.genre || "-"}${w.novel ? " / 원작 소설 있음" : ""}${w.keywords.length ? " / " + w.keywords.slice(0, 6).join(", ") : ""}`, `[작품 소개] ${w.desc || "-"}`, "",
    `[댓글 표본] 1화부터 최신 화까지 회차마다 공감 많은 베스트 댓글 ${perBest}개 + 댓글 수가 튄 회차는 공개 직후 댓글 중 좋아요 많은 ${perEarly}개. 번호 [좋아요] 본문`];
  for (const e of w.episodes.filter((x) => x.analyzed)) {
    const cs = w.sample.filter((c) => c.no === e.no);
    const best = cs.filter((c) => c.pick === "best").slice(0, perBest);
    const early = cs.filter((c) => c.pick === "early").sort((a, b) => b.like - a.like).slice(0, perEarly);
    lines.push(`== ${e.label} (${e.date || "-"})${e.deep ? ` [${e.deep}]` : ""}${e.ext.length ? ` (${e.ext.join(", ")})` : ""} ==`);
    for (const c of [...best, ...early]) lines.push(`#${c.n} [${c.like}] ${clip(c.text, CFG.themeTextMax)}`);
  }
  return lines.join("\n");
}
function themeTextFor(w) {
  let b = CFG.themeBestPerEp, e = CFG.themeEarlyPerEp, t = themeText(w, b, e);
  while (t.length > CFG.synthMaxChars && (b > 2 || e > 8)) { if (b > 2) b--; if (e > 8) e = Math.floor(e * 0.8); t = themeText(w, b, e); }
  log(`  1단계 자료: ${w.title} ${t.length.toLocaleString()}자 (회차마다 베스트 ${b}개, 튄 회차 +${e}개)`);
  return t;
}
function themeRequests(works) {
  return works.map((w, wi) => ({ custom_id: `t-${wi}`, params: AI.buildThemeParams(SONNET, themeTextFor(w)) }));
}
// 묶음이 너무 적게 온 작품은 한 번 더 (2026-10-10 시범: 화산귀환이 오류 없이 1개만 옴)
const THEME_MIN = 8;
function themeRetryRequests(works) {
  return works.map((w, wi) => ({ w, wi })).filter(({ w }) => (w.themes || []).length < THEME_MIN).map(({ w, wi }) => ({
    custom_id: `t-${wi}`,
    params: AI.buildThemeParams(SONNET, themeTextFor(w) + `\n\n(주의: 앞선 답의 묶음이 ${(w.themes || []).length}개뿐이었습니다. 이 작품 댓글에서 되풀이되는 반응을 빠짐없이 찾아 반드시 15~22개 묶음으로 정리하세요. 인물별 매력·과몰입, 명장면 환호, 개그·드립, 연재 아쉬움, 추리, 원작 비교를 각각 따로 묶습니다.)`)
  }));
}
function applyThemes(works, out) {
  let usd = 0;
  for (const [cid, res] of out) {
    const w = works[Number(cid.split("-")[1])];
    if (!w || res.type !== "succeeded") { report.notes.push(`1단계 실패: ${w ? w.title : cid} (${res.type})`); continue; }
    usd += costOf(SONNET.model, res.message.usage || {});
    try {
      const valid = new Set(w.sample.map((c) => c.n));
      w.themes = (AI.parseJson(res.message).themes || []).slice(0, CFG.themeMax).map((t, i) => ({
        id: "T" + (i + 1), bucket: AI.BUCKETS[t.bucket] ? t.bucket : "talk", label: N.cut(t.label, 60), def: N.cut(t.def, 160),
        seed: [...new Set((t.refs || []).filter((n) => valid.has(n)))].slice(0, 5)
      }));
    } catch (e) { report.notes.push(`1단계 해석 실패: ${w.title} ${e.message}`); }
  }
  return usd;
}

// ---------------- ④ 2단계: 댓글마다 표시 ----------------
function classifyRequests(works) {
  const reqs = [];
  works.forEach((w, wi) => {
    if (!w.themes || !w.themes.length) return;
    for (const e of w.episodes.filter((x) => x.analyzed || x._early)) {
      const cs = w.sample.filter((c) => c.no === e.no);
      for (let k = 0; k < cs.length; k += CFG.chunk) {
        reqs.push({ custom_id: `h-${wi}-${e.no}-${k / CFG.chunk}`, params: AI.buildClassifyParams(HAIKU, w, e, cs.slice(k, k + CFG.chunk), CFG.textMax, w.themes) });
      }
    }
  });
  return reqs;
}
function applyLabels(works, out) {
  let usd = 0, failed = 0;
  for (const [cid, res] of out) {
    const w = works[Number(cid.split("-")[1])];
    if (!w || res.type !== "succeeded") { failed++; continue; }
    usd += costOf(HAIKU.model, res.message.usage || {});
    let parsed;
    try { parsed = AI.parseJson(res.message); } catch (e) { failed++; continue; }
    const byN = new Map(w.sample.map((c) => [c.n, c]));
    const themeOf = new Map((w.themes || []).map((t) => [t.id, t]));
    for (const it of parsed.comments || []) {
      const c = byN.get(it.n);
      if (!c) continue;
      const b = { th: [...new Set((it.th || []).map((x) => String(x).trim().toUpperCase()).filter((x) => themeOf.has(x)))].slice(0, 2),
        tn: it.tn, nd: [...new Set(it.nd || [])].slice(0, 3), st: it.st, nn: N.cut(it.nn, 20), ac: it.ac, cf: it.cf };
      if (["char", "tease", "miss", "nudge"].includes(b.tn) && b.ac === "churn") b.ac = "none";
      if (b.tn === "miss") { b.nd = []; b.th = []; }   // 연재 운영·작품 밖은 분석에서 뺌(사용자 결정 2026-10-11)
      if (!b.nd.length && !b.nn) b.st = "none";
      const before = b.th.length;   // '불호' 묶음엔 확신 있는 진짜 작품 불만만
      b.th = b.th.filter((id) => themeOf.get(id).bucket !== "dislike" || (b.tn === "critic" && b.cf !== "lo"));
      if (b.th.length < before) report.dropped++;
      c.lab = b;
    }
  }
  return { usd, failed };
}
// ---- 불호 재확인(Sonnet): Haiku가 critic으로 본 댓글만 → 고구마/캐릭터 답답/전개 억지 또는 '불호 아님'
const RECHECK_CHUNK = 60;
const DISLIKE_WORDS = /답답|고구마|억지|개연|캐붕|질질|어장|민폐|무책임|비호감|매력\s?(이\s?)?없|실망|이해\s?(가\s?)?안|감정선|노잼|지루|지팔지꼰|하차|진도|내용\s?(이\s?)?없|별로/;
function recheckRequests(works) {
  const reqs = [];
  works.forEach((w, wi) => {
    // Haiku가 불호로 본 것 + 불호 단어가 든 다른 댓글(연재 운영 제외) — 2차 채점에서 '수애야 어장~ㅋㅋ' 같은 캐릭터 답답 평가를 몰입으로 놓침
    const cand = w.sample.filter((c) => c.lab && (c.lab.tn === "critic" || (c.lab.tn !== "miss" && DISLIKE_WORDS.test(c.text))));
    for (const c of cand) c.lab.wasCritic = c.lab.tn === "critic";
    for (let k = 0; k < cand.length; k += RECHECK_CHUNK) reqs.push({ custom_id: `r-${wi}-${k / RECHECK_CHUNK}`, params: AI.buildRecheckParams(SONNET, w, cand.slice(k, k + RECHECK_CHUNK), CFG.textMax) });
  });
  return reqs;
}
function applyRecheck(works, out) {
  let usd = 0;
  const seen = new Set();
  for (const [cid, res] of out) {
    const w = works[Number(cid.split("-")[1])];
    if (!w || res.type !== "succeeded") { report.notes.push(`불호 재확인 실패: ${cid}`); continue; }
    usd += costOf(SONNET.model, res.message.usage || {});
    let parsed; try { parsed = AI.parseJson(res.message); } catch (e) { report.notes.push(`불호 재확인 해석 실패: ${cid}`); continue; }
    const byN = new Map(w.sample.map((c) => [c.n, c]));
    for (const it of parsed.items || []) { const c = byN.get(it.n); if (c && c.lab) { seen.add(w.id + "_" + it.n); setRecheck(w, c, it.v); } }
  }
  // 답이 안 온 후보는 불호가 아닌 쪽으로(보수적으로)
  for (const w of works) for (const c of w.sample) if (c.lab && c.lab.tn === "critic" && !c.lab.dk && !seen.has(w.id + "_" + c.n)) setRecheck(w, c, "other");
  for (const w of works) for (const c of w.sample) if (c.lab) delete c.lab.wasCritic;
  return usd;
}
function setRecheck(w, c, v) {
  const dis = new Set((w.themes || []).filter((t) => t.bucket === "dislike").map((t) => t.id));
  if (AI.DISLIKE_KINDS[v]) { c.lab.tn = "critic"; c.lab.dk = v; if (c.lab.wasCritic === false) report.promoted++; return; }
  if (c.lab.wasCritic === false) { if (v === "ops") { c.lab.tn = "miss"; c.lab.th = []; } return; }   // 넓힌 후보가 불호 아니면 원래 표시 그대로
  c.lab.tn = { immersion: "char", light: "nudge", ops: "miss", other: "other" }[v] || "other";
  c.lab.th = c.lab.tn === "miss" ? [] : c.lab.th.filter((id) => !dis.has(id));
  if (c.lab.ac === "churn") c.lab.ac = "none";
  report.demoted++;
}
function themeStats(w) {
  for (const t of w.themes || []) {
    const cs = w.sample.filter((c) => c.lab && c.lab.th.includes(t.id));
    t.count = cs.length;
    t.best = cs.filter((c) => c.pick === "best").length;
    t.early = cs.filter((c) => c.pick === "early").length;
    t.likes = cs.reduce((s, c) => s + c.like, 0);
    t.eps = {};
    for (const c of cs) t.eps[c.label] = (t.eps[c.label] || 0) + 1;
    t.refs = [...cs].sort((a, b) => b.like - a.like).slice(0, CFG.themeRefs).map((c) => c.n);
    t.tones = cs.reduce((o, c) => ((o[c.lab.tn] = (o[c.lab.tn] || 0) + 1), o), {});
  }
  for (const e of w.episodes) {
    e.topThemes = (w.themes || []).map((t) => ({ id: t.id, n: t.eps[e.label] || 0 })).filter((x) => x.n >= 2).sort((a, b) => b.n - a.n).slice(0, 3);
  }
  w.untagged = w.sample.filter((c) => c.lab && !c.lab.th.length && c.lab.tn !== "miss").length;
  w.ops = w.sample.filter((c) => c.lab && c.lab.tn === "miss").length;
  w.dislikeKinds = {};
  for (const k of Object.keys(AI.DISLIKE_KINDS)) {
    const cs = w.sample.filter((c) => c.lab && c.lab.tn === "critic" && c.lab.dk === k);
    const eps = {}; for (const c of cs) eps[c.label] = (eps[c.label] || 0) + 1;
    w.dislikeKinds[k] = { label: AI.DISLIKE_KINDS[k], count: cs.length, likes: cs.reduce((t, c) => t + c.like, 0), eps, refs: [...cs].sort((a, b) => b.like - a.like).slice(0, 6).map((c) => c.n) };
  }
}

// ---------------- ⑥ 3단계: 참고용 니즈 맵 ----------------
const L = (o, k) => o[k] || k;
function needsText(w, perEp) {
  const lines = [`[작품] ${w.title} / 웹툰 / ${w.genre || "-"}`, `[작품 소개] ${w.desc || "-"}`, "",
    `[튄 회차] (댓글 수 = 지금까지 달린 수, 앞뒤 5화 대비 배수)`];
  for (const e of w.episodes.filter((x) => x.deep || (x.flags && x.flags.length))) {
    lines.push(`${e.label}: 댓글 ${e.count ?? "-"} / ${e.ratio ?? "-"}배${e.drop ? ` / 이후 ${e.drop}%↓` : ""}${e.flags && e.flags.length ? " / " + e.flags.join(",") : ""}${e.ext.length ? " / " + e.ext.join(",") : ""}` +
      (e.ai ? ` / 속뜻 ${Object.entries(e.ai.tn || {}).map(([k, v]) => `${L(AI.TONES, k)} ${v}`).join(", ")} / 결제 ${e.ai.pay}` : ""));
  }
  lines.push("", "[반복되는 반응]");
  for (const t of w.themes || []) lines.push(`${t.id} (${AI.BUCKETS[t.bucket]}) ${t.label}: ${t.count}개, 좋아요 ${t.likes}`);
  lines.push("", "[니즈 통계] (충족/결핍/요구/갈림 · 관련 댓글 좋아요 합 · 나온 회차 · 결제 신호)");
  for (const [d, s] of Object.entries(w.needStats || {}).sort((a, b) => (b[1].met + b[1].lack + b[1].ask) - (a[1].met + a[1].lack + a[1].ask))) {
    lines.push(`${AI.NEEDS[d]}(${AI.AXES[AI.NEED_AXIS(d)]}): ${s.met}/${s.lack}/${s.ask}/${s.split} · 좋아요 ${s.likes} · ${s.eps.slice(0, 20).join(",")} · 결제 ${s.pay}`);
  }
  const nn = Object.entries(w.newNeeds || {}).sort((a, b) => b[1].count - a[1].count).slice(0, 12);
  if (nn.length) lines.push("", "[목록에 없는 바람] " + nn.map(([k, v]) => `${k} ${v.count}개(좋아요 ${v.likes})`).join(" / "));
  lines.push("", "[니즈가 표시된 댓글] 번호 [좋아요] 속뜻/상태/니즈/신규 | 본문");
  for (const e of w.episodes) {
    const cs = w.sample.filter((c) => c.no === e.no && c.lab && (c.lab.nd.length || c.lab.nn)).sort((a, b) => b.like - a.like).slice(0, perEp).sort((a, b) => a.n - b.n);
    if (!cs.length) continue;
    lines.push(`== ${e.label} ==`);
    for (const c of cs) { const b = c.lab; lines.push(`#${c.n} [${c.like}] ${L(AI.TONES, b.tn)}/${L(AI.STATES, b.st)}/${b.nd.map((d) => AI.NEEDS[d]).join(",") || "-"}${b.nn ? "/신규:" + b.nn : ""} | ${clip(c.text, 120)}`); }
  }
  return lines.join("\n");
}
function needsRequests(works) {
  return works.map((w, wi) => {
    if (!w.sample.some((c) => c.lab)) return null;
    let per = CFG.needsPerEp, t = needsText(w, per);
    while (t.length > CFG.synthMaxChars && per > 2) { per = Math.floor(per * 0.75); t = needsText(w, per); }
    log(`  3단계 자료: ${w.title} ${t.length.toLocaleString()}자`);
    return { custom_id: `s-${wi}`, params: AI.buildNeedsParams(SONNET, t) };
  }).filter(Boolean);
}
function applyNeeds(works, out) {
  let usd = 0;
  for (const [cid, res] of out) {
    const w = works[Number(cid.split("-")[1])];
    if (!w || res.type !== "succeeded") { report.notes.push(`3단계 실패: ${w ? w.title : cid} (${res.type})`); continue; }
    usd += costOf(SONNET.model, res.message.usage || {});
    try {
      const valid = new Set(w.sample.filter((c) => c.lab).map((c) => c.n));
      w.needsMap = (AI.parseJson(res.message).needs || []).map((x) => ({ ...x, refs: [...new Set((x.refs || []).filter((n) => valid.has(n)))].slice(0, 8) })).filter((x) => x.refs.length);
    } catch (e) { report.notes.push(`3단계 해석 실패: ${w.title} ${e.message}`); }
  }
  return usd;
}

// ---------------- 실행 ----------------
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
state.spend ||= {};
const report = { version: 1, platform: "naver", generated_at: new Date().toISOString(), cfg: CFG, models: { haiku: HAIKU, sonnet: SONNET },
  cost: { theme: 0, theme2: 0, haiku: 0, recheck: 0, needs: 0 }, batches: {}, notes: [], dropped: 0, demoted: 0, promoted: 0, scrubbed: 0, mock: MOCK };
let works = [];
const GRAM = 12;   // 공개 결과에 원문이 실리지 않게: AI 글이 어떤 댓글과 공백 빼고 12자 넘게 겹치면 가림
function scrubber(w) {
  const norm = (s) => String(s || "").replace(/\s+/g, ""), grams = new Set();
  for (const c of w.sample || []) { const t = norm(c.text); for (let i = 0; i + GRAM <= t.length; i++) grams.add(t.slice(i, i + GRAM)); }
  return (s) => { const t = norm(s); for (let i = 0; i + GRAM <= t.length; i++) if (grams.has(t.slice(i, i + GRAM))) { report.scrubbed++; return "(댓글 원문과 겹쳐 가림)"; } return s; };
}
function save() {
  mkdirSync(OUT, { recursive: true });
  report.requests = N.requests;
  report.scrubbed = 0;
  const pub = (w) => {
    const sc = scrubber(w);
    return { id: w.id, title: w.title, genre: w.genre, adult: w.adult,
      episodes: w.episodes.map(({ _best, _early, ...e }) => e),
      themes: (w.themes || []).map((t) => ({ ...t, label: sc(t.label), def: sc(t.def) })), untagged: w.untagged ?? null,
      comments: (w.sample || []).map(({ text, ...c }) => c),   // 원문 없음 — 번호·시각·좋아요·표시만
      dislikeKinds: w.dislikeKinds || null, ops: w.ops ?? null,   // 불호 세 가지(근거는 댓글 번호) · 분석에서 뺀 연재 운영 얘기 수
      needStats: w.needStats || {}, newNeeds: Object.fromEntries(Object.entries(w.newNeeds || {}).map(([k, v]) => [sc(k), v])),
      needsMap: w.needsMap ? w.needsMap.map((x) => ({ ...x, need: sc(x.need), evidence: sc(x.evidence), why: sc(x.why) })) : null };
  };
  report.works = works.map(pub);
  writeFileSync(`${OUT}/result.json`, JSON.stringify(report));
  // 원문 포함 전체 — 잠가서(사용자 컴퓨터의 열쇠로만 열림) 보고서용으로
  writeFileSync(`${OUT}/full.enc.json`, JSON.stringify(seal({ ...report, works: works.map((w) => ({ ...pub(w), comments: w.sample || [], themes: w.themes || [], needsMap: w.needsMap || null })) })));
}
function charge(usd, label) {
  if (MOCK) return;
  state.spend[MONTH] = (state.spend[MONTH] || 0) + usd;
  mkdirSync("state", { recursive: true });
  writeFileSync(STATE, JSON.stringify(state, null, 1) + "\n");
  log(`  ${label} 비용 $${usd.toFixed(4)} → 이 달 합계 $${state.spend[MONTH].toFixed(2)}`);
}
const { stage } = createBatcher({ mock: MOCK, mockAnswer, waitMin: args.waitMin, tStart: T_START, charge, report, log });

try {
  for (const id of args.ids) works.push(await collect(id));
  for (const w of works) pickSample(w);
  const nC = works.reduce((t, w) => t + w.sample.length, 0);
  log(`수집 끝: 네이버 요청 ${N.requests}번, 분석 대상 ${nC}개 (베스트 ${works.reduce((t, w) => t + w.sample.filter((c) => c.pick === "best").length, 0)} + 공개 직후 ${works.reduce((t, w) => t + w.sample.filter((c) => c.pick === "early").length, 0)})`);
  if (args.collectOnly) { for (const w of works) judge(w); save(); log("수집만 하고 끝냅니다 (--collect-only)"); process.exit(0); }

  const est = nC * EST_PER_COMMENT + works.length * (EST_THEME_WORK + EST_NEEDS_WORK);
  const spent = state.spend[MONTH] || 0;
  log(`예상 비용 $${est.toFixed(2)} (상한 $${args.capUsd}) / 이 달 사용 $${spent.toFixed(2)} (한도 $${args.limitUsd})`);
  if (!MOCK && est > args.capUsd) throw new Error("예상 비용이 시범 상한을 넘어 보내지 않습니다");
  if (!MOCK && spent + est > args.limitUsd) throw new Error("이 달 한도를 넘을 것 같아 보내지 않습니다");

  await stage("1단계(Sonnet) 반복 반응 찾기", themeRequests(works), works.length * EST_THEME_WORK, "theme", (out) => applyThemes(works, out));
  const retry = themeRetryRequests(works);
  if (retry.length) {
    report.notes.push(`1단계 묶음이 ${THEME_MIN}개 미만이라 다시 요청: ${retry.map((r) => works[Number(r.custom_id.split("-")[1])].title).join(", ")}`);
    await stage("1단계 다시(묶음이 적은 작품)", retry, retry.length * EST_THEME_WORK, "theme2", (out) => applyThemes(works, out));
  }
  save();
  if (!works.some((w) => w.themes && w.themes.length)) throw new Error("반복 반응 묶음을 하나도 받지 못했습니다");

  await stage("2단계(Haiku) 댓글 표시", classifyRequests(works), nC * EST_PER_COMMENT, "haiku", (out) => {
    const a = applyLabels(works, out);
    if (a.failed) report.notes.push(`2단계 실패한 묶음 ${a.failed}개`);
    return a.usd;
  });
  const rc = recheckRequests(works);
  if (rc.length) await stage("불호 재확인(Sonnet)", rc, works.reduce((t, w) => t + w.sample.filter((c) => c.lab && c.lab.tn === "critic").length, 0) * EST_RECHECK_PER, "recheck", (out) => applyRecheck(works, out));
  for (const w of works) { judge(w); themeStats(w); }
  save();

  await stage("3단계(Sonnet) 참고용 니즈 맵", needsRequests(works), works.length * EST_NEEDS_WORK, "needs", (out) => applyNeeds(works, out));
} catch (e) {
  report.error = e instanceof N.NaverBlocked ? "네이버가 요청을 막아 멈췄습니다" : e.message;
  console.error("오류:", e.message);
  process.exitCode = 1;
} finally {
  save();
  const usd = report.cost.theme + report.cost.theme2 + report.cost.haiku + report.cost.recheck + report.cost.needs;
  const lines = [`## 네이버 회차 댓글 분석 시범${MOCK ? " (가짜 답)" : ""}`, `- 작품: ${works.map((w) => w.title).join(", ")}`, `- 네이버 요청 ${N.requests}번`,
    `- 표시한 댓글 ${works.reduce((t, w) => t + (w.sample || []).filter((c) => c.lab).length, 0)}개, 반복 반응 묶음 ${works.map((w) => (w.themes || []).length).join("·")}개`,
    `- '불호' 묶음에서 뺀 겉말 불평 ${report.dropped}개, 재확인에서 불호 아님으로 돌린 것 ${report.demoted}개, 불호 단어로 넓혀 찾은 불호 ${report.promoted}개, 원문과 겹쳐 가린 글 ${report.scrubbed || 0}개`,
    `- 불호 세 가지: ${works.map((w) => w.title + ' ' + Object.values(w.dislikeKinds || {}).map((k) => k.label.split('(')[0] + ' ' + k.count).join('·')).join(' / ')} · 연재 운영 얘기(분석 제외) ${works.map((w) => w.ops || 0).join('·')}개`,
    `- AI 비용 $${usd.toFixed(3)} (묶음 찾기 $${(report.cost.theme + report.cost.theme2).toFixed(3)} + 표시 $${report.cost.haiku.toFixed(3)} + 불호 재확인 $${report.cost.recheck.toFixed(3)} + 니즈 맵 $${report.cost.needs.toFixed(3)}) / 이 달 합계 $${(state.spend[MONTH] || 0).toFixed(2)}`,
    ...report.notes.map((n) => "- " + n), ...(report.error ? ["- 오류: " + report.error] : [])];
  log(lines.join("\n"));
  if (args.summary) appendFileSync(args.summary, lines.join("\n") + "\n");
}
