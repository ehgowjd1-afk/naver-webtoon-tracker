'use strict';
// RIDI original-novel finder for Naver webtoons adapted from web novels.
//
// search(title, authors) -> [{p:'ridi', title, author, url, id, eps?, vols?, done, adult, kind, match}]
//   eps = episodes (웹소설 only), vols = volumes (novel e-book only)
// Only accepted hits are returned:
//   (1) the book is a novel (web novel serial or novel e-book), not a webtoon / comic
//   (2) one of its author names equals one of `authors` after normalisation
//   (3) normalised titles are equal, or one contains the other as a whole phrase
//       (shorter side >= 4 chars); 'contains' hits are dropped when an exact hit exists
//   (4) it is not a separately listed side story / sequel (X 외전, X 2부, X 리턴즈 ...)
//
// Endpoint: https://search-api.ridibooks.com/search?keyword=KW&where=book&what=base&site=ridi-store
// (public JSON used by the Ridi site search; no login, no cookies).
//
// Transport: Cloudflare in front of Ridi rejects plain Node fetch (undici) with a
// 403 "Just a moment" JS challenge (TLS fingerprint based). The module tries
// fetch first, then the system curl (works from a Windows PC: Schannel curl),
// then python3 urllib (non-Windows only; what passes on GitHub Actions runners).
// The first transport that returns a non-challenge answer is remembered.
// Force one with RIDI_TRANSPORT=fetch|curl|python.

const { execFile, spawn } = require('child_process');

const P = 'ridi';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const HEADERS = {
  'User-Agent': UA,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
  'Referer': 'https://ridibooks.com/',
};
const GAP_MS = 1600;            // >= 1.5 s between requests (module-level)
let lastAt = 0;
let transport = process.env.RIDI_TRANSPORT || null; // chosen transport, cached
let blockedStreak = 0;           // consecutive 403/429 answers on every transport
let requestCount = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function throttle() {
  const wait = lastAt + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastAt = Date.now();
  requestCount++;
}

// ---------- transports: each returns {status, body} ----------
async function viaFetch(url) {
  const r = await fetch(url, { headers: HEADERS, redirect: 'follow' });
  return { status: r.status, body: await r.text() };
}

function viaCurl(url) {
  const args = ['-s', '-S', '-L', '--max-time', '30', '-w', '\n__STATUS__%{http_code}'];
  for (const [k, v] of Object.entries(HEADERS)) {
    if (k === 'User-Agent') args.push('-A', v); else args.push('-H', `${k}: ${v}`);
  }
  args.push(url);
  return new Promise((resolve, reject) => {
    execFile('curl', args, { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err && !stdout?.length) return reject(new Error('curl failed: ' + (stderr?.toString() || err.message)));
      const text = stdout.toString('utf8');
      const i = text.lastIndexOf('\n__STATUS__');
      if (i < 0) return reject(new Error('curl: no status marker'));
      resolve({ status: Number(text.slice(i + 11).trim()) || 0, body: text.slice(0, i) });
    });
  });
}

const PY = `
import sys, json, urllib.request, urllib.error
q = json.loads(sys.stdin.read())
req = urllib.request.Request(q['url'], headers=q['headers'])
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        st, body = r.status, r.read()
except urllib.error.HTTPError as e:
    st, body = e.code, e.read()
sys.stdout.write(json.dumps({'status': st, 'body': body.decode('utf-8', 'replace')}))
`;
function viaPython(url) {
  if (process.platform === 'win32' && !process.env.RIDI_TRANSPORT) {
    // the WindowsApps python stub can pop the Store; only use python when forced on Windows
    return Promise.reject(new Error('python transport skipped on win32'));
  }
  return new Promise((resolve, reject) => {
    const cp = spawn(process.env.PYTHON || 'python3', ['-I', '-c', PY], { windowsHide: true });
    let out = '', err = '';
    cp.stdout.on('data', (d) => (out += d));
    cp.stderr.on('data', (d) => (err += d));
    cp.on('error', reject);
    cp.on('close', (code) => {
      try { resolve(JSON.parse(out)); } catch { reject(new Error('python failed ' + code + ' ' + err.slice(0, 200))); }
    });
    cp.stdin.end(JSON.stringify({ url, headers: HEADERS }));
  });
}

const TRANSPORTS = { fetch: viaFetch, curl: viaCurl, python: viaPython };
const ORDER = ['fetch', 'curl', 'python'];
const isChallenge = (r) => (r.status === 403 || r.status === 503) && /just a moment|cf-chl|challenge-platform/i.test(r.body || '');

async function getJson(url) {
  const order = transport ? [transport] : ORDER;
  let last = null;
  for (const name of order) {
    await throttle();
    let r;
    try { r = await TRANSPORTS[name](url); } catch (e) { last = { status: 0, body: String(e.message || e) }; continue; }
    last = r;
    if (isChallenge(r)) continue;           // try the next transport
    if (r.status === 429 || r.status === 403) { if (transport) break; else continue; } // untried transport: try the next one
    if (!transport) transport = name;         // remember what works
    if (r.status !== 200) throw new Error(`ridi HTTP ${r.status} (${name})`);
    blockedStreak = 0;
    return JSON.parse(r.body);
  }
  if (last && (last.status === 403 || last.status === 429)) {
    blockedStreak++;
    const e = new Error(`ridi blocked HTTP ${last.status}` + (blockedStreak >= 2 ? ' (repeated - stop)' : ''));
    e.blocked = true; e.repeated = blockedStreak >= 2;
    throw e;
  }
  throw new Error('ridi request failed: ' + (last ? `${last.status} ${String(last.body).slice(0, 120)}` : 'no transport'));
}

// ---------- normalisation & matching ----------
const nfkc = (s) => String(s || '').normalize('NFKC').toLowerCase();
const squash = (s) => s.replace(/[^\p{L}\p{N}]+/gu, '');

const spaced = (s) => s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// title variants: tags in [] / 【】 / 〈〉 / () removed, plus status words removed.
// Status words are removed only when they stand as their own word ("독점 연재", "개정판 | X"),
// so a title word that merely starts with one (독점욕, 세트장...) is kept intact.
const BRACKETS = /\[[^\]]*\]|【[^】]*】|〈[^〉]*〉|<[^>]*>|\([^)]*\)/g;
const TAG_WORDS = /(^|[^\p{L}\p{N}])(외전\s*포함|외전|특별외전|개정증보판|개정판|완전판|합본|세트|단행본|무삭제판?|19세\s*(?:판|완전판)?|15세\s*(?:판|개정판|이용가)?|연재|완결|독점|선독점|e북|체험판|프롤로그)(?=$|[^\p{L}\p{N}])/gu;
// "X : 부제" / "X - 부제" -> X is also a variant (separator must touch a space)
const SUBTITLE_SPLIT = /\s[:\-–—~]|[:–—~]\s/;
function variantsFull(t) {
  const s = nfkc(t);
  const noBr = s.replace(BRACKETS, ' ');
  const bases = [s, noBr];
  const head = noBr.split(SUBTITLE_SPLIT)[0];
  if (head !== noBr && squash(head).length >= 2) bases.push(head);
  const out = new Map();
  for (const v of bases) {
    for (const x of [v, v.replace(TAG_WORDS, '$1 ')]) {
      const sq = squash(x);
      if (sq && !out.has(sq)) out.set(sq, { sq, sp: spaced(x) });
    }
  }
  return [...out.values()];
}
const titleVariants = (t) => variantsFull(t).map((v) => v.sq);

// `short` (squashed) must occur in `longSpaced` as a whole phrase: 마신 is not in 마신전설,
// 펭귄철도 분실물센터 is in 펭귄철도 분실물센터 리턴즈 (the latter is then caught by isSideStory).
const esc = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function phraseIn(short, longSpaced) {
  const re = new RegExp('(?:^|\\s)' + [...short].map(esc).join('\\s?') + '(?:\\s|$)', 'u');
  return re.test(longSpaced);
}

const MIN_CONTAINS = 4;   // shorter side of a 'contains' match, in characters (3-letter titles need 'exact')
function titleMatch(naverTitle, ridiTitle) {
  const A = variantsFull(naverTitle), B = variantsFull(ridiTitle);
  for (const a of A) for (const b of B) {
    if (a.sq === b.sq) return 'exact';
  }
  for (const a of A) for (const b of B) {
    const ridiShorter = b.sq.length < a.sq.length;
    const [sh, lo] = ridiShorter ? [b, a] : [a, b];
    if ([...sh.sq].length < MIN_CONTAINS || !lo.sq.includes(sh.sq)) continue;
    // when the RIDI title is the shorter one it must still be a substantial part of the webtoon title
    if (ridiShorter && b.sq.length < a.sq.length * 0.5) continue;
    if (!phraseIn(sh.sq, lo.sp)) continue;
    return 'contains';
  }
  return null;
}

// Side stories / sequels listed as their own book: "X 외전", "X 2부", "X 시즌2", "X 리턴즈", "X 2".
// They are not the original work, so they are never returned (unless both titles carry such a marker).
const SIDE_OK = /외전\s*(포함|추가|수록|합본)/gu;
const SIDE_RE = /외전|후일담|번외|(^|[^\p{L}\p{N}])(\d+|i{1,3}|iv)\s*부($|[^\p{L}\p{N}])|시즌\s*\d|season\s*\d|리턴즈|(^|\s)(2|3|4|5|ii|iii|iv)$/u;
// Companion books in novel categories (내가 키운 S급들 팬아트북 is filed under 판타지 e북)
const COMPANION_RE = /팬\s*아트북|아트북|일러스트\s*(북|집)|설정집|화보집|캐릭터\s*북|가이드\s*북|오디오\s*북|드라마\s*cd/u;
function isSideStory(naverTitle, ridiTitle) {
  const r = spaced(nfkc(ridiTitle).replace(SIDE_OK, ' '));
  const n = spaced(nfkc(naverTitle));
  if (COMPANION_RE.test(r) && !COMPANION_RE.test(n)) return true;
  // a sequel / side marker on only one side (X vs X 리턴즈, X 외전 vs X) means a different book
  return SIDE_RE.test(r) !== SIDE_RE.test(n);
}

// author variants: "산경(山景)" -> 산경山景, 산경, 山景
function authorVariants(name) {
  const s = nfkc(name).trim();
  const out = new Set();
  const full = squash(s);
  if (full) out.add(full);
  const outside = squash(s.replace(/\([^)]*\)|\[[^\]]*\]/g, ''));
  if (outside) out.add(outside);
  for (const m of s.matchAll(/\(([^)]*)\)|\[([^\]]*)\]/g)) {
    const inner = squash(m[1] || m[2] || '');
    if (inner) out.add(inner);
  }
  return [...out];
}

const NON_WRITER_ROLES = new Set(['illustrator', 'translator', 'comic_author', 'publisher', 'planner', 'editor']);
function bookAuthors(b) {
  const names = [];
  for (const a of b.authors_info || []) if (!NON_WRITER_ROLES.has(a.role)) names.push(a.name, a.alias_name, a.native_name);
  if (!names.length) names.push(...String(b.author || '').split(/[,·]/));
  return names.filter(Boolean).map((x) => String(x).trim()).filter(Boolean);
}

function authorMatch(naverAuthors, b) {
  const want = new Set((naverAuthors || []).flatMap(authorVariants));
  for (const n of bookAuthors(b)) for (const v of authorVariants(n)) if (want.has(v)) return n;
  return null;
}

const COMIC_RE = /만화|웹툰|코믹|comic|화보|그림/i;
function novelKind(b) {
  const pn = String(b.parent_category_name || '');
  const cn = String(b.category_name || '');
  if (COMIC_RE.test(pn) || COMIC_RE.test(cn)) return null;
  if ((b.authors_info || []).some((a) => a.role === 'comic_author')) return null;
  // RIDI parent categories seen: 판타지/로맨스/로판/BL 웹소설, 판타지/로맨스/로판 e북, BL 소설 e북, 소설, 라이트노벨
  // (comics are 웹툰 / 만화 e북 / 만화 연재 / BL 만화 e북 / BL 웹툰 and are rejected above)
  const novelCat = /웹소설/.test(pn) ? '웹소설'
    : (/소설|라이트노벨/.test(pn) || /^(판타지|로맨스|로판|bl)\s*e북$/i.test(pn)) ? 'e북'
    : null;
  if (!novelCat) return null;
  return b.is_serial ? '웹소설' : novelCat;
}

function acceptBooks(books, title, authors) {
  const hits = [];
  for (const b of books || []) {
    const kind = novelKind(b);
    if (!kind) continue;
    const au = authorMatch(authors, b);
    if (!au) continue;
    const tm = titleMatch(title, b.title);
    if (!tm) continue;
    if (isSideStory(title, b.title)) continue;   // "X 외전" / "X 2부" etc. is not the original work
    const n = Number(b.book_count) || undefined;
    hits.push({
      p: P,
      title: b.title,
      author: b.author || au,
      url: `https://ridibooks.com/books/${b.b_id}`,
      id: String(b.b_id),
      eps: kind === '웹소설' ? n : undefined,   // episodes (웹소설 only)
      vols: kind === 'e북' ? n : undefined,     // volumes of a novel e-book series
      done: !!b.is_series_complete,
      adult: Number(b.age_limit) >= 19,
      kind,                                    // '웹소설' (serial) | 'e북'
      match: tm,                               // 'exact' | 'contains'
      cat: b.parent_category_name || undefined,
    });
  }
  return hits;
}

const SEARCH = (kw) => 'https://search-api.ridibooks.com/search?keyword=' + encodeURIComponent(kw) + '&where=book&what=base&site=ridi-store&size=100'; // default page is 24; size=100 verified

async function query(kw) {
  const j = await getJson(SEARCH(kw));
  const books = Array.isArray(j.books) ? j.books : [];
  if (typeof module.exports.onResponse === 'function') { try { module.exports.onResponse(kw, books, j.total); } catch {} }
  return books;
}

// Title search first; if nothing is accepted, search by the (first usable) original author name.
async function search(title, authors) {
  authors = (authors || []).filter(Boolean);
  if (!title || !authors.length) return [];
  const seen = new Map();
  const add = (arr) => { for (const h of arr) if (!seen.has(h.id)) seen.set(h.id, h); };

  add(acceptBooks(await query(String(title).trim()), title, authors));

  if (!seen.size) {
    for (const a of authors.slice(0, 2)) {
      const kw = authorVariants(a).length ? nfkc(a).replace(/\([^)]*\)/g, '').trim() || a : a;
      add(acceptBooks(await query(kw), title, authors));
      if (seen.size) break;
    }
  }
  let hits = [...seen.values()];
  // When the same work is found with an exact title, 'contains' hits are other works / sequels
  // by the same author (마신 vs 마신전설) -> keep only the exact ones.
  if (hits.some((h) => h.match === 'exact')) hits = hits.filter((h) => h.match === 'exact');
  const rank = (h) => (h.match === 'exact' ? 0 : 2) + (h.kind === '웹소설' ? 0 : 1);
  return hits.sort((x, y) => rank(x) - rank(y));
}

module.exports = {
  search,
  // exposed for testing / diagnostics
  _internals: { titleMatch, authorMatch, authorVariants, titleVariants, novelKind, acceptBooks, isSideStory },
  stats: () => ({ requests: requestCount, transport }),
};
