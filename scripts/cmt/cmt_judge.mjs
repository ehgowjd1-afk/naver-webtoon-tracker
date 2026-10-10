/* 네이버웹툰 회차 댓글 분석 — 숫자 판정 (리디 cmt_judge.mjs 의 네이버판)
 * 회차 표시(e.flags): [대박][터짐][논쟁][댓글 급증][이탈 경고] + 작품 밖 원인(e.ext: 휴재 직전·휴재 후 복귀·동시 공개·미리보기)
 *   - 급증: 앞 5화·뒤 5화 중앙값 '둘 다'의 CFG.spikeX배 이상 (수집 단계에서 e.ratio 로 계산)
 *   - 급감: 이 회차까지 4화 중앙값 대비 다음 4화 중앙값이 CFG.dropX 이하 → 이 회차를 '이탈 시작 직전'(e.drop)으로
 * '불만'은 속뜻(tn)이 진짜 작품 불만(critic)인 것만 — 캐릭터 과몰입·애정 투정·연재 아쉬움은 불만이 아님. 하차 신호도 농담이면 세지 않음.
 * 니즈 누적·폭발은 참고용 니즈 맵에만 쓴다.
 */
import { CFG } from "./cmt_config.mjs";

const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

export function judge(w) {
  const num = w.episodes;
  const an = num.filter((e) => e.analyzed);
  for (const e of num) { delete e.needRun; delete e.needBurst; }
  for (const e of an) {
    const cs = w.sample.filter((c) => c.no === e.no && c.lab);
    const cnt = (f) => cs.filter(f).length;
    const needs = {};
    for (const c of cs) for (const d of c.lab.nd) {
      needs[d] ||= { met: 0, lack: 0, ask: 0, split: 0 };
      if (needs[d][c.lab.st] != null) needs[d][c.lab.st]++;
    }
    const by = (key) => cs.reduce((o, c) => (c.lab[key] != null && (o[c.lab[key]] = (o[c.lab[key]] || 0) + 1), o), {});
    e.ai = { n: cs.length, tn: by("tn"), needs, critic: cnt((c) => c.lab.tn === "critic"),
      churn: cnt((c) => c.lab.ac === "churn" && c.lab.tn !== "tease"), pay: cnt((c) => c.lab.ac === "pay"), stay: cnt((c) => c.lab.ac === "stay"), share: cnt((c) => c.lab.ac === "share"),
      lo: cnt((c) => c.lab.cf === "lo") };
    const cheer = (c) => ["praise", "tease"].includes(c.lab.tn);
    e.ai.cheerShare = e.ai.n ? Math.round((cnt(cheer) / e.ai.n) * 100) / 100 : 0;
    e.ai.complainShare = e.ai.n ? Math.round((e.ai.critic / e.ai.n) * 100) / 100 : 0;
    e.ai.churnShare = e.ai.n ? Math.round((e.ai.churn / e.ai.n) * 100) / 100 : 0;
  }
  num.forEach((e, i) => {
    e.flags = [];
    e.needFlags = [];
    const up = e.ratio != null && e.ratio >= CFG.spikeX;
    if (up && e.ai && e.ai.n) {
      const prevA = an.filter((x) => x.ai && x.ai.n && x.no < e.no).slice(-CFG.baseEps);
      const prevCheer = prevA.length ? avg(prevA.map((x) => x.ai.cheerShare)) : null;
      if (e.ai.cheerShare >= CFG.controversyShare && e.ai.complainShare >= CFG.controversyShare) e.flags.push("논쟁");
      else if (prevCheer == null || e.ai.cheerShare > prevCheer) e.flags.push(e.ratio >= CFG.bigX ? "대박" : "터짐");
      else e.flags.push("댓글 급증");
    } else if (up) e.flags.push("댓글 급증");
    if (e.drop) e.flags.push("이탈 경고");
  });
  // 니즈 누적 → 니즈 폭발 (참고용)
  const codes = new Set(an.flatMap((e) => Object.keys((e.ai && e.ai.needs) || {})));
  w.needStats = {};
  for (const d of codes) {
    let run = 0, built = false;
    const st = { met: 0, lack: 0, ask: 0, split: 0, likes: 0, eps: [], pay: 0, askBeforeBurst: 0, burstRatios: [] };
    for (const e of an) {
      const x = (e.ai && e.ai.needs[d]) || { met: 0, lack: 0, ask: 0, split: 0 };
      const want = x.ask + x.lack, wasBuilt = built;
      run = want >= CFG.needMin ? run + 1 : 0;
      if (run >= CFG.needRun) { built = true; if (!e.needFlags.includes("니즈 누적")) e.needFlags.push("니즈 누적"); (e.needRun ||= []).push(d); }
      if (wasBuilt && x.met >= CFG.burstMin) {
        e.needFlags.push(e.flags.some((f) => f === "터짐" || f === "대박") ? "핵심 니즈" : "니즈 폭발");
        (e.needBurst ||= []).push(d);
        st.burstRatios.push(e.ratio);
        built = false; run = 0;
      } else if (!st.burstRatios.length) st.askBeforeBurst += want;
      for (const k of ["met", "lack", "ask", "split"]) st[k] += x[k];
      if (x.met + x.lack + x.ask + x.split) st.eps.push(e.label || e.no);
    }
    const rel = w.sample.filter((c) => c.lab && c.lab.nd.includes(d));
    st.likes = rel.reduce((t, c) => t + c.like, 0);
    st.pay = rel.filter((c) => c.lab.ac === "pay").length;
    w.needStats[d] = st;
  }
  w.newNeeds = {};
  for (const c of w.sample) if (c.lab && c.lab.nn) {
    const k = c.lab.nn;
    w.newNeeds[k] ||= { count: 0, likes: 0, eps: [] };
    w.newNeeds[k].count++; w.newNeeds[k].likes += c.like;
    if (!w.newNeeds[k].eps.includes(c.label)) w.newNeeds[k].eps.push(c.label);
  }
}
