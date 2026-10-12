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
const PER_EP = 15, MAX_EPS = 60, MIN_REFS = 2;
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
  type: "object", additionalProperties: false, required: ["cast", "points", "lines"],
  properties: {
    cast: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "aliases", "role"],
      properties: { name: { type: "string" }, aliases: { type: "array", items: { type: "string" } }, role: { type: "string" } } } },
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

가장 중요한 원칙 세 가지.
1) 지어내지 않습니다. 웹툰 그림은 볼 수 없으므로 '그 회차에 실제로 있었던 일'은 회차 제목과 그 회차 댓글들이 공통으로 묘사하는 장면에서만 가져옵니다. 독자 반응은 댓글이 실제로 말한 것만 씁니다. 모든 칸에 근거 댓글 번호(refs, 입력의 #번호)를 2~6개 답니다. 근거 댓글이 2개가 안 되는 내용은 쓰지 않습니다. 프로그램이 번호를 검사해 근거가 부족한 칸은 버립니다.
2) 누가 했는지는 근거 댓글에 그 인물의 이름·호칭(남주·여주·OO아 등)이 직접 나오거나 문맥상 분명할 때만 씁니다. 주어 없는 댓글(예: 안경 벗으니 짱)로 특정 인물을 단정하지 않습니다. 누가 + 무엇(행동·모습·대사)은 한 댓글 안에 함께 나와야 합니다. 서로 다른 댓글을 이어 붙여('안경 벗으니 짱' + '이섭 얼굴 좋다' → '이섭이 안경을 벗었다') 새 사실을 만들지 않습니다. 작품 소개의 인물 정보(이름·직업·관계)를 참고합니다. 다 쓴 뒤 다른 담당이 근거 댓글과 하나씩 대조해 틀린 칸은 고치거나 버립니다.
3) 어느 작품에나 붙는 말로 쓰지 않습니다. '잘생겼다', '몰입된다', '작화가 좋다', '답답하다'만으로는 안 됩니다. 이 작품의 인물 이름·장면·설정·상황을 넣어, 다른 작품에는 그대로 쓸 수 없는 문장으로 씁니다. 스스로 점검: 작품 이름과 인물 이름만 바꿔 넣어도 말이 되면 다시 씁니다.

cast: 댓글과 작품 소개에 나오는 주요 인물 목록. name(댓글에서 가장 많이 부르는 이름), aliases(댓글에서 그 인물을 부르는 다른 말 — 성까지 붙인 이름, '이름+이', 직함·호칭, 남주·여주·서브남 같은 역할 호칭), role(남주·여주·조연·악역 등). 프로그램이 이 목록으로 '누구 얘기인지'를 다시 검사합니다.

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
    for (const c of cs) { const n = num.size + 1; num.set(n, { no, like: c.like, text: c.text, cid: c.cid }); lines.push(`#${n} [${c.like}] ${clip(c.text, 160)}`); }
  }
  return lines.join("\n");
}

// ---- 사실 확인 ----
const EST_CHECK = 0.07;   // 작품 1개당 예상
const CHECK_SCHEMA = {
  type: "object", additionalProperties: false, required: ["items"],
  properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["k", "facts", "v", "kw", "more", "name", "detail", "react", "line"],
    properties: { k: { type: "string" }, facts: { type: "string" }, v: { type: "string", enum: ["ok", "fix", "drop", "need"] }, kw: { type: "string" }, more: { type: "array", items: { type: "integer" } }, name: { type: "string" }, detail: { type: "string" }, react: { type: "string" }, line: { type: "string" } } } } }
};
const CHECK_SYSTEM = `당신은 사실 확인 담당입니다. 다른 AI가 웹툰 댓글을 근거로 쓴 분석 문장들을 근거 댓글 원문과 하나씩 대조합니다. 웹툰 그림은 볼 수 없으므로, 사실의 근거는 오직 그 항목의 근거 댓글과 작품 소개뿐입니다.

항목(K번호)마다 먼저 facts에 근거 댓글 하나하나가 실제로 말하는 '누가·무엇'을 짧게 적습니다(예: '#12 누가 없음 / 안경 벗은 모습 칭찬', '#13 민경 / 안경 쓴 민경에게 농담'). 그다음 facts만 보고 판정합니다.
칸은 상위 항목(예: 'S1 남주 이섭의 매력')에 속합니다. 칸 내용이 상위 항목의 인물·주제에 관한 것으로 읽히는데 근거 댓글이 그 인물 얘기가 아니면(다른 인물이거나 누구인지 없음) 틀린 것입니다 — 그 인물로 확인되는 내용만 남겨 fix하거나 drop.

- ok: 문장의 핵심 내용 — 누가, 무엇을, 어느 회차에서, 독자가 어떻게 반응했는지 — 가 근거 댓글에 직접 나온다.
- fix: 대체로 맞지만 일부(특히 누가 했는지, 어느 회차인지, 무슨 행동인지)가 근거 댓글에 없거나 틀렸다. 근거 댓글로 확인되는 내용만 남겨 고쳐 쓴다.
- drop: 핵심 내용이 근거 댓글로 확인되지 않는다.
- need: 누구(또는 무엇) 얘기인지가 근거 댓글만으로는 불분명해서, 그 회차의 다른 댓글을 더 봐야 판단할 수 있다. kw에 그 회차 댓글에서 찾아볼 단어 1~3개를 쉼표로(예: 안경). 첫 확인에서만 씁니다.
- '추가로 찾은 댓글'이 붙은 항목(두 번째 확인)은 need를 쓰지 않고 ok·fix·drop 중 하나로 정하고, 판단에 쓴 추가 댓글 번호를 more에 적습니다. 추가 댓글로 인물이 확인되면 그 인물로 고쳐 씁니다(fix). 그래도 불분명하면 drop.
- need가 아니면 kw는 빈 문자열, more는 빈 배열.

인물 판단 규칙
- 누구의 행동·외모인지는 근거 댓글에 그 인물의 이름·호칭(남주·여주·OO아·OO 차장 등)이 직접 나오거나 문맥상 분명할 때만 인정합니다. 주어 없는 댓글('안경 벗으니 짱이네')을 특정 인물로 단정한 문장은 fix(누구인지 빼거나 근거로 확인되는 인물로) 또는 drop.
- 작품 소개의 인물 정보(이름·직업·관계)와 어긋나면 틀린 것입니다.
- 누가 + 무엇(행동·모습·대사)이 한 댓글 안에서 함께 확인돼야 합니다. 두 댓글을 이어 붙여야만 성립하는 문장(인물은 A 댓글, 행동·모습은 B 댓글)은 틀린 것입니다 — 확인되는 것만 남겨 fix하거나 drop. 예) '안경 벗으니 짱'(누가인지 없음) + '이섭 얼굴 좋다'(안경 얘기 없음) → '이섭이 안경을 벗었다'는 틀림.
- 회차 번호는 근거 댓글이 달린 회차(괄호 안 제목)와 맞아야 합니다.

fix일 때: 칸이면 name·detail·react 세 칸을 모두 다시 씁니다(이름에 틀린 내용이 들어 있으면 이름도 고치고, 바뀌지 않는 칸도 그대로 다시 씀). 한 줄 평이나 마무리 문장이면 line에 고친 전체 문장. 나머지는 빈 문자열. ok·drop이면 모두 빈 문자열.
고친 문장에 '분명하지 않다', '확인되지 않는다' 같은 단서를 달지 말고, 근거로 확인되는 내용만 남겨 씁니다. 남길 내용이 없으면 drop.
고친 문장도 댓글 문장을 그대로 옮기지 않고 요약합니다. 쉬운 한국어로.`;
function titlesOf(w) {
  const A = w.cm.analysis || {}, R = A.readers || {}, title = {};
  (A.strengths || []).forEach((p, i) => { title[`S${i + 1}`] = `먹힌 요소: ${p.point}`; });
  (A.weaknesses || []).forEach((p, i) => { title[`W${i + 1}`] = `안 먹힌 요소: ${p.point}`; });
  title.ID = "이 작품만의 특색"; title.RP = `독자층: ${clip(R.who || "", 60)}`; title.RC = `이탈 신호: ${clip(R.churn || "", 60)}`;
  (R.wants || []).forEach((x, i) => { title[`RW${i + 1}`] = `바라는 것: ${x.want}`; });
  (R.splits || []).forEach((x, i) => { title[`RS${i + 1}`] = `갈리는 지점: ${x.topic}`; });
  w.cm.themes.slice(0, 24).forEach((t, i) => { title[`T${i + 1}`] = `반복 반응 묶음: ${t.l}`; });
  for (const d of w.cm.dislike || []) title[DKEY[d.k]] = `불호: ${d.l}`;
  return title;
}
function checkText(w, second) {
  const det = N.workInfo(w.id), title = titlesOf(w);
  const epl = new Map(w.cm.eps.map((e) => [e.no, e.l || `${e.no}번`]));
  const ev = (refs) => refs.map((n) => { const c = w.num.get(n); return `#${n} (${epl.get(c.no)}) [${c.like}] ${clip(c.text, 160)}`; }).join("\n    ");
  const lines = [`[작품] ${w.cm.title}`, `[작품 소개] ${clip(det.desc || "-", 300)}`, `[주요 인물] ${(w.cast || []).map((c) => `${c.name}(${c.role}: ${c.al.join("·")})`).join(" / ") || "-"}`, "", "[확인할 항목] K번호 (어느 칸) 문장 / 근거 댓글"];
  for (const it of w.items.filter((x) => !second || x.need)) {
    const body = it.kind === "line" ? `한 줄 평: ${it.line}` : it.kind === "insight" ? `마무리 문장: ${it.insight}` : `이름: ${it.name} / 내용: ${it.detail} / 반응: ${it.react}`;
    lines.push(`${it.k} [${it.key} ${title[it.key] || ""}] (${it.kind === "part" ? "칸" : it.kind === "line" ? "한 줄 평" : "마무리"}) ${body}`, `    ${ev(it.refs)}`);
    if (it.kwShown) lines.push(`    추가로 찾은 댓글(그 회차 공감순 상위 500개 중 '${it.kwShown.join("·")}' 포함 — 누구 얘기인지 이걸로 확인):`, (it.extra || []).length ? `    ${ev(it.extra)}` : "    (찾은 댓글 없음)");
  }
  return lines.join("\n");
}

// ---- 실행 ----
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
state.spend ||= {};
const SPENT0 = state.spend[MONTH] || 0;
const report = { cost: { deep: 0, check: 0, check2: 0 }, batches: {}, notes: [], tokens: {}, dropped: 0, kept: 0, checkOk: 0, checkFix: 0, checkDrop: 0, checkNeed: 0, flagged: 0 };
function charge(usd, label) { if (MOCK) return; state.spend[MONTH] = (state.spend[MONTH] || 0) + usd; mkdirSync("state", { recursive: true }); writeFileSync(STATE, JSON.stringify(state, null, 1) + "\n"); log(`  ${label} 비용 $${usd.toFixed(4)} → 이 달 합계 $${state.spend[MONTH].toFixed(2)}`); }
const costOf = (m, u) => { const t = (report.tokens[m] ||= { in: 0, out: 0, calls: 0 }); t.in += u.input_tokens || 0; t.out += u.output_tokens || 0; t.calls++; return MOCK ? 0 : rawCost(m, u); };
function mockAnswer(cid, body) {
  if (cid.startsWith("c-")) return { items: [...body.matchAll(/^(K\d+) /gm)].map((m, i) => ({ k: m[1], facts: "가짜", v: ["ok", "fix", "drop", "need"][i % 4], kw: i % 4 === 3 ? "안경" : "", more: [], name: i % 4 === 1 ? "고친 이름" : "", detail: i % 4 === 1 ? "고친 내용" : "", react: "", line: i % 4 === 1 ? "고친 한 줄" : "" })) };
  if (cid.startsWith("e-")) return { items: [...body.matchAll(/^(K\d+) /gm)].map((m, i) => ({ k: m[1], facts: "가짜", v: i % 2 ? "drop" : "fix", kw: "", more: [...body.matchAll(/^    #(\d+) /gm)].map((x) => Number(x[1])).slice(-2), name: "추가 댓글로 고친 이름", detail: "추가 댓글로 고친 내용", react: "", line: "추가 댓글로 고친 한 줄" })) };
  const keys = [...body.matchAll(/^(ID|S\d+|W\d+|RP|RW\d+|RS\d+|RC) /gm)].map((m) => m[1]);
  const lkeys = [...body.matchAll(/^(T\d+|DG|DS|DF) /gm)].map((m) => m[1]);
  const ns = [...body.matchAll(/^#(\d+) \[/gm)].map((m) => Number(m[1]));
  return { cast: [{ name: "이섭", aliases: ["태이섭", "남주"], role: "남주" }, { name: "민경", aliases: ["강민경", "여주"], role: "여주" }], lines: lkeys.map((key, i) => ({ key, line: "가짜 한 줄 평", refs: ns.slice(i, i + 2) })), points: keys.map((key, i) => ({ key, parts: [{ name: "가짜 항목", detail: "가짜 장면", react: "가짜 반응", refs: ns.slice(i, i + 3) }, { name: "근거 부족", detail: "버려져야 함", react: "-", refs: [ns[0]] }], insight: "가짜 배울 점" })) };
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
      for (const no of nos) { const b = await N.fetchPopular(id, no, PER_EP); best.push([no, b.comments]); }   // 공감순(인기순) 상위
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
  const est = works.length * (EST_WORK + EST_CHECK), spent = state.spend[MONTH] || 0;
  log(`예상 비용 $${est.toFixed(2)} (상한 $${args.capUsd}) / 이 달 사용 $${spent.toFixed(2)} (한도 $${args.limitUsd})`);
  if (!MOCK && est > args.capUsd) throw new Error("예상 비용이 상한을 넘어 보내지 않습니다");
  if (!MOCK && spent + est > args.limitUsd) throw new Error("이 달 한도를 넘을 것 같아 보내지 않습니다");
  const reqs = works.map((w, wi) => ({ custom_id: `d-${wi}`, params: { model: SONNET.model, max_tokens: 32000, system: SYSTEM,
    messages: [{ role: "user", content: w.text + "\n\n위 항목마다 근거 댓글 번호를 달아 구체적으로 쪼개서 JSON으로 쓰세요." }],
    output_config: { format: { type: "json_schema", schema: SCHEMA }, effort: SONNET.effort } } }));
  // 1) 항목 자세히 — 근거 번호 검사(2개 미만 버림)까지만. 글은 사실 확인 뒤에 확정
  const LK = /^(T\d+|DG|DS|DF)$/;
  await stage("항목 자세히(Sonnet)", reqs, est, "deep", (res) => {
    let usd = 0;
    for (const [cid, r] of res) {
      const w = works[Number(cid.split("-")[1])];
      if (!w || r.type !== "succeeded") { report.notes.push(`실패: ${w ? w.cm.title : cid}`); continue; }
      usd += costOf(SONNET.model, r.message.usage || {});
      let p; try { p = parseJson(r.message); } catch (e) { report.notes.push(`해석 실패: ${w.cm.title}`); continue; }
      const okRefs = (x) => [...new Set((x.refs || []).filter((n) => w.num.has(n)))];
      w.cast = (p.cast || []).map((c) => ({ name: c.name, role: c.role, al: [...new Set([c.name, ...(c.aliases || [])].map((a) => String(a || "").trim()).filter((a) => a.length >= 2))] })).filter((c) => c.al.length);
      w.items = [];
      for (const x of p.lines || []) { if (!LK.test(x.key)) continue; const refs = okRefs(x); if (refs.length < MIN_REFS) { report.dropped++; continue; } w.items.push({ key: x.key, kind: "line", line: x.line, refs }); }
      const PK = /^(ID|Sd+|Wd+|RP|RWd+|RSd+|RC)$/;   // 항목 번호가 아닌 key(예: 묶음 T3를 항목으로 씀)는 버림 — 한 줄 평과 섞여 정리 단계가 멈췄음(2026-10-12)
      for (const pt of p.points || []) {
        if (!PK.test(pt.key)) continue;
        const all = [];
        for (const x of pt.parts || []) { const refs = okRefs(x); if (refs.length < MIN_REFS) { report.dropped++; continue; } all.push(...refs); w.items.push({ key: pt.key, kind: "part", name: x.name, detail: x.detail, react: x.react, refs }); }
        if (pt.insight && all.length) w.items.push({ key: pt.key, kind: "insight", insight: pt.insight, refs: [...new Set(all)].slice(0, 10) });
      }
      w.items.forEach((it, i) => { it.k = `K${i + 1}`; });
    }
    return usd;
  });
  // 2) 사실 확인 — 칸마다 근거 댓글 원문과 대조해 맞음 / 근거대로 고침 / 버림
  //    (2026-10-12 사용자 지적: '이섭의 연애' 3화 '안경 벗으니 짱'은 여주 민경인데 남주 이섭으로 씀 — 근거 개수만 보고 '누가'는 검사 안 했음)
  //    누구(무엇) 얘기인지 근거만으로 불분명하면(need) → 그 회차 공개 직후 댓글에서 찾을 단어가 든 댓글을 더 모아 붙이고 한 번 더 확인
  //    (2026-10-12 사용자: '베댓이 누가 누군지 명확하지 않을 때 댓글 확인과 검증 후에 쓰는 걸로, 다른 것도 다 검증')
  const applyCheck = (w, p, second) => {
    const v = new Map((p.items || []).map((x) => [x.k, x]));
    w.items = w.items.filter((it) => {
      if (second && !it.need) return true;   // 두 번째 확인은 불분명했던 칸만
      const x = v.get(it.k);
      if (!x || x.v === "drop") { report.checkDrop++; return false; }
      if (x.v === "need") {
        const kw = String(x.kw || "").split(/[,·\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 3);
        if (second || !kw.length) { report.checkDrop++; return false; }   // 더 찾아봐도 불분명하면 버림
        it.need = kw; report.checkNeed++; return true;
      }
      if ((it.extra || []).length) { const more = (x.more || []).filter((n) => it.extra.includes(n)); it.refs = [...new Set([...it.refs, ...more])]; }
      delete it.need;
      if (x.v === "fix") {
        report.checkFix++;
        if (it.kind === "line") { if (x.line) it.line = x.line; }
        else if (it.kind === "insight") { if (x.line) it.insight = x.line; }
        else { if (!x.name || !x.detail) { report.checkDrop++; report.checkFix--; return false; } it.name = x.name; it.detail = x.detail; if (x.react) it.react = x.react; }   // 고칠 때 이름·내용을 다 안 주면 버림(틀린 이름이 남지 않게)
      } else report.checkOk++;
      return true;
    });
  };
  const checkStage = async (label, key, list, second) => {
    if (!list.length) return;
    await stage(label, list.map((w) => ({ custom_id: `${second ? "e" : "c"}-${works.indexOf(w)}`, params: { model: SONNET.model, max_tokens: 32000, system: CHECK_SYSTEM,
        messages: [{ role: "user", content: checkText(w, second) + "\n\n항목마다 판정해 JSON으로 쓰세요." }], output_config: { format: { type: "json_schema", schema: CHECK_SCHEMA }, effort: SONNET.effort } } })),
      list.length * (second ? EST_CHECK / 3 : EST_CHECK), key, (res) => {
        let usd = 0;
        for (const [cid, r] of res) {
          const w = works[Number(cid.split("-")[1])];
          if (!w || r.type !== "succeeded") { report.notes.push(`${label} 실패 — 확인 안 된 칸은 올리지 않음: ${w ? w.cm.title : cid}`); if (w) w.items = second ? w.items.filter((it) => !it.need) : []; continue; }
          usd += costOf(SONNET.model, r.message.usage || {});
          let p; try { p = parseJson(r.message); } catch (e) { report.notes.push(`${label} 해석 실패 — 올리지 않음: ${w.cm.title}`); w.items = second ? w.items.filter((it) => !it.need) : []; continue; }
          applyCheck(w, p, second);
        }
        return usd;
      });
  };
  // 더 찾은 증거: 근거 댓글이 달린 회차의 공감순(인기순) 상위 500개에서 찾을 단어가 든 댓글(공감 순 15개)
  const gather = async (w, list, keyOf) => {
    w.pop ||= new Map(); w.seen ||= new Set([...w.num.values()].map((c) => c.cid));
    for (const it of list) {
      const kw = keyOf(it), nos = [...new Set(it.refs.map((n) => w.num.get(n).no))].slice(0, 3), found = [];
      try {
        for (const no of nos) {
          if (!w.pop.has(no)) w.pop.set(no, (await N.fetchPopular(w.id, no, 500)).comments.map((c) => ({ ...c, no })));
          found.push(...w.pop.get(no).filter((c) => kw.some((k) => c.text.includes(k))));
        }
      } catch (e) { if (e instanceof N.NaverBlocked) throw e; }
      const add = [];
      for (const c of found.sort((a, b) => b.like - a.like)) {
        if (add.length >= 15) break;
        const old = [...w.num.entries()].find(([, x]) => x.cid === c.cid);   // 이미 받은 댓글이면 같은 번호로
        if (old) { if (!it.refs.includes(old[0])) add.push(old[0]); continue; }
        const n = w.num.size + 1; w.num.set(n, { no: c.no, like: c.like, text: c.text, cid: c.cid }); add.push(n);
      }
      it.extra = [...new Set([...(it.extra || []), ...add])];
      it.kwShown = kw;
    }
  };
  // 프로그램 검사: 어떤 인물에 대한 칸인데 칸의 구체 단어(예: 안경)가 그 인물 이름·호칭과 '같은 근거 댓글'에 함께 나오지 않으면 → 확인 필요
  //   (2026-10-12: 사실 확인 AI가 '안경 벗으니 짱'을 끝까지 남주 얘기로 읽고 불분명 판정을 안 냄 → AI가 알아채길 기다리지 않고 프로그램이 표시)
  const STOP = new Set(["장면", "반응", "모습", "매력", "독자", "댓글", "칭찬", "호평", "연출", "작화", "얼굴", "비주얼", "회차", "남주", "여주", "인물", "캐릭터", "감탄", "환호", "분위기", "관계", "사이", "이야기", "전개", "느낌", "표정", "등장", "공개", "대사"]);
  const PART = /(은|는|이|가|을|를|의|에|에서|와|과|도|로|으로|한|된|던|하는|했던|하던|에게|까지|부터|처럼|만|이나|나)$/;
  const tokens = (s) => String(s || "").split(/[\s,.·~!?()'"“”‘’/·]+/).map((t) => t.replace(PART, "")).filter((t) => t.length >= 2 && !/^\d+(화|번)?$/.test(t) && !STOP.has(t));
  const flagAmbiguous = (w) => {
    const title = titlesOf(w), cast = w.cast || [];
    let n = 0;
    for (const it of w.items || []) {
      if (it.kind === "insight") continue;
      const text = it.kind === "line" ? it.line : `${it.name} ${it.detail}`;
      const ctx = `${text} ${title[it.key] || ""}`;
      const who = cast.filter((c) => c.al.some((a) => ctx.includes(a)));
      if (!who.length) continue;
      const aliases = who.flatMap((c) => c.al);
      const refs = it.refs.map((k) => w.num.get(k).text);
      const kws = [];
      for (const t of tokens(it.kind === "line" ? it.line : it.name)) {
        if (aliases.some((a) => t.includes(a) || a.includes(t))) continue;
        const with_t = refs.filter((r) => r.includes(t));
        if (with_t.length && !with_t.some((r) => aliases.some((a) => r.includes(a)))) kws.push(t);   // 단어는 나오는데 그 인물과 같은 댓글엔 없음
      }
      if (kws.length) { it.flag = kws.slice(0, 2); n++; }
    }
    return n;
  };
  for (const w of works.filter((x) => x.items && x.items.length)) {
    const n = flagAmbiguous(w);
    if (n) { await gather(w, w.items.filter((it) => it.flag), (it) => it.flag); report.flagged += n; log(`  ${w.cm.title}: 인물과 구체 내용이 같은 댓글에 없는 칸 ${n}개 → 그 회차 공감순 댓글에서 더 찾아 함께 확인`); }
  }
  await checkStage("사실 확인(Sonnet)", "check", works.filter((w) => w.items && w.items.length), false);
  // 사실 확인 AI가 '불분명'(need)으로 본 칸도 같은 방식으로 더 찾아 한 번 더 확인 → 그래도 불분명하면 버림
  const needW = works.filter((w) => w.items && w.items.some((it) => it.need));
  for (const w of needW) {
    await gather(w, w.items.filter((x) => x.need), (it) => it.need);
    log(`  ${w.cm.title}: 누구 얘기인지 불분명한 칸 ${w.items.filter((x) => x.need).length}개 → 그 회차 공감순 댓글을 더 찾아 다시 확인`);
  }
  await checkStage("불분명한 칸 다시 확인(Sonnet)", "check2", needW, true);
  // 3) 확정 — 회차 링크는 근거 댓글이 달린 회차, 칸마다 근거 수·좋아요, 원문 겹침 가림(공개 저장소)
  for (const w of works) {
    if (!w.items) continue;
    const norm = (s) => String(s || "").replace(/\s+/g, ""), grams = new Set();
    for (const c of w.num.values()) { const t = norm(c.text); for (let i = 0; i + 12 <= t.length; i++) grams.add(t.slice(i, i + 12)); }
    const sc = (s) => { const t = norm(s); for (let i = 0; i + 12 <= t.length; i++) if (grams.has(t.slice(i, i + 12))) return "(댓글 원문과 겹쳐 가림)"; return s; };
    const o = {};
    for (const it of w.items.filter((x) => x.kind !== "insight")) {
      const cs = it.refs.map((n) => w.num.get(n)), meta = { n: it.refs.length, lk: cs.reduce((t, c) => t + c.like, 0) };
      if (it.kind === "line") { o[it.key] = { line: sc(it.line), ...meta }; report.kept++; continue; }
      const epc = {}; for (const c of cs) epc[c.no] = (epc[c.no] || 0) + 1;
      if (o[it.key] && !o[it.key].parts) continue;
      (o[it.key] ||= { parts: [], insight: "" }).parts.push({ name: sc(it.name), detail: sc(it.detail), react: sc(it.react),
        eps: Object.entries(epc).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4).map(([no]) => Number(no)).sort((a, b) => a - b), ...meta });
      report.kept++;
    }
    for (const it of w.items.filter((x) => x.kind === "insight")) if (o[it.key]) o[it.key].insight = sc(it.insight);
    out[w.id] = o;
  }
} catch (e) {
  report.error = e instanceof N.NaverBlocked ? "네이버가 요청을 막아 멈췄습니다" : e.message;
  console.error("오류:", report.error);
  process.exitCode = 1;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/deep.json`, JSON.stringify({ month: MONTH, mock: MOCK, works: out }));
  writeFileSync(`${OUT}/spend.json`, JSON.stringify({ month: MONTH, delta: (state.spend[MONTH] || 0) - SPENT0 }));
  const lines = [`## 작품·독자 분석 자세히${MOCK ? " (가짜 답)" : ""}`, `- 작품: ${works.map((w) => w.cm.title).join(", ")}`, `- 네이버 요청 ${N.requests}번`,
    `- 자세히 쓴 작품 ${Object.keys(out).length}개 · 올린 칸 ${report.kept}개 · 근거 2개 미만이라 버린 칸 ${report.dropped}개 · 사실 확인: 맞음 ${report.checkOk} / 근거대로 고침 ${report.checkFix} / 확인 안 돼 버림 ${report.checkDrop} · 인물·내용이 같은 댓글에 없어 프로그램이 더 찾은 칸 ${report.flagged} · AI가 불분명하다고 해 더 찾은 칸 ${report.checkNeed}`,
    `- AI 비용 $${(report.cost.deep + report.cost.check + report.cost.check2).toFixed(3)} (자세히 $${report.cost.deep.toFixed(3)} + 사실 확인 $${(report.cost.check + report.cost.check2).toFixed(3)}) / 이 달 합계 $${(state.spend[MONTH] || 0).toFixed(2)}`,
    `- 토큰: ${Object.entries(report.tokens).map(([m, t]) => `${m} 입력 ${t.in} · 출력 ${t.out} (${t.calls}번)`).join(" / ")}`,
    ...report.notes.map((n) => "- " + n), ...(report.error ? ["- 오류: " + report.error] : [])];
  log(lines.join("\n"));
  if (args.summary) appendFileSync(args.summary, lines.join("\n") + "\n");
}
