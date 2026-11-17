'use strict';

/* =========================================================
 * 저장소 (localStorage)
 * ========================================================= */
const STORAGE_KEY = 'myPlanner.v1';
const defaultProfile = () => ({
  emoji: '🌱', name: '', headline: '', about: '', birth: '', birthTime: '', gender: '',
  mbti: '', motto: '', interests: '', vision: '',
});
const defaultState = () => ({
  profile: defaultProfile(),
  strengths: [],     // {id, title, desc, kind: 'strength'|'grow'}
  sajuNote: '',
  habits: [],        // {id, name, icon, target(주 n회)}
  habitChecks: {},   // 'YYYY-MM-DD' -> [habitId]
  logs: {},          // 'YYYY-MM-DD' -> {mood, energy, sleep, exercise, weight, grateful, note}
  goals: [],         // {id, title, area, due, progress, linkHabit, linkTarget, since}
  snapshots: {},     // 'YYYY-MM-DD' -> {v, c, cur}  날짜별 자산 스냅샷
  reviews: {},       // 주의 월요일 'YYYY-MM-DD' -> {note}
  events: [],        // {id, title, date, start, end, cat, memo, done}
  trades: [],        // {id, symbol, type, qty, price, date, memo}
  prices: {},        // symbol -> 현재가
  targets: {},       // symbol -> 목표가
  watchlist: [],     // {id, symbol}
  settings: { currency: 'KRW', usdKrw: 1400, googleCalendarId: 'primary' },
  meta: {},          // 연동 시각 등 {tossAt, gcalAt, samsungAt}
  toss: null,        // 토스증권에서 불러온 보유 주식 스냅샷 {items, usdKrw, fetchedAt, accountSeq}
});

function mergeState(data) {
  const s = Object.assign(defaultState(), data);
  s.profile = Object.assign(defaultProfile(), data.profile);
  s.settings = Object.assign(defaultState().settings, data.settings);
  for (const k of ['logs', 'habitChecks', 'prices', 'targets', 'snapshots', 'reviews', 'meta']) if (!s[k] || typeof s[k] !== 'object') s[k] = {};
  for (const k of ['strengths', 'habits', 'goals', 'events', 'trades', 'watchlist']) if (!Array.isArray(s[k])) s[k] = [];
  return s;
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return mergeState(JSON.parse(raw));
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
const PAGES = {
  dashboard: ['홈', () => fmtDate(todayStr())],
  records: ['기록', () => '달력 · 하루 기록 · 검색'],
  insights: ['분석', () => '추세와 발견, 주간 리뷰'],
  stocks: ['자산', () => '포트폴리오와 매매 기록'],
  me: ['나', () => '프로필 · 목표 · 연동'],
};
const VIEW_ALIAS = { schedule: 'records', care: 'insights', settings: 'me' }; // 이전 주소 호환
function showView(name) {
  name = VIEW_ALIAS[name] || name;
  if (!PAGES[name]) name = 'dashboard';
  const [title, sub] = PAGES[name];
  $('#page-title').textContent = title;
  $('#page-sub').textContent = sub();
  window.scrollTo(0, 0);
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
  render();
}
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
document.addEventListener('click', (ev) => {
  const g = ev.target.closest('[data-goto]');
  if (!g) return;
  if (g.dataset.pane) ui.meTab = g.dataset.pane;
  showView(g.dataset.goto);
});

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
    const mood = state.logs[ds]?.mood;
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-cell' + (d.getMonth() !== m ? ' other' : '') + (ds === today ? ' today' : '') + (ds === selectedDate ? ' selected' : '');
    cell.innerHTML = `<span class="cal-top"><span class="num">${d.getDate()}</span>${mood ? `<span class="cal-mood" title="기분 ${mood}">${MOOD_EMOJI[mood]}</span>` : (state.logs[ds] || state.habitChecks[ds] ? '<span class="cal-has"></span>' : '')}</span>` +
      evs.slice(0, 3).map((e) => `<span class="chip" style="background:${CAT_COLOR[e.cat] || CAT_COLOR.etc}">${esc(e.title)}</span>`).join('') +
      (evs.length > 3 ? `<span class="more">+${evs.length - 3}</span>` : '');
    cell.addEventListener('click', () => { selectedDate = ds; resetEventForm(); renderRecords(); });
    grid.appendChild(cell);
  }
}

function eventItem(e, { showDate = false, editable = true } = {}) {
  return `<li class="${e.done ? 'done' : ''}" data-id="${e.id}">
    <input type="checkbox" class="ev-toggle" ${e.done ? 'checked' : ''} title="완료" />
    <span class="dot cat-${esc(e.cat)}"></span>
    <div class="grow">
      <div class="ev-name">${e.source === 'google' ? '<span class="src-badge g" title="구글 캘린더">G</span>' : ''}${esc(e.title)}</div>
      <div class="sub">${showDate ? fmtDate(e.date) + ' · ' : ''}${timeRange(e)} · ${CAT_LABEL[e.cat] || '기타'}${e.memo ? ' · ' + esc(e.memo) : ''}</div>
    </div>
    ${!editable ? '' : e.source === 'google'
      ? (e.link ? `<a class="icon-btn" href="${esc(e.link)}" target="_blank" rel="noopener" title="구글 캘린더에서 열기">${ico('ext')}</a>` : '')
      : `<button class="icon-btn ev-edit" title="수정">${ico('edit')}</button><button class="icon-btn ev-del" title="삭제">${ico('trash')}</button>`}
  </li>`;
}

function resetEventForm() {
  $('#event-form').reset();
  $('#ev-id').value = '';
  $('#ev-date').value = selectedDate;
  $('#event-form-title').textContent = '일정 추가';
  $('#event-details').open = false;
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
    $('#event-details').open = true;
    $('#ev-title').focus();
  }
});

$('#cal-prev').addEventListener('click', () => { calCursor.setMonth(calCursor.getMonth() - 1); renderCalendar(); });
$('#cal-next').addEventListener('click', () => { calCursor.setMonth(calCursor.getMonth() + 1); renderCalendar(); });
$('#cal-today').addEventListener('click', () => {
  calCursor = new Date(); calCursor.setDate(1); selectedDate = todayStr(); resetEventForm(); renderRecords();
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
    .concat(tossHoldings())
    .sort((a, b) => b.value - a.value);
  const cost = holdings.reduce((s, h) => s + h.cost, 0);
  const value = holdings.reduce((s, h) => s + h.value, 0);
  return { holdings, cost, value, pnl: value - cost, rate: cost ? ((value - cost) / cost) * 100 : 0, realized };
}

// 토스증권 스냅샷 → 표시 통화로 환산한 보유 종목
function tossHoldings() {
  const t = state.toss;
  if (!t || !Array.isArray(t.items)) return [];
  const fx = Number(t.usdKrw) || Number(state.settings.usdKrw) || 0;
  const display = state.settings.currency;
  const conv = (v, cur) => {
    v = Number(v) || 0;
    if (cur === display || !fx) return v;
    return display === 'KRW' ? v * fx : v / fx;
  };
  return t.items.map((it) => {
    const key = 'toss:' + it.symbol;
    const qty = Number(it.quantity) || 0;
    const cost = conv(it.marketValue?.purchaseAmount ?? qty * it.averagePurchasePrice, it.currency);
    const value = conv(it.marketValue?.amount ?? qty * it.lastPrice, it.currency);
    const pnl = value - cost;
    return {
      key, source: 'toss', symbol: it.name || it.symbol, code: it.symbol, currency: it.currency, qty,
      avg: conv(it.averagePurchasePrice, it.currency), price: conv(it.lastPrice, it.currency),
      cost, value, pnl, rate: cost ? (pnl / cost) * 100 : 0, target: state.targets[key],
      daily: it.dailyProfitLoss ? Number(it.dailyProfitLoss.rate) * 100 : null,
    };
  });
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
    <tr data-sym="${esc(h.key || h.symbol)}">
      <td>${h.source === 'toss' ? '<span class="src-badge t" title="토스증권 연동">토스</span>' : ''}<strong>${esc(h.symbol)}</strong>${h.code ? ` <span class="muted">${esc(h.code)}</span>` : ''}${h.target && h.price >= h.target ? '<span class="badge hit">목표 도달</span>' : ''}${h.daily != null ? `<div class="sub ${cls(h.daily)}">오늘 ${pct(h.daily)}</div>` : ''}</td>
      <td>${h.qty.toLocaleString()}</td>
      <td>${money(h.avg)}</td>
      <td>${h.source === 'toss' ? money(h.price) : `<input class="inline price-input" type="number" step="any" min="0" value="${+h.price.toFixed(4)}" />`}</td>
      <td>${money(h.value)}</td>
      <td class="${cls(h.pnl)}">${signed(h.pnl)}</td>
      <td class="${cls(h.rate)}">${pct(h.rate)}</td>
      <td><input class="inline target-input" type="number" step="any" min="0" value="${h.target ?? ''}" placeholder="-" /></td>
      <td>${h.source === 'toss' ? '' : '<button class="icon-btn quick-sell" title="전량 매도 기록">매도</button>'}</td>
    </tr>`).join('') : '<tr><td colspan="9" class="empty">보유 종목이 없습니다. 아래에서 매수 기록을 추가해 보세요.</td></tr>';

  const trades = [...state.trades].sort((a, b) => b.date.localeCompare(a.date));
  $('#trades-body').innerHTML = trades.length ? trades.map((t) => `
    <tr data-id="${t.id}">
      <td>${t.date}</td><td>${esc(t.symbol)}</td>
      <td class="${t.type === 'buy' ? 'up' : 'down'}">${t.type === 'buy' ? '매수' : '매도'}</td>
      <td>${t.qty.toLocaleString()}</td><td>${money(t.price)}</td><td>${money(t.qty * t.price)}</td>
      <td>${esc(t.memo || '')}</td>
      <td><button class="icon-btn trade-del" title="삭제">${ico('trash')}</button></td>
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
      <button class="icon-btn w-edit" title="가격 수정">${ico('edit')}</button>
      <button class="icon-btn w-del" title="삭제">${ico('trash')}</button>
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
    const h = computeHoldings().holdings.find((x) => x.symbol === t.symbol && x.source !== 'toss');
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
  const h = computeHoldings().holdings.find((x) => x.symbol === sym && x.source !== 'toss');
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
  const holdings = computeHoldings().holdings.filter((h) => h.source !== 'toss');
  if (!holdings.length) { toast('직접 입력한 보유 종목이 없습니다'); return; }
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
const PIE_COLORS = ['#4f6bed', '#12a150', '#f59e0b', '#8b5cf6', '#e5484d', '#06b6d4', '#ec4899', '#94a3b8'];

function drawPie(canvas, items) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = 200;
  canvas.width = size * dpr; canvas.height = size * dpr;
  canvas.style.width = size + 'px'; canvas.style.height = size + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const total = items.reduce((s, i) => s + i.value, 0);
  const cx = size / 2, cy = size / 2, r = 90;
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

/* =========================================================
 * 나 (프로필 · 강점 · 사주)
 * ========================================================= */
const AREA_LABEL = { health: '건강', career: '커리어', money: '재테크', study: '배움', relation: '관계', mind: '마음' };
const MOOD_EMOJI = { 1: '😣', 2: '😕', 3: '😐', 4: '🙂', 5: '😄' };

function ageOf(birth) {
  if (!birth) return null;
  const b = parseYmd(birth), t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a;
}
const interestsOf = (p) => p.interests.split(',').map((s) => s.trim()).filter(Boolean);
const getSaju = () => (state.profile.birth ? Saju.calculate(state.profile.birth, state.profile.birthTime) : null);

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? '늦은 밤이에요 🌙' : h < 11 ? '좋은 아침이에요 ☀️' : h < 17 ? '좋은 오후예요 🌤️' : h < 21 ? '수고한 하루예요 🌇' : '편안한 밤 되세요 🌙';
}
function heroHtml({ compact = false } = {}) {
  const p = state.profile, saju = getSaju(), age = ageOf(p.birth);
  const tags = [
    p.mbti && `<span class="tag primary">${esc(p.mbti.toUpperCase())}</span>`,
    age != null && `<span class="tag">만 ${age}세</span>`,
    saju && `<span class="tag">${saju.animal}띠</span>`,
    saju && `<span class="tag">일간 ${esc(saju.dayMaster.name)}</span>`,
    ...interestsOf(p).map((i) => `<span class="tag">#${esc(i)}</span>`),
  ].filter(Boolean).join('');
  return `<div class="avatar">${esc(p.emoji || '🌱')}</div>
    <div class="grow">
      ${compact ? `<div class="greeting">${greeting()}</div>` : ''}
      <h2>${p.name ? esc(p.name) + (compact ? '님' : '') : '나를 소개해 주세요'}</h2>
      <div class="headline">${p.headline ? esc(p.headline) : (compact ? '‘나’ 탭에서 프로필을 작성하면 여기에 표시됩니다.' : '한 줄 소개가 아직 없어요.')}</div>
      <div class="tags">${tags}</div>
      ${p.motto ? `<div class="quote">“${esc(p.motto)}”</div>` : ''}
    </div>
    ${compact ? '' : '<button class="btn ghost small" id="pf-edit-btn">편집</button>'}`;
}

function renderProfileView() {
  const p = state.profile;
  const box = $('#profile-view');
  box.innerHTML = `<div class="hero" style="background:none;padding:0">${heroHtml()}</div>
    <div class="profile-grid">
      <div class="stat"><div class="label">자기소개</div><div class="value about">${p.about ? esc(p.about) : '<span class="muted">아직 작성하지 않았어요</span>'}</div></div>
      <div class="stat"><div class="label">5년 후의 나</div><div class="value about">${p.vision ? esc(p.vision) : '<span class="muted">비전을 적어보세요</span>'}</div></div>
      <div class="stat"><div class="label">생년월일</div><div class="value">${p.birth ? esc(p.birth) + (p.birthTime ? ' ' + esc(p.birthTime) : '') : '-'}</div></div>
    </div>`;
  $('#pf-edit-btn').addEventListener('click', openProfileEdit);
}

function openProfileEdit() {
  const p = state.profile;
  const map = { emoji: 'pf-emoji', name: 'pf-name', mbti: 'pf-mbti', headline: 'pf-headline', about: 'pf-about',
    birth: 'pf-birth', birthTime: 'pf-birthtime', gender: 'pf-gender', motto: 'pf-motto', interests: 'pf-interests', vision: 'pf-vision' };
  for (const [k, id] of Object.entries(map)) document.getElementById(id).value = p[k] || '';
  $('#profile-view').hidden = true;
  $('#profile-edit').hidden = false;
  $('#pf-name').focus();
}
function closeProfileEdit() { $('#profile-view').hidden = false; $('#profile-edit').hidden = true; }

$('#profile-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  Object.assign(state.profile, {
    emoji: $('#pf-emoji').value.trim() || '🌱',
    name: $('#pf-name').value.trim(),
    mbti: $('#pf-mbti').value.trim().toUpperCase(),
    headline: $('#pf-headline').value.trim(),
    about: $('#pf-about').value.trim(),
    birth: $('#pf-birth').value,
    birthTime: $('#pf-birthtime').value,
    gender: $('#pf-gender').value,
    motto: $('#pf-motto').value.trim(),
    interests: $('#pf-interests').value,
    vision: $('#pf-vision').value.trim(),
  });
  save(); closeProfileEdit(); toast('프로필을 저장했습니다'); render();
});
$('#pf-cancel').addEventListener('click', closeProfileEdit);

function strengthItem(s) {
  return `<li data-sid="${s.id}"><span>${s.kind === 'grow' ? '🌱' : '⭐'}</span>
    <div class="grow"><div><strong>${esc(s.title)}</strong></div>${s.desc ? `<div class="sub">${esc(s.desc)}</div>` : ''}</div>
    <button class="icon-btn st-del" title="삭제">${ico('trash')}</button></li>`;
}
function renderStrengths() {
  const st = state.strengths.filter((s) => s.kind !== 'grow');
  const gr = state.strengths.filter((s) => s.kind === 'grow');
  $('#strength-list').innerHTML = st.length ? st.map(strengthItem).join('') : '<li class="empty">나의 강점을 적어보세요</li>';
  $('#grow-list').innerHTML = gr.length ? gr.map(strengthItem).join('') : '<li class="empty">보완점은 ‘보완점’으로 추가할 수 있어요</li>';
}
$('#strength-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const title = $('#st-title').value.trim();
  if (!title) return;
  state.strengths.push({ id: uid(), title, desc: $('#st-desc').value.trim(), kind: $('#st-kind').value });
  save(); $('#st-title').value = ''; $('#st-desc').value = ''; renderStrengths();
});
document.addEventListener('click', (ev) => {
  if (!ev.target.classList.contains('st-del')) return;
  const id = ev.target.closest('li').dataset.sid;
  state.strengths = state.strengths.filter((s) => s.id !== id); save(); renderStrengths();
});

function renderSaju() {
  const box = $('#saju-box');
  const p = state.profile;
  if (!p.birth) {
    box.innerHTML = `<p class="muted">프로필에 생년월일(과 태어난 시각)을 입력하면 사주 원국과 오행 분포를 보여드려요.</p>
      <button class="btn small" id="saju-setup">생년월일 입력하기</button>`;
    $('#saju-setup').addEventListener('click', openProfileEdit);
    return;
  }
  const s = getSaju();
  if (!s) { box.innerHTML = '<p class="muted">생년월일 형식을 확인해 주세요.</p>'; return; }
  const col = (label, pl, cls = '') => {
    if (!pl) return `<div class="saju-col ${cls}"><div class="head">${label}</div>
      <div class="saju-char el-none">?<small>시각 미입력</small></div><div class="saju-char el-none">?<small>&nbsp;</small></div></div>`;
    const se = s.stemElement(pl.stem), be = s.branchElement(pl.branch);
    return `<div class="saju-col ${cls}"><div class="head">${label}</div>
      <div class="saju-char el-${se}">${Saju.STEMS[pl.stem]}<small>${pl.hangul[0]} · ${se}</small></div>
      <div class="saju-char el-${be}">${Saju.BRANCHES[pl.branch]}<small>${pl.hangul[1]} · ${be}</small></div></div>`;
  };
  const total = s.elements.reduce((a, e) => a + e.count, 0);
  const dm = s.dayMaster;
  box.innerHTML = `
    <div class="saju-table">${col('시주', s.hour)}${col('일주', s.day, 'day')}${col('월주', s.month)}${col('연주', s.year)}</div>
    <p><strong>${s.year.hangul}년 · ${s.animal}띠</strong> / 일주 <strong>${s.day.hangul}(${s.day.hanja})</strong></p>
    <div class="stat"><div class="label">나를 상징하는 일간</div>
      <div class="value" style="font-size:16px">${esc(dm.name)} — ${esc(dm.image)} <span class="muted">(${dm.yinYang}의 ${dm.element})</span></div>
      <div style="margin-top:6px;line-height:1.6">${esc(dm.desc)}</div></div>
    <h3>오행 분포</h3>
    <div class="el-bars">${s.elements.map((e) => `<div class="el-bar"><span style="width:20px">${e.name}</span>
      <div class="track"><div class="fill el-${e.name}" style="width:${(e.count / total) * 100}%"></div></div><span style="width:20px">${e.count}</span></div>`).join('')}</div>
    <p>강한 기운: <strong>${s.strong.join(', ')}</strong>${s.lacking.length ? ` · 부족한 기운: <strong>${s.lacking.join(', ')}</strong>` : ''}</p>
    ${s.tips.map((t) => `<div class="notice">💡 <strong>${t.element}</strong> 기운 보충 — ${esc(t.tip)}</div>`).join('')}
    <div class="notice">절기 기준 만세력으로 계산했습니다 (한국 표준시 기준, 서머타임·진태양시 보정 없음, 자시는 자정 기준).
    ${s.nearTermBoundary ? '<br>⚠️ 절기가 바뀌는 시점과 가까워 월주·연주가 달라질 수 있어요.' : ''}</div>`;
}
$('#saju-note').addEventListener('input', (ev) => { state.sajuNote = ev.target.value; save(); });

function renderMe() {
  document.querySelectorAll('#me-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.pane === ui.meTab));
  document.querySelectorAll('.me-pane').forEach((p) => (p.hidden = p.dataset.pane !== ui.meTab));
  if (ui.meTab === 'profile') {
    renderProfileView();
    renderMeData();
    renderStrengths();
    renderSaju();
    if (document.activeElement !== $('#saju-note')) $('#saju-note').value = state.sajuNote || '';
  } else if (ui.meTab === 'plan') {
    renderGoals();
    renderHabitDefs();
  } else {
    $('#set-currency').value = state.settings.currency;
  }
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
    state = mergeState(data);
    save(); toast('가져오기 완료'); render();
  } catch (e) {
    toast('가져오기 실패: ' + e.message);
  } finally {
    ev.target.value = '';
  }
});
$('#reset-btn').addEventListener('click', () => {
  if (confirm('프로필, 기록, 일정, 자산 등 모든 데이터를 삭제합니다. 되돌릴 수 없습니다. 계속할까요?')) {
    state = defaultState(); save(); toast('초기화했습니다'); render();
  }
});

/* =========================================================
 * 렌더
 * ========================================================= */
function render() {
  const active = document.querySelector('.view.active')?.id;
  $('#logo-emoji').textContent = state.profile.emoji || '🌱';
  if (active === 'view-dashboard') renderHome();
  if (active === 'view-records') renderRecords();
  if (active === 'view-insights') renderInsights();
  if (active === 'view-stocks') { renderStocks(); renderAssets(); }
  if (active === 'view-me') renderMe();
  if (!$('#sheet').hidden) renderSheet();
}

$('#tr-date').value = todayStr();
