'use strict';
// 카카오페이지 웹소설 원작 검색 (platform key "kakao")
// Public, no-login BFF endpoints (same ones the page.kakao.com SPA calls):
//   search  : https://bff-page.kakao.com/api/gateway/api/v2/search/series?keyword=KW&category_uid=0&is_complete=false&sort_type=ACCURACY&page=0&size=25
//             (is_complete=false = no filter -> ongoing AND completed; is_complete=true keeps only completed)
//   overview: https://bff-page.kakao.com/api/gateway/api/v1/content/overview?series_id=ID  (on_sale_count = eps)
// search(title, authors, opts?) -> [{p:'kakao', title, author, url, id, eps?|vols?, done, adult, views, variant?, contains?, fuzzy?}]
// Only accepted hits are returned: category==='웹소설' AND author matches AND title is the same work.
// Verifier changes (2026-10-20): searches restricted to category_uid=11 (웹소설); direction-aware containment
// (short same-author title inside a longer webtoon title is rejected unless >=4 chars and >=60%); when an exact title
// exists, contains/fuzzy hits are dropped; '[외전 독점]/[외전포함]' no longer flags the main work as 외전; a result made
// only of 외전/속편 series is dropped; author search reads one more page for prolific authors; a [단행본]-only top hit
// reports vols (권) instead of eps; requests are serialised through a module-level queue.

const BASE = 'https://bff-page.kakao.com/api/gateway/api';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const HEADERS = {
  'User-Agent': UA,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'ko-KR,ko;q=0.9',
  'Origin': 'https://page.kakao.com',
  'Referer': 'https://page.kakao.com/',
};
const MIN_GAP_MS = 1500;

let lastReqAt = 0;          // module-level timestamp shared by every request
let blockedStreak = 0;      // consecutive 403/429
let requestCount = 0;
let queue = Promise.resolve(); // serialises requests so concurrent search() calls still keep the gap

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(url) {
  const p = queue.then(() => getJsonNow(url));
  queue = p.catch(() => {});
  return p;
}
async function getJsonNow(url) {
  const wait = lastReqAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastReqAt = Date.now();
  requestCount++;
  let res;
  try {
    res = await fetch(url, { headers: HEADERS });
  } catch (e) {
    lastReqAt = Date.now();
    throw new Error('kakao fetch failed: ' + e.message);
  }
  lastReqAt = Date.now();
  if (res.status === 403 || res.status === 429) {
    blockedStreak++;
    const err = new Error(`kakao HTTP ${res.status} (streak ${blockedStreak})`);
    err.blocked = blockedStreak >= 2;
    err.status = res.status;
    throw err;
  }
  blockedStreak = 0;
  if (!res.ok) throw new Error(`kakao HTTP ${res.status} for ${url}`);
  return res.json();
}

// ---------- normalisation ----------
const TAG_WORDS = [
  '19세완전판', '15세개정판', '15세이용가', '개정판', '완전판', '리마스터판', '리마스터', '특별판', '합본',
  '단행본', '독점', '선독점', '연재', '완결', '외전', '번외', '무료', '기다무',
];
const BRACKETS = /\[[^\]]*\]|【[^】]*】|〔[^〕]*〕|［[^］]*］|〈[^〉]*〉|<[^>]*>|「[^」]*」|『[^』]*』|\([^)]*\)|（[^）]*）/g;
const nfkc = (s) => String(s || '').normalize('NFKC').toLowerCase();
const alnum = (s) => s.replace(/[^\p{L}\p{N}]/gu, '');
function stripTags(s) {
  let t = alnum(s);
  for (const w of TAG_WORDS) t = t.split(w).join('');
  return t;
}
// several normalised forms of a title (with / without bracketed parts)
function titleForms(title) {
  const s = nfkc(title);
  const forms = new Set();
  const noBr = stripTags(s.replace(BRACKETS, ' '));
  if (noBr) forms.add(noBr);
  const keepBr = stripTags(s);           // brackets removed as chars only, content kept (minus tag words)
  if (keepBr) forms.add(keepBr);
  return [...forms];
}
// bracket tags that only say the main work CONTAINS / ships extra side stories, e.g. "[외전 독점]",
// "[외전포함]", "[외전 선공개]" -> the series is still the main work, not a spin-off.
const SIDE_INCLUDED = /[\[(（【]\s*외전\s*(포함|독점|선공개|추가|수록|연재)[^\])）】]*[\])）】]/g;
function variantOf(title) {
  const raw = nfkc(title);
  const s = raw.replace(/\s+/g, '');
  const v = [];
  if (s.includes('단행본')) v.push('단행본');
  if (s.includes('19세완전판')) v.push('19세 완전판');
  if (s.includes('15세개정판')) v.push('15세 개정판');
  if (s.includes('개정판') && !s.includes('15세개정판')) v.push('개정판');
  const noSide = raw.replace(SIDE_INCLUDED, ' ').replace(/\s+/g, '');
  if (noSide.includes('외전') || noSide.includes('번외')) v.push('외전');
  if (/(\d+|[ⅰ-ⅻⅠ-Ⅻ])부(?![가-힣])|시즌\d|season\d/i.test(s)) v.push('속편');
  return v.join(',') || undefined;
}
const isSideOnly = (h) => !!h.variant && /외전|속편/.test(h.variant);
// author name -> set of comparable keys. 산경(山景) -> {산경山景, 산경, 山景}
function authorKeys(name) {
  const s = nfkc(name).trim();
  const keys = new Set();
  const full = alnum(s);
  if (full) keys.add(full);
  const outside = alnum(s.replace(BRACKETS, ' '));
  if (outside) keys.add(outside);
  const re = /[\[(（【]([^\])）】]*)[\])）】]/g;
  let m;
  while ((m = re.exec(s))) { const k = alnum(m[1]); if (k) keys.add(k); }
  return keys;
}
function splitAuthors(str) {
  return String(str || '').split(/[,，、/&·]|\s및\s/).map((x) => x.trim()).filter(Boolean);
}
function authorMatch(kakaoAuthors, origAuthors) {
  const want = new Set();
  for (const a of origAuthors || []) for (const k of authorKeys(a)) want.add(k);
  for (const a of splitAuthors(kakaoAuthors)) for (const k of authorKeys(a)) if (want.has(k)) return true;
  return false;
}
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]; prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}
// 'exact' | 'contains' | 'fuzzy' | null      (candidate = Kakao title, wanted = Naver webtoon title)
// Containment is direction-aware:
//  - novel title LONGER than the webtoon title (subtitle / longer original title, e.g. 천마육성 -> 천마육성 시뮬레이션):
//    accepted when the webtoon title has >= 3 chars.
//  - novel title SHORTER than the webtoon title: a same-author short title inside a longer webtoon title is usually a
//    different work (Kakao has 김강현 '마신' AND '마신전설'), so it needs >= 4 chars and >= 60% of the webtoon title.
function titleMatch(candidate, wanted) {
  const A = titleForms(candidate), B = titleForms(wanted);
  let best = null;
  for (const a of A) for (const b of B) {
    if (!a || !b) continue;
    if (a === b) return 'exact';
    if (a.length > b.length) {                       // Kakao title longer: it must contain the webtoon title
      if (b.length >= 3 && a.includes(b)) { best = 'contains'; continue; }
    } else if (a.length < b.length) {                // Kakao title shorter: strict
      if (a.length >= 4 && a.length / b.length >= 0.6 && b.includes(a)) { best = 'contains'; continue; }
    }
    if (!best && Math.min(a.length, b.length) >= 8 && lev(a, b) <= 1) best = 'fuzzy'; // 1-char typo/truncation in a long title
  }
  return best;
}

// ---------- API ----------
// category_uid=11 = 웹소설 only (verified: '이윤희' with 0 returns 25 webtoons, with 11 returns 0; '로드워리어' returns the
// same 10 novels with 0 and 11), so webtoons / 책 no longer use up the 25 result slots.
const CAT_WEBNOVEL = 11;
async function rawSearchPage(keyword, page = 0) {
  const u = `${BASE}/v2/search/series?keyword=${encodeURIComponent(keyword)}&category_uid=${CAT_WEBNOVEL}&is_complete=false&sort_type=ACCURACY&page=${page}&size=25`;
  const j = await getJson(u);
  const r = (j && j.result) || {};
  return { list: r.list || [], isEnd: r.is_end !== false };
}
async function rawSearch(keyword) { return (await rawSearchPage(keyword, 0)).list; }
async function overview(seriesId) {
  const j = await getJson(`${BASE}/v1/content/overview?series_id=${seriesId}`);
  return (j && j.result && j.result.content) || null;
}

function judge(item, title, authors) {
  if (!item || item.category !== '웹소설') return { ok: false, why: 'category:' + (item && item.category) };
  if (!authorMatch(item.authors, authors)) return { ok: false, why: 'author' };
  const tm = titleMatch(item.title, title);
  if (!tm) return { ok: false, why: 'title' };
  return { ok: true, tm };
}

function toHit(item, tm) {
  const h = {
    p: 'kakao',
    title: item.title,
    author: item.authors,
    url: `https://page.kakao.com/content/${item.series_id}`,
    id: String(item.series_id),
    done: item.on_issue === 'N',
    adult: Number(item.age_grade) >= 19,
    views: item.service_property ? item.service_property.view_count : undefined,
    sub: item.sub_category,
  };
  const v = variantOf(item.title);
  if (v) h.variant = v;
  if (tm === 'fuzzy') h.fuzzy = true;
  if (tm === 'contains') h.contains = true;
  h._tm = tm;
  return h;
}
const TM_RANK = { exact: 0, contains: 1, fuzzy: 2 };

/**
 * @param {string} title   webtoon title on Naver
 * @param {string[]} authors Naver "원작" author names
 * @param {{eps?:boolean, debug?:boolean}} [opts] eps (default true): one overview call for the top hit to get episode count
 */
async function search(title, authors, opts = {}) {
  const wantEps = opts.eps !== false;
  authors = (Array.isArray(authors) ? authors : [authors]).filter(Boolean);
  const seen = new Map();   // series_id -> hit
  const rejected = [];
  const consider = (list, via) => {
    for (const it of list) {
      if (seen.has(it.series_id)) continue;
      const r = judge(it, title, authors);
      if (r.ok) { const h = toHit(it, r.tm); h.via = via; seen.set(it.series_id, h); }
      else if (opts.debug && (titleMatch(it.title, title) || authorMatch(it.authors, authors)))
        rejected.push({ id: it.series_id, title: it.title, author: it.authors, category: it.category, why: r.why });
    }
  };

  // 1) title search (tags stripped so "[독점]" etc. don't hurt)
  const kw = String(title).replace(BRACKETS, ' ').replace(/\s+/g, ' ').trim() || String(title);
  consider(await rawSearch(kw), 'title');

  // 2) fallback: author search (finds novels whose title differs a bit from the webtoon title)
  if (!seen.size) {
    const names = [];
    for (const a of authors) {
      const n = String(a).normalize('NFKC').replace(BRACKETS, ' ').replace(/\s+/g, ' ').trim();
      if (n && !names.includes(n)) names.push(n);
    }
    for (const n of names.slice(0, 2)) {
      // one extra page only when page 0 is full AND still listing this author (prolific author, list truncated)
      for (let page = 0; page < 2; page++) {
        const { list, isEnd } = await rawSearchPage(n, page);
        consider(list, 'author');
        const tail = list[list.length - 1];
        if (seen.size || isEnd || list.length < 25 || !tail || !authorMatch(tail.authors, authors)) break;
      }
      if (seen.size) break;
    }
  }

  let hits = [...seen.values()];
  // an exact title match exists -> drop looser (contains / fuzzy) ones: those are sequels, spin-offs or other works
  if (hits.some((h) => h._tm === 'exact')) hits = hits.filter((h) => h._tm === 'exact');
  // only a 외전 / 속편 series found -> the original novel itself is not here (precision over recall)
  if (hits.length && hits.every(isSideOnly)) {
    if (opts.debug) for (const h of hits) rejected.push({ id: h.id, title: h.title, author: h.author, category: '웹소설', why: 'side-story-only' });
    hits = [];
  }
  hits.sort((a, b) => TM_RANK[a._tm] - TM_RANK[b._tm] ||
    (a.variant ? 1 : 0) - (b.variant ? 1 : 0) || (b.views || 0) - (a.views || 0));
  for (const h of hits) delete h._tm;

  // 3) episode count for the main (top) hit only
  if (wantEps && hits.length) {
    try {
      const c = await overview(hits[0].id);
      if (c) {
        // a [단행본] series counts volumes (권), not episodes -> report it as vols so it is not mistaken for 화 count
        const isVolumes = /단행본/.test(hits[0].variant || '');
        if (c.on_sale_count != null) hits[0][isVolumes ? 'vols' : 'eps'] = Number(c.on_sale_count);
        if (c.on_issue) hits[0].done = c.on_issue === 'N';
      }
    } catch (e) { if (e.blocked) throw e; }
  }
  if (!opts.debug) for (const h of hits) delete h.via;
  if (opts.debug) hits.rejected = rejected;
  return hits;
}

module.exports = { search, rawSearch, rawSearchPage, overview, titleMatch, authorMatch, titleForms, authorKeys, variantOf, stats: () => ({ requestCount, blockedStreak }) };
