/* USB로 연결한 안드로이드 폰의 네이버웹툰 앱 화면을 ADB로 읽는 공통 도구 (collect_app_phone.js·collect_app_weekday.js).
 * 화면 글자는 uiautomator dump(접근성 정보)로 읽음 — 앱 서버를 직접 부르지 않음.
 * Git Bash에서 /sdcard 경로가 망가지지 않게 MSYS_NO_PATHCONV=1.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");

const ADB = process.env.ADB || (fs.existsSync("C:/Users/Desktop/platform-tools/adb.exe") ? "C:/Users/Desktop/platform-tools/adb.exe" : "adb");
const PKG = "com.nhn.android.webtoon";
const norm = (s) => String(s || "").replace(/[\s\u200b·・:,.!?'"‘’“”~\-]/g, "").toLowerCase();

const adb = (...a) => execFileSync(ADB, a, { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" }, maxBuffer: 64 * 1024 * 1024, timeout: 90000 });
const wait = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const zw = (s) => String(s || "").replace(/\u200b/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#10;/g, " ");
const log = (...a) => console.log(new Date(Date.now() + 9 * 3600e3).toISOString().slice(11, 19), ...a);

function nodesOf(xml) {
  return [...xml.matchAll(/<node [^>]*>/g)].map((m) => {
    const n = m[0], b = (n.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/) || []).slice(1).map(Number);
    return { cls: ((n.match(/class="([^"]*)"/) || [])[1] || "").split(".").pop(), d: zw((n.match(/content-desc="([^"]*)"/) || [])[1]), t: zw((n.match(/ text="([^"]*)"/) || [])[1]), b };
  });
}
function dump() {
  for (let i = 0; i < 4; i++) {
    try { adb("shell", "uiautomator", "dump", "/sdcard/wt_ui.xml"); const x = adb("exec-out", "cat", "/sdcard/wt_ui.xml"); if (x.includes("<hierarchy")) return nodesOf(x); } catch (e) {}
    wait(800);
  }
  throw new Error("화면 읽기(uiautomator dump) 실패");
}
const focus = () => ((adb("shell", "dumpsys", "window").match(/mCurrentFocus=Window\{[^}]*\}/) || [""])[0]);
function waitFocus(re, ms = 10000) { const t = Date.now(); while (Date.now() - t < ms) { if (re.test(focus())) return true; wait(500); } return false; }
const tap = (b) => adb("shell", "input", "tap", String(Math.round((b[0] + b[2]) / 2)), String(Math.round((b[1] + b[3]) / 2)));
const swipe = (x1, y1, x2, y2, ms) => adb("shell", "input", "swipe", String(x1), String(y1), String(x2), String(y2), String(ms));
const back = () => adb("shell", "input", "keyevent", "4");
function toTop(n = 12) { for (let i = 0; i < n; i++) swipe(540, 500, 540, 2000, 100); wait(1200); }
function dismissPopups(nodes) {   // 앱 안내 팝업("닫기")이 떠 있으면 닫음
  const c = nodes.find((n) => /^닫기/.test(n.t || n.d) && n.b.length);
  if (c) { tap(c.b); wait(1200); return true; }
  return false;
}
function ensureReady() {
  if (!/\tdevice\b/.test(adb("devices"))) throw new Error("폰이 연결돼 있지 않음(USB 디버깅 확인)");
  if (!/mWakefulness=Awake/.test(adb("shell", "dumpsys", "power"))) { adb("shell", "input", "keyevent", "KEYCODE_WAKEUP"); wait(1500); }
  const locked = () => /isKeyguardShowing=true|mDreamingLockscreen=true/.test(adb("shell", "dumpsys", "window"));
  if (locked()) { swipe(540, 1800, 540, 500, 300); wait(1500); }
  if (locked()) throw new Error("폰 화면이 잠겨 있음 — 잠금(PIN 등)을 풀어 두면 다음부터 수집");
  if (!adb("shell", "pm", "list", "packages", PKG).includes(PKG)) throw new Error("네이버웹툰 앱이 설치돼 있지 않음");
}
function finish() { try { adb("shell", "input", "keyevent", "KEYCODE_HOME"); adb("shell", "rm", "-f", "/sdcard/wt_ui.xml"); } catch (e) {} }

// 트래커 목록(lookup)에 없는 작품(완결·장기 휴재 등) → 네이버웹툰 공개 검색으로 titleId·썸네일(이름 완전 일치만)
async function searchTitle(name) {
  try {
    const r = await fetch(`https://comic.naver.com/api/search/all?keyword=${encodeURIComponent(name)}`, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36", Referer: "https://comic.naver.com/" } });
    const L = ((await r.json()).searchWebtoonResult || {}).searchViewList || [];
    const hit = L.find((x) => norm(x.titleName) === norm(name));
    return hit ? { id: hit.titleId, th: hit.thumbnailUrl || "" } : null;
  } catch (e) { return null; }
}
// 목록 항목에 titleId 채우기: 먼저 lookup 이름표, 없으면 검색(th도 저장 — 사이트가 lookup에서 썸네일을 못 찾는 작품)
async function fillIds(list, lookup, extra = {}) {
  const nameId = {}; for (const k in (lookup && lookup.name) || {}) nameId[norm(k)] = lookup.name[k];
  for (const x of list) { const id = extra[norm(x.t)] || nameId[norm(x.t)]; if (id) x.id = id; }
  for (const x of list) {
    if (x.id && lookup && lookup.id && lookup.id[x.id]) continue;
    const h = await searchTitle(x.t); if (h) { x.id = h.id; if (h.th) x.th = h.th; }
    await new Promise((r) => setTimeout(r, 120));
  }
  return list;
}
// 커밋·푸시(다른 수집 결과는 merge_remote.js로 합친 뒤)
function pushPaths(root, paths, msg) {
  const { execSync } = require("child_process"), path = require("path");
  try {
    try { execSync(`git -C "${root}" fetch -q origin main`, { stdio: "inherit" }); execSync(`node "${path.join(root, "scripts", "merge_remote.js")}" origin/main`, { stdio: "inherit" }); } catch (e) { log("원격 합치기 실패 — 그대로 올림:", e.message); }
    execSync(`git -C "${root}" add ${paths.join(" ")}`, { stdio: "inherit" });
    execSync(`git -C "${root}" commit -m "${msg}"`, { stdio: "inherit" });
    for (let i = 0; i < 3; i++) { try { execSync(`git -C "${root}" pull --rebase --autostash -X theirs origin main`, { stdio: "inherit" }); execSync(`git -C "${root}" push origin main`, { stdio: "inherit" }); log("푸시 완료"); return; } catch (e) { log("재시도", i + 1); } }
  } catch (e) { log("변경 없음/커밋 스킵"); }
}

module.exports = { ADB, PKG, norm, adb, wait, zw, log, nodesOf, dump, focus, waitFocus, tap, swipe, back, toTop, dismissPopups, ensureReady, finish, searchTitle, fillIds, pushPaths };
