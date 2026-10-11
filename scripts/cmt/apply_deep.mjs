/* deep_dive.mjs 결과(cmt_out/deep.json) → 사이트 파일 docs/data/cmt/{id}.json
 *   먹힌·안 먹힌 요소: analysis.strengths[i].deep / weaknesses[i].deep
 *   독자 분석: analysis.readers.deep = { RP, RW:[…], RS:[…], RC }
 *   이번 결과가 있는 작품은 예전 '자세히'를 지우고 새로 붙임(근거 부족으로 버린 칸이 예전 값으로 남지 않게)
 *   node scripts/cmt/apply_deep.mjs [cmt_out/deep.json] [docs/data/cmt]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const SRC = process.argv[2] || "cmt_out/deep.json", DIR = process.argv[3] || "docs/data/cmt";
if (!existsSync(SRC)) { console.log("자세히 결과 없음"); process.exit(0); }
const D = JSON.parse(readFileSync(SRC, "utf8"));
if (D.mock) { console.log("가짜 답 결과는 사이트에 올리지 않음"); process.exit(0); }
let n = 0;
for (const [id, pts] of Object.entries(D.works || {})) {
  const f = `${DIR}/${id}.json`;
  if (!existsSync(f)) continue;
  const o = JSON.parse(readFileSync(f, "utf8"));
  const A = o.analysis; if (!A) continue;
  const set = (p, d) => { if (d && d.parts && d.parts.length) p.deep = d; else delete p.deep; };
  (A.strengths || []).forEach((p, i) => set(p, pts[`S${i + 1}`]));
  (A.weaknesses || []).forEach((p, i) => set(p, pts[`W${i + 1}`]));
  // 작품만의 특색(ID) · 반복 반응 묶음 한 줄 평(T#) · 불호 세 가지 한 줄(DG·DS·DF)
  if (pts.ID && pts.ID.parts && pts.ID.parts.length) A.identity = pts.ID; else delete A.identity;
  (o.themes || []).forEach((t, i) => { const x = pts[`T${i + 1}`]; if (x && x.line) t.line = x; else delete t.line; });
  const DKEY = { goguma: "DG", stuffy: "DS", forced: "DF" };
  (o.dislike || []).forEach((d) => { const x = pts[DKEY[d.k]]; if (x && x.line) d.line = x; else delete d.line; });
  if (A.readers) {
    const R = A.readers;
    R.deep = { RP: pts.RP || null, RW: (R.wants || []).map((_, i) => pts[`RW${i + 1}`] || null), RS: (R.splits || []).map((_, i) => pts[`RS${i + 1}`] || null), RC: pts.RC || null };
  }
  writeFileSync(f, JSON.stringify(o));
  n++;
}
console.log(`자세히 ${n}작품 사이트 파일에 붙임`);
