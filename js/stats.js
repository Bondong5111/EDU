'use strict';
/* =========================================================
 * 쌓인 기록에서 숫자 뽑기: 기간 평균 · 추세 · 달성률 · 발견(인사이트)
 * ========================================================= */
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const daysBack = (n, end = todayStr()) => Array.from({ length: n }, (_, i) => addDays(end, i - (n - 1)));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const mondayOf = (s) => { const d = parseYmd(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };

const MOOD_LABEL = { 1: '힘듦', 2: '별로', 3: '보통', 4: '좋음', 5: '최고' };
const METRICS = {
  mood: { label: '기분', subj: '기분이', unit: '', digits: 1, min: 1, max: 5 },
  energy: { label: '에너지', subj: '에너지가', unit: '', digits: 1, min: 1, max: 5 },
  sleep: { label: '수면', subj: '수면 시간이', unit: '시간', digits: 1 },
  steps: { label: '걸음', subj: '걸음 수가', unit: '보', digits: 0 },
  exercise: { label: '운동', subj: '운동 시간이', unit: '분', digits: 0 },
  weight: { label: '체중', subj: '체중이', unit: 'kg', digits: 1 },
  habit: { label: '습관 달성률', subj: '습관 달성률이', unit: '%', digits: 0, min: 0, max: 100 },
};
function fmtMetric(key, v, withUnit = true) {
  if (v == null) return '–';
  const m = METRICS[key];
  const n = m.digits ? v.toFixed(m.digits) : Math.round(v).toLocaleString();
  return withUnit && m.unit ? n + m.unit : n;
}

/* ---------- 습관 ---------- */
const isChecked = (date, hid) => (state.habitChecks[date] || []).includes(hid);
function toggleHabit(date, hid) {
  const arr = state.habitChecks[date] || [];
  const next = arr.includes(hid) ? arr.filter((x) => x !== hid) : [...arr, hid];
  if (next.length) state.habitChecks[date] = next; else delete state.habitChecks[date];
  save();
}
const habitStart = () => Object.keys(state.habitChecks).sort()[0] || null;
// 그날의 습관 달성률(%). 습관을 쓰기 전 날짜는 null (평균을 깎지 않도록)
function habitRate(date) {
  const st = habitStart();
  if (!state.habits.length || !st || date < st || date > todayStr()) return null;
  return (state.habits.filter((h) => isChecked(date, h.id)).length / state.habits.length) * 100;
}
function streakOf(hid) {
  let d = todayStr();
  if (!isChecked(d, hid)) d = addDays(d, -1); // 오늘 아직 안 했으면 어제부터
  let n = 0;
  while (isChecked(d, hid)) { n++; d = addDays(d, -1); }
  return n;
}
const habitFirst = (hid) => Object.keys(state.habitChecks).filter((d) => isChecked(d, hid)).sort()[0] || null;
// 최근 30일 달성률. 주 n회 목표면 그 기준으로 100%
function habitRate30(h) {
  const first = habitFirst(h.id);
  if (!first) return null;
  const days = daysBack(30).filter((d) => d >= first);
  const done = days.filter((d) => isChecked(d, h.id)).length;
  const want = Math.max(1, (days.length * (h.target || 7)) / 7);
  return Math.min(100, (done / want) * 100);
}
const habitThisWeek = (h) => daysBack(7, addDays(mondayOf(todayStr()), 6)).filter((d) => isChecked(d, h.id)).length;

/* ---------- 지표 ---------- */
const metricValue = (key, date) => (key === 'habit' ? habitRate(date) : state.logs[date]?.[key] ?? null);
const series = (key, n, end = todayStr()) => daysBack(n, end).map((date) => ({ date, v: metricValue(key, date) }));
function periodAvg(key, n, end = todayStr()) {
  const vals = series(key, n, end).map((p) => p.v).filter((v) => v != null);
  return { avg: mean(vals), count: vals.length };
}
// 1년 보기용: 7일씩 묶어 평균
function weekly(points) {
  const out = [];
  for (let i = points.length % 7; i < points.length; i += 7) {
    const chunk = points.slice(i, i + 7), vals = chunk.map((p) => p.v).filter((v) => v != null);
    out.push({ date: chunk[chunk.length - 1].date, v: mean(vals) });
  }
  return out;
}

/* ---------- 기록 색인 ---------- */
function recordDates({ future = false } = {}) {
  const today = todayStr();
  const set = new Set([...Object.keys(state.logs), ...Object.keys(state.habitChecks)]);
  for (const e of state.events) if (future || e.date <= today) set.add(e.date);
  return [...set].sort().reverse();
}

/* ---------- 발견: 함께 나타나는 경향 ---------- */
function computeInsights() {
  const dates = Object.keys(state.logs).sort();
  const moodDays = dates.filter((d) => state.logs[d].mood != null).length;
  const items = [];
  const compare = (pred, key) => {
    const yes = [], no = [];
    for (const d of dates) {
      const y = state.logs[d][key];
      if (y == null) continue;
      const p = pred(d);
      if (p == null) continue;
      (p ? yes : no).push(y);
    }
    if (yes.length < 4 || no.length < 4 || yes.length + no.length < 14) return null;
    return { hi: mean(yes), lo: mean(no), n: yes.length + no.length };
  };
  const log = (d) => state.logs[d];
  const st = habitStart();
  const causes = [
    { when: '7시간 이상 잔 날은', metric: 'sleep', pred: (d) => (log(d).sleep == null ? null : log(d).sleep >= 7) },
    { when: '운동한 날은', metric: 'exercise', pred: (d) => (log(d).exercise == null ? null : log(d).exercise > 0) },
    { when: '8,000보 이상 걸은 날은', metric: 'steps', pred: (d) => (log(d).steps == null ? null : log(d).steps >= 8000) },
    ...state.habits.map((h) => ({ when: `‘${h.name}’ 체크한 날은`, metric: 'habit', pred: (d) => (!st || d < st ? null : isChecked(d, h.id)) })),
  ];
  for (const c of causes) {
    // 같은 원인은 기분·에너지 중 차이가 더 큰 쪽 하나만 보여줌
    const found = ['mood', 'energy'].map((key) => ({ key, r: compare(c.pred, key) })).filter((x) => x.r && Math.abs(x.r.hi - x.r.lo) >= 0.3)
      .sort((a, b) => Math.abs(b.r.hi - b.r.lo) - Math.abs(a.r.hi - a.r.lo)).slice(0, 1);
    for (const { key, r } of found) {
      const diff = r.hi - r.lo;
      items.push({
        metric: c.metric, weight: Math.abs(diff),
        text: `${c.when} ${METRICS[key].subj} 평균 ${Math.abs(diff).toFixed(1)}점 ${diff > 0 ? '높았어요' : '낮았어요'}`,
        detail: `${r.hi.toFixed(1)} 대 ${r.lo.toFixed(1)} · ${r.n}일 기준`,
      });
    }
  }
  // 요일 패턴
  const byDow = Array.from({ length: 7 }, () => []);
  for (const d of dates) if (log(d).mood != null) byDow[parseYmd(d).getDay()].push(log(d).mood);
  const dows = byDow.map((a, i) => ({ i, avg: mean(a), n: a.length })).filter((x) => x.n >= 2);
  if (moodDays >= 14 && dows.length >= 4) {
    const best = dows.reduce((a, b) => (b.avg > a.avg ? b : a)), worst = dows.reduce((a, b) => (b.avg < a.avg ? b : a));
    if (best.avg - worst.avg >= 0.4) {
      items.push({
        metric: 'mood', weight: (best.avg - worst.avg) * 0.8,
        text: `${WEEK[best.i]}요일에 기분이 가장 좋고, ${WEEK[worst.i]}요일에 가장 낮았어요`,
        detail: `${best.avg.toFixed(1)} 대 ${worst.avg.toFixed(1)} · ${moodDays}일 기준`,
      });
    }
  }
  items.sort((a, b) => b.weight - a.weight);
  return { items, moodDays, need: 14 };
}

/* ---------- 주간 리뷰 ---------- */
function weekStats(monday) {
  const days = daysBack(7, addDays(monday, 6));
  const avg = (k) => mean(days.map((d) => metricValue(k, d)).filter((v) => v != null));
  const evs = state.events.filter((e) => e.date >= days[0] && e.date <= days[6]);
  const moods = days.map((d) => ({ d, v: state.logs[d]?.mood })).filter((x) => x.v != null);
  const best = moods.length ? moods.reduce((a, b) => (b.v > a.v ? b : a)) : null;
  return {
    days, mood: avg('mood'), sleep: avg('sleep'), steps: avg('steps'), habit: avg('habit'),
    exercise: days.reduce((s, d) => s + (state.logs[d]?.exercise || 0), 0),
    evDone: evs.filter((e) => e.done).length, evTotal: evs.length,
    logged: days.filter((d) => state.logs[d]).length, best,
  };
}

/* ---------- 목표: 습관과 연결되면 진행률 자동 계산 ---------- */
function goalProgress(g) {
  const h = g.linkHabit && state.habits.find((x) => x.id === g.linkHabit);
  if (!h) return { pct: g.progress || 0, auto: false, text: '' };
  const target = Math.max(1, g.linkTarget || 1);
  const count = Object.keys(state.habitChecks).filter((d) => (!g.since || d >= g.since) && isChecked(d, h.id)).length;
  return { pct: Math.min(100, Math.round((count / target) * 100)), auto: true, text: `${h.icon || ''} ${h.name} ${count}/${target}회`.trim() };
}

/* ---------- 데이터로 본 나 ---------- */
function mePatterns() {
  const dates = recordDates();
  const logDates = Object.keys(state.logs).sort();
  let longest = 0, run = 0, prev = null;
  for (const d of logDates) { run = prev && addDays(prev, 1) === d ? run + 1 : 1; longest = Math.max(longest, run); prev = d; }
  const rated = state.habits.map((h) => ({ h, r: habitRate30(h) })).filter((x) => x.r != null);
  const bestHabit = rated.length ? rated.reduce((a, b) => (b.r > a.r ? b : a)) : null;
  const byDow = Array.from({ length: 7 }, () => []);
  for (const d of logDates) if (state.logs[d].mood != null) byDow[parseYmd(d).getDay()].push(state.logs[d].mood);
  const dows = byDow.map((a, i) => ({ i, avg: mean(a), n: a.length })).filter((x) => x.n >= 2);
  const bestDow = dows.length >= 3 ? dows.reduce((a, b) => (b.avg > a.avg ? b : a)) : null;
  return { total: dates.length, since: dates[dates.length - 1] || null, longest, bestHabit, bestDow, sleep: periodAvg('sleep', 30).avg, mood: periodAvg('mood', 30).avg };
}

/* ---------- 자산 스냅샷 ---------- */
// 오늘의 평가금액을 하루 한 줄씩 쌓아 둠 (값이 바뀌면 갱신)
function recordSnapshot() {
  const p = computeHoldings();
  if (!p.holdings.length) return;
  const cur = state.settings.currency;
  const r = (n) => (cur === 'USD' ? Math.round(n * 100) / 100 : Math.round(n));
  const s = { v: r(p.value), c: r(p.cost), cur };
  const old = state.snapshots[todayStr()];
  if (!old || old.v !== s.v || old.c !== s.c || old.cur !== s.cur) { state.snapshots[todayStr()] = s; save(); }
}
function snapshotSeries(n) {
  const cur = state.settings.currency, fx = Number(state.settings.usdKrw) || 0;
  const conv = (s, f) => (!s ? null : s.cur === cur || !fx ? s[f] : cur === 'KRW' ? s[f] * fx : s[f] / fx);
  const dates = Object.keys(state.snapshots).sort().slice(-n);
  return dates.map((date) => ({ date, v: conv(state.snapshots[date], 'v'), c: conv(state.snapshots[date], 'c') }));
}
function moneyShort(n) {
  if (state.settings.currency === 'USD') return '$' + (Math.abs(n) >= 1000 ? (n / 1000).toFixed(1) + 'k' : Math.round(n));
  const a = Math.abs(n);
  return a >= 1e8 ? (n / 1e8).toFixed(1) + '억' : a >= 1e4 ? Math.round(n / 1e4).toLocaleString() + '만' : Math.round(n).toLocaleString();
}
