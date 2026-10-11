/* deep_dive.mjs 결과(cmt_out/deep.json) → 사이트 파일 docs/data/cmt/{id}.json 의 analysis.strengths[i].deep / weaknesses[i].deep
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
  if (!o.analysis) continue;
  (o.analysis.strengths || []).forEach((p, i) => { const d = pts[`S${i + 1}`]; if (d && d.parts && d.parts.length) p.deep = d; });
  (o.analysis.weaknesses || []).forEach((p, i) => { const d = pts[`W${i + 1}`]; if (d && d.parts && d.parts.length) p.deep = d; });
  writeFileSync(f, JSON.stringify(o));
  n++;
}
console.log(`요소 자세히 ${n}작품 사이트 파일에 붙임`);
