'use strict';

/* =========================================================
 * 저장소 (localStorage)
 * ========================================================= */
const STORAGE_KEY = 'myPlanner.v1';
const defaultState = () => ({
  events: [],        // {id, title, date, start, end, cat, memo, done}
  trades: [],        // {id, symbol, type, qty, price, date, memo}
  prices: {},        // symbol -> 현재가
  targets: {},       // symbol -> 목표가
  watchlist: [],     // {id, symbol}
  settings: { currency: 'KRW' },
});

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) {
    console.warn('저장된 데이터를 읽지 못했습니다.', e);
    return defaultState();
  }
}
let state = loadState();
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('저장에 실패했습니다: ' + e.message);
  }
}

/* =========================================================
 * 유틸
 * ========================================================= */
const $ = (sel) => document.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const CAT_LABEL = { work: '업무', personal: '개인', finance: '투자/금융', etc: '기타' };
const CAT_COLOR = { work: 'var(--c-work)', personal: 'var(--c-personal)', finance: 'var(--c-finance)', etc: 'var(--c-etc)' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function money(n) {
  if (!isFinite(n)) return '-';
  const usd = state.settings.currency === 'USD';
  const v = usd ? n.toLocaleString('en-US', { maximumFractionDigits: 2 })
                : Math.round(n).toLocaleString('ko-KR');
  return usd ? `$${v}` : `${v}원`;
}
const signed = (n) => (n > 0 ? '+' : '') + money(n);
const pct = (n) => (isFinite(n) ? (n > 0 ? '+' : '') + n.toFixed(2) + '%' : '-');
const cls = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
const fmtDate = (s) => { const d = parseYmd(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`; };
const timeRange = (e) => (e.start ? e.start + (e.end ? '~' + e.end : '') : '종일');

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2200);
}

/* =========================================================
 * 탭 전환
 * ========================================================= */
function showView(name) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  location.hash = name;
  render();
}
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

/* =========================================================
 * 일정
 * ========================================================= */
let calCursor = new Date(); calCursor.setDate(1);
let selectedDate = todayStr();

const sortEvents = (a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || ''));
const eventsOn = (date) => state.events.filter((e) => e.date === date).sort(sortEvents);

function renderCalendar() {
  const y = calCursor.getFullYear(), m = calCursor.getMonth();
  $('#cal-title').textContent = `${y}년 ${m + 1}월`;
  const first = new Date(y, m, 1);
  const start = new Date(y, m, 1 - first.getDay());
  const today = todayStr();
  const grid = $('#cal-grid');
  grid.innerHTML = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    if (i === 35 && d.getMonth() !== m) break; // 6번째 주가 필요 없으면 생략
    const ds = ymd(d);
    const evs = eventsOn(ds);
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-cell' + (d.getMonth() !== m ? ' other' : '') + (ds === today ? ' today' : '') + (ds === selectedDate ? ' selected' : '');
    cell.innerHTML = `<span class="num">${d.getDate()}</span>` +
      evs.slice(0, 3).map((e) => `<span class="chip" style="background:${CAT_COLOR[e.cat] || CAT_COLOR.etc}">${esc(e.title)}</span>`).join('') +
      (evs.length > 3 ? `<span class="more">+${evs.length - 3}</span>` : '');
    cell.addEventListener('click', () => { selectedDate = ds; resetEventForm(); renderSchedule(); });
    grid.appendChild(cell);
  }
}

function eventItem(e, { showDate = false, editable = true } = {}) {
  return `<li class="${e.done ? 'done' : ''}" data-id="${e.id}">
    <input type="checkbox" class="ev-toggle" ${e.done ? 'checked' : ''} title="완료" />
    <span class="dot cat-${esc(e.cat)}"></span>
    <div class="grow">
      <div class="ev-name">${esc(e.title)}</div>
      <div class="sub">${showDate ? fmtDate(e.date) + ' · ' : ''}${timeRange(e)} · ${CAT_LABEL[e.cat] || '기타'}${e.memo ? ' · ' + esc(e.memo) : ''}</div>
    </div>
    ${editable ? '<button class="icon-btn ev-edit" title="수정">✏️</button><button class="icon-btn ev-del" title="삭제">🗑️</button>' : ''}
  </li>`;
}

function renderDayPanel() {
  $('#day-title').textContent = fmtDate(selectedDate);
  const evs = eventsOn(selectedDate);
  $('#day-events').innerHTML = evs.length ? evs.map((e) => eventItem(e)).join('') : '<li class="empty">일정이 없습니다</li>';
  if (!$('#ev-id').value) $('#ev-date').value = selectedDate;
}

function renderSchedule() { renderCalendar(); renderDayPanel(); }

function resetEventForm() {
  $('#event-form').reset();
  $('#ev-id').value = '';
  $('#ev-date').value = selectedDate;
  $('#event-form-title').textContent = '일정 추가';
}

$('#event-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const id = $('#ev-id').value;
  const data = {
    title: $('#ev-title').value.trim(),
    date: $('#ev-date').value,
    start: $('#ev-start').value,
    end: $('#ev-end').value,
    cat: $('#ev-cat').value,
    memo: $('#ev-memo').value.trim(),
    done: $('#ev-done').checked,
  };
  if (!data.title || !data.date) return;
  if (data.start && data.end && data.end < data.start) { toast('종료 시간이 시작보다 빠릅니다'); return; }
  if (id) {
    Object.assign(state.events.find((e) => e.id === id), data);
    toast('일정을 수정했습니다');
  } else {
    state.events.push({ id: uid(), ...data });
    toast('일정을 추가했습니다');
  }
  save();
  selectedDate = data.date;
  const d = parseYmd(data.date); calCursor = new Date(d.getFullYear(), d.getMonth(), 1);
  resetEventForm();
  render();
});
$('#ev-cancel').addEventListener('click', resetEventForm);

// 일정 목록 (오늘/다가오는/선택일) 공통 이벤트 위임
document.addEventListener('click', (ev) => {
  const li = ev.target.closest('li[data-id]');
  if (!li) return;
  const e = state.events.find((x) => x.id === li.dataset.id);
  if (!e) return;
  if (ev.target.classList.contains('ev-toggle')) {
    e.done = ev.target.checked; save(); render();
  } else if (ev.target.classList.contains('ev-del')) {
    if (confirm(`'${e.title}' 일정을 삭제할까요?`)) {
      state.events = state.events.filter((x) => x.id !== e.id); save(); resetEventForm(); render();
    }
  } else if (ev.target.classList.contains('ev-edit')) {
    $('#ev-id').value = e.id;
    $('#ev-title').value = e.title;
    $('#ev-date').value = e.date;
    $('#ev-start').value = e.start || '';
    $('#ev-end').value = e.end || '';
    $('#ev-cat').value = e.cat;
    $('#ev-memo').value = e.memo || '';
    $('#ev-done').checked = !!e.done;
    $('#event-form-title').textContent = '일정 수정';
    $('#ev-title').focus();
  }
});

$('#cal-prev').addEventListener('click', () => { calCursor.setMonth(calCursor.getMonth() - 1); renderCalendar(); });
$('#cal-next').addEventListener('click', () => { calCursor.setMonth(calCursor.getMonth() + 1); renderCalendar(); });
$('#cal-today').addEventListener('click', () => {
  calCursor = new Date(); calCursor.setDate(1); selectedDate = todayStr(); resetEventForm(); renderSchedule();
});

/* =========================================================
 * 주식
 * ========================================================= */

// 매매 기록으로부터 보유 현황 계산 (이동평균 단가법)
function computeHoldings() {
  const map = {};
  let realized = 0;
  const sorted = [...state.trades].sort((a, b) => a.date.localeCompare(b.date));
  for (const t of sorted) {
    const h = (map[t.symbol] ||= { symbol: t.symbol, qty: 0, cost: 0 });
    if (t.type === 'buy') {
      h.qty += t.qty; h.cost += t.qty * t.price;
    } else {
      const sellQty = Math.min(t.qty, h.qty);
      const avg = h.qty ? h.cost / h.qty : 0;
      realized += sellQty * (t.price - avg);
      h.cost -= avg * sellQty; h.qty -= sellQty;
    }
  }
  const holdings = Object.values(map)
    .filter((h) => h.qty > 1e-9)
    .map((h) => {
      const avg = h.cost / h.qty;
      const price = state.prices[h.symbol] ?? avg;
      const value = price * h.qty;
      const pnl = value - h.cost;
      return { ...h, avg, price, value, pnl, rate: h.cost ? (pnl / h.cost) * 100 : 0, target: state.targets[h.symbol] };
    })
    .sort((a, b) => b.value - a.value);
  const cost = holdings.reduce((s, h) => s + h.cost, 0);
  const value = holdings.reduce((s, h) => s + h.value, 0);
  return { holdings, cost, value, pnl: value - cost, rate: cost ? ((value - cost) / cost) * 100 : 0, realized };
}

function statsHtml(p) {
  return `
    <div class="stat"><div class="label">총 매입금액</div><div class="value">${money(p.cost)}</div></div>
    <div class="stat"><div class="label">총 평가금액</div><div class="value">${money(p.value)}</div></div>
    <div class="stat"><div class="label">평가손익</div><div class="value ${cls(p.pnl)}">${signed(p.pnl)}</div></div>
    <div class="stat"><div class="label">수익률</div><div class="value ${cls(p.rate)}">${pct(p.rate)}</div></div>
    <div class="stat"><div class="label">실현손익</div><div class="value ${cls(p.realized)}">${signed(p.realized)}</div></div>`;
}

function renderStocks() {
  const p = computeHoldings();
  $('#pf-stats').innerHTML = statsHtml(p);

  $('#holdings-body').innerHTML = p.holdings.length ? p.holdings.map((h) => `
    <tr data-sym="${esc(h.symbol)}">
      <td><strong>${esc(h.symbol)}</strong>${h.target && h.price >= h.target ? '<span class="badge hit">목표 도달</span>' : ''}</td>
      <td>${h.qty.toLocaleString()}</td>
      <td>${money(h.avg)}</td>
      <td><input class="inline price-input" type="number" step="any" min="0" value="${+h.price.toFixed(4)}" /></td>
      <td>${money(h.value)}</td>
      <td class="${cls(h.pnl)}">${signed(h.pnl)}</td>
      <td class="${cls(h.rate)}">${pct(h.rate)}</td>
      <td><input class="inline target-input" type="number" step="any" min="0" value="${h.target ?? ''}" placeholder="-" /></td>
      <td><button class="icon-btn quick-sell" title="전량 매도 기록">매도</button></td>
    </tr>`).join('') : '<tr><td colspan="9" class="empty">보유 종목이 없습니다. 아래에서 매수 기록을 추가해 보세요.</td></tr>';

  const trades = [...state.trades].sort((a, b) => b.date.localeCompare(a.date));
  $('#trades-body').innerHTML = trades.length ? trades.map((t) => `
    <tr data-id="${t.id}">
      <td>${t.date}</td><td>${esc(t.symbol)}</td>
      <td class="${t.type === 'buy' ? 'up' : 'down'}">${t.type === 'buy' ? '매수' : '매도'}</td>
      <td>${t.qty.toLocaleString()}</td><td>${money(t.price)}</td><td>${money(t.qty * t.price)}</td>
      <td>${esc(t.memo || '')}</td>
      <td><button class="icon-btn trade-del" title="삭제">🗑️</button></td>
    </tr>`).join('') : '<tr><td colspan="8" class="empty">매매 기록이 없습니다</td></tr>';

  const symbols = new Set([...state.trades.map((t) => t.symbol), ...state.watchlist.map((w) => w.symbol)]);
  $('#symbol-list').innerHTML = [...symbols].map((s) => `<option value="${esc(s)}">`).join('');

  $('#watch-list').innerHTML = state.watchlist.length ? state.watchlist.map((w) => {
    const price = state.prices[w.symbol], target = state.targets[w.symbol];
    const gap = price && target ? ((target - price) / price) * 100 : NaN;
    return `<li data-wid="${w.id}">
      <div class="grow"><div><strong>${esc(w.symbol)}</strong>
        ${price != null && target && price >= target ? '<span class="badge hit">목표 도달</span>' : ''}</div>
        <div class="sub">현재가 ${price != null ? money(price) : '-'} · 목표가 ${target ? money(target) : '-'}${isFinite(gap) ? ` (목표까지 ${pct(gap)})` : ''}</div>
      </div>
      <button class="icon-btn w-edit" title="가격 수정">✏️</button>
      <button class="icon-btn w-del" title="삭제">🗑️</button>
    </li>`;
  }).join('') : '<li class="empty">관심 종목이 없습니다</li>';
}

$('#trade-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const t = {
    id: uid(),
    symbol: $('#tr-symbol').value.trim(),
    type: $('#tr-type').value,
    qty: parseFloat($('#tr-qty').value),
    price: parseFloat($('#tr-price').value),
    date: $('#tr-date').value,
    memo: $('#tr-memo').value.trim(),
  };
  if (!t.symbol || !(t.qty > 0) || !(t.price >= 0) || !t.date) { toast('입력값을 확인하세요'); return; }
  if (t.type === 'sell') {
    const h = computeHoldings().holdings.find((x) => x.symbol === t.symbol);
    if (!h || h.qty < t.qty - 1e-9) { toast(`보유 수량(${h ? h.qty : 0})보다 많이 매도할 수 없습니다`); return; }
  }
  state.trades.push(t);
  if (state.prices[t.symbol] == null) state.prices[t.symbol] = t.price;
  save();
  ev.target.reset();
  $('#tr-date').value = todayStr();
  toast(`${t.symbol} ${t.type === 'buy' ? '매수' : '매도'} 기록 완료`);
  render();
});

$('#holdings-body').addEventListener('change', (ev) => {
  const sym = ev.target.closest('tr')?.dataset.sym;
  if (!sym) return;
  const v = ev.target.value === '' ? null : parseFloat(ev.target.value);
  if (ev.target.classList.contains('price-input') && v != null && v >= 0) state.prices[sym] = v;
  if (ev.target.classList.contains('target-input')) {
    if (v && v > 0) state.targets[sym] = v; else delete state.targets[sym];
  }
  save(); render();
});
$('#holdings-body').addEventListener('click', (ev) => {
  if (!ev.target.classList.contains('quick-sell')) return;
  const sym = ev.target.closest('tr').dataset.sym;
  const h = computeHoldings().holdings.find((x) => x.symbol === sym);
  if (!h || !confirm(`${sym} ${h.qty}주를 현재가 ${money(h.price)}에 전량 매도 기록할까요?`)) return;
  state.trades.push({ id: uid(), symbol: sym, type: 'sell', qty: h.qty, price: h.price, date: todayStr(), memo: '전량 매도' });
  save(); render();
});
$('#trades-body').addEventListener('click', (ev) => {
  if (!ev.target.classList.contains('trade-del')) return;
  const id = ev.target.closest('tr').dataset.id;
  if (confirm('이 매매 기록을 삭제할까요?')) {
    state.trades = state.trades.filter((t) => t.id !== id); save(); render();
  }
});
$('#refresh-prices').addEventListener('click', () => {
  const { holdings } = computeHoldings();
  if (!holdings.length) { toast('보유 종목이 없습니다'); return; }
  for (const h of holdings) {
    const v = prompt(`${h.symbol} 현재가 (취소하면 건너뜀)`, h.price);
    if (v === null) continue;
    const n = parseFloat(v);
    if (n >= 0) state.prices[h.symbol] = n;
  }
  save(); render();
});

$('#watch-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const symbol = $('#w-symbol').value.trim();
  if (!symbol) return;
  if (state.watchlist.some((w) => w.symbol === symbol)) { toast('이미 등록된 종목입니다'); return; }
  const target = parseFloat($('#w-target').value), price = parseFloat($('#w-price').value);
  state.watchlist.push({ id: uid(), symbol });
  if (target > 0) state.targets[symbol] = target;
  if (price >= 0) state.prices[symbol] = price;
  save(); ev.target.reset(); render();
});
$('#watch-list').addEventListener('click', (ev) => {
  const li = ev.target.closest('li[data-wid]');
  if (!li) return;
  const w = state.watchlist.find((x) => x.id === li.dataset.wid);
  if (ev.target.classList.contains('w-del')) {
    state.watchlist = state.watchlist.filter((x) => x.id !== w.id); save(); render();
  } else if (ev.target.classList.contains('w-edit')) {
    const p = prompt(`${w.symbol} 현재가`, state.prices[w.symbol] ?? '');
    if (p !== null && p !== '' && parseFloat(p) >= 0) state.prices[w.symbol] = parseFloat(p);
    const t = prompt(`${w.symbol} 목표가 (비우면 삭제)`, state.targets[w.symbol] ?? '');
    if (t !== null) { if (parseFloat(t) > 0) state.targets[w.symbol] = parseFloat(t); else delete state.targets[w.symbol]; }
    save(); render();
  }
});

/* =========================================================
 * 대시보드
 * ========================================================= */
const PIE_COLORS = ['#3b6ef5', '#2fa36b', '#e08a1e', '#8a63d2', '#d93a3a', '#1fa3b8', '#c2549b', '#7a8599'];

function drawPie(canvas, items) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = 260;
  canvas.width = size * dpr; canvas.height = size * dpr;
  canvas.style.width = size + 'px'; canvas.style.height = size + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const total = items.reduce((s, i) => s + i.value, 0);
  const cx = size / 2, cy = size / 2, r = 110;
  if (!total) {
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--muted');
    ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('보유 종목 없음', cx, cy);
    return;
  }
  let a = -Math.PI / 2;
  items.forEach((it, i) => {
    const slice = (it.value / total) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a, a + slice); ctx.closePath();
    ctx.fillStyle = PIE_COLORS[i % PIE_COLORS.length]; ctx.fill();
    a += slice;
  });
  // 도넛 구멍
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

function renderDashboard() {
  const today = todayStr();
  $('#dash-today').textContent = fmtDate(today);
  const todays = eventsOn(today);
  $('#dash-events').innerHTML = todays.length ? todays.map((e) => eventItem(e, { editable: false })).join('') : '<li class="empty">오늘 일정이 없습니다</li>';

  const end = new Date(); end.setDate(end.getDate() + 7);
  const endStr = ymd(end);
  const upcoming = state.events.filter((e) => e.date > today && e.date <= endStr).sort(sortEvents);
  $('#dash-upcoming').innerHTML = upcoming.length ? upcoming.map((e) => eventItem(e, { showDate: true, editable: false })).join('') : '<li class="empty">예정된 일정이 없습니다</li>';

  const p = computeHoldings();
  $('#dash-stats').innerHTML = statsHtml(p);
  // 상위 7개 + 기타로 묶기
  let items = p.holdings.map((h) => ({ label: h.symbol, value: h.value }));
  if (items.length > 8) {
    const rest = items.slice(7).reduce((s, i) => s + i.value, 0);
    items = [...items.slice(0, 7), { label: '기타', value: rest }];
  }
  drawPie($('#dash-pie'), items);
  const total = items.reduce((s, i) => s + i.value, 0);
  $('#dash-legend').innerHTML = items.map((it, i) =>
    `<span><span class="dot" style="background:${PIE_COLORS[i % PIE_COLORS.length]}"></span>${esc(it.label)} ${((it.value / total) * 100).toFixed(1)}%</span>`).join('');
}

/* =========================================================
 * 설정 / 백업
 * ========================================================= */
$('#settings-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  state.settings.currency = $('#set-currency').value;
  save(); toast('설정을 저장했습니다'); render();
});
$('#export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `my-planner-backup-${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$('#import-file').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.events) || !Array.isArray(data.trades)) throw new Error('형식이 올바르지 않습니다');
    if (!confirm('현재 데이터를 백업 파일로 덮어쓸까요?')) return;
    state = Object.assign(defaultState(), data);
    save(); toast('가져오기 완료'); render();
  } catch (e) {
    toast('가져오기 실패: ' + e.message);
  } finally {
    ev.target.value = '';
  }
});
$('#reset-btn').addEventListener('click', () => {
  if (confirm('모든 일정과 주식 데이터를 삭제합니다. 계속할까요?')) {
    state = defaultState(); save(); toast('초기화했습니다'); render();
  }
});

/* =========================================================
 * 렌더
 * ========================================================= */
function render() {
  const active = document.querySelector('.view.active')?.id;
  if (active === 'view-dashboard') renderDashboard();
  if (active === 'view-schedule') renderSchedule();
  if (active === 'view-stocks') renderStocks();
  if (active === 'view-settings') $('#set-currency').value = state.settings.currency;
}

$('#tr-date').value = todayStr();
const initial = location.hash.slice(1);
if (['dashboard', 'schedule', 'stocks', 'settings'].includes(initial)) showView(initial);
else render();
