/* 네이버웹툰 회차 댓글 API (로그인 불필요 — 무료·미리보기·성인 작품 모두 열림, 2026-10-10 확인)
 *
 *   공감 베스트: GET comic.naver.com/comment/api/community/v1/page/webtoon_{titleId}_{no}/top-recent-posts?topCount=15&recentTopCount=0&pinRepresentation=distinct
 *                → result.tops[] (공감순, 서버 상한 15개), result.page.pageName = 회차 이름("178화")
 *   댓글 수   : GET .../v1/pages/activity/count/?pageIds=webtoon_{t}_{no}&pageIds=... (한 번에 50개까지, 65개는 400)
 *                → activePostCount = 네이버 화면의 '댓글 N'(답글 포함). 아직 안 나온 회차는 0
 *   회차 목록 : GET comic.naver.com/api/article/list?titleId=&page=&sort=ASC (20개씩) — 성인 작품은 로그인 필요(401)라 댓글 수로 회차 번호를 찾음
 *   헤더 Service-Ticket-Id: comic_webtoon 이 없으면 400.
 *
 * 저장하는 건 댓글 본문(잘라서)·공감 수·회차뿐 — 닉네임·아이디 같은 사용자 정보는 읽지도 저장하지도 않는다.
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
const CB = 'https://comic.naver.com/comment/api/community';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class HttpError extends Error { constructor(status, url) { super(`${status} ${url}`); this.status = status; } }

// 5xx·네트워크 오류는 두 번까지 다시, 4xx는 바로 실패 (404 = 없는 회차)
async function getJSON(url, { referer = 'https://comic.naver.com/', comment = false, tries = 3 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const headers = { 'User-Agent': UA, Referer: referer, Accept: 'application/json' };
      if (comment) headers['Service-Ticket-Id'] = 'comic_webtoon';
      const r = await fetch(url, { headers });
      if (r.ok) return await r.json();
      if (r.status < 500) throw new HttpError(r.status, url);
      last = new HttpError(r.status, url);
    } catch (e) {
      if (e instanceof HttpError && e.status < 500) throw e;
      last = e;
    }
    await sleep(800 * (i + 1));
  }
  throw last;
}

const pageId = (titleId, no) => `webtoon_${titleId}_${no}`;
const likesOf = (p) => { const e = ((p.reactions || [])[0] || {}).emotions || []; const l = e.find((x) => x.emotionId === 'like'); return l ? l.count || 0 : 0; };
const extra = (p, key) => ((p.extraList || []).find((x) => x.key === key) || {}).value;

// 공감 베스트 최대 15개 → [{text, likes, at, author, ownerLiked}] + 회차 이름. 삭제·클린봇이 가린 댓글은 뺀다(본문은 와도 사이트에선 숨겨짐)
async function bestComments(titleId, no) {
  const j = await getJSON(`${CB}/v1/page/${pageId(titleId, no)}/top-recent-posts?topCount=15&recentTopCount=0&pinRepresentation=distinct`, { comment: true });
  const r = j.result || {};
  const seen = new Set();
  const out = [];
  for (const p of [...(r.pins || []), ...(r.tops || [])]) {
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    if (p.status !== 'SERVICE' || extra(p, 'CLEANBOT_STATUS') === 'BLIND' || !(p.body || '').trim()) continue;
    const owner = (((p.reactions || [])[0] || {}).emotions || []).some((e) => e.emotionId === 'like' && (e.pageOwnerReactors || []).length);
    out.push({ text: p.body, likes: likesOf(p), at: p.createdAt ? new Date(p.createdAt).toISOString() : '', author: !!(p.createdBy && p.createdBy.isPageOwner), ownerLiked: owner });
  }
  out.sort((a, b) => b.likes - a.likes);
  const any = [...(r.tops || []), ...(r.pins || [])].find((p) => p && p.pageName);   // 회차 이름은 댓글마다 pageName으로 옴('178화')
  return { label: ((r.page || {}).pageName || (any && any.pageName) || '').trim(), comments: out };
}

// 회차별 댓글 수 {no: activePostCount} — 50개씩 묶어서
async function commentCounts(titleId, nos, gap = 150) {
  const out = {};
  for (let i = 0; i < nos.length; i += 50) {
    const batch = nos.slice(i, i + 50);
    const qs = batch.map((no) => `pageIds=${pageId(titleId, no)}`).join('&');
    const j = await getJSON(`${CB}/v1/pages/activity/count/?${qs}`, { comment: true });
    for (const c of ((j.result || {}).countList || [])) {
      const m = String(c.pageId || '').match(/_(\d+)$/);
      if (m) out[m[1]] = c.activePostCount || 0;
    }
    if (i + 50 < nos.length) await sleep(gap);
  }
  return out;
}

// 회차 목록 [{no, label, at(YYYY.MM.DD→YYYY-MM-DD), preview}] — 공개 회차(ASC 전 페이지) + 미리보기(유료 선공개)
// 성인 작품이면 null (로그인 필요)
async function listEpisodes(titleId, gap = 150) {
  const url = (p) => `https://comic.naver.com/api/article/list?titleId=${titleId}&page=${p}&sort=ASC`;
  const ref = `https://comic.naver.com/webtoon/list?titleId=${titleId}`;
  let first;
  try { first = await getJSON(url(1), { referer: ref }); } catch (e) { if (e.status === 401 || e.status === 403) return null; throw e; }
  const date = (s) => { const m = String(s || '').match(/(\d{2,4})\.(\d{1,2})\.(\d{1,2})/); if (!m) return ''; const y = m[1].length === 2 ? `20${m[1]}` : m[1]; return `${y}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; };
  const eps = [];
  // ASC 목록엔 미리보기(유료 선공개, charge·'N일 후 무료')도 섞여 옴
  const add = (a, preview) => { if (a && a.no != null) eps.push({ no: a.no, label: (a.subtitle || '').trim(), at: date(a.serviceDateDescription), preview: preview || !!a.charge }); };
  (first.articleList || []).forEach((a) => add(a, false));
  const pages = (first.pageInfo || {}).totalPages || 1;
  for (let p = 2; p <= pages; p++) {
    await sleep(gap);
    const j = await getJSON(url(p), { referer: ref });
    (j.articleList || []).forEach((a) => add(a, false));
  }
  (first.chargeFolderArticleList || []).forEach((a) => add(a, true));
  const seen = new Set();
  return eps.filter((e) => !seen.has(e.no) && seen.add(e.no)).sort((a, b) => a.no - b.no);
}

// 최신 회차 쪽만 (DESC 1페이지 + 미리보기) — 매일 새 회차 확인용, 요청 1번
async function latestEpisodes(titleId) {
  const ref = `https://comic.naver.com/webtoon/list?titleId=${titleId}`;
  let j;
  try { j = await getJSON(`https://comic.naver.com/api/article/list?titleId=${titleId}&page=1&sort=DESC`, { referer: ref }); } catch (e) { if (e.status === 401 || e.status === 403) return null; throw e; }
  const date = (s) => { const m = String(s || '').match(/(\d{2,4})\.(\d{1,2})\.(\d{1,2})/); if (!m) return ''; const y = m[1].length === 2 ? `20${m[1]}` : m[1]; return `${y}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; };
  const out = [];
  (j.articleList || []).forEach((a) => out.push({ no: a.no, label: (a.subtitle || '').trim(), at: date(a.serviceDateDescription), preview: !!a.charge }));
  (j.chargeFolderArticleList || []).forEach((a) => out.push({ no: a.no, label: (a.subtitle || '').trim(), at: date(a.serviceDateDescription), preview: true }));
  return { total: j.totalCount || 0, eps: out };
}

// 성인 작품: 댓글 수로 회차 번호 찾기 — from 이후 번호를 50개씩 보고, 댓글 있는 번호를 회차로 본다(안 나온 회차는 0)
async function probeEpisodeNos(titleId, from = 1, max = 2000, gap = 150) {
  const nos = [];
  for (let s = Math.max(1, from); s <= max; s += 50) {
    const batch = []; for (let n = s; n < s + 50; n++) batch.push(n);
    const c = await commentCounts(titleId, batch, gap);
    const live = batch.filter((n) => (c[n] || 0) > 0);
    nos.push(...live);
    if (!live.length) break;
    await sleep(gap);
  }
  return nos;
}

// 앱 주간 제목이 lookup에 없을 때: 네이버 검색으로 titleId
async function searchTitleId(title) {
  const j = await getJSON(`https://comic.naver.com/api/search/all?keyword=${encodeURIComponent(title)}`);
  const list = (((j || {}).searchWebtoonResult || {}).searchViewList) || [];
  const norm = (s) => String(s || '').replace(/\s+/g, '');
  const hit = list.find((x) => norm(x.titleName) === norm(title));
  return hit ? hit.titleId : null;
}

module.exports = { bestComments, commentCounts, listEpisodes, latestEpisodes, probeEpisodeNos, searchTitleId, sleep, HttpError, getJSON, pageId, likesOf, extra, CB };
