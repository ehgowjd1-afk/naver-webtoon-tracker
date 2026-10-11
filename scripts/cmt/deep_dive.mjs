/* 작품 분석 '자세히' — 먹힌 요소·안 먹힌 요소 하나하나를 구체적으로 쪼갬 (사용자 요청 2026-10-11)
 *   예) '남주의 외모와 매력' → 어떤 매력인지(성격·행동 패턴·관계에서의 태도·외모 연출), '혐관에서 사랑으로' → 어떤 단계로 바뀌는 서사인지,
 *       '질투·소유욕' → 어떤 식의 소유욕 연출인지. 각각 드러난 회차와 독자 반응.
 * 재료: 사이트용 결과(docs/data/cmt/{id}.json — 요소·근거 회차·반복 반응 묶음·회차 요약) + 핵심 회차의 베스트 댓글을 다시 모음(로그인 없음, 2초 간격, 닉네임 버림).
 *   핵심 회차 = 요소마다 근거 회차 ∪ '좋다는 말'·'불호' 묶음이 가장 많이 나온 회차 ∪ 댓글 급증 회차.
 * AI: 작품마다 Sonnet 1건(일괄, 반값). 결과 cmt_out/deep.json(댓글 원문 없음, AI 글이 원문과 12자 넘게 겹치면 가림) → apply_deep.mjs 가 사이트 파일에 붙임.
 *   node scripts/cmt/deep_dive.mjs --ids 801475[,…] [--cap-usd 3] [--limit-usd 36] [--wait-min 200]
 *   CMT_MOCK=1 이면 가짜 답(돈 안 듦).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import * as N from "./naver_cmt.mjs";
import { createBatcher, costOf as rawCost } from "./batch.mjs";
import { parseJson } from "./cmt_ai.mjs";

const SONNET = { model: "claude-sonnet-5-5", effort: "medium" };
const EST_WORK = 0.12;
const MOCK = !!process.env.CMT_MOCK;
const STATE = "state/ai_state.json", OUT = "cmt_out";
const args = { ids: [], capUsd: 3, limitUsd: 36, waitMin: 200, summary: null };
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i], v = () => process.argv[++i];
  if (k === "--ids") args.ids = v().split(",").map((s) => s.trim()).filter(Boolean);
  else if (k === "--cap-usd") args.capUsd = Number(v());
  else if (k === "--limit-usd") args.limitUsd = Number(v());
  else if (k === "--wait-min") args.waitMin = Number(v());
  else if (k === "--summary") args.summary = v();
  else throw new Error("모르는 옵션: " + k);
}
if (!args.ids.length || args.ids.length > 60 || args.ids.some((x) => !/^\d{3,9}$/.test(x))) throw new Error("--ids 에 작품 번호 1~60개");
const T_START = Date.now();
const MONTH = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
const log = (...a) => console.log(...a);
const clip = (t, n) => N.cut(String(t).trim().replace(/\s+/g, " "), n);
const BUCKET = { like: "좋다는 말", talk: "많이 하는 말", dislike: "불호" };

// ---- 요청 글 ----
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["points"],
  properties: { points: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "parts", "insight"],
    properties: {
      key: { type: "string" },
      parts: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "detail", "eps", "react"],
        properties: { name: { type: "string" }, detail: { type: "string" }, eps: { type: "array", items: { type: "integer" } }, react: { type: "string" } } } },
      insight: { type: "string" }
    } } } }
};
const SYSTEM = `당신은 웹툰 기획 PD를 돕는 분석가입니다. 한 작품의 '먹힌 요소'와 '안 먹힌 요소' 목록과, 핵심 회차의 베스트 댓글·회차 요약을 받아 요소 하나하나를 구체적으로 쪼갭니다. 웹툰 그림은 볼 수 없으니 댓글이 묘사한 장면으로 판단합니다.

요소마다(key는 입력의 S1·W1 같은 번호 그대로) parts 3~5개와 insight를 씁니다.
- 캐릭터 요소: 그 인물의 매력(또는 비호감)을 구체적인 결로 나눕니다 — 성격, 반복되는 행동 패턴, 상대에게 보이는 태도, 말투, 외모·비주얼이 연출되는 방식. 예) '무심한 척 뒤에서 챙김', '위기 때 나타나 구해 줌', '여주에게만 다정한 말투'.
- 서사 요소: 이야기가 어떤 단계로 바뀌는지 순서대로 나눕니다 — 각 단계가 어느 회차 무렵 어떤 사건으로 관계·상황이 어떻게 바뀌었는지. 예) '1단계 계약 결혼으로 서로 경계(2~20화)', '2단계 사건으로 상대의 사정을 알게 됨'.
- 구조·전개 요소: 구성 방식 — 떡밥을 깔고 회수하는 방식, 회차를 끊는 위치, 시점 전환, 속도 조절.
- 작화·연출 요소: 연출 장치 — 어떤 장면에서 어떤 구도·클로즈업·표정·색·컷 배치·대사 처리가 반응을 얻었는지(댓글이 말한 장면 기준).
- 설정·세계관 요소: 어떤 설정이 어떤 재미를 만들었는지.
- 안 먹힌 요소: 무엇이 어떤 식으로 문제였는지, 어느 구간이었는지, 독자가 어떻게 반응했는지를 같은 방식으로 쪼갭니다.

parts 한 칸 = name(짧은 이름, 15자 안팎), detail(구체적으로 어떤 장면·행동·장치인지 1~2문장), eps(드러난 회차 번호 no, 1~4개), react(독자가 어떻게 반응했는지 한 문장).
insight = 기획자가 다른 작품에 가져갈 수 있는 점(안 먹힌 요소는 피할 점) 한두 문장.

규칙
- 댓글과 회차 요약에 근거가 있는 것만 씁니다. 지어내지 않습니다. 근거가 약하면 parts를 줄입니다.
- 인물에게 화내기·악역 미워하기는 몰입 반응입니다. 휴재·분량·작가 인사는 다루지 않습니다.
- 댓글 문장을 그대로 옮기지 않습니다(따옴표 인용 금지). 장면은 요약해서 씁니다.
- 쉬운 한국어로, 문장은 짧게.`;

function pickEpisodes(cm) {
  const byLabel = new Map(cm.eps.map((e) => [e.l, e.no]));
  const set = new Set();
  const A = cm.analysis || {};
  for (const p of [...(A.strengths || []), ...(A.weaknesses || [])]) for (const no of p.eps || []) set.add(no);
  for (const t of cm.themes) if (t.b !== "talk") for (const [l] of t.e.slice(0, 3)) if (byLabel.has(l)) set.add(byLabel.get(l));
  for (const e of cm.eps) if (e.k === "급증") set.add(e.no);
  return [...set].filter((no) => cm.eps.some((e) => e.no === no)).sort((a, b) => a - b).slice(0, 60);
}
function requestText(cm, info, best) {
  const A = cm.analysis;
  const lines = [`[작품] ${cm.title} / ${cm.genre || info.genre || "-"}${info.keywords.length ? " / " + info.keywords.slice(0, 8).join(", ") : ""}`, `[작품 소개] ${clip(info.desc || "-", 300)}`, "", "[요소]"];
  (A.strengths || []).forEach((p, i) => lines.push(`S${i + 1} 먹힌 요소 (${p.axis}) ${p.point} — 근거: ${p.why} · 근거 회차 ${(p.eps || []).join(",")}`));
  (A.weaknesses || []).forEach((p, i) => lines.push(`W${i + 1} 안 먹힌 요소 (${p.axis}) ${p.point} — 근거: ${p.why} · 근거 회차 ${(p.eps || []).join(",")}`));
  lines.push("", "[반복 반응 묶음] (종류) 이름: 개수 · 많이 나온 회차");
  for (const t of cm.themes.slice(0, 24)) lines.push(`(${BUCKET[t.b]}) ${t.l}: ${t.n}개 · ${t.e.slice(0, 3).map(([l, n]) => `${l} ${n}`).join(", ")}`);
  lines.push("", "[핵심 회차] no 제목 (댓글 수, 표시) · 댓글로 본 내용 · 반응 / 베스트 댓글 [좋아요] 본문");
  for (const [no, cs] of best) {
    const e = cm.eps.find((x) => x.no === no) || {};
    lines.push(`== ${no} ${e.l || ""} (댓글 ${e.c ?? "-"}${e.k ? ", " + e.k : ""}${e.m ? ", 분위기 " + e.m : ""})${e.s ? " · " + e.s : ""}${e.r ? " · " + e.r : ""} ==`);
    for (const c of cs) lines.push(`[${c.like}] ${clip(c.text, 160)}`);
  }
  return lines.join("\n");
}

// ---- 실행 ----
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
state.spend ||= {};
const SPENT0 = state.spend[MONTH] || 0;
const report = { cost: { deep: 0 }, batches: {}, notes: [], tokens: {} };
function charge(usd, label) { if (MOCK) return; state.spend[MONTH] = (state.spend[MONTH] || 0) + usd; mkdirSync("state", { recursive: true }); writeFileSync(STATE, JSON.stringify(state, null, 1) + "\n"); log(`  ${label} 비용 $${usd.toFixed(4)} → 이 달 합계 $${state.spend[MONTH].toFixed(2)}`); }
const costOf = (m, u) => { const t = (report.tokens[m] ||= { in: 0, out: 0, calls: 0 }); t.in += u.input_tokens || 0; t.out += u.output_tokens || 0; t.calls++; return MOCK ? 0 : rawCost(m, u); };
function mockAnswer(cid, body) {
  const keys = [...body.matchAll(/^([SW]\d+) /gm)].map((m) => m[1]);
  return { points: keys.map((key) => ({ key, parts: [{ name: "가짜 매력", detail: "가짜 장면", eps: [1], react: "가짜 반응" }], insight: "가짜 배울 점" })) };
}
const { stage } = createBatcher({ mock: MOCK, mockAnswer, waitMin: args.waitMin, tStart: T_START, charge, report, log });

const works = [];
const out = {};
try {
  for (const id of args.ids) {
    const f = `docs/data/cmt/${id}.json`;
    if (!existsSync(f)) { report.notes.push(`분석 결과 없음: ${id}`); continue; }
    const cm = JSON.parse(readFileSync(f, "utf8"));
    if (!cm.analysis || !((cm.analysis.strengths || []).length + (cm.analysis.weaknesses || []).length)) { report.notes.push(`요소 없음: ${cm.title}`); continue; }
    const nos = pickEpisodes(cm), best = [];
    try {
      for (const no of nos) { const b = await N.fetchBest(id, no); best.push([no, b.comments.slice(0, 15)]); }
    } catch (e) { if (e instanceof N.NaverBlocked) throw e; report.notes.push(`수집 실패로 건너뜀: ${cm.title} (${e.message})`); continue; }
    const text = requestText(cm, N.workInfo(id), best);
    log(`■ ${cm.title} — 핵심 회차 ${nos.length}개, 댓글 ${best.reduce((t, [, cs]) => t + cs.length, 0)}개, 자료 ${text.length.toLocaleString()}자`);
    works.push({ id, cm, text, comments: best.flatMap(([, cs]) => cs) });
  }
  if (!works.length) throw new Error("자세히 볼 작품이 없습니다");
  const est = works.length * EST_WORK, spent = state.spend[MONTH] || 0;
  log(`예상 비용 $${est.toFixed(2)} (상한 $${args.capUsd}) / 이 달 사용 $${spent.toFixed(2)} (한도 $${args.limitUsd})`);
  if (!MOCK && est > args.capUsd) throw new Error("예상 비용이 상한을 넘어 보내지 않습니다");
  if (!MOCK && spent + est > args.limitUsd) throw new Error("이 달 한도를 넘을 것 같아 보내지 않습니다");
  const reqs = works.map((w, wi) => {
    const req = { model: SONNET.model, max_tokens: 32000, system: SYSTEM, messages: [{ role: "user", content: w.text + "\n\n위 요소마다 구체적으로 쪼개서 JSON으로 쓰세요." }], output_config: { format: { type: "json_schema", schema: SCHEMA }, effort: SONNET.effort } };
    return { custom_id: `d-${wi}`, params: req };
  });
  await stage("요소 자세히(Sonnet)", reqs, est, "deep", (res) => {
    let usd = 0;
    for (const [cid, r] of res) {
      const w = works[Number(cid.split("-")[1])];
      if (!w || r.type !== "succeeded") { report.notes.push(`실패: ${w ? w.cm.title : cid}`); continue; }
      usd += costOf(SONNET.model, r.message.usage || {});
      let p; try { p = parseJson(r.message); } catch (e) { report.notes.push(`해석 실패: ${w.cm.title}`); continue; }
      // 원문 겹침 가림(공개 저장소): AI 글이 어떤 댓글과 공백 빼고 12자 넘게 같으면 가림
      const norm = (s) => String(s || "").replace(/\s+/g, ""), grams = new Set();
      for (const c of w.comments) { const t = norm(c.text); for (let i = 0; i + 12 <= t.length; i++) grams.add(t.slice(i, i + 12)); }
      const sc = (s) => { const t = norm(s); for (let i = 0; i + 12 <= t.length; i++) if (grams.has(t.slice(i, i + 12))) return "(댓글 원문과 겹쳐 가림)"; return s; };
      const valid = new Set(w.cm.eps.map((e) => e.no));
      out[w.id] = {};
      for (const pt of p.points || []) out[w.id][pt.key] = { parts: (pt.parts || []).map((x) => ({ name: sc(x.name), detail: sc(x.detail), eps: (x.eps || []).filter((no) => valid.has(no)).slice(0, 4), react: sc(x.react) })), insight: sc(pt.insight) };
    }
    return usd;
  });
} catch (e) {
  report.error = e instanceof N.NaverBlocked ? "네이버가 요청을 막아 멈췄습니다" : e.message;
  console.error("오류:", report.error);
  process.exitCode = 1;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/deep.json`, JSON.stringify({ month: MONTH, mock: MOCK, works: out }));
  writeFileSync(`${OUT}/spend.json`, JSON.stringify({ month: MONTH, delta: (state.spend[MONTH] || 0) - SPENT0 }));
  const lines = [`## 작품 분석 자세히${MOCK ? " (가짜 답)" : ""}`, `- 작품: ${works.map((w) => w.cm.title).join(", ")}`, `- 네이버 요청 ${N.requests}번`,
    `- 자세히 쓴 작품 ${Object.keys(out).length}개 · AI 비용 $${report.cost.deep.toFixed(3)} / 이 달 합계 $${(state.spend[MONTH] || 0).toFixed(2)}`,
    `- 토큰: ${Object.entries(report.tokens).map(([m, t]) => `${m} 입력 ${t.in} · 출력 ${t.out} (${t.calls}번)`).join(" / ")}`,
    ...report.notes.map((n) => "- " + n), ...(report.error ? ["- 오류: " + report.error] : [])];
  log(lines.join("\n"));
  if (args.summary) { const { appendFileSync } = await import("node:fs"); appendFileSync(args.summary, lines.join("\n") + "\n"); }
}
