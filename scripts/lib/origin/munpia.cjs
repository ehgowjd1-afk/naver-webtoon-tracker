// 문피아(munpia) 원작 웹소설 검색 모듈
// 엔드포인트: https://www.munpia.com/api/v1/main/search (로그인·쿠키 불필요, JSON)
//   params: query, tab=AUTHOR|NOVEL|ALL|TAG, sort=SIMILARITY, novelType=ALL, finishedOnly=false,
//           adultMode=false, page=0(0부터 시작!), size(<=50 확인)
// 결과: result.searchNovelTabDtos[] = {novelId,title,author,itemType,groupCode,groupName,entryCount,finished,adult,ebook,...}
// 순서: 작가 탭 검색(작가명 정확 일치 → 제목 비교) → 작가가 안 보이면 작품 탭 제목 검색으로 한 번 더.
// 채택 규칙: 소설(itemType NOVEL, 만화 제외) + 작가 정규화 일치 + 제목 같은 작품(같음/포함/길이 6+에서 조사·어미 1글자 차이).
// [검증 수정 2026-10-20] 1글자 차이는 조사·어미만, 웹툰 제목이 더 길면 소설 제목이 60% 이상 덮을 때만, 외전 단독 항목 제외, 작가 결과 50개 꽉 차면 다음 쪽(최대 2쪽).
'use strict';

const API = 'https://www.munpia.com/api/v1/main/search';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const GAP_MS = 1600;

let lastTs = 0;
let reqCount = 0;
let badStreak = 0;
const authorCache = new Map(); // 같은 작가 반복 조회 방지

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(params) {
  const wait = lastTs + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastTs = Date.now();
  reqCount++;
  const url = API + '?' + new URLSearchParams(params).toString();
  const r = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'ko-KR,ko;q=0.9',
      Referer: 'https://www.munpia.com/search',
    },
  });
  if (r.status === 403 || r.status === 429) {
    badStreak++;
    const e = new Error('munpia HTTP ' + r.status);
    e.status = r.status;
    e.blocked = badStreak >= 2;
    throw e;
  }
  badStreak = 0;
  if (!r.ok) throw new Error('munpia HTTP ' + r.status);
  const j = await r.json();
  if (!j || !j.result) throw new Error('munpia bad response ' + (j && j.code));
  return j.result;
}

async function searchApi(query, tab, size, page = 0) {
  const res = await getJson({
    query,
    tab,
    sort: 'SIMILARITY',
    novelType: 'ALL',
    finishedOnly: 'false',
    adultMode: 'false',
    page: String(page),
    size: String(size),
  });
  return res.searchNovelTabDtos || [];
}

// ---------- 정규화 ----------
const stripPunct = (s) => s.toLowerCase().replace(/[^0-9a-zㄱ-ㆎ가-힣一-鿿぀-ヿ]/g, '');

function authorKeys(a) {
  const s = String(a || '').normalize('NFC').trim();
  const keys = new Set();
  const noBr = s.replace(/[\(\[（【][^\)\]）】]*[\)\]）】]/g, ' ');
  keys.add(stripPunct(noBr));
  keys.add(stripPunct(s));
  const inner = s.match(/[\(\[（【]([^\)\]）】]*)[\)\]）】]/g) || [];
  for (const m of inner) keys.add(stripPunct(m.slice(1, -1)));
  keys.delete('');
  return keys;
}

function authorMatch(itemAuthor, origAuthors) {
  // 문피아 작가란이 "A, B" 처럼 여럿일 수 있음
  const parts = String(itemAuthor || '').split(/[,\/&·]| 외 /).map((x) => x.trim()).filter(Boolean);
  const want = new Set();
  for (const a of origAuthors) for (const k of authorKeys(a)) want.add(k);
  for (const p of parts.length ? parts : [itemAuthor]) {
    for (const k of authorKeys(p)) if (want.has(k)) return true;
  }
  return false;
}

const TRAIL_TAG = /(특별외전|외전|연재중|연재|완결|개정판|리마스터|리메이크|단행본|전자책|이북|합본|세트|19세판|15세판|독점|선공개)+$/;

function normTitle(t) {
  let s = String(t || '').normalize('NFC');
  s = s.replace(/\[[^\]]*\]/g, ' ').replace(/【[^】]*】/g, ' ').replace(/[\(（][^\)）]*[\)）]/g, ' ');
  s = stripPunct(s);
  const t2 = s.replace(TRAIL_TAG, '');
  if (t2.length >= 2) s = t2;
  return s;
}

function lev1(a, b) {
  // 편집거리 <= 1 여부
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
  }
  return diff + (la - i) + (lb - j) <= 1;
}

// [검증 수정] 1글자 차이는 조사·어미 차이(했더/했다, 의/에 등)만 허용.
// "아포칼립스에 집을 숨김" vs "아포칼립스에 쌀을 숨김"처럼 명사 한 글자만 바뀐 패러디·다른 작품을 막는다.
const SOFT_CH = new Set('의에이가은는을를도와과로다더요죠한된히게고'.split(''));
function softDiff(a, b) {
  // a, b 편집거리 1일 때, 달라진 글자가 조사·어미류인지
  if (a.length === b.length) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return SOFT_CH.has(a[i]) && SOFT_CH.has(b[i]);
    return true;
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0; i < l.length; i++) if (s[i] !== l[i]) return SOFT_CH.has(l[i]);
  return SOFT_CH.has(l[l.length - 1]);
}

function titleMatch(itemTitle, wantTitle) {
  const a = normTitle(itemTitle), b = normTitle(wantTitle);
  if (!a || !b) return null;
  if (a === b) return 'exact';
  // 소설 제목이 더 긴 경우(부제·긴 원제)는 그대로 포함 허용.
  if (b.length >= 3 && a.includes(b)) return 'contains';
  // [검증 수정] 웹툰 제목이 더 긴 경우(소설 제목이 웹툰 제목의 일부)는 대부분을 덮을 때만.
  // 예: 같은 작가의 "천하제일"이 웹툰 "천하제일 대사형"에 붙는 것을 막음.
  if (a.length >= 3 && b.includes(a) && a.length >= 0.6 * b.length) return 'contains';
  // 부제 앞부분 비교 (예: "비따비 : Vis ta Vie")
  const mainA = normTitle(String(itemTitle).split(/\s[:\-~]\s|:\s|\s-\s/)[0]);
  if (mainA && mainA.length >= 3 && mainA === b) return 'contains';
  if (Math.min(a.length, b.length) >= 6 && lev1(a, b) && softDiff(a, b)) return 'edit1';
  return null;
}

// [검증 수정] 외전·스핀오프 판별: 원래 제목에 '외전'이 있는데 웹툰 제목엔 없으면 본편이 아님.
const isSide = (itemTitle, wantTitle) => /외전|스핀오프|IF\s*스토리/i.test(String(itemTitle)) && !/외전|스핀오프/.test(String(wantTitle));

function isNovel(x) {
  if (!x) return false;
  if (x.itemType && x.itemType !== 'NOVEL') return false;
  if (/comic|cm\./i.test(x.groupCode || '')) return false;
  if (/만화|웹툰|코믹/.test(x.groupName || '')) return false;
  return true;
}

function toHit(x, m) {
  return {
    p: 'munpia',
    title: x.title,
    author: x.author,
    url: 'https://novel.munpia.com/' + x.novelId,
    id: x.novelId,
    eps: typeof x.entryCount === 'number' ? x.entryCount : undefined,
    done: !!x.finished,
    adult: !!x.adult,
    ebook: !!(x.ebook || /epub/.test(x.groupCode || '')),
    group: x.groupName || x.groupCode || '',
    m,
  };
}

function pick(items, title, authors) {
  const out = [];
  for (const x of items) {
    if (!isNovel(x)) continue;
    if (!authorMatch(x.author, authors)) continue;
    const m = titleMatch(x.title, title);
    if (!m) continue;
    if (isSide(x.title, title)) continue; // 외전만 따로 올라온 항목은 원작 본편으로 치지 않음
    out.push(toHit(x, m));
  }
  return out;
}

function finalize(hits) {
  const seen = new Set();
  const uniq = hits.filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)));
  // 연재본이 있으면 [D] 다운로드 이북 사본은 뺌
  const serial = uniq.filter((h) => !h.ebook);
  const list = serial.length ? serial : uniq;
  const rank = { exact: 0, contains: 1, edit1: 2 };
  list.sort((a, b) => rank[a.m] - rank[b.m] || (b.eps || 0) - (a.eps || 0));
  return list;
}

function cleanQuery(t) {
  return String(t || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function search(title, authors) {
  authors = (Array.isArray(authors) ? authors : [authors]).filter(Boolean);
  if (!title || !authors.length) return [];
  let hits = [];
  let authorSeen = false;
  for (const a of authors) {
    const q = String(a).replace(/[\(（][^\)）]*[\)）]/g, ' ').trim() || String(a).trim();
    let items = authorCache.get(q);
    if (!items) {
      items = await searchApi(q, 'AUTHOR', 50);
      // [검증 수정] 작가 일치 항목이 앞에서부터 50개를 꽉 채우면(작품·이북 사본이 많은 작가) 다음 쪽도 본다. 최대 2쪽 더.
      for (let pg = 1; pg <= 2 && items.length === 50 * pg && authorMatch(items[items.length - 1].author, [a]); pg++) {
        items = items.concat(await searchApi(q, 'AUTHOR', 50, pg));
      }
      authorCache.set(q, items);
    }
    if (items.some((x) => authorMatch(x.author, [a]))) authorSeen = true;
    hits = hits.concat(pick(items, title, authors));
  }
  if (!hits.length && !authorSeen) {
    // 작가 검색에서 해당 작가가 안 잡힐 때만 제목으로 한 번 더
    const items = await searchApi(cleanQuery(title), 'NOVEL', 30);
    hits = pick(items, title, authors);
  }
  return finalize(hits);
}

module.exports = { search, _stats: () => ({ reqCount }), _internals: { normTitle, authorKeys, authorMatch, titleMatch, isSide, softDiff, isNovel } };
