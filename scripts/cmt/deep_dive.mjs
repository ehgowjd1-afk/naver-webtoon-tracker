/* 작품 분석 '자세히' — 먹힌·안 먹힌 요소와 독자 분석을 하나하나 구체적으로 쪼갬 (사용자 요청 2026-10-11)
 *   예) '남주의 외모와 매력' → 어떤 매력인지, '혐관에서 사랑으로' → 어떤 단계로 바뀌는 서사인지, '소유욕' → 어떤 연출인지,
 *       독자층 → 어떤 독자들이 무엇에 반응하는지, 바라는 것·갈리는 지점·이탈 신호 → 구체적으로 무엇인지.
 * 원칙(사용자): AI가 지어 채우는 게 아니라 '독자 반응 + 실제 회차 이야기'를 종합한 분석이어야 함.
 *   → 웹툰 그림은 못 보니 회차 이야기 = 회차 제목 + 그 회차 베스트 댓글이 묘사한 장면. AI는 칸마다 근거 댓글 번호(refs)를 달아야 하고,
 *     프로그램이 번호를 검사해 근거 댓글이 2개 미만인 칸은 버림. 회차 링크도 AI가 쓴 번호가 아니라 근거 댓글이 실제로 달린 회차로 정함.
 *     사이트에는 칸마다 '근거 댓글 N개 · 좋아요 합'을 보여 줌(댓글 원문·번호는 싣지 않음).
 * 재료: 사이트용 결과(docs/data/cmt/{id}.json) + 핵심 회차의 베스트 댓글을 다시 모음(로그인 없음, 2초 간격, 닉네임 버림).
 *   핵심 회차 = 요소 근거 회차 ∪ 반복 반응 묶음(좋다는 말·많이 하는 말·불호)이 가장 많이 나온 회차 ∪ 댓글 급증 회차 (최대 60화, 회차마다 좋아요 순 12개)
 * AI: 작품마다 Sonnet 1건(일괄, 반값). 결과 cmt_out/deep.json → apply_deep.mjs 가 사이트 파일에 붙임.
 *   node scripts/cmt/deep_dive.mjs --ids 801475[,…] [--cap-usd 3] [--limit-usd 40] [--wait-min 200]
 *   CMT_MOCK=1 이면 가짜 답(돈 안 듦).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import * as N from "./naver_cmt.mjs";
import { createBatcher, costOf as rawCost } from "./batch.mjs";
import { parseJson } from "./cmt_ai.mjs";

const SONNET = { model: "claude-sonnet-5-5", effort: "medium" };
const EST_WORK = 0.11;   // 작품 1개당 예상(시범 실측 0.062 + 독자 분석·근거 번호로 늘어난 몫)
const PER_EP = 12, MAX_EPS = 60, MIN_REFS = 2;
const MOCK = !!process.env.CMT_MOCK;
const STATE = "state/ai_state.json", OUT = "cmt_out";
const args = { ids: [], capUsd: 3, limitUsd: 40, waitMin: 200, summary: null };
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
const DKEY = { goguma: "DG", stuffy: "DS", forced: "DF" };
const DISLIKE_WORDS = /답답|고구마|억지|개연|캐붕|질질|어장|민폐|무책임|비호감|매력\s?(이\s?)?없|실망|이해\s?(가\s?)?안|감정선|노잼|지루|하차|진도|별로/;

// ---- 요청 글 ----
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["points", "lines"],
  properties: {
    lines: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "line", "refs"],
      properties: { key: { type: "string" }, line: { type: "string" }, refs: { type: "array", items: { type: "integer" } } } } },
    points: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "parts", "insight"],
    properties: {
      key: { type: "string" },
      parts: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "detail", "react", "refs"],
        properties: { name: { type: "string" }, detail: { type: "string" }, react: { type: "string" }, refs: { type: "array", items: { type: "integer" } } } } },
      insight: { type: "string" }
    } } } }
};
const SYSTEM = `당신은 웹툰 기획 PD를 돕는 분석가입니다. 한 작품의 분석 항목(먹힌 요소 S·안 먹힌 요소 W·독자 분석 R)과, 핵심 회차의 제목·베스트 댓글을 받아 항목 하나하나를 구체적으로 쪼갭니다.

가장 중요한 원칙 두 가지.
1) 지어내지 않습니다. 웹툰 그림은 볼 수 없으므로 '그 회차에 실제로 있었던 일'은 회차 제목과 그 회차 댓글들이 공통으로 묘사하는 장면에서만 가져옵니다. 독자 반응은 댓글이 실제로 말한 것만 씁니다. 모든 칸에 근거 댓글 번호(refs, 입력의 #번호)를 2~6개 답니다. 근거 댓글이 2개가 안 되는 내용은 쓰지 않습니다. 프로그램이 번호를 검사해 근거가 부족한 칸은 버립니다.
2) 어느 작품에나 붙는 말로 쓰지 않습니다. '잘생겼다', '몰입된다', '작화가 좋다', '답답하다'만으로는 안 됩니다. 이 작품의 인물 이름·장면·설정·상황을 넣어, 다른 작품에는 그대로 쓸 수 없는 문장으로 씁니다. 스스로 점검: 작품 이름과 인물 이름만 바꿔 넣어도 말이 되면 다시 씁니다.

points: 항목마다(key는 입력의 ID·S1·W1·RP·RW1·RS1·RC 그대로) parts 2~5개와 insight를 씁니다.
- ID 이 작품만의 특색: 이 작품에서 두드러지는 결을 댓글 근거로 구체적으로 — 인물 조합과 관계 구도, 되풀이되는 장면 공식, 톤(개그·진지·수위), 연출 습관, 독자들이 만든 놀이 문화(별명·밈·팬덤 구호). parts 3~5개, insight는 이 작품의 정체성을 2~3문장으로. (장르의 흔한 공식인지 이 작품만의 것인지는 여러 작품을 모아 따로 비교하므로, 여기서는 일반 상식으로 짐작해 단정하지 말고 이 작품에서 실제로 두드러진 것만 씁니다.)
- 캐릭터 요소: 그 인물의 매력(또는 비호감)의 결 — 성격, 반복되는 행동 패턴, 상대에게 보이는 태도, 말투, 외모·비주얼이 연출되는 방식. 어떤 회차의 어떤 장면에서 드러났는지.
- 서사 요소: 이야기가 바뀌는 단계를 순서대로 — 각 단계가 어느 회차 무렵 어떤 사건으로 관계·상황이 어떻게 바뀌었는지.
- 구조·전개 요소: 떡밥을 깔고 회수하는 방식, 회차를 끊는 위치, 시점 전환, 속도 조절.
- 작화·연출 요소: 댓글이 말한 장면의 구도·클로즈업·표정·색·컷 배치·대사 처리.
- 설정·세계관 요소: 어떤 설정이 어떤 재미를 만들었는지.
- 안 먹힌 요소: 무엇이 어떤 식으로 문제였는지, 어느 구간이었는지.
- RP 독자층: 댓글에서 보이는 독자 무리를 나눕니다(예: 원작 소설 독자, 특정 커플·인물 팬, 수위·로맨스를 기다리는 독자, 추리하는 독자, 작화를 보는 독자). 무리마다 무엇에 반응하고 어떤 말을 하는지.
- RW 바라는 것: 독자가 구체적으로 어떤 장면·전개·관계 변화를 바라는지, 언제 커졌는지, 채워졌는지.
- RS 갈리는 지점: 양쪽이 각각 무엇을 근거로 무엇을 주장하는지, 어느 회차에서 붙었는지.
- RC 이탈 신호: 하차·실망을 말한 지점과 이유. 근거가 없으면 parts를 비웁니다.

parts 한 칸 = name(짧은 이름, 15자 안팎), detail(그 회차에서 실제로 무슨 장면·행동·장치였는지, 또는 그 독자 무리가 무엇을 원하는지 1~2문장), react(독자가 어떻게 반응했는지 한 문장), refs(근거 댓글 번호 2~6개).
lines: 입력의 [반복 반응 묶음] T1·T2…와 [불호] DG·DS·DF마다 한 줄(40~70자) — 이 작품에서 구체적으로 무엇이 그랬는지(어떤 인물의 어떤 모습·어느 회차 어떤 장면·어떤 전개). 예) '셔츠 차림 세레나를 보고 웃는 76화, 핏대 세우는 108화 질투 장면' 같은 결. refs 2~6개. 근거가 없는 묶음은 빼도 됩니다.

insight = 기획자가 가져갈 점(안 먹힌 요소·이탈은 피할 점, 독자 항목은 이 독자를 붙잡는 방법) 한두 문장. 위 parts에서 나온 것만.

규칙
- 인물에게 화내기·악역 미워하기는 몰입 반응입니다. 휴재·분량·작가 인사는 다루지 않습니다.
- 댓글 문장을 그대로 옮기지 않습니다(따옴표 인용 금지). 장면과 반응은 요약해서 씁니다.
- 쉬운 한국어로, 문장은 짧게.`;

function pickEpisodes(cm) {
  const byLabel = new Map(cm.eps.map((e) => [e.l, e.no]));
  const set = new Set();
  const A = cm.analysis || {};
  for (const p of [...(A.strengths || []), ...(A.weaknesses || [])]) for (const no of p.eps || []) set.add(no);
  for (const t of cm.themes) for (const [l] of t.e.slice(0, t.b === "talk" ? 2 : 3)) if (byLabel.has(l)) set.add(byLabel.get(l));
  for (const e of cm.eps) if (e.k) set.add(e.no);
  for (const d of cm.dislike || []) for (const [l] of (d.e || []).slice(0, 2)) if (byLabel.has(l)) set.add(byLabel.get(l));
  return [...set].filter((no) => cm.eps.some((e) => e.no === no)).sort((a, b) => a - b).slice(0, MAX_EPS);
}
function readerItems(A) {
  const R = A.readers || {}, out = [];
  if (R.who) out.push(["RP", `독자층: ${R.who}`]);
  (R.wants || []).forEach((x, i) => out.push([`RW${i + 1}`, `바라는 것: ${x.want} — ${x.why}`]));
  (R.splits || []).forEach((x, i) => out.push([`RS${i + 1}`, `갈리는 지점: ${x.topic} — ${x.sides}`]));
  if (R.churn) out.push(["RC", `이탈 신호: ${R.churn}`]);
  return out;
}
function requestText(cm, info, best, num) {
  const A = cm.analysis;
  const lines = [`[작품] ${cm.title} / ${cm.genre || info.genre || "-"}${info.keywords.length ? " / " + info.keywords.slice(0, 8).join(", ") : ""}`, `[작품 소개] ${clip(info.desc || "-", 300)}`, "", "[분석 항목]", "ID 이 작품만의 특색(정체성)"];
  (A.strengths || []).forEach((p, i) => lines.push(`S${i + 1} 먹힌 요소 (${p.axis}) ${p.point} — 근거: ${p.why} · 근거 회차 ${(p.eps || []).join(",")}`));
  (A.weaknesses || []).forEach((p, i) => lines.push(`W${i + 1} 안 먹힌 요소 (${p.axis}) ${p.point} — 근거: ${p.why} · 근거 회차 ${(p.eps || []).join(",")}`));
  for (const [k, t] of readerItems(A)) lines.push(`${k} 독자 분석 ${t}`);
  lines.push("", "[반복 반응 묶음] T번호 (종류) 이름: 개수 · 많이 나온 회차");
  cm.themes.slice(0, 24).forEach((t, i) => lines.push(`T${i + 1} (${BUCKET[t.b]}) ${t.l}: ${t.n}개 · ${t.e.slice(0, 3).map(([l, n]) => `${l} ${n}`).join(", ")}`));
  lines.push("", "[불호] (재확인 거친 것)");
  for (const d of cm.dislike || []) if (d.n) lines.push(`${DKEY[d.k]} ${d.l}: ${d.n}개 · 몰린 회차 ${(d.e || []).slice(0, 3).map(([l, n]) => `${l} ${n}`).join(", ")}`);
  lines.push("", "[핵심 회차] == no 회차 제목 (댓글 수, 표시) ==  그 아래 베스트 댓글: #번호 [좋아요] 본문");
  for (const [no, cs] of best) {
    const e = cm.eps.find((x) => x.no === no) || {};
    lines.push(`== ${no} ${e.l || ""} (댓글 ${e.c ?? "-"}${e.k ? ", " + e.k : ""}) ==`);
    for (const c of cs) { const n = num.size + 1; num.set(n, { no, like: c.like, text: c.text }); lines.push(`#${n} [${c.like}] ${clip(c.text, 160)}`); }
  }
  return lines.join("\n");
}

// ---- 실행 ----
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
state.spend ||= {};
const SPENT0 = state.spend[MONTH] || 0;
const report = { cost: { deep: 0 }, batches: {}, notes: [], tokens: {}, dropped: 0, kept: 0 };
function charge(usd, label) { if (MOCK) return; state.spend[MONTH] = (state.spend[MONTH] || 0) + usd; mkdirSync("state", { recursive: true }); writeFileSync(STATE, JSON.stringify(state, null, 1) + "\n"); log(`  ${label} 비용 $${usd.toFixed(4)} → 이 달 합계 $${state.spend[MONTH].toFixed(2)}`); }
const costOf = (m, u) => { const t = (report.tokens[m] ||= { in: 0, out: 0, calls: 0 }); t.in += u.input_tokens || 0; t.out += u.output_tokens || 0; t.calls++; return MOCK ? 0 : rawCost(m, u); };
function mockAnswer(cid, body) {
  const keys = [...body.matchAll(/^(ID|S\d+|W\d+|RP|RW\d+|RS\d+|RC) /gm)].map((m) => m[1]);
  const lkeys = [...body.matchAll(/^(T\d+|DG|DS|DF) /gm)].map((m) => m[1]);
  const ns = [...body.matchAll(/^#(\d+) \[/gm)].map((m) => Number(m[1]));
  return { lines: lkeys.map((key, i) => ({ key, line: "가짜 한 줄 평", refs: ns.slice(i, i + 2) })), points: keys.map((key, i) => ({ key, parts: [{ name: "가짜 항목", detail: "가짜 장면", react: "가짜 반응", refs: ns.slice(i, i + 3) }, { name: "근거 부족", detail: "버려져야 함", react: "-", refs: [ns[0]] }], insight: "가짜 배울 점" })) };
}
const { stage } = createBatcher({ mock: MOCK, mockAnswer, waitMin: args.waitMin, tStart: T_START, charge, report, log });

const works = [];
const out = {};
try {
  for (const id of args.ids) {
    const f = `docs/data/cmt/${id}.json`;
    if (!existsSync(f)) { report.notes.push(`분석 결과 없음: ${id}`); continue; }
    const cm = JSON.parse(readFileSync(f, "utf8"));
    if (!cm.analysis) { report.notes.push(`작품 분석 없음: ${cm.title}`); continue; }
    const nos = pickEpisodes(cm), best = [];
    try {
      for (const no of nos) { const b = await N.fetchBest(id, no); best.push([no, b.comments.slice(0, PER_EP)]); }
      // 불호가 몰린 회차는 공개 직후 댓글 중 불호 단어가 든 것도(베스트엔 불평이 잘 안 오름)
      const byLabel = new Map(cm.eps.map((e) => [e.l, e.no]));
      const dnos = new Set(); for (const d of cm.dislike || []) if (d.n) for (const [l] of (d.e || []).slice(0, 2)) if (byLabel.has(l)) dnos.add(byLabel.get(l));
      for (const no of dnos) {
        const row = best.find((x) => x[0] === no); if (!row) continue;
        const r = await N.fetchEarly(id, no, 300);
        const seen = new Set(row[1].map((c) => c.cid));
        row[1].push(...r.comments.filter((c) => !seen.has(c.cid) && DISLIKE_WORDS.test(c.text)).sort((a, b) => b.like - a.like).slice(0, 10));
      }
    } catch (e) { if (e instanceof N.NaverBlocked) throw e; report.notes.push(`수집 실패로 건너뜀: ${cm.title} (${e.message})`); continue; }
    const num = new Map();
    const text = requestText(cm, N.workInfo(id), best, num);
    log(`■ ${cm.title} — 핵심 회차 ${nos.length}개, 댓글 ${num.size}개, 자료 ${text.length.toLocaleString()}자`);
    works.push({ id, cm, text, num });
  }
  if (!works.length) throw new Error("자세히 볼 작품이 없습니다");
  const est = works.length * EST_WORK, spent = state.spend[MONTH] || 0;
  log(`예상 비용 $${est.toFixed(2)} (상한 $${args.capUsd}) / 이 달 사용 $${spent.toFixed(2)} (한도 $${args.limitUsd})`);
  if (!MOCK && est > args.capUsd) throw new Error("예상 비용이 상한을 넘어 보내지 않습니다");
  if (!MOCK && spent + est > args.limitUsd) throw new Error("이 달 한도를 넘을 것 같아 보내지 않습니다");
  const reqs = works.map((w, wi) => ({ custom_id: `d-${wi}`, params: { model: SONNET.model, max_tokens: 32000, system: SYSTEM,
    messages: [{ role: "user", content: w.text + "\n\n위 항목마다 근거 댓글 번호를 달아 구체적으로 쪼개서 JSON으로 쓰세요." }],
    output_config: { format: { type: "json_schema", schema: SCHEMA }, effort: SONNET.effort } } }));
  await stage("항목 자세히(Sonnet)", reqs, est, "deep", (res) => {
    let usd = 0;
    for (const [cid, r] of res) {
      const w = works[Number(cid.split("-")[1])];
      if (!w || r.type !== "succeeded") { report.notes.push(`실패: ${w ? w.cm.title : cid}`); continue; }
      usd += costOf(SONNET.model, r.message.usage || {});
      let p; try { p = parseJson(r.message); } catch (e) { report.notes.push(`해석 실패: ${w.cm.title}`); continue; }
      // 원문 겹침 가림(공개 저장소)
      const norm = (s) => String(s || "").replace(/\s+/g, ""), grams = new Set();
      for (const c of w.num.values()) { const t = norm(c.text); for (let i = 0; i + 12 <= t.length; i++) grams.add(t.slice(i, i + 12)); }
      const sc = (s) => { const t = norm(s); for (let i = 0; i + 12 <= t.length; i++) if (grams.has(t.slice(i, i + 12))) return "(댓글 원문과 겹쳐 가림)"; return s; };
      out[w.id] = {};
      const LK = /^(T\d+|DG|DS|DF)$/;
      for (const x of p.lines || []) {
        if (!LK.test(x.key)) continue;
        const refs = [...new Set((x.refs || []).filter((n) => w.num.has(n)))];
        if (refs.length < MIN_REFS) { report.dropped++; continue; }
        out[w.id][x.key] = { line: sc(x.line), n: refs.length, lk: refs.reduce((t, n) => t + w.num.get(n).like, 0) };
        report.kept++;
      }
      for (const pt of p.points || []) {
        const parts = [];
        for (const x of pt.parts || []) {
          const refs = [...new Set((x.refs || []).filter((n) => w.num.has(n)))];
          if (refs.length < MIN_REFS) { report.dropped++; continue; }   // 근거 댓글이 2개 안 되면 버림(지어낸 내용 막기)
          const cs = refs.map((n) => w.num.get(n));
          const epc = {}; for (const c of cs) epc[c.no] = (epc[c.no] || 0) + 1;
          parts.push({ name: sc(x.name), detail: sc(x.detail), react: sc(x.react),
            eps: Object.entries(epc).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4).map(([no]) => Number(no)).sort((a, b) => a - b),
            n: refs.length, lk: cs.reduce((t, c) => t + c.like, 0) });
          report.kept++;
        }
        if (parts.length) out[w.id][pt.key] = { parts, insight: sc(pt.insight) };
      }
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
  const lines = [`## 작품·독자 분석 자세히${MOCK ? " (가짜 답)" : ""}`, `- 작품: ${works.map((w) => w.cm.title).join(", ")}`, `- 네이버 요청 ${N.requests}번`,
    `- 자세히 쓴 작품 ${Object.keys(out).length}개 · 근거 2개 이상이라 남긴 칸 ${report.kept}개, 근거 부족으로 버린 칸 ${report.dropped}개`,
    `- AI 비용 $${report.cost.deep.toFixed(3)} / 이 달 합계 $${(state.spend[MONTH] || 0).toFixed(2)}`,
    `- 토큰: ${Object.entries(report.tokens).map(([m, t]) => `${m} 입력 ${t.in} · 출력 ${t.out} (${t.calls}번)`).join(" / ")}`,
    ...report.notes.map((n) => "- " + n), ...(report.error ? ["- 오류: " + report.error] : [])];
  log(lines.join("\n"));
  if (args.summary) appendFileSync(args.summary, lines.join("\n") + "\n");
}
