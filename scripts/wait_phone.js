/* 아침 수집 때 폰이 연결돼 있지 않으면, 연결될 때까지 기다렸다가 폰 수집(앱 주간·장르 주간·요일별·시리즈 앱)으로 넘어가게 함.
 * run_local.bat에서 폰 수집기들 바로 앞에 실행. 사용자 요청(2026-11-18): "내가 연결하는 시점에 요일 순위와 시리즈 순위가 되도록".
 *  - 이미 연결돼 있으면 바로 끝(0).
 *  - 아니면 1분마다 확인 → 연결되면 1분 기다렸다(꽂고 바로 폰 쓰는 경우) 끝(0).
 *  - --until(기본 23:00, 한국 시각)까지 연결 안 되면 끝(1) → 뒤 수집기들은 각자 '폰 없음'으로 건너뜀.
 *  - 다른 폰 수집(손으로 돌린 것)이 돌고 있으면 끝날 때까지 기다림 — 같은 폰을 둘이 동시에 만지지 않게. 뒤 수집기들은 오늘 받은 건 건너뜀.
 * 사용: node scripts/wait_phone.js [--until=23:00] [--every=60] [--grace=60]
 */
const { execFileSync } = require("child_process");
const { ADB, log } = require("./lib/adb_phone.cjs");

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const UNTIL = arg("until", "23:00"), EVERY = +arg("every", 60) * 1000, GRACE = +arg("grace", 60) * 1000;
const kst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(11, 16);   // "HH:MM"
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const connected = () => { try { return /\tdevice\b/.test(execFileSync(ADB, ["devices"], { encoding: "utf8", timeout: 30000 })); } catch (e) { return false; } };
function othersRunning() {   // 지금 돌고 있는 다른 폰 수집기(node 명령줄에 collect_app_ / collect_series_app)
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { $_.ProcessId.ToString() + ' ' + $_.CommandLine }"], { encoding: "utf8", timeout: 60000 });
    return out.split(/\r?\n/).filter((l) => /collect_(app_|series_app)/.test(l) && !l.startsWith(process.pid + " "));
  } catch (e) { return []; }
}

function go() {
  for (let o = othersRunning(); o.length; o = othersRunning()) { log("다른 폰 수집이 돌고 있어 끝나길 기다림:", o.map((l) => l.replace(/^.*scripts[\\/]/, "")).join(" | ")); sleep(120000); }
  log("폰 수집 시작"); process.exit(0);
}
if (connected()) { log("폰 연결돼 있음"); go(); }
log(`폰이 연결돼 있지 않음 — ${UNTIL}까지 연결되길 기다림(${EVERY / 1000}초마다 확인)`);
for (;;) {
  if (kst() >= UNTIL) { log(`${UNTIL}까지 폰이 연결되지 않음 — 오늘 폰 수집 건너뜀`); process.exit(1); }
  sleep(EVERY);
  if (!connected()) continue;
  log(`폰 연결됨 — ${GRACE / 1000}초 뒤 수집 시작`);
  sleep(GRACE);
  if (!connected()) { log("다시 끊김 — 계속 기다림"); continue; }
  go();
}
