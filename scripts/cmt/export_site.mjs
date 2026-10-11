/* 댓글 분석 결과(cmt_out/result.json — 원문 없음) → 사이트용 파일
 *   docs/data/cmt/{titleId}.json : 회차별(댓글 수·급증/급감·이 화 내용/반응·많이 나온 묶음·불호) + 반복 반응 묶음 + 불호 세 가지 + 작품·독자 분석
 *   docs/data/cmt/index.json     : 분석된 작품 목록(요약) — 실행할 때마다 합쳐서 갱신
 * 공개 저장소라 댓글 원문·번호는 싣지 않는다(숫자·묶음 이름·AI 요약만, AI 글은 cmt_pilot에서 원문 겹침을 이미 가림).
 *   node scripts/cmt/export_site.mjs [cmt_out/result.json] [docs/data/cmt]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const SRC = process.argv[2] || "cmt_out/result.json";
const DIR = process.argv[3] || "docs/data/cmt";
if (!existsSync(SRC)) { console.log("결과 파일 없음 — 내보낼 것 없음"); process.exit(0); }
const R = JSON.parse(readFileSync(SRC, "utf8"));
if (R.mock) { console.log("가짜 답 모드 결과는 사이트에 올리지 않음"); process.exit(0); }
mkdirSync(DIR, { recursive: true });
const day = String(R.generated_at || new Date().toISOString()).slice(0, 10);
const KINDS = ["goguma", "stuffy", "forced"];
const topEps = (o, n) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).slice(0, n);

const idxPath = `${DIR}/index.json`;
const index = existsSync(idxPath) ? JSON.parse(readFileSync(idxPath, "utf8")) : { works: {} };
let wrote = 0;
for (const w of R.works || []) {
  const cs = (w.comments || []).filter((c) => c.lab);
  if (!cs.length || !(w.themes || []).length) { console.log(`건너뜀(분석 덜 됨): ${w.title}`); continue; }
  const themes = w.themes.filter((t) => t.count > 0).sort((a, b) => b.count - a.count);
  const tIdx = new Map(themes.map((t, i) => [t.id, i]));
  // 회차별로 댓글 표시 모으기
  const per = new Map();
  for (const c of cs) {
    const p = per.get(c.no) || { th: {}, dk: [0, 0, 0], tn: {}, n: 0 };
    p.n++; p.tn[c.lab.tn] = (p.tn[c.lab.tn] || 0) + 1;
    for (const id of c.lab.th || []) if (tIdx.has(id)) p.th[tIdx.get(id)] = (p.th[tIdx.get(id)] || 0) + 1;
    if (c.lab.tn === "critic" && c.lab.dk) p.dk[KINDS.indexOf(c.lab.dk)]++;
    per.set(c.no, p);
  }
  const eps = w.episodes.filter((e) => e.analyzed || e.count).map((e) => {
    const p = per.get(e.no);
    const o = { no: e.no, l: e.label, d: e.date || "", c: e.count ?? null };
    if (e.ratio != null) o.x = e.ratio;
    if (e.deep) o.k = e.deep;
    if (e.drop) o.dr = e.drop;
    if (e.ext && e.ext.length) o.ext = e.ext;
    if (e.flags && e.flags.length) o.f = e.flags;
    if (e.preview) o.pv = 1;
    if (e.sum) { o.s = e.sum.s; o.r = e.sum.r; o.m = e.sum.mood; }
    if (p) { o.n = p.n; o.t = Object.entries(p.th).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([i, n]) => [+i, n]); if (p.dk.some(Boolean)) o.dk = p.dk; o.tn = p.tn; }
    return o;
  });
  const out = {
    v: 1, id: w.id, title: w.title, genre: w.genre || "", updated: day,
    n: { total: cs.length, best: cs.filter((c) => c.pick === "best").length, early: cs.filter((c) => c.pick === "early").length, ops: w.ops ?? cs.filter((c) => c.lab.tn === "miss").length },
    eps,
    themes: themes.map((t) => ({ b: t.bucket, l: t.label, d: t.def || "", n: t.count, lk: t.likes, e: topEps(t.eps, 5) })),
    dislike: KINDS.map((k) => { const x = (w.dislikeKinds || {})[k] || {}; return { k, l: x.label || k, n: x.count || 0, lk: x.likes || 0, e: topEps(x.eps, 5) }; }),
    analysis: w.analysis || null
  };
  writeFileSync(`${DIR}/${w.id}.json`, JSON.stringify(out));
  const spikes = eps.filter((e) => e.k === "급증").length, drops = eps.filter((e) => e.k === "급감 직전").length;
  index.works[w.id] = { t: w.title, u: day, n: cs.length, eps: eps.length,
    like: themes.filter((t) => t.bucket === "like").slice(0, 2).map((t) => t.l),
    dk: out.dislike.map((x) => x.n), sp: spikes, dr: drops, sum: (w.analysis && w.analysis.summary) || "" };
  wrote++;
}
index.updated = day;
writeFileSync(idxPath, JSON.stringify(index));
console.log(`사이트용 댓글 분석 ${wrote}작품 내보냄 → ${DIR} (목록 ${Object.keys(index.works).length}작품)`);
