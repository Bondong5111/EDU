// 노션으로 보낼 표 다섯 개의 모양(스키마)과, 쌓인 기록에서 각 표의 행을 만드는 계산.
// 노션 API 를 부르지 않는 순수 함수만 있습니다 (테스트하기 쉽게).

const MOOD = { 1: '😣 힘듦', 2: '😕 별로', 3: '😐 보통', 4: '🙂 좋음', 5: '😄 최고' };
const AREA = { health: '건강', career: '커리어', money: '재테크', study: '배움', relation: '관계', mind: '마음' };
const CAT = { work: '업무', personal: '개인', finance: '투자/금융', etc: '기타' };
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const COLORS = { '😣 힘듦': 'red', '😕 별로': 'orange', '😐 보통': 'gray', '🙂 좋음': 'blue', '😄 최고': 'green' };

const num = (format = 'number') => ({ number: { format } });
const options = (names) => ({ select: { options: names.map((name) => ({ name, color: COLORS[name] || 'default' })) } });

// 표 이름 · 아이콘 · 열. 첫 열은 제목(title) 열
export const TABLES = {
  daily: {
    title: '날짜별 기록', icon: '📅',
    properties: {
      '날짜': { title: {} }, '일자': { date: {} }, '기분': options(Object.values(MOOD)),
      '에너지': num(), '수면(시간)': num(), '걸음': num('number_with_commas'), '운동(분)': num(),
      '체중(kg)': num(), '섭취(kcal)': num('number_with_commas'), '탄수화물(g)': num(), '단백질(g)': num(), '지방(g)': num(),
      '습관 달성률(%)': num(), '한 습관': { multi_select: { options: [] } }, '일정': { rich_text: {} },
      '감사한 일': { rich_text: {} }, '일기': { rich_text: {} },
    },
  },
  weekly: {
    title: '주간 리뷰', icon: '🗓️',
    properties: {
      '주': { title: {} }, '기간': { date: {} }, '기록한 날': num(), '평균 기분': num(), '평균 수면(시간)': num(),
      '평균 걸음': num('number_with_commas'), '운동 합계(분)': num(), '평균 섭취(kcal)': num('number_with_commas'),
      '체중(kg)': num(), '습관 달성률(%)': num(), '완료한 일정': num(), '전체 일정': num(),
      '가장 좋았던 날': { rich_text: {} }, '회고': { rich_text: {} },
    },
  },
  goals: {
    title: '목표', icon: '🎯',
    properties: {
      '목표': { title: {} }, '분야': options(Object.values(AREA)), '마감일': { date: {} }, '진행률(%)': num(),
      '상태': options(['진행 중', '완료']), '자동 계산': { rich_text: {} },
    },
  },
  habits: {
    title: '습관', icon: '🔁',
    properties: {
      '습관': { title: {} }, '주간 목표(회)': num(), '이번 주(회)': num(), '30일 달성률(%)': num(),
      '연속(일)': num(), '총 체크(회)': num(), '시작일': { date: {} },
    },
  },
  events: {
    title: '할 일 · 일정', icon: '✅',
    properties: {
      '제목': { title: {} }, '일시': { date: {} }, '분류': options(Object.values(CAT)), '완료': { checkbox: {} },
      '출처': options(['직접 입력', '구글 캘린더']), '메모': { rich_text: {} },
    },
  },
};
export const TABLE_ORDER = ['daily', 'weekly', 'goals', 'habits', 'events'];

/* ---------- 노션 값 만들기 ---------- */
// 노션 텍스트 한 조각은 2000자, 한 칸에 최대 100조각
export function text(s) {
  s = String(s ?? '').trim();
  if (!s) return { rich_text: [] };
  const parts = [];
  for (let i = 0; i < s.length && parts.length < 100; i += 2000) parts.push({ type: 'text', text: { content: s.slice(i, i + 2000) } });
  return { rich_text: parts };
}
const title = (s) => ({ title: [{ type: 'text', text: { content: String(s).slice(0, 2000) } }] });
const n = (v, digits = 1) => ({ number: v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10 ** digits) / 10 ** digits });
const date = (start, end) => ({ date: start ? { start, ...(end ? { end } : {}) } : null });
const select = (name) => ({ select: name ? { name: String(name).replace(/,/g, ' ').slice(0, 100) } : null });

/* ---------- 날짜 계산 ---------- */
const DAY = 86400000;
const parse = (s) => new Date(s + 'T00:00:00Z');
const fmt = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, k) => fmt(new Date(parse(s).getTime() + k * DAY));
const mondayOf = (s) => addDays(s, -((parse(s).getUTCDay() + 6) % 7));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const md = (s) => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`;

/**
 * 기록 전체(state) → 표별 행 목록. 각 행은 {key, properties}
 * today 는 'YYYY-MM-DD' (서버 시간대 기준 오늘)
 */
export function buildRows(state, today, { timeZone } = {}) {
  const logs = state.logs || {}, checks = state.habitChecks || {}, habits = state.habits || [], events = state.events || [];
  const checked = (d, id) => (checks[d] || []).map(String).includes(String(id));
  const firstCheck = Object.keys(checks).sort()[0] || null;
  const habitRate = (d) => (!habits.length || !firstCheck || d < firstCheck || d > today ? null : (habits.filter((h) => checked(d, h.id)).length / habits.length) * 100);
  const eventsOn = (d) => events.filter((e) => e.date === d);

  /* 날짜별 기록: 기록이나 습관 체크가 있는 지난 날짜 */
  const days = [...new Set([...Object.keys(logs), ...Object.keys(checks)])].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today).sort();
  const daily = days.map((d) => {
    const l = logs[d] || {};
    const done = habits.filter((h) => checked(d, h.id)).map((h) => ({ name: `${h.icon ? h.icon + ' ' : ''}${h.name}`.replace(/,/g, ' ').slice(0, 100) }));
    return {
      key: d,
      properties: {
        '날짜': title(`${d} (${WEEK[parse(d).getUTCDay()]})`), '일자': date(d), '기분': select(MOOD[l.mood]),
        '에너지': n(l.energy), '수면(시간)': n(l.sleep), '걸음': n(l.steps, 0), '운동(분)': n(l.exercise, 0),
        '체중(kg)': n(l.weight), '섭취(kcal)': n(l.kcal, 0), '탄수화물(g)': n(l.carb), '단백질(g)': n(l.protein), '지방(g)': n(l.fat),
        '습관 달성률(%)': n(habitRate(d), 0), '한 습관': { multi_select: done },
        '일정': text(eventsOn(d).map((e) => e.title).join(', ')), '감사한 일': text(l.grateful), '일기': text(l.note),
      },
    };
  });

  /* 주간 리뷰: 첫 기록이 있는 주부터 이번 주까지 */
  const weekly = [];
  const reviews = state.reviews || {};
  if (days.length) {
    for (let mon = mondayOf(days[0]); mon <= today; mon = addDays(mon, 7)) {
      const wd = Array.from({ length: 7 }, (_, i) => addDays(mon, i)), sun = wd[6];
      const vals = (k) => wd.map((d) => logs[d]?.[k]).filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
      const logged = wd.filter((d) => logs[d]).length;
      const note = reviews[mon]?.note || '';
      if (!logged && !note && !wd.some((d) => checks[d])) continue;
      const moods = wd.filter((d) => logs[d]?.mood != null);
      const best = moods.length ? moods.reduce((a, b) => (logs[b].mood > logs[a].mood ? b : a)) : null;
      const weights = wd.filter((d) => logs[d]?.weight != null);
      const evs = events.filter((e) => e.date >= mon && e.date <= sun);
      weekly.push({
        key: mon,
        properties: {
          '주': title(`${md(mon)} – ${md(sun)}`), '기간': date(mon, sun), '기록한 날': n(logged, 0),
          '평균 기분': n(mean(vals('mood'))), '평균 수면(시간)': n(mean(vals('sleep'))), '평균 걸음': n(mean(vals('steps')), 0),
          '운동 합계(분)': n(vals('exercise').reduce((a, b) => a + b, 0), 0), '평균 섭취(kcal)': n(mean(vals('kcal')), 0),
          '체중(kg)': n(weights.length ? logs[weights[weights.length - 1]].weight : null),
          '습관 달성률(%)': n(mean(wd.map(habitRate).filter((v) => v != null)), 0),
          '완료한 일정': n(evs.filter((e) => e.done).length, 0), '전체 일정': n(evs.length, 0),
          '가장 좋았던 날': text(best ? `${md(best)} (${WEEK[parse(best).getUTCDay()]}) ${MOOD[logs[best].mood]}` : ''),
          '회고': text(note),
        },
      });
    }
  }

  /* 목표 */
  const goals = (state.goals || []).filter((g) => g && g.id != null).map((g) => {
    const h = g.linkHabit && habits.find((x) => String(x.id) === String(g.linkHabit));
    let pct = Number(g.progress) || 0, auto = '';
    if (h) {
      const target = Math.max(1, Number(g.linkTarget) || 1);
      const count = Object.keys(checks).filter((d) => (!g.since || d >= g.since) && checked(d, h.id)).length;
      pct = Math.min(100, Math.round((count / target) * 100));
      auto = `${h.icon ? h.icon + ' ' : ''}${h.name} ${count}/${target}회`;
    }
    return {
      key: String(g.id),
      properties: {
        '목표': title(g.title || '(이름 없음)'), '분야': select(AREA[g.area] || g.area), '마감일': date(g.due),
        '진행률(%)': n(pct, 0), '상태': select(pct >= 100 ? '완료' : '진행 중'), '자동 계산': text(auto),
      },
    };
  });

  /* 습관 */
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(mondayOf(today), i));
  const habitRows = habits.filter((h) => h && h.id != null).map((h) => {
    const all = Object.keys(checks).filter((d) => checked(d, h.id)).sort();
    let d = checked(today, h.id) ? today : addDays(today, -1), streak = 0;
    while (checked(d, h.id)) { streak++; d = addDays(d, -1); }
    let rate = null;
    if (all.length) {
      const span = Array.from({ length: 30 }, (_, i) => addDays(today, i - 29)).filter((x) => x >= all[0]);
      const done = span.filter((x) => checked(x, h.id)).length;
      rate = Math.min(100, (done / Math.max(1, (span.length * (h.target || 7)) / 7)) * 100);
    }
    return {
      key: String(h.id),
      properties: {
        '습관': title(`${h.icon ? h.icon + ' ' : ''}${h.name || '(이름 없음)'}`), '주간 목표(회)': n(h.target || 7, 0),
        '이번 주(회)': n(weekDays.filter((x) => checked(x, h.id)).length, 0), '30일 달성률(%)': n(rate, 0),
        '연속(일)': n(streak, 0), '총 체크(회)': n(all.length, 0), '시작일': date(all[0] || null),
      },
    };
  });

  /* 할 일 · 일정 */
  const at = (d, t) => (t ? `${d}T${t}:00` : d);
  const eventRows = events.filter((e) => e && e.id != null && /^\d{4}-\d{2}-\d{2}$/.test(e.date || '')).map((e) => {
    const start = at(e.date, e.start), end = e.start && e.end && e.end > e.start ? at(e.date, e.end) : null;
    return {
      key: String(e.id),
      properties: {
        '제목': title(e.title || '(제목 없음)'),
        '일시': { date: { start, ...(end ? { end } : {}), ...(e.start && timeZone ? { time_zone: timeZone } : {}) } },
        '분류': select(CAT[e.cat] || CAT.etc), '완료': { checkbox: !!e.done },
        '출처': select(e.source === 'google' ? '구글 캘린더' : '직접 입력'), '메모': text(e.memo),
      },
    };
  });

  return { daily, weekly, goals, habits: habitRows, events: eventRows };
}
