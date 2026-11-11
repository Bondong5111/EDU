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
  habits: [],        // {id, name, icon}
  habitChecks: {},   // 'YYYY-MM-DD' -> [habitId]
  logs: {},          // 'YYYY-MM-DD' -> {mood, energy, sleep, exercise, weight, grateful, note}
  goals: [],         // {id, title, area, due, progress}
  events: [],        // {id, title, date, start, end, cat, memo, done}
  trades: [],        // {id, symbol, type, qty, price, date, memo}
  prices: {},        // symbol -> 현재가
  targets: {},       // symbol -> 목표가
  watchlist: [],     // {id, symbol}
  settings: { currency: 'KRW' },
});

function mergeState(data) {
  const s = Object.assign(defaultState(), data);
  s.profile = Object.assign(defaultProfile(), data.profile);
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
function showView(name) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  location.hash = name;
  render();
}
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
document.addEventListener('click', (ev) => {
  const g = ev.target.closest('[data-goto]');
  if (g) showView(g.dataset.goto);
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
      <h2>${p.name ? esc(p.name) : '나를 소개해 주세요'}</h2>
      <div class="headline">${p.headline ? esc(p.headline) : (compact ? '‘나’ 탭에서 프로필을 작성하면 여기에 표시됩니다.' : '한 줄 소개가 아직 없어요.')}</div>
      <div class="tags">${tags}</div>
      ${p.motto ? `<div class="quote">“${esc(p.motto)}”</div>` : ''}
    </div>
    ${compact ? '<button class="btn ghost small" data-goto="me">프로필 보기</button>' : '<button class="btn ghost small" id="pf-edit-btn">✏️ 편집</button>'}`;
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
    <button class="icon-btn st-del" title="삭제">🗑️</button></li>`;
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
  renderProfileView();
  renderStrengths();
  renderSaju();
  $('#saju-note').value = state.sajuNote || '';
}

/* =========================================================
 * 자기관리 (습관 · 기록 · 목표)
 * ========================================================= */
const lastDays = (n) => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return ymd(d); });
const isChecked = (date, hid) => (state.habitChecks[date] || []).includes(hid);
function toggleHabit(date, hid) {
  const arr = state.habitChecks[date] || [];
  state.habitChecks[date] = arr.includes(hid) ? arr.filter((x) => x !== hid) : [...arr, hid];
  if (!state.habitChecks[date].length) delete state.habitChecks[date];
  save();
}
function streakOf(hid) {
  const d = new Date();
  if (!isChecked(ymd(d), hid)) d.setDate(d.getDate() - 1); // 오늘 아직 안 했으면 어제부터
  let n = 0;
  while (isChecked(ymd(d), hid)) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function renderHabits() {
  const days = lastDays(7), today = todayStr();
  const t = $('#habit-table');
  if (!state.habits.length) {
    t.innerHTML = '<tbody><tr><td class="empty">습관을 추가해 보세요 (예: 🏃 아침 러닝, 📖 독서 20분)</td></tr></tbody>';
    return;
  }
  t.innerHTML = `<thead><tr><th>습관</th>${days.map((d) => {
    const dt = parseYmd(d);
    return `<th class="${d === today ? 'today-col' : ''}">${WEEK[dt.getDay()]}<br>${dt.getDate()}</th>`;
  }).join('')}<th>연속</th><th></th></tr></thead>
  <tbody>${state.habits.map((h) => `<tr data-hid="${h.id}">
    <td>${esc(h.icon || '•')} ${esc(h.name)}</td>
    ${days.map((d) => `<td><button class="hcheck ${isChecked(d, h.id) ? 'on' : ''}" data-hid="${h.id}" data-date="${d}">${isChecked(d, h.id) ? '✓' : ''}</button></td>`).join('')}
    <td><span class="streak">${streakOf(h.id) ? '🔥' + streakOf(h.id) : '-'}</span></td>
    <td><button class="icon-btn hb-del" title="삭제">🗑️</button></td>
  </tr>`).join('')}</tbody>`;
}
$('#habit-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const name = $('#hb-name').value.trim();
  if (!name) return;
  state.habits.push({ id: uid(), name, icon: $('#hb-icon').value.trim() });
  save(); ev.target.reset(); render();
});
document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.hcheck');
  if (btn) { toggleHabit(btn.dataset.date, btn.dataset.hid); render(); return; }
  if (ev.target.classList.contains('hb-del')) {
    const id = ev.target.closest('tr').dataset.hid;
    const h = state.habits.find((x) => x.id === id);
    if (h && confirm(`'${h.name}' 습관을 삭제할까요? (체크 기록도 함께 삭제)`)) {
      state.habits = state.habits.filter((x) => x.id !== id);
      for (const d of Object.keys(state.habitChecks)) {
        state.habitChecks[d] = state.habitChecks[d].filter((x) => x !== id);
        if (!state.habitChecks[d].length) delete state.habitChecks[d];
      }
      save(); render();
    }
  }
});

// 일일 기록
function loadLogForm() {
  const l = state.logs[$('#lg-date').value] || {};
  $('#lg-mood').value = l.mood || 3;
  $('#lg-energy').value = l.energy || 3;
  $('#lg-sleep').value = l.sleep ?? '';
  $('#lg-exercise').value = l.exercise ?? '';
  $('#lg-weight').value = l.weight ?? '';
  $('#lg-grateful').value = l.grateful || '';
  $('#lg-note').value = l.note || '';
}
$('#lg-date').addEventListener('change', loadLogForm);
const numOrNull = (v) => (v === '' ? null : parseFloat(v));
$('#log-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const date = $('#lg-date').value;
  if (!date) return;
  state.logs[date] = {
    mood: +$('#lg-mood').value, energy: +$('#lg-energy').value,
    sleep: numOrNull($('#lg-sleep').value), exercise: numOrNull($('#lg-exercise').value), weight: numOrNull($('#lg-weight').value),
    grateful: $('#lg-grateful').value.trim(), note: $('#lg-note').value.trim(),
  };
  save(); toast(`${fmtDate(date)} 기록을 저장했습니다`); render();
});

function renderLogList() {
  const dates = Object.keys(state.logs).sort().reverse();
  $('#log-list').innerHTML = dates.length ? dates.map((d) => {
    const l = state.logs[d];
    const meta = [l.sleep != null && `수면 ${l.sleep}h`, l.exercise != null && `운동 ${l.exercise}분`, l.weight != null && `${l.weight}kg`, `에너지 ${l.energy}`].filter(Boolean).join(' · ');
    return `<li class="col" data-ldate="${d}">
      <div class="row" style="align-items:center"><strong class="grow">${MOOD_EMOJI[l.mood] || ''} ${fmtDate(d)}</strong>
        <button class="icon-btn lg-edit" title="불러오기">✏️</button><button class="icon-btn lg-del" title="삭제">🗑️</button></div>
      <div class="sub">${meta}</div>
      ${l.grateful ? `<div>🙏 ${esc(l.grateful)}</div>` : ''}
      ${l.note ? `<div class="about sub">${esc(l.note)}</div>` : ''}
    </li>`;
  }).join('') : '<li class="empty">아직 기록이 없습니다</li>';
}
$('#log-list').addEventListener('click', (ev) => {
  const li = ev.target.closest('li[data-ldate]');
  if (!li) return;
  const d = li.dataset.ldate;
  if (ev.target.classList.contains('lg-edit')) { $('#lg-date').value = d; loadLogForm(); $('#log-form').scrollIntoView({ behavior: 'smooth' }); }
  if (ev.target.classList.contains('lg-del') && confirm(`${fmtDate(d)} 기록을 삭제할까요?`)) { delete state.logs[d]; save(); render(); }
});

function renderTrend() {
  const days = lastDays(14);
  const W = 700, H = 200, L = 24, R = 10, T = 10, B = 24;
  const x = (i) => L + (i * (W - L - R)) / (days.length - 1);
  const y = (v) => T + (H - T - B) * (1 - (v - 0) / 6);
  const series = [
    { key: 'mood', color: 'var(--c-work)', f: (l) => l.mood },
    { key: 'energy', color: 'var(--c-personal)', f: (l) => l.energy },
    { key: 'sleep', color: 'var(--c-etc)', f: (l) => (l.sleep != null ? Math.min(l.sleep / 2, 6) : null) },
  ];
  let svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="최근 14일 컨디션 추이">`;
  for (let v = 1; v <= 5; v++) svg += `<line class="axis" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" /><text x="4" y="${y(v) + 3}">${v}</text>`;
  days.forEach((d, i) => { if (i % 2 === 0 || i === days.length - 1) svg += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${parseYmd(d).getDate()}</text>`; });
  let any = false;
  for (const s of series) {
    const pts = days.map((d, i) => { const l = state.logs[d]; const v = l ? s.f(l) : null; return v != null ? [x(i), y(v)] : null; });
    // 연속 구간끼리 선으로 연결
    let path = '', pen = false;
    pts.forEach((p) => { if (p) { path += (pen ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); pen = true; any = true; } else pen = false; });
    if (path) svg += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.5" vector-effect="non-scaling-stroke" />`;
    pts.forEach((p) => { if (p) svg += `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${s.color}" />`; });
  }
  if (!any) svg += `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" style="font-size:13px">기록을 남기면 추이가 표시됩니다</text>`;
  $('#trend-chart').innerHTML = svg + '</svg>';
}

// 목표
function goalItem(g, { editable = true } = {}) {
  const dday = g.due ? Math.round((parseYmd(g.due) - parseYmd(todayStr())) / 86400000) : null;
  const ddayTxt = dday == null ? '' : dday > 0 ? `D-${dday}` : dday === 0 ? 'D-day' : `D+${-dday}`;
  return `<li class="col" data-gid="${g.id}">
    <div class="row" style="align-items:center">
      <span class="tag">${AREA_LABEL[g.area] || '기타'}</span>
      <strong class="grow">${g.progress >= 100 ? '🏆 ' : ''}${esc(g.title)}</strong>
      <span class="sub">${ddayTxt ? ddayTxt + ' · ' : ''}${g.progress}%</span>
      ${editable ? '<button class="icon-btn gl-del" title="삭제">🗑️</button>' : ''}
    </div>
    ${editable ? `<input type="range" class="goal-range" min="0" max="100" step="5" value="${g.progress}" aria-label="진행률" />`
               : `<div class="progress"><div style="width:${g.progress}%"></div></div>`}
  </li>`;
}
function renderGoals() {
  $('#goal-list').innerHTML = state.goals.length ? state.goals.map((g) => goalItem(g)).join('') : '<li class="empty">목표를 세워보세요</li>';
}
$('#goal-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const title = $('#gl-title').value.trim();
  if (!title) return;
  state.goals.push({ id: uid(), title, area: $('#gl-area').value, due: $('#gl-due').value, progress: 0 });
  save(); ev.target.reset(); renderGoals();
});
$('#goal-list').addEventListener('input', (ev) => {
  if (!ev.target.classList.contains('goal-range')) return;
  const g = state.goals.find((x) => x.id === ev.target.closest('li').dataset.gid);
  g.progress = +ev.target.value;
  ev.target.closest('li').querySelector('.sub').textContent = ev.target.closest('li').querySelector('.sub').textContent.replace(/\d+%$/, g.progress + '%');
  save();
});
$('#goal-list').addEventListener('change', (ev) => { if (ev.target.classList.contains('goal-range')) renderGoals(); });
$('#goal-list').addEventListener('click', (ev) => {
  if (!ev.target.classList.contains('gl-del')) return;
  const id = ev.target.closest('li').dataset.gid;
  if (confirm('이 목표를 삭제할까요?')) { state.goals = state.goals.filter((g) => g.id !== id); save(); renderGoals(); }
});

function renderCare() {
  renderHabits();
  renderTrend();
  renderGoals();
  renderLogList();
}

/* =========================================================
 * 홈 대시보드
 * ========================================================= */
function renderDashboard() {
  const today = todayStr();
  $('#dash-hero').innerHTML = heroHtml({ compact: true });
  $('#logo-emoji').textContent = state.profile.emoji || '🌱';

  // 습관
  const doneCount = state.habits.filter((h) => isChecked(today, h.id)).length;
  $('#dash-habit-rate').textContent = state.habits.length ? `${doneCount}/${state.habits.length}` : '';
  $('#dash-habits').innerHTML = state.habits.length ? state.habits.map((h) => `<li>
      <button class="hcheck ${isChecked(today, h.id) ? 'on' : ''}" data-hid="${h.id}" data-date="${today}">${isChecked(today, h.id) ? '✓' : ''}</button>
      <span class="grow">${esc(h.icon || '')} ${esc(h.name)}</span><span class="streak">${streakOf(h.id) ? '🔥' + streakOf(h.id) : ''}</span></li>`).join('')
    : '<li class="empty"><button class="btn ghost small" data-goto="care">습관 추가하기</button></li>';

  // 일정
  $('#dash-today').textContent = fmtDate(today);
  const todays = eventsOn(today);
  $('#dash-events').innerHTML = todays.length ? todays.map((e) => eventItem(e, { editable: false })).join('') : '<li class="empty">오늘 일정이 없습니다</li>';
  const end = new Date(); end.setDate(end.getDate() + 7);
  const endStr = ymd(end);
  const upcoming = state.events.filter((e) => e.date > today && e.date <= endStr).sort(sortEvents);
  $('#dash-upcoming').innerHTML = upcoming.length ? upcoming.map((e) => eventItem(e, { showDate: true, editable: false })).join('') : '<li class="empty">예정된 일정이 없습니다</li>';

  // 컨디션
  const week = lastDays(7).map((d) => state.logs[d]).filter(Boolean);
  const avg = (f) => { const v = week.map(f).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const mood = avg((l) => l.mood), sleep = avg((l) => l.sleep), ex = week.reduce((a, l) => a + (l.exercise || 0), 0);
  const habitRate = state.habits.length
    ? (lastDays(7).reduce((a, d) => a + state.habits.filter((h) => isChecked(d, h.id)).length, 0) / (state.habits.length * 7)) * 100 : null;
  $('#dash-condition').innerHTML = `
    <div class="stat"><div class="label">평균 기분</div><div class="value">${mood != null ? MOOD_EMOJI[Math.round(mood)] + ' ' + mood.toFixed(1) : '-'}</div></div>
    <div class="stat"><div class="label">평균 수면</div><div class="value">${sleep != null ? sleep.toFixed(1) + 'h' : '-'}</div></div>
    <div class="stat"><div class="label">총 운동</div><div class="value">${ex ? ex + '분' : '-'}</div></div>
    <div class="stat"><div class="label">습관 달성률</div><div class="value">${habitRate != null ? Math.round(habitRate) + '%' : '-'}</div></div>
    <div class="stat"><div class="label">기록한 날</div><div class="value">${week.length}/7</div></div>`;

  // 목표
  const goals = [...state.goals].sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')).slice(0, 5);
  $('#dash-goals').innerHTML = goals.length ? goals.map((g) => goalItem(g, { editable: false })).join('') : '<li class="empty"><button class="btn ghost small" data-goto="care">목표 세우기</button></li>';

  // 포트폴리오
  const p = computeHoldings();
  $('#dash-stats').innerHTML = statsHtml(p);
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
    state = mergeState(data);
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
  if (active === 'view-me') renderMe();
  if (active === 'view-care') renderCare();
  if (active === 'view-schedule') renderSchedule();
  if (active === 'view-stocks') renderStocks();
  if (active === 'view-settings') $('#set-currency').value = state.settings.currency;
}

$('#tr-date').value = todayStr();
$('#lg-date').value = todayStr();
loadLogForm();
const initial = location.hash.slice(1);
if (['dashboard', 'me', 'care', 'schedule', 'stocks', 'settings'].includes(initial)) showView(initial);
else render();
