'use strict';
/* =========================================================
 * 화면: 홈(요약 허브) · 기록(보관함) · 분석 · 자산 · 나 + 빠른 기록 창
 * ========================================================= */
const ui = {
  homeDays: 7,        // 홈 지표 기간
  heat: 'mood',       // 히트맵 기준
  metric: 'mood',     // 분석 지표
  range: 30,          // 분석 기간
  week: null,         // 주간 리뷰 대상 주(월요일)
  meTab: 'profile',
  q: '', qType: 'all', tlPage: 1,
  sheetDate: null,
};
const METRIC_COLOR = { mood: 'var(--primary)', energy: 'var(--c-finance)', sleep: 'var(--c-etc)', steps: 'var(--success)', exercise: 'var(--success)', weight: 'var(--text-2)', kcal: 'var(--c-finance)', habit: 'var(--success)' };
const fmtDateFull = (s) => { const d = parseYmd(s); return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`; };
const snippet = (t, n = 70) => (t.length > n ? t.slice(0, n) + '…' : t);
const emptyLi = (text) => `<li class="empty">${text}</li>`;

/* ---------- 공통 조각 ---------- */
const moodButtons = (sel) => [1, 2, 3, 4, 5].map((n) =>
  `<button type="button" class="mood-btn ${sel === n ? 'on' : ''}" data-mood="${n}" aria-pressed="${sel === n}"><span>${MOOD_EMOJI[n]}</span><small>${MOOD_LABEL[n]}</small></button>`).join('');
const levelButtons = (sel) => [1, 2, 3, 4, 5].map((n) =>
  `<button type="button" class="level-btn ${sel === n ? 'on' : ''}" data-level="${n}" aria-pressed="${sel === n}">${n}</button>`).join('');
const habitChips = (date) => state.habits.map((h) =>
  `<button type="button" class="hchip ${isChecked(date, h.id) ? 'on' : ''}" data-hid="${esc(h.id)}" data-date="${date}" aria-pressed="${isChecked(date, h.id)}">${esc(h.icon || '')} ${esc(h.name)}</button>`).join('');

function setLog(date, field, value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return;
  const log = state.logs[date] || {};
  if (value == null || value === '' || Number.isNaN(value)) delete log[field]; else log[field] = value;
  if (Object.keys(log).length) state.logs[date] = log; else delete state.logs[date];
  save();
}

function insightList(el, limit) {
  const r = computeInsights();
  if (!r.items.length) {
    el.innerHTML = emptyLi(r.moodDays < r.need
      ? `기분을 ${r.need}일 이상 기록하면 패턴을 찾아드려요<br><span class="sub">지금 ${r.moodDays}일째</span>`
      : '아직 뚜렷한 패턴이 없어요. 수면이나 운동도 함께 기록해 보세요');
    return;
  }
  el.innerHTML = r.items.slice(0, limit).map((i) =>
    `<li><span class="ins-ico">${ico('spark')}</span><div class="grow"><div>${esc(i.text)}</div><div class="sub">${esc(i.detail)}</div></div></li>`).join('');
}

function goalRow(g, editable) {
  const pr = goalProgress(g);
  const dday = g.due ? Math.round((parseYmd(g.due) - parseYmd(todayStr())) / 86400000) : null;
  const ddayTxt = dday == null ? '' : dday > 0 ? `D-${dday}` : dday === 0 ? 'D-day' : `D+${-dday}`;
  const bar = `<div class="progress"><div style="width:${pr.pct}%"></div></div>`;
  return `<li class="col" data-gid="${esc(g.id)}">
    <div class="goal-top"><span class="tag">${AREA_LABEL[g.area] || '기타'}</span><strong class="grow">${esc(g.title)}</strong>
      <span class="sub goal-pct">${[ddayTxt, pr.pct + '%'].filter(Boolean).join(' · ')}</span>
      ${editable ? `<button class="icon-btn gl-del" title="삭제">${ico('trash')}</button>` : ''}</div>
    ${pr.auto ? `${bar}<div class="sub">${esc(pr.text)} · 자동 계산</div>`
      : editable ? `<input type="range" class="goal-range" min="0" max="100" step="5" value="${pr.pct}" aria-label="진행률" />` : bar}
  </li>`;
}

/* =========================================================
 * 홈: 쌓인 기록을 한눈에
 * ========================================================= */
const HOME_METRICS = ['mood', 'sleep', 'steps', 'habit'];

function renderHome() {
  recordSnapshot();
  const today = todayStr(), p = state.profile, log = state.logs[today] || {};
  const evs = eventsOn(today);
  const hAll = state.habits.length, hDone = state.habits.filter((h) => isChecked(today, h.id)).length;
  const evDone = evs.filter((e) => e.done).length;
  const filled = ['mood', 'energy', 'sleep'].filter((k) => log[k] != null).length;

  $('#home-today').innerHTML = `
    <div class="today-top">
      <div class="avatar">${esc(p.emoji || '🌱')}</div>
      <div class="grow">
        <div class="greeting">${greeting()}</div>
        <h2>${p.name ? esc(p.name) + '님' : '오늘의 나'}</h2>
        ${p.headline ? `<div class="sub">${esc(p.headline)}</div>` : ''}
      </div>
      <div class="rings">
        ${ring(hAll ? (hDone / hAll) * 100 : 0, '습관', hAll ? `${hDone}/${hAll}` : '–', 'var(--success)')}
        ${ring(evs.length ? (evDone / evs.length) * 100 : 0, '일정', evs.length ? `${evDone}/${evs.length}` : '–', 'var(--warn)')}
        ${ring((filled / 3) * 100, '기록', `${filled}/3`)}
      </div>
    </div>
    <div class="field">
      <div class="field-label">${log.mood ? '오늘 기분' : '오늘 기분은 어때요?'}</div>
      <div class="mood-row" data-date="${today}">${moodButtons(log.mood)}</div>
    </div>
    ${hAll ? `<div class="field"><div class="field-label">오늘의 습관</div><div class="habit-chips">${habitChips(today)}</div></div>`
      : '<button class="link" data-goto="me" data-pane="plan">습관을 추가하면 여기서 바로 체크할 수 있어요</button>'}
    <button class="btn ghost small" data-checkin>${ico('plus')}수면 · 일기 더 기록</button>`;

  // 일정
  const upcoming = state.events.filter((e) => e.date > today && e.date <= addDays(today, 7)).sort(sortEvents);
  const list = [...evs.map((e) => eventItem(e, { editable: false })), ...upcoming.slice(0, Math.max(2, 5 - evs.length)).map((e) => eventItem(e, { showDate: true, editable: false }))];
  $('#home-events').innerHTML = list.length ? list.join('') : emptyLi('7일 안에 일정이 없어요');

  // 지표 카드
  const n = ui.homeDays;
  document.querySelectorAll('#home-period button').forEach((b) => b.classList.toggle('on', +b.dataset.days === n));
  $('#home-metrics').innerHTML = HOME_METRICS.map((k) => {
    const cur = periodAvg(k, n), prev = periodAvg(k, n, addDays(today, -n));
    const pts = n === 365 ? weekly(series(k, 364)) : series(k, n === 7 ? 14 : n);
    let delta = `<span class="delta">${cur.count ? `${cur.count}일 기록` : '기록 없음'}</span>`;
    if (cur.avg != null && prev.avg != null) {
      const d = cur.avg - prev.avg, tiny = Math.abs(d) < (k === 'steps' ? 50 : k === 'habit' ? 1 : 0.05);
      delta = tiny ? '<span class="delta">지난 기간과 비슷</span>' : `<span class="delta ${d > 0 ? 'pos' : 'neg'}">${d > 0 ? '▲' : '▼'} ${fmtMetric(k, Math.abs(d), false)}<small> 지난 기간 대비</small></span>`;
    }
    return `<button class="metric" data-metric="${k}">
      <span class="m-label">${METRICS[k].label}<small>${n === 365 ? '1년' : n + '일'} 평균</small></span>
      <span class="m-value">${fmtMetric(k, cur.avg, false)}<small>${cur.avg == null ? '' : METRICS[k].unit}</small></span>
      ${delta}${spark(pts.map((x) => x.v), { color: METRIC_COLOR[k] })}</button>`;
  }).join('');

  // 히트맵
  document.querySelectorAll('#home-heatmode button').forEach((b) => b.classList.toggle('on', b.dataset.heat === ui.heat));
  const total = recordDates().length;
  $('#home-heat-count').textContent = total ? `지금까지 ${total}일` : '';
  const heat = $('#home-heat');
  heat.innerHTML = heatmap(ui.heat);
  heat.scrollLeft = heat.scrollWidth;
  const scale = ui.heat === 'habit' ? ['h1', 'h2', 'h3', 'h4', 'h5'] : ['m1', 'm2', 'm3', 'm4', 'm5'];
  $('#home-heat-legend').innerHTML = `<span>${ui.heat === 'habit' ? '0%' : '힘듦'}</span>${scale.map((c) => `<i class="hc ${c}"></i>`).join('')}<span>${ui.heat === 'habit' ? '100%' : '최고'}</span><span class="grow"></span><span>칸을 누르면 그날 기록으로 이동</span>`;

  insightList($('#home-insights'), 2);

  const goals = [...state.goals].sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')).slice(0, 4);
  $('#home-goals').innerHTML = goals.length ? goals.map((g) => goalRow(g, false)).join('') : emptyLi('목표를 세우고 습관과 연결해 보세요');

  // 자산
  const pf = computeHoldings(), snaps = snapshotSeries(30);
  $('#home-asset').innerHTML = `<div class="card-head"><h2>자산</h2><button class="link" data-goto="stocks">자세히</button></div>` + (pf.holdings.length
    ? `<div class="asset-row"><div><div class="m-value">${money(pf.value)}</div>
        <div class="sub"><span class="${cls(pf.pnl)}">${signed(pf.pnl)} (${pct(pf.rate)})</span></div></div>
        ${spark(snaps.map((x) => x.v), { w: 150, h: 48 })}</div>
       <div class="sub">${snaps.length > 1 ? `최근 ${snaps.length}일 추이` : '오늘부터 평가금액이 매일 쌓여요'}</div>`
    : '<ul class="list tight"><li class="empty">매매 기록을 추가하거나 토스증권을 연결하면 자산이 쌓여요</li></ul>');

  renderRecall();
}

// 예전 오늘 다시 보기
function renderRecall() {
  const today = todayStr();
  const box = $('#home-recall');
  for (const [n, label] of [[365, '1년 전 오늘'], [182, '6개월 전 오늘'], [91, '3개월 전 오늘'], [30, '한 달 전 오늘'], [7, '일주일 전 오늘']]) {
    const d = addDays(today, -n), log = state.logs[d], evs = eventsOn(d);
    if (!log && !evs.length) continue;
    const text = log?.note || log?.grateful || '';
    box.innerHTML = `<div class="card-head"><h2>${label}</h2><button class="link" data-day="${d}">그날 보기</button></div>
      <div class="recall">
        <div class="recall-mood">${log?.mood ? MOOD_EMOJI[log.mood] : '📅'}</div>
        <div class="grow"><div class="sub">${fmtDateFull(d)}</div>
          ${text ? `<div class="about">${esc(snippet(text, 140))}</div>` : ''}
          ${evs.length ? `<div class="sub">일정: ${esc(evs.map((e) => e.title).join(', '))}</div>` : ''}
          ${!text && log ? `<div class="sub">${['sleep', 'steps', 'exercise', 'kcal'].filter((k) => log[k] != null).map((k) => `${METRICS[k].label} ${fmtMetric(k, log[k])}`).join(' · ')}</div>` : ''}
        </div></div>`;
    return;
  }
  box.innerHTML = `<div class="card-head"><h2>다시 보기</h2></div>
    <ul class="list tight"><li class="empty">기록이 쌓이면 일주일 전, 한 달 전, 1년 전 오늘을 여기서 다시 보여드려요</li></ul>`;
}

/* =========================================================
 * 기록: 달력 · 하루 카드 · 검색
 * ========================================================= */
function renderRecords() {
  renderCalendar();
  renderDay();
  renderTimeline();
}

function renderDay() {
  const d = selectedDate, log = state.logs[d] || {}, evs = eventsOn(d);
  const future = d > todayStr();
  const snap = snapshotSeries(100000).find((s) => s.date === d);
  const chips = ['mood', 'energy', 'sleep', 'steps', 'exercise', 'weight', 'kcal'].filter((k) => log[k] != null).map((k) => (k === 'mood'
    ? `<span class="chip-m big">${MOOD_EMOJI[log.mood]} ${MOOD_LABEL[log.mood]}</span>`
    : `<span class="chip-m"><small>${METRICS[k].label}</small>${k === 'energy' ? log[k] + '/5' : fmtMetric(k, log[k])}</span>`));
  const macros = [['carb', '탄'], ['protein', '단'], ['fat', '지']].filter(([k]) => log[k] != null).map(([k, l]) => `${l} ${Math.round(log[k])}g`);
  if (macros.length) chips.push(`<span class="chip-m"><small>탄단지</small>${macros.join(' · ')}</span>`);
  $('#day-card').innerHTML = `
    <div class="card-head"><h2>${fmtDateFull(d)}</h2>
      ${future ? '' : `<button class="btn ghost small" data-checkin="${d}">${ico(Object.keys(log).length ? 'edit' : 'plus')}${Object.keys(log).length ? '수정' : '기록하기'}</button>`}</div>
    ${chips.length ? `<div class="chip-row">${chips.join('')}</div>` : future ? '' : '<p class="muted">이 날의 기록이 없어요.</p>'}
    ${state.habits.length && !future ? `<div class="habit-chips">${habitChips(d)}</div>` : ''}
    ${log.grateful ? `<div class="journal"><small>감사한 일 · 잘한 일</small><div>${esc(log.grateful)}</div></div>` : ''}
    ${log.note ? `<div class="journal"><small>일기</small><div class="about">${esc(log.note)}</div></div>` : ''}
    ${snap ? `<div class="journal"><small>이 날의 자산</small><div>${money(snap.v)}</div></div>` : ''}
    <h3>일정</h3>
    <ul id="day-events" class="list tight">${evs.length ? evs.map((e) => eventItem(e)).join('') : emptyLi('일정이 없습니다')}</ul>`;
  if (!$('#ev-id').value) $('#ev-date').value = d;
}

function renderTimeline() {
  const q = ui.q.trim().toLowerCase();
  let days = recordDates({ future: !!q || ui.qType === 'event' }).map((d) => ({ d, log: state.logs[d] || {}, evs: eventsOn(d) }));
  if (ui.qType === 'journal') days = days.filter((x) => x.log.note || x.log.grateful);
  if (ui.qType === 'event') days = days.filter((x) => x.evs.length);
  const texts = (x) => [x.log.note, x.log.grateful, ...x.evs.flatMap((e) => [e.title, e.memo])].filter(Boolean);
  if (q) days = days.filter((x) => texts(x).some((t) => t.toLowerCase().includes(q)));
  $('#tl-title').textContent = q ? `‘${ui.q.trim()}’ 검색 결과` : '지난 기록';
  $('#tl-count').textContent = days.length ? `${days.length}일` : '';
  const shown = days.slice(0, ui.tlPage * 15);
  $('#timeline').innerHTML = shown.length ? shown.map((x) => {
    const dt = parseYmd(x.d);
    const done = state.habits.filter((h) => isChecked(x.d, h.id)).length;
    const facts = [
      x.log.sleep != null && `수면 ${fmtMetric('sleep', x.log.sleep)}`,
      x.log.steps != null && `${fmtMetric('steps', x.log.steps)}`,
      x.log.exercise ? `운동 ${fmtMetric('exercise', x.log.exercise)}` : '',
      x.log.kcal != null && `섭취 ${fmtMetric('kcal', x.log.kcal)}`,
      state.habits.length && done ? `습관 ${done}/${state.habits.length}` : '',
      x.evs.length ? `일정 ${x.evs.length}` : '',
    ].filter(Boolean).join(' · ');
    const hit = q ? texts(x).find((t) => t.toLowerCase().includes(q)) : x.log.note || x.log.grateful || x.evs.map((e) => e.title).join(', ');
    return `<li><button class="tl-item ${x.d === selectedDate ? 'on' : ''}" data-day="${x.d}">
      <span class="tl-date"><strong>${dt.getMonth() + 1}.${dt.getDate()}</strong><small>${WEEK[dt.getDay()]}${dt.getFullYear() !== new Date().getFullYear() ? ' · ' + dt.getFullYear() : ''}</small></span>
      <span class="tl-mood">${x.log.mood ? MOOD_EMOJI[x.log.mood] : '·'}</span>
      <span class="grow"><span class="tl-facts">${esc(facts) || '&nbsp;'}</span>${hit ? `<span class="tl-text">${esc(snippet(hit, 90))}</span>` : ''}</span></button></li>`;
  }).join('') : `<li class="empty">${q ? '검색 결과가 없어요' : '아직 기록이 없어요. ‘기록하기’로 오늘을 남겨보세요'}</li>`;
  $('#tl-more').hidden = shown.length >= days.length;
}

function gotoDay(d) {
  selectedDate = d;
  const dt = parseYmd(d);
  calCursor = new Date(dt.getFullYear(), dt.getMonth(), 1);
  resetEventForm();
  if (document.querySelector('#view-records.active')) { renderRecords(); window.scrollTo({ top: 0, behavior: 'smooth' }); } else showView('records');
}

function exportCsv() {
  const dates = recordDates({ future: true }).reverse();
  if (!dates.length) { toast('내보낼 기록이 없어요'); return; }
  const snaps = Object.fromEntries(snapshotSeries(100000).map((s) => [s.date, s.v]));
  const safe = (t) => (/^[=+\-@]/.test(t) ? "'" + t : t); // 스프레드시트 수식으로 해석되지 않게
  const cell = (v) => { v = v == null ? '' : String(v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const rows = [['날짜', '기분', '에너지', '수면(시간)', '걸음', '운동(분)', '체중(kg)', '섭취(kcal)', '탄수화물(g)', '단백질(g)', '지방(g)', '습관', '감사한 일', '일기', '일정', '자산']];
  for (const d of dates) {
    const l = state.logs[d] || {};
    rows.push([d, l.mood, l.energy, l.sleep, l.steps, l.exercise, l.weight, l.kcal, l.carb, l.protein, l.fat,
      safe(state.habits.filter((h) => isChecked(d, h.id)).map((h) => h.name).join(' / ')),
      safe(l.grateful || ''), safe(l.note || ''), safe(eventsOn(d).map((e) => e.title).join(' / ')), snaps[d] ?? '']);
  }
  const blob = new Blob(['﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `my-life-records-${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`${dates.length}일치 기록을 내보냈습니다`);
}

/* =========================================================
 * 분석: 추세 · 요일 패턴 · 발견 · 습관 · 주간 리뷰
 * ========================================================= */
function renderInsights() {
  const k = ui.metric, m = METRICS[k], n = ui.range, today = todayStr();
  document.querySelectorAll('#an-metric button').forEach((b) => b.classList.toggle('on', b.dataset.metric === k));
  document.querySelectorAll('#an-range button').forEach((b) => b.classList.toggle('on', +b.dataset.range === n));

  const pts = series(k, n), vals = pts.filter((p) => p.v != null);
  const hi = vals.length ? vals.reduce((a, b) => (b.v > a.v ? b : a)) : null, lo = vals.length ? vals.reduce((a, b) => (b.v < a.v ? b : a)) : null;
  const tile = (label, value, sub = '') => `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  $('#an-stats').innerHTML = [
    tile(`${n === 365 ? '1년' : n + '일'} 평균`, fmtMetric(k, mean(vals.map((p) => p.v)))),
    tile('최고', hi ? fmtMetric(k, hi.v) : '–', hi ? md(hi.date) : ''),
    tile('최저', lo ? fmtMetric(k, lo.v) : '–', lo ? md(lo.date) : ''),
    tile('기록한 날', `${vals.length}일`, `${n}일 중`),
  ].join('');
  lineChart($('#an-chart'), n === 365 ? weekly(pts.slice(1)) : pts, {
    min: m.min, max: m.max, color: METRIC_COLOR[k], fmt: (v) => fmtMetric(k, v, false),
    empty: `${m.label} 기록이 아직 없어요. ‘기록하기’로 남기면 추세가 그려져요`,
  });

  const byDow = Array.from({ length: 7 }, () => []);
  for (const p of vals) byDow[parseYmd(p.date).getDay()].push(p.v);
  barChart($('#an-weekday'), [1, 2, 3, 4, 5, 6, 0].map((i) => ({ label: WEEK[i], v: mean(byDow[i]) })), { fmt: (v) => fmtMetric(k, v, false), lo: m.min ?? 0, hi: m.max });

  insightList($('#an-insights'), 8);

  $('#an-habits').innerHTML = state.habits.length ? state.habits.map((h) => {
    const r = habitRate30(h), w = habitThisWeek(h), t = h.target || 7, st = streakOf(h.id);
    return `<li class="col"><div class="goal-top"><strong class="grow">${esc(h.icon || '')} ${esc(h.name)}</strong>
        <span class="sub">이번 주 ${w}/${t}${st > 1 ? ` · 연속 ${st}일` : ''}</span></div>
      <div class="progress ok"><div style="width:${r ?? 0}%"></div></div>
      <div class="sub">${r == null ? '아직 체크한 적이 없어요' : `30일 달성률 ${Math.round(r)}% (${t === 7 ? '매일' : '주 ' + t + '회'} 기준)`}</div></li>`;
  }).join('') : emptyLi('습관을 추가하면 달성률이 여기에 쌓여요');

  // 주간 리뷰
  ui.week ||= mondayOf(today);
  const w = weekStats(ui.week);
  $('#wk-title').textContent = `${md(w.days[0])} – ${md(w.days[6])}`;
  $('#wk-next').disabled = ui.week >= mondayOf(today);
  $('#wk-stats').innerHTML = [
    tile('기분', fmtMetric('mood', w.mood)), tile('수면', fmtMetric('sleep', w.sleep)), tile('걸음', fmtMetric('steps', w.steps)),
    tile('운동', w.exercise ? `${w.exercise}분` : '–'), tile('습관', fmtMetric('habit', w.habit)),
    tile('일정', w.evTotal ? `${w.evDone}/${w.evTotal}` : '–'), tile('기록한 날', `${w.logged}/7`),
    tile('가장 좋았던 날', w.best ? `${MOOD_EMOJI[w.best.v]} ${WEEK[parseYmd(w.best.d).getDay()]}요일` : '–'),
  ].join('');
  if (document.activeElement !== $('#wk-note')) $('#wk-note').value = state.reviews[ui.week]?.note || '';
}

/* =========================================================
 * 자산: 쌓인 스냅샷 추이 · 비중
 * ========================================================= */
function renderAssets() {
  recordSnapshot();
  const pts = snapshotSeries(180);
  $('#asset-trend-note').textContent = pts.length > 1 ? `${pts.length}일치` : '';
  lineChart($('#asset-trend'), pts, { fmt: moneyShort, empty: '보유 종목이 생기면 평가금액이 매일 한 줄씩 쌓여요' });
  let items = computeHoldings().holdings.map((h) => ({ label: h.symbol, value: h.value }));
  if (items.length > 8) items = [...items.slice(0, 7), { label: '기타', value: items.slice(7).reduce((s, i) => s + i.value, 0) }];
  drawPie($('#asset-pie'), items);
  const total = items.reduce((s, i) => s + i.value, 0);
  $('#asset-legend').innerHTML = items.map((it, i) =>
    `<span><span class="dot" style="background:${PIE_COLORS[i % PIE_COLORS.length]}"></span>${esc(it.label)} ${((it.value / total) * 100).toFixed(1)}%</span>`).join('');
}

/* =========================================================
 * 나: 데이터로 본 나 · 목표 · 습관
 * ========================================================= */
function renderMeData() {
  const m = mePatterns();
  const tile = (label, value, sub = '') => `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  $('#me-data').innerHTML = [
    tile('기록한 날', `${m.total}일`, m.since ? `${m.since}부터` : '오늘 시작해 보세요'),
    tile('가장 긴 연속 기록', m.longest ? `${m.longest}일` : '–'),
    tile('가장 꾸준한 습관', m.bestHabit ? `${esc(m.bestHabit.h.icon || '')} ${esc(m.bestHabit.h.name)}` : '–', m.bestHabit ? `30일 달성률 ${Math.round(m.bestHabit.r)}%` : ''),
    tile('컨디션 좋은 요일', m.bestDow ? `${WEEK[m.bestDow.i]}요일` : '–', m.bestDow ? `평균 기분 ${m.bestDow.avg.toFixed(1)}` : '기록이 더 필요해요'),
    tile('평균 수면 (30일)', fmtMetric('sleep', m.sleep)),
    tile('평균 기분 (30일)', m.mood != null ? `${MOOD_EMOJI[Math.round(m.mood)]} ${m.mood.toFixed(1)}` : '–'),
  ].join('');
}

function renderGoals() {
  $('#goal-list').innerHTML = state.goals.length ? state.goals.map((g) => goalRow(g, true)).join('') : emptyLi('목표를 세워보세요');
  const sel = $('#gl-link'), keep = sel.value;
  sel.innerHTML = '<option value="">직접 입력</option>' + state.habits.map((h) => `<option value="${esc(h.id)}">습관 연결: ${esc(h.name)}</option>`).join('');
  sel.value = state.habits.some((h) => h.id === keep) ? keep : '';
  $('#gl-target-wrap').hidden = !sel.value;
}
function renderHabitDefs() {
  $('#habit-defs').innerHTML = state.habits.length ? state.habits.map((h) => `<li data-hid="${esc(h.id)}">
    <span class="h-ico">${esc(h.icon || '•')}</span><span class="grow">${esc(h.name)}</span>
    <select class="auto hb-target-sel" aria-label="주간 목표">${[7, 6, 5, 4, 3, 2, 1].map((n) => `<option value="${n}" ${(h.target || 7) === n ? 'selected' : ''}>${n === 7 ? '매일' : '주 ' + n + '회'}</option>`).join('')}</select>
    <button class="icon-btn hb-del" title="삭제">${ico('trash')}</button></li>`).join('') : emptyLi('습관을 추가해 보세요 (예: 🏃 아침 러닝)');
}

$('#goal-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const title = $('#gl-title').value.trim(), link = $('#gl-link').value, target = parseInt($('#gl-target').value, 10);
  if (!title) return;
  if (link && !(target > 0)) { toast('목표 횟수를 입력하세요'); $('#gl-target').focus(); return; }
  state.goals.push({ id: uid(), title, area: $('#gl-area').value, due: $('#gl-due').value, progress: 0, linkHabit: link, linkTarget: link ? target : 0, since: todayStr() });
  save(); ev.target.reset(); renderGoals();
});
$('#gl-link').addEventListener('change', () => { $('#gl-target-wrap').hidden = !$('#gl-link').value; });
$('#goal-list').addEventListener('input', (ev) => {
  if (!ev.target.classList.contains('goal-range')) return;
  const li = ev.target.closest('li'), g = state.goals.find((x) => x.id === li.dataset.gid);
  g.progress = +ev.target.value;
  li.querySelector('.goal-pct').textContent = li.querySelector('.goal-pct').textContent.replace(/\d+%$/, g.progress + '%');
  save();
});
$('#goal-list').addEventListener('click', (ev) => {
  if (!ev.target.classList.contains('gl-del')) return;
  const id = ev.target.closest('li').dataset.gid;
  if (confirm('이 목표를 삭제할까요?')) { state.goals = state.goals.filter((g) => g.id !== id); save(); renderGoals(); }
});
$('#habit-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const name = $('#hb-name').value.trim();
  if (!name) return;
  state.habits.push({ id: uid(), name, icon: $('#hb-icon').value.trim(), target: +$('#hb-target').value || 7 });
  save(); ev.target.reset(); render();
});
$('#habit-defs').addEventListener('change', (ev) => {
  if (!ev.target.classList.contains('hb-target-sel')) return;
  state.habits.find((h) => h.id === ev.target.closest('li').dataset.hid).target = +ev.target.value;
  save();
});
$('#habit-defs').addEventListener('click', (ev) => {
  if (!ev.target.classList.contains('hb-del')) return;
  const id = ev.target.closest('li').dataset.hid, h = state.habits.find((x) => x.id === id);
  if (!h || !confirm(`‘${h.name}’ 습관을 삭제할까요? 지금까지의 체크 기록도 함께 삭제됩니다.`)) return;
  state.habits = state.habits.filter((x) => x.id !== id);
  for (const d of Object.keys(state.habitChecks)) {
    const left = state.habitChecks[d].filter((x) => x !== id);
    if (left.length) state.habitChecks[d] = left; else delete state.habitChecks[d];
  }
  for (const g of state.goals) if (g.linkHabit === id) { g.progress = goalProgress({ ...g, linkHabit: '' }).pct; g.linkHabit = ''; }
  save(); render();
});

/* =========================================================
 * 빠른 기록 창: 기분 한 번 탭이면 저장
 * ========================================================= */
function openSheet(date) {
  ui.sheetDate = date && date <= todayStr() ? date : todayStr();
  $('#sheet').hidden = false;
  document.body.classList.add('sheet-open');
  $('#ck-saved').textContent = '';
  renderSheet(true);
}
function closeSheet() {
  if ($('#sheet').hidden) return;
  if ($('#sheet').contains(document.activeElement)) document.activeElement.blur(); // 입력 중이던 값 저장
  $('#sheet').hidden = true;
  document.body.classList.remove('sheet-open');
  render();
}
function renderSheet(force = false) {
  const d = ui.sheetDate, log = state.logs[d] || {};
  $('#ck-date').value = d;
  $('#ck-date').max = todayStr();
  $('#sheet-title').textContent = d === todayStr() ? '오늘 기록' : `${fmtDate(d)} 기록`;
  $('#ck-mood').dataset.date = d;
  $('#ck-mood').innerHTML = moodButtons(log.mood);
  $('#ck-energy').dataset.date = d;
  $('#ck-energy').innerHTML = levelButtons(log.energy);
  $('#ck-habits-wrap').hidden = !state.habits.length;
  $('#ck-habits').innerHTML = habitChips(d);
  document.querySelectorAll('#sheet [data-field]').forEach((el) => { if (force || document.activeElement !== el) el.value = log[el.dataset.field] ?? ''; });
}
const markSaved = () => { $('#ck-saved').textContent = '저장됨'; };

$('#sheet').addEventListener('change', (ev) => {
  const f = ev.target.dataset.field;
  if (ev.target.id === 'ck-date') {
    if (ev.target.value && ev.target.value <= todayStr()) { ui.sheetDate = ev.target.value; $('#ck-saved').textContent = ''; }
    renderSheet(true);
    return;
  }
  if (!f) return;
  const raw = ev.target.value.trim();
  const numeric = ev.target.type === 'number';
  const v = raw === '' ? null : numeric ? parseFloat(raw) : raw;
  if (numeric && v != null && (Number.isNaN(v) || v < 0 || (f === 'sleep' && v > 24))) { toast('값을 확인해 주세요'); return; }
  setLog(ui.sheetDate, f, v);
  markSaved();
});

/* =========================================================
 * 공통 클릭 처리
 * ========================================================= */
document.addEventListener('click', (ev) => {
  const t = ev.target;
  const pick = (sel) => t.closest(sel);
  let el;
  if ((el = pick('[data-close-sheet]'))) return closeSheet();
  if ((el = pick('[data-checkin]'))) return openSheet(el.dataset.checkin);
  if ((el = pick('.mood-btn'))) {
    const date = el.closest('[data-date]').dataset.date, n = +el.dataset.mood;
    setLog(date, 'mood', state.logs[date]?.mood === n ? null : n);
    if ($('#sheet').hidden) toast(state.logs[date]?.mood ? '기분을 기록했어요' : '기분 기록을 지웠어요'); else markSaved();
    return render();
  }
  if ((el = pick('.level-btn'))) {
    const date = el.closest('[data-date]').dataset.date, n = +el.dataset.level;
    setLog(date, 'energy', state.logs[date]?.energy === n ? null : n);
    markSaved();
    return render();
  }
  if ((el = pick('.hchip'))) { toggleHabit(el.dataset.date, el.dataset.hid); if (!$('#sheet').hidden) markSaved(); return render(); }
  if ((el = pick('[data-day]'))) return gotoDay(el.dataset.day);
  if ((el = pick('.metric'))) { ui.metric = el.dataset.metric; ui.range = ui.homeDays === 7 ? 30 : ui.homeDays; return showView('insights'); }
  if ((el = pick('#home-period button'))) { ui.homeDays = +el.dataset.days; return render(); }
  if ((el = pick('#home-heatmode button'))) { ui.heat = el.dataset.heat; return render(); }
  if ((el = pick('#an-metric button'))) { ui.metric = el.dataset.metric; return render(); }
  if ((el = pick('#an-range button'))) { ui.range = +el.dataset.range; return render(); }
  if ((el = pick('#me-tabs button'))) { ui.meTab = el.dataset.pane; return render(); }
  if (pick('#wk-prev')) { ui.week = addDays(ui.week, -7); return render(); }
  if (pick('#wk-next')) { ui.week = addDays(ui.week, 7); return render(); }
  if (pick('#tl-more')) { ui.tlPage++; return renderTimeline(); }
  if (pick('#rec-export')) return exportCsv();
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeSheet(); });
$('#rec-q').addEventListener('input', (ev) => { ui.q = ev.target.value; ui.tlPage = 1; renderTimeline(); });
$('#rec-type').addEventListener('change', (ev) => { ui.qType = ev.target.value; ui.tlPage = 1; renderTimeline(); });
$('#wk-note').addEventListener('input', (ev) => {
  const note = ev.target.value;
  if (note.trim()) state.reviews[ui.week] = { note }; else delete state.reviews[ui.week];
  save();
});

let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 150); });
window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (v && !document.querySelector(`#view-${VIEW_ALIAS[v] || v}.active`)) showView(v); });

showView(location.hash.slice(1) || 'dashboard');
