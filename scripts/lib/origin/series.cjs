'use strict';
// 네이버 시리즈 웹소설 원작 검색 (key "series")
// search(title, authors) -> accepted hits only:
//   [{p:'series', title, author, url, id, eps?, vols?, done?, adult?}]
// Endpoint: https://series.naver.com/search/search.series?t=novel&q=<q>  (server-rendered HTML, no login)
// Strategy: 1) search by webtoon title; 2) if nothing accepted, search by each original-author name
//           (catches short/common titles buried past page 1). Matching is done here (precision first).

const BASE = 'https://series.naver.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const MIN_GAP_MS = 1600; // >= 1.5 s between requests

let lastAt = 0;           // module-level timestamp of the last request
let chain = Promise.resolve();
let requestCount = 0;
let blockedCount = 0;     // consecutive 403/429

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function throttled(fn) {
  const run = chain.then(async () => {
    const wait = lastAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try { return await fn(); } finally { lastAt = Date.now(); }
  });
  chain = run.catch(() => {});
  return run;
}

async function getHtml(url) {
  return throttled(async () => {
    requestCount++;
    const r = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.5',
        'Referer': BASE + '/novel/home.series',
      },
      redirect: 'follow',
    });
    if (r.status === 403 || r.status === 429) {
      blockedCount++;
      const e = new Error('series blocked HTTP ' + r.status);
      e.status = r.status; e.blocked = true; e.consecutive = blockedCount;
      throw e;
    }
    if (!r.ok) { const e = new Error('series HTTP ' + r.status); e.status = r.status; throw e; }
    blockedCount = 0;
    return r.text();
  });
}

// ---------- text helpers ----------
function decode(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

// strip everything but letters/digits (any script), lowercase
const squash = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

// Title tags that do not change the identity of the work
const TAG_WORDS = /(외전증보판|증보판|개정판|합본|무삭제판|무삭제|단행본|외전|특별외전|연재|완결|독점|선공개|리마스터|ebook|e북|[0-9]+부|시즌[0-9]+)/g;

function normTitle(s) {
  let t = String(s || '').normalize('NFKC');
  t = t.replace(/\(\s*총[^)]*\)/g, ' ');            // (총 944화/미완결)
  t = t.replace(/[(（][^)）]*[)）]/g, ' ');           // (喇勞 魔神) hanja / alt-title glosses
  t = t.replace(/[\[【〔<〈《][^\]】〕>〉》]*[\]】〕>〉》]/g, ' '); // [독점] [단행본] 《..》
  t = t.replace(/\s[:\-~]\s.*$/, (m) => (new RegExp(TAG_WORDS.source).test(m) ? " " : m)); // " : 외전" style suffix
  t = squash(t).replace(TAG_WORDS, '');
  return t;
}

// Variants of an author string: "산경(山景)" -> ["산경山景","산경","山景"]
function authorVariants(a) {
  const s = String(a || '').normalize('NFKC');
  const out = new Set();
  const whole = squash(s);
  if (whole) out.add(whole);
  const outside = squash(s.replace(/[(\[（][^)\]）]*[)\]）]/g, ' '));
  if (outside) out.add(outside);
  for (const m of s.matchAll(/[(\[（]([^)\]）]*)[)\]）]/g)) { const v = squash(m[1]); if (v) out.add(v); }
  return [...out];
}

// Candidate author field may list several people: "A, B" / "A/B" / "글 A · 그림 B"
// [verifier fix] the role label is stripped only when a separator follows it ("글 A", "글: A");
// the old pattern also ate the first syllable of pen-names like 글맛 / 글쓰는기계 / 글망쟁이 / 저스틴.
function splitAuthors(s) {
  return String(s || '')
    .split(/[,，/·&|]|\s외\s|\s외$/)
    .map((x) => x.replace(/^\s*(글|그림|저|작가|원작|역|지음)(?:\s*[:：]\s*|\s+)(?=\S)/, '').trim())
    .filter(Boolean);
}

function authorMatches(candidateField, origAuthors) {
  const want = new Set();
  for (const a of origAuthors || []) {
    for (const v of authorVariants(a)) want.add(v);                              // whole string
    for (const p of splitAuthors(a)) for (const v of authorVariants(p)) want.add(v); // [verifier fix] "단구름·불랄리" -> each name
  }
  if (!want.size) return null;
  const field = String(candidateField || '').trim();
  for (const v of authorVariants(field)) if (want.has(v)) return field;         // whole field equal
  for (const c of splitAuthors(field)) {
    for (const v of authorVariants(c)) if (want.has(v)) return c;
  }
  return null;
}

// 2 = normalised equal, 1 = containment (with a length guard), 0 = no
function titleMatchLevel(candTitle, wantTitle) {
  const a = normTitle(candTitle), b = normTitle(wantTitle);
  if (!a || !b) return 0;
  if (a === b) return 2;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  // guard: very short strings (e.g. 2 chars) contained in a long title are too ambiguous
  if (short.length >= 3 && long.includes(short) && short.length / long.length >= 0.4) return 1;
  return 0;
}

// ---------- parsing ----------
function parseResults(html) {
  const out = [];
  const start = html.indexOf('class="lst_list"');
  if (start < 0) return out;
  const body = html.slice(start);
  const blocks = body.split(/<li>\s*<a href="\/novel\/detail\.series/).slice(1);
  for (const raw of blocks) {
    const b = '<a href="/novel/detail.series' + raw;
    const tm = b.match(/<a href="(\/novel\/detail\.series\?productNo=(\d+))"\s+class="N=a:nov\.title">([\s\S]*?)<\/a>/);
    if (!tm) continue;
    const full = decode(tm[3]);
    const cm = full.match(/\(\s*총\s*([\d,]+)\s*(화|권)\s*\/\s*(미완결|완결)\s*\)\s*$/);
    const title = decode(full.replace(/\(\s*총[^)]*\)\s*$/, ''));
    const am = b.match(/<span class="author">([\s\S]*?)<\/span>/);
    const author = am ? decode(am[1]) : '';
    const h3 = (b.match(/<h3>([\s\S]*?)<\/h3>/) || [, ''])[1];
    const adult = /class="ico n19"/.test(h3) || /19over_book/.test(b.slice(0, 600));
    const rec = { id: tm[2], path: tm[1], title, author, adult };
    if (cm) {
      const n = parseInt(cm[1].replace(/,/g, ''), 10);
      if (cm[2] === '화') rec.eps = n; else rec.vols = n;
      rec.done = cm[3] === '완결';
    }
    out.push(rec);
  }
  return out;
}

function searchUrl(q) {
  return BASE + '/search/search.series?t=novel&q=' + encodeURIComponent(q);
}

// optional diagnostics: set module.exports.debug = [] to collect {q, n, results}
async function fetchParsed(q) {
  const results = parseResults(await getHtml(searchUrl(q)));
  if (Array.isArray(module.exports.debug)) module.exports.debug.push({ q, n: results.length, results: results.map((r) => ({ id: r.id, title: r.title, author: r.author })) });
  return results;
}

function accept(results, title, authors) {
  const hits = [];
  for (const r of results) {
    if (!/^\/novel\/detail\.series\?productNo=\d+$/.test(r.path)) continue; // novel only
    const lvl = titleMatchLevel(r.title, title);
    if (!lvl) continue;
    const who = authorMatches(r.author, authors);
    if (!who) continue;
    const h = { p: 'series', title: r.title, author: r.author, url: BASE + r.path, id: r.id };
    if (r.eps != null) h.eps = r.eps;
    if (r.vols != null) h.vols = r.vols;
    if (r.done != null) h.done = r.done;
    h.adult = !!r.adult;
    h._lvl = lvl;
    h._book = /단행본/.test(r.title) || r.vols != null;
    // [verifier fix] standalone side-story product ("화산귀환 특별 외전", "X : 외전") – same IP, kept,
    // but never allowed to sort ahead of the main edition. "[외전포함]" / "[외전증보판]" are main editions.
    h._side = /외전/.test(r.title.replace(/[\[【〔<〈《][^\]】〕>〉》]*[\]】〕>〉》]/g, ' ').replace(/외전\s*(포함|증보)/g, ''));
    hits.push(h);
  }
  return hits;
}

async function search(title, authors) {
  authors = (authors || []).filter(Boolean);
  if (!title || !authors.length) return [];
  const seen = new Map();
  const add = (arr) => { for (const h of arr) if (!seen.has(h.id)) seen.set(h.id, h); };

  // 1) title query
  add(accept(await fetchParsed(title), title, authors));

  // 2) fallback: author-name queries (only if nothing accepted yet)
  if (!seen.size) {
    const tried = new Set();
    for (const a of authors) {
      const q = String(a).replace(/[(\[（][^)\]）]*[)\]）]/g, '').trim() || String(a).trim();
      if (!q || tried.has(q)) continue;
      tried.add(q);
      add(accept(await fetchParsed(q), title, authors));
      if (seen.size) break;
    }
  }

  let hits = [...seen.values()];
  // precision: when a normalised-equal title exists, drop containment-only hits
  // (e.g. same-author spin-off "<title> - 퓨어 블러드")
  if (hits.some((h) => h._lvl === 2)) hits = hits.filter((h) => h._lvl === 2);
  return hits
    .sort((x, y) => (y._lvl - x._lvl) || (x._side - y._side) || (x._book - y._book))
    .map(({ _lvl, _book, _side, ...h }) => h);
}

module.exports = {
  search,
  // exposed for testing / diagnostics
  _internal: { parseResults, normTitle, authorVariants, authorMatches, titleMatchLevel, searchUrl,
    stats: () => ({ requestCount, blockedCount }) },
};
