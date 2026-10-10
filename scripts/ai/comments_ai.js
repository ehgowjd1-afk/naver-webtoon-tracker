/* 댓글 AI 분류 (요청서 '댓글 분석' 3~5번) — 앱 주간 순위 작품의 회차 댓글을 Claude Haiku로 분류
 *
 * 회차마다 댓글을 한 번에 받아(공감 베스트 15 + 최신 500) '좋아요 상위 30 + 나머지 중 무작위 70'을 뽑고,
 * 댓글마다 유형·서사 축·니즈 코드·니즈 상태·실제 평가·감정 대상·행동 신호·독자 유형·몰입 단계·언급 캐릭터·장면 메모·확신도를 붙인다.
 *
 * 저장소가 공개라서 댓글 원문·분류 결과는 공개 열쇠(scripts/ai/public.pem)로 암호화해 워크플로 결과물(artifact)로만 남긴다.
 * 여는 열쇠는 사용자 컴퓨터(scripts/.ai-key/private.pem, 커밋 금지)에만 있다 → scripts/ai/open.js 로 연다.
 * 닉네임·아이디 등 작성자 정보는 읽지도 저장하지도 않는다(본문·작성 시각·공감 수·베스트 여부만).
 *
 * 실행 (GitHub Actions, ANTHROPIC_API_KEY 시크릿):
 *   --mode=pilot  --ids=769209,793275 --eps=10   바로 분류(일반 요청) → 결과 암호화
 *   --mode=submit [--ids=..] --eps=20|all [--top=30 --rand=70] [--max-requests=N] [--wait-min=300]
 *                 일괄 처리(반값)로 제출 → 기다렸다가 결과 받음(시간 안에 안 끝나면 batch id만 남김)
 *   --mode=fetch  --batches=id1,id2                제출해 둔 일괄 처리 결과 받기
 * 출력: ai_out/*.enc.json (암호화), ai_out/summary.json (비용·건수 — 원문 없음)
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const NC = require('../lib/naver-comments.cjs');

const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'docs', 'data');
const OUT = path.join(ROOT, 'ai_out');
const MODEL = 'claude-haiku-5-5';
const PRICE = { in: 0.10, out: 0.50, cacheRead: 0.01, cacheWrite: 0.125 };   // $/1M 토큰 (Haiku 5.5, 10만 토큰 이하 프롬프트) — 일괄 처리는 절반

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const readJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normName = (s) => String(s || '').replace(/\s*\[[^\]]*\]\s*$/, '').replace(/\s+/g, '');

// ---- 분류 기준 (요청서 3~5번) ----
const NEEDS = [
  '주:응징사이다', '주:인정위상역전', '주:성장보상', '주:주체성', '주:상처치유', '주:긴장감대가',
  '로:관계진전', '로:쌍방확인', '로:힘구도', '로:질투독점', '로:갈등종류', '로:구원', '로:서브캐릭터',
  '판:세계관비밀공개', '판:능력체계일관성', '판:전투액션쾌감', '판:두뇌전전략', '판:회귀빙의정보우위', '판:스케일확장',
  '관:가족서사', '관:동료우정', '관:악역서사',
  '공:캐릭터일관성', '공:보상타이밍', '공:원작명장면재현', '공:설정을사건으로',
];
const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer' },
          type: { type: 'string', enum: ['환호', '불만', '요구', '예측', '단순', '외부'] },
          axes: { type: 'array', items: { type: 'string', enum: ['주인공', '로맨스', '판타지', '관계조연', '작화연출', '연재운영', '원작비교', '기타'] } },
          needs: { type: 'array', items: { type: 'string', enum: NEEDS } },
          newNeed: { type: 'string' },
          status: { type: 'string', enum: ['충족', '결핍', '요구', '갈림', '없음'] },
          eval: { type: 'string', enum: ['긍정', '부정', '중립'] },
          target: { type: 'string', enum: ['캐릭터', '전개작가', '작화', '운영', '기타'] },
          action: { type: 'string', enum: ['결제전환', '기다림유지', '추천전파', '이탈경고', '없음'] },
          reader: { type: 'string', enum: ['장기', '신규정주행', '원작', '모름'] },
          level: { type: 'integer', enum: [1, 2, 3, 4] },
          chars: { type: 'array', items: { type: 'string' } },
          scene: { type: 'string' },
          conf: { type: 'string', enum: ['높음', '중간', '낮음'] },
        },
        required: ['i', 'type', 'axes', 'needs', 'newNeed', 'status', 'eval', 'target', 'action', 'reader', 'level', 'chars', 'scene', 'conf'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};
const SYSTEM = `너는 웹툰 기획 PD를 돕는 독자 댓글 분석가다. 네이버웹툰 한 회차의 독자 댓글 목록을 받아, 댓글마다 아래 칸을 채운다.
관점: 댓글은 "리뷰(충족된 니즈) + 클레임(배신·지연된 니즈) + 주문서(아직 안 채워진 니즈)"가 섞인 것이다. 독자가 진짜 원하는 걸 거꾸로 알아내는 게 목표다.

[칸]
- type 댓글 유형: 환호 / 불만 / 요구(앞으로 이렇게 해달라) / 예측(망상·예측·떡밥 추리) / 단순(출석·ㅋㅋ·1등·의미 없는 반응) / 외부(작품 외 이슈: 광고, 다른 독자와 싸움, 현실 얘기)
- axes 서사 축(여러 개 가능): 주인공 / 로맨스 / 판타지 / 관계조연 / 작화연출 / 연재운영(휴재·분량·가격) / 원작비교 / 기타
- needs 니즈 코드(여러 개 가능, 목록에서만): 주(주인공)=응징사이다·인정위상역전·성장보상·주체성·상처치유·긴장감대가 / 로(로맨스)=관계진전·쌍방확인·힘구도·질투독점·갈등종류·구원·서브캐릭터 / 판(판타지)=세계관비밀공개·능력체계일관성·전투액션쾌감·두뇌전전략·회귀빙의정보우위·스케일확장 / 관(관계·조연)=가족서사·동료우정·악역서사 / 공(공통)=캐릭터일관성·보상타이밍·원작명장면재현·설정을사건으로. 니즈가 안 담긴 댓글은 빈 배열.
- newNeed: 목록에 없는 니즈가 분명히 보이면 짧게(예: "주인공의 과거 공개"), 없으면 빈 문자열.
- status 니즈 상태: 충족 / 결핍(배신·지연) / 요구(아직 안 채워짐) / 갈림(호불호) / 없음
- eval 실제 평가: 작품에 대한 실제 평가(겉 감정 아님) 긍정 / 부정 / 중립
- target 감정의 대상: 캐릭터 / 전개작가 / 작화 / 운영 / 기타
- action 행동 신호: 결제전환(쿠키·미리보기 결제) / 기다림유지(다음 화 기다림) / 추천전파 / 이탈경고(하차·그만 봄·결제 중단) / 없음
- reader 독자 유형 단서: 장기("1화부터", "연재 때부터") / 신규정주행 / 원작(원작 소설 독자) / 모름
- level 몰입 단계: 1 출석형 / 2 감상형 / 3 해석형(떡밥 추리·예측) / 4 확장형(재독·밈·2차 창작·영상화 요청)
- chars 언급 캐릭터 이름(작중 인물만, 댓글에 쓴 대로). 없으면 빈 배열.
- scene 어떤 장면에 대한 반응인지 30자 이내 한 줄. 알 수 없으면 빈 문자열.
- conf 분류 확신도: 높음 / 중간 / 낮음(반어·드립·밈·문맥 부족으로 애매하면 낮음)

[규칙 — 가장 중요]
- 겉 감정과 실제 평가는 다르다. "작가님 미쳤어요" = 극찬(긍정). 악역에게 하는 욕은 몰입 성공 = 긍정.
- 캐릭터에게 화내는 건 좋은 신호(target=캐릭터, eval은 대개 긍정이나 중립), 전개·작가에게 화내는 건 경고 신호(target=전개작가, eval=부정).
- "또 휴재?" 같은 운영 불만은 작품 평가와 섞지 말고 axes=연재운영, target=운영.
- 불만은 뒤집어서 숨은 니즈로 번역한다: "주인공 답답해" → 주:주체성(+공:보상타이밍) / "오해 또?" → 로:쌍방확인 / "서브남이 낫다" → 로:서브캐릭터 / "너무 쉽게 이김" → 주:긴장감대가 / "설정 설명 지루해" → 공:설정을사건으로 / "질질 끈다" → 공:보상타이밍 / "캐붕" → 공:캐릭터일관성 / "원작이랑 달라" → 공:원작명장면재현.
- 망상·예측형 댓글은 아직 안 채워진 니즈가 가장 순수하게 드러나는 곳이다. 빠짐없이 type=예측, 해당 니즈와 status=요구로.
- 반어·드립·밈은 문맥으로 판단하고, 애매하면 conf=낮음.
- 커플링·남주 진영 싸움(팬덤전)은 type=외부가 아니라 로맨스 니즈(로:서브캐릭터·로:관계진전 등)로 보고 eval은 실제 평가대로.
- 모든 댓글 번호(i)를 빠짐없이 한 번씩, 입력 순서대로 출력한다.`;

// ---- 공개 열쇠로 잠그기 (AES-256-GCM + RSA-OAEP) ----
function seal(obj) {
  const pub = fs.readFileSync(path.join(__dirname, 'public.pem'), 'utf8');
  const key = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(zlib.gzipSync(JSON.stringify(obj))), c.final()]);
  return { v: 1, key: crypto.publicEncrypt({ key: pub, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key).toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}
const saveSealed = (name, obj) => { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, `${name}.enc.json`), JSON.stringify(seal(obj))); };

// ---- 대상 작품: 앱 주간 최신 주 전체·여성·남성 ----
function appWeeklyTargets() {
  const ix = readJson(path.join(DATA, 'index.json'), { weeks: [] });
  const wk = readJson(path.join(DATA, `${ix.latest}.json`), { charts: {} });
  const L = readJson(path.join(DATA, 'lookup.json'), { id: {}, name: {} });
  const byN = {}; for (const k of Object.keys(L.name || {})) byN[normName(k)] = L.name[k];
  const out = new Map();
  for (const c of ['전체', '여성', '남성']) for (const it of (wk.charts[c] || [])) {
    const id = L.name[it.t] != null ? L.name[it.t] : byN[normName(it.t)];
    if (id == null) continue;
    const cur = out.get(String(id));
    const rank = { ...(cur ? cur.rank : {}), [c]: it.r };
    out.set(String(id), { id: String(id), title: it.t, rank });
  }
  return { week: ix.latest, list: [...out.values()] };
}

// 회차 목록: 비성인은 회차 목록 API, 성인은 댓글 수로 번호 찾기
async function episodes(id) {
  const all = await NC.listEpisodes(id, 250);
  if (all) return { adult: false, eps: all };
  const nos = await NC.probeEpisodeNos(id, 1, 3000, 250);
  return { adult: true, eps: nos.map((no) => ({ no, label: '', at: '', preview: false })) };
}
function pickEpisodes(eps, n) {
  if (n === 'all') return eps;
  const k = Number(n) || 10;
  const pub = eps.filter((e) => !e.preview), prev = eps.filter((e) => e.preview);
  return [...pub.slice(-k), ...prev.slice(0, 5)];   // 최근 공개 k화 + 미리보기(유료) 앞쪽 최대 5화
}

// 한 회차 표본: 한 번 요청(베스트 15 + 최신 500) → 좋아요 상위 nTop + 나머지 중 무작위 nRand (회차별 고정 시드)
function seeded(seed) { let s = 0; for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
async function episodeSample(id, no, nTop, nRand) {
  const j = await NC.getJSON(`${NC.CB}/v2/posts?pageId=${NC.pageId(id, no)}&pinRepresentation=distinct&prevSize=0&nextSize=500`, { comment: true });
  const r = j.result || {};
  const seen = new Set(), pool = [];
  let label = '', author = 0;
  for (const p of [...(r.tops || []), ...(r.posts || [])]) {
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    if (!label && p.pageName) label = String(p.pageName).trim();
    if (p.createdBy && p.createdBy.isPageOwner) { author++; continue; }   // 작가 본인 댓글은 독자 반응이 아니라 뺌
    const body = String(p.body || '').trim();
    if (p.status !== 'SERVICE' || NC.extra(p, 'CLEANBOT_STATUS') === 'BLIND' || !body) continue;
    pool.push({ text: body.slice(0, 400), likes: NC.likesOf(p), at: p.createdAt ? new Date(p.createdAt).toISOString() : '', best: !!p.isTop, replies: p.activeChildPostCount || p.childPostCount || 0 });
  }
  pool.sort((a, b) => b.likes - a.likes);
  const top = pool.slice(0, nTop).map((x) => ({ ...x, pick: 'top' }));
  const rest = pool.slice(nTop), rnd = seeded(`${id}_${no}`);
  for (let i = rest.length - 1; i > 0; i--) { const k = Math.floor(rnd() * (i + 1)); [rest[i], rest[k]] = [rest[k], rest[i]]; }
  const rand = rest.slice(0, nRand).map((x) => ({ ...x, pick: 'rand' }));
  const total = r.activeRootPostCount ?? r.rootPostCount ?? null;
  return { label, total, poolSize: pool.length, complete: total != null && pool.length + author >= total, comments: [...top, ...rand] };
}

function userText(w, e, s, det) {
  const d = det[w.id] || {};
  const head = `작품: ${w.title} (장르: ${d.g || '?'}${(d.k || []).length ? ` · 키워드: ${(d.k || []).slice(0, 6).join(', ')}` : ''})\n줄거리: ${String(d.syn || '').slice(0, 220)}\n회차: ${s.label || e.label || `${e.no}번`}${e.preview ? ' (미리보기·유료 선공개)' : ''}\n`;
  const lines = s.comments.map((c, i) => `${i + 1} | 공감 ${c.likes} | ${c.best ? '베스트' : '-'} | ${c.text.replace(/\s+/g, ' ')}`);
  return `${head}\n댓글 목록 (번호 | 공감 | 베스트 여부 | 본문):\n${lines.join('\n')}`;
}
const params = (text) => ({
  model: MODEL,
  max_tokens: 32000,
  system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: text }],
  output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
});

// 표본 모으기 (네이버 요청: 작업자 3 · 간격 250ms · 연속 실패 30번이면 멈춤)
async function collect(targets, epsArg, nTop, nRand, maxReq) {
  const det = readJson(path.join(DATA, 'details.json'), {});
  const samples = [];
  let streak = 0, stop = false, reqs = 0, i = 0;
  const worker = async () => {
    while (!stop && i < targets.length) {
      const w = targets[i++];
      let E;
      try { E = await episodes(w.id); streak = 0; } catch (e) { if (++streak >= 30) stop = true; continue; }
      w.adult = E.adult;
      for (const e of pickEpisodes(E.eps, epsArg)) {
        if (stop || (maxReq && reqs >= maxReq)) break;
        try {
          const s = await episodeSample(w.id, e.no, nTop, nRand);
          streak = 0;
          if (s.comments.length) { samples.push({ w: { id: w.id, title: w.title, rank: w.rank, adult: w.adult }, e: { no: e.no, label: s.label || e.label, at: e.at, preview: !!e.preview }, total: s.total, poolSize: s.poolSize, complete: s.complete, comments: s.comments, text: userText(w, e, s, det) }); reqs++; }
        } catch (err) { if (err.status !== 404 && ++streak >= 30) { console.log('  ! 연속 실패 30번 — 멈춤'); stop = true; } }
        await sleep(250);
      }
      console.log(`  표본 ${w.title} (${samples.filter((x) => x.w.id === w.id).length}화) · 누적 ${samples.length}`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return samples;
}

const costOf = (u, batch) => {
  const k = batch ? 0.5 : 1;
  return k * ((u.input_tokens || 0) * PRICE.in + (u.output_tokens || 0) * PRICE.out + (u.cache_read_input_tokens || 0) * PRICE.cacheRead + (u.cache_creation_input_tokens || 0) * PRICE.cacheWrite) / 1e6;
};
const addUsage = (acc, u) => { for (const k of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) acc[k] = (acc[k] || 0) + (u[k] || 0); };
const textOf = (msg) => (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');

async function main() {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();
  const mode = arg('mode', 'pilot');
  const nTop = Number(arg('top', 30)), nRand = Number(arg('rand', 70));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const summary = { mode, model: MODEL, startedAt: new Date().toISOString() };

  if (mode === 'fetch') {
    const ids = arg('batches', '').split(',').filter(Boolean);
    const results = {}; const usage = {};
    for (const bid of ids) {
      const b = await client.messages.batches.retrieve(bid);
      summary[bid] = b.processing_status;
      if (b.processing_status !== 'ended') { console.log(`${bid}: 아직 ${b.processing_status}`); continue; }
      for await (const r of await client.messages.batches.results(bid)) {
        if (r.result.type === 'succeeded') { addUsage(usage, r.result.message.usage || {}); results[r.custom_id] = { ok: 1, json: textOf(r.result.message), stop: r.result.message.stop_reason }; }
        else results[r.custom_id] = { ok: 0, err: r.result.type };
      }
    }
    summary.results = Object.keys(results).length; summary.usage = usage; summary.costUSD = +costOf(usage, true).toFixed(3);
    saveSealed(`results-${stamp}`, { batches: ids, results });
    fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
    console.log(JSON.stringify(summary));
    return;
  }

  // 대상
  const T = appWeeklyTargets();
  let targets = T.list;
  const idsArg = arg('ids', '');
  if (idsArg) { const want = idsArg.split(','); targets = want.map((id) => targets.find((t) => t.id === id) || { id, title: (readJson(path.join(DATA, 'lookup.json'), { id: {} }).id[id] || [id])[0], rank: {} }); }
  const epsArg = arg('eps', '10');
  const maxReq = Number(arg('max-requests', 0)) || 0;
  console.log(`앱 주간 ${T.week} · 대상 ${targets.length}작품 · 회차 ${epsArg} · 회차당 상위 ${nTop}+무작위 ${nRand} · ${mode}`);
  const samples = await collect(targets, epsArg, nTop, nRand, maxReq);
  const nComments = samples.reduce((s, x) => s + x.comments.length, 0);
  summary.week = T.week; summary.works = new Set(samples.map((x) => x.w.id)).size; summary.episodes = samples.length; summary.comments = nComments;
  console.log(`표본: ${summary.works}작품 · ${samples.length}회차 · 댓글 ${nComments}개`);
  const sampleFile = `samples-${stamp}`;
  saveSealed(sampleFile, { week: T.week, nTop, nRand, samples: samples.map(({ text, ...rest }) => rest) });

  if (mode === 'pilot') {
    const results = {}; const usage = {};
    let k = 0;
    const run = async () => {
      while (k < samples.length) {
        const s = samples[k++];
        const cid = `${s.w.id}_${s.e.no}`;
        try {
          const msg = await client.messages.stream(params(s.text)).finalMessage();   // 답이 길 수 있어 실시간 전송(일반 요청은 SDK가 10분 넘을 수 있다며 막음)
          addUsage(usage, msg.usage || {});
          results[cid] = { ok: 1, json: textOf(msg), stop: msg.stop_reason };
        } catch (e) { results[cid] = { ok: 0, err: String(e.message || e).slice(0, 200) }; }
        console.log(`  분류 ${cid} ${results[cid].ok ? 'ok' : 'x'}`);
      }
    };
    await Promise.all([run(), run()]);
    summary.usage = usage; summary.costUSD = +costOf(usage, false).toFixed(4);
    summary.costPerComment = nComments ? +(summary.costUSD / nComments).toFixed(6) : 0;
    summary.failed = Object.values(results).filter((r) => !r.ok).length;
    saveSealed(`results-${stamp}`, { samplesFile: sampleFile, results });
    fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
    console.log(JSON.stringify(summary));
    return;
  }

  // submit: 일괄 처리(반값). 한 묶음 200MB·10만 건 안으로 나눔
  const reqs = samples.map((s) => ({ custom_id: `${s.w.id}_${s.e.no}`, params: params(s.text) }));
  const chunks = []; let cur = [], size = 0;
  for (const r of reqs) { const b = Buffer.byteLength(JSON.stringify(r)); if (cur.length && (size + b > 200e6 || cur.length >= 90000)) { chunks.push(cur); cur = []; size = 0; } cur.push(r); size += b; }
  if (cur.length) chunks.push(cur);
  const ids = [];
  for (const c of chunks) { const b = await client.messages.batches.create({ requests: c }); ids.push(b.id); console.log(`일괄 처리 제출 ${b.id} (${c.length}건)`); }
  summary.batches = ids; summary.samplesFile = sampleFile;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
  // 기다렸다가 결과 받기 (시간 안에 안 끝나면 fetch 모드로 나중에)
  const deadline = Date.now() + Number(arg('wait-min', 300)) * 60000;
  const results = {}; const usage = {};
  for (const bid of ids) {
    let b;
    while (true) { b = await client.messages.batches.retrieve(bid); if (b.processing_status === 'ended' || Date.now() > deadline) break; console.log(`  ${bid} ${b.processing_status} · 처리중 ${b.request_counts.processing} · 완료 ${b.request_counts.succeeded}`); await sleep(60000); }
    if (b.processing_status !== 'ended') { console.log(`${bid} 아직 안 끝남 — 나중에 --mode=fetch --batches=${ids.join(',')}`); continue; }
    for await (const r of await client.messages.batches.results(bid)) {
      if (r.result.type === 'succeeded') { addUsage(usage, r.result.message.usage || {}); results[r.custom_id] = { ok: 1, json: textOf(r.result.message), stop: r.result.message.stop_reason }; }
      else results[r.custom_id] = { ok: 0, err: r.result.type };
    }
  }
  summary.results = Object.keys(results).length; summary.usage = usage; summary.costUSD = +costOf(usage, true).toFixed(3);
  if (summary.results) saveSealed(`results-${stamp}`, { samplesFile: sampleFile, batches: ids, results });
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary));
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { SCHEMA, SYSTEM, NEEDS, seal, collect, appWeeklyTargets, episodeSample, params };
