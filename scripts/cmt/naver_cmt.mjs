/* 네이버웹툰 회차 댓글 수집 (로그인 없음) — 리디 트래커 ridi_comments.mjs 의 네이버판
 *
 * - 요청 간격 2초 이상, '너무 많음(429)'이 3번 이어지면 멈춘다(NaverBlocked).
 * - 작성자 닉네임·아이디·회원번호(createdBy 전체)는 읽자마자 버린다. 남기는 건 본문·작성 시각·공감 수·베스트 여부·댓글 번호뿐.
 * - 삭제·클린봇이 가린 댓글, 작가 본인 댓글(isPageOwner)은 독자 반응이 아니라 뺀다.
 * API: scripts/lib/naver-comments.cjs 설명 참고. 댓글 id = KW-comic_webtoon:{n/2000}-webtoon_{작품}_{회차}-{n 36진수} (n = 그 회차 몇 번째 댓글)
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const NC = require("../lib/naver-comments.cjs");

export const GAP_MS = 2000;
export class NaverBlocked extends Error {}
export const cut = (s, n) => Array.from(String(s ?? "")).slice(0, n).join("");   // 글자 단위(이모지를 반쪽으로 자르지 않음)
export let requests = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tooMany = 0;

async function get(url, opts = {}) {
  for (;;) {
    await sleep(GAP_MS);
    requests++;
    try { const j = await NC.getJSON(url, opts); tooMany = 0; return j; }
    catch (e) {
      if (e.status === 429) { if (++tooMany >= 3) throw new NaverBlocked("네이버가 '너무 많음(429)'을 3번 보내 멈춥니다"); await sleep(30000); continue; }
      throw e;
    }
  }
}
const ymd = (s) => { const m = String(s || "").match(/(\d{2,4})\.(\d{1,2})\.(\d{1,2})/); if (!m) return ""; const y = m[1].length === 2 ? `20${m[1]}` : m[1]; return `${y}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`; };
const cid = (t, no, n) => `KW-comic_webtoon:${Math.floor(n / 2000)}-webtoon_${t}_${no}-${n.toString(36)}`;
const numOf = (id) => parseInt(String(id).split("-").pop(), 36);

// 작품 정보는 트래커가 모은 파일에서 (제목·장르·키워드·줄거리·노블코믹스·성인)
export function workInfo(id) {
  const rd = (f, d) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return d; } };
  const L = rd("docs/data/lookup.json", { id: {} }), D = rd("docs/data/details.json", {});
  const d = D[id] || {}, l = L.id[id] || [];
  return { title: l[0] || String(id), author: l[2] || "", genre: d.g || "", keywords: d.k || [], desc: String(d.syn || "").slice(0, 300), novel: !!d.novel, adult: !!d.adult };
}

// 회차 목록 [{no, label, date, preview}] — 비성인은 회차 목록(ASC 전 페이지), 성인은 로그인 필요라 댓글 수로 번호만
export async function fetchSeries(id) {
  const ref = `https://comic.naver.com/webtoon/list?titleId=${id}`;
  const url = (p) => `https://comic.naver.com/api/article/list?titleId=${id}&page=${p}&sort=ASC`;
  let first;
  try { first = await get(url(1), { referer: ref }); }
  catch (e) {
    if (e.status !== 401 && e.status !== 403) throw e;
    const counts = await fetchCounts(id, Array.from({ length: 3000 }, (_, i) => i + 1), true);
    const nos = Object.keys(counts).map(Number).filter((n) => counts[n] > 0).sort((a, b) => a - b);
    return { adult: true, episodes: nos.map((no) => ({ no, label: "", date: "", preview: false })) };
  }
  const eps = [];
  const add = (a, prev) => { if (a && a.no != null) eps.push({ no: a.no, label: String(a.subtitle || "").trim(), date: ymd(a.serviceDateDescription), preview: !!(prev || a.charge) }); };
  (first.articleList || []).forEach((a) => add(a, false));
  for (let p = 2; p <= ((first.pageInfo || {}).totalPages || 1); p++) ((await get(url(p), { referer: ref })).articleList || []).forEach((a) => add(a, false));
  (first.chargeFolderArticleList || []).forEach((a) => add(a, true));
  const seen = new Set();
  return { adult: false, episodes: eps.filter((e) => !seen.has(e.no) && seen.add(e.no)).sort((a, b) => a.no - b.no) };
}

// 회차별 댓글 수(답글 제외 = activeRootPostCount) — 50회차씩. probe=true 면 댓글이 없는 50칸이 나오면 멈춤(성인작 번호 찾기)
export async function fetchCounts(id, nos, probe = false) {
  const out = {};
  for (let i = 0; i < nos.length; i += 50) {
    const batch = nos.slice(i, i + 50);
    const j = await get(`${NC.CB}/v1/pages/activity/count/?${batch.map((no) => `pageIds=${NC.pageId(id, no)}`).join("&")}`, { comment: true });
    let any = false;
    for (const c of ((j.result || {}).countList || [])) { const m = String(c.pageId).match(/_(\d+)$/); if (m) { out[m[1]] = c.activeRootPostCount || 0; if (out[m[1]] > 0) any = true; } }
    if (probe && !any) break;
  }
  return out;
}

function clean(p) {   // 작성자 정보는 여기서 버림
  const body = String(p.body || "").trim();
  if (p.status !== "SERVICE" || NC.extra(p, "CLEANBOT_STATUS") === "BLIND" || !body) return null;
  if (p.createdBy && p.createdBy.isPageOwner) return null;
  return { cid: numOf(p.id), text: body, like: NC.likesOf(p), at: p.createdAt ? new Date(p.createdAt).toISOString() : "", best: !!p.isTop };
}

// 공감순 베스트(최대 15) + 회차 이름
export async function fetchBest(id, no) {
  const j = await get(`${NC.CB}/v1/page/${NC.pageId(id, no)}/top-recent-posts?topCount=15&recentTopCount=0&pinRepresentation=distinct`, { comment: true });
  const r = j.result || {}, seen = new Set(), out = [];
  let label = "";
  for (const p of [...(r.pins || []), ...(r.tops || [])]) {
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    if (!label && p.pageName) label = String(p.pageName).trim();
    const c = clean(p);
    if (c) out.push({ ...c, best: true });
  }
  return { label, comments: out.sort((a, b) => b.like - a.like) };
}

// 공개 직후 첫 댓글 n개 (댓글 번호 1~n) — 번호로 건너뛰어 한 번에. 첫 댓글 시각 = 공개 시각에 가까움
export async function fetchEarly(id, no, n) {
  const j = await get(`${NC.CB}/v2/posts?pageId=${NC.pageId(id, no)}&pinRepresentation=none&prevSize=0&nextSize=${n}&cursor=${encodeURIComponent(cid(id, no, n + 1))}`, { comment: true });
  const ps = (j.result || {}).posts || [];
  const out = ps.map(clean).filter(Boolean).sort((a, b) => a.cid - b.cid);
  const first = ps.map((p) => p.createdAt).filter(Boolean).sort((a, b) => a - b)[0];
  return { comments: out, firstAt: first ? new Date(first).toISOString() : "" };
}
