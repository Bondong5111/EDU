'use strict';
/* =========================================================
 * 클라우드 동기화 (기록 단위)
 *  - 통합 서버에서 열면: 로그인 → 바뀐 기록만 서버와 주고받음
 *  - 파일로 열거나 정적 호스팅이면: 이 기기에만 저장
 * 로드 순서: records.js → app.js → … → sync.js → integrations.js
 * ========================================================= */
const CURSOR_KEY = 'myPlanner.cursor';   // 서버에서 어디까지 받았는지
const FLAT_KEY = 'myPlanner.flatBase';   // 서버와 마지막으로 맞춘 상태 (레코드 단위)
const LEGACY_KEYS = ['myPlanner.rev', 'myPlanner.dirty', 'myPlanner.base'];

const Cloud = {
  mode: 'detecting', // detecting | local | server
  authed: false,
  dirty: false,
  status: 'idle',    // idle | saving | offline | error
  lastSyncAt: null,
  integrations: {},
  syncing: false,
  again: false,
  timer: null,
};
let syncCursor = Number(localStorage.getItem(CURSOR_KEY)) || 0;
let syncBase = (() => { try { return JSON.parse(localStorage.getItem(FLAT_KEY)); } catch { return null; } })();

function persistSync() {
  try {
    localStorage.setItem(CURSOR_KEY, String(syncCursor));
    localStorage.setItem(FLAT_KEY, JSON.stringify(syncBase));
  } catch { /* 저장 공간 부족 등: 다음 동기화 때 다시 맞춰짐 */ }
}

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-MyLife': '1' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    const e = new Error('서버에 연결할 수 없습니다'); e.offline = true; throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `서버 오류 (${res.status})`);
    e.status = res.status; e.data = data;
    if (res.status === 401 && path !== '/api/login') showLogin();
    throw e;
  }
  return data;
}

const isServer = () => Cloud.mode === 'server' && Cloud.authed;

/* ---------- 저장 → 서버 반영 ---------- */
const localSave = save;
save = function () {
  localSave();
  if (!isServer()) return;
  Cloud.dirty = true;
  scheduleSync(600);
  updateSyncBadge();
};
function scheduleSync(ms) {
  clearTimeout(Cloud.timer);
  Cloud.timer = setTimeout(syncNow, ms);
}

async function syncNow() {
  if (!isServer()) return;
  if (Cloud.syncing) { Cloud.again = true; return; }
  Cloud.syncing = true; Cloud.again = false;
  if (Cloud.dirty) { Cloud.status = 'saving'; updateSyncBadge(); }
  let ok = false;
  try {
    if (!syncBase) {
      // 이 기기의 첫 동기화: 서버 기록을 먼저 받아 기준으로 삼고, 이 기기에만 있는 기록은 이어서 올림
      const first = await api('/api/sync', { method: 'POST', body: { cursor: 0, changes: [] } });
      const hadLocal = Object.keys(Records.flatten(state)).length;
      Records.apply(state, first.changes);
      syncBase = {};
      for (const c of first.changes) Records.applyToFlat(syncBase, c);
      syncCursor = first.cursor;
      localSave(); persistSync(); render();
      if (!first.changes.length && hadLocal > 12) toast('이 기기의 데이터를 서버에 올립니다. 이제 모든 기기에서 볼 수 있어요.');
    }
    const sent = Records.flatten(state);
    const changes = Records.diff(syncBase, sent);
    const r = await api('/api/sync', { method: 'POST', body: { cursor: syncCursor, changes } });
    for (const c of changes) Records.applyToFlat(syncBase, c);
    // 요청하는 동안 이 기기에서 또 고친 줄은 건드리지 않고(다음 동기화 때 올라감), 나머지만 반영
    const now = Records.flatten(state);
    const incoming = r.changes.filter((c) => Records.same(now[c.k], sent[c.k]));
    for (const c of r.changes) Records.applyToFlat(syncBase, c);
    if (incoming.length) { Records.apply(state, incoming); localSave(); }
    syncCursor = r.cursor;
    persistSync();
    Cloud.dirty = Records.diff(syncBase, Records.flatten(state)).length > 0;
    Cloud.status = 'idle'; Cloud.lastSyncAt = new Date();
    ok = true;
    if (incoming.length) render();
  } catch (e) {
    if (e.offline) {
      Cloud.status = 'offline';
      scheduleSync(15000);
    } else {
      Cloud.status = 'error';
      if (e.status !== 401) toast('동기화 실패: ' + e.message);
    }
  } finally {
    Cloud.syncing = false;
    updateSyncBadge();
    if (ok && (Cloud.dirty || Cloud.again)) scheduleSync(0);
  }
}
const pull = syncNow;

/* ---------- 로그인 ---------- */
function showLogin() {
  Cloud.authed = false;
  $('#login').hidden = false;
  setTimeout(() => $('#login-pw').focus(), 50);
  updateSyncBadge();
}
$('#login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = ev.target.querySelector('button');
  btn.disabled = true; $('#login-error').textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: { password: $('#login-pw').value } });
    $('#login-pw').value = '';
    $('#login').hidden = true;
    await afterLogin();
  } catch (e) {
    $('#login-error').textContent = e.message;
  } finally { btn.disabled = false; }
});

async function refreshSession() {
  const s = await api('/api/session');
  Cloud.authed = !!s.authed;
  Cloud.integrations = s.integrations || {};
  return s;
}

async function afterLogin() {
  await refreshSession();
  await syncNow();
  updateSyncBadge();
  render();
  document.dispatchEvent(new CustomEvent('cloud:ready'));
}

async function logout(all = false) {
  if (!confirm(all ? '모든 기기에서 로그아웃할까요?' : '로그아웃할까요? 이 기기에 저장된 사본은 지워집니다.')) return;
  if (Cloud.dirty) await syncNow();
  if (Cloud.dirty && !confirm('아직 서버에 저장되지 않은 변경이 있습니다. 그래도 로그아웃할까요?')) return;
  await api(all ? '/api/logout-all' : '/api/logout', { method: 'POST' }).catch(() => {});
  for (const k of [STORAGE_KEY, CURSOR_KEY, FLAT_KEY, ...LEGACY_KEYS]) localStorage.removeItem(k);
  location.reload();
}

/* ---------- 상태 표시 ---------- */
function updateSyncBadge() {
  const el = $('#sync-badge');
  if (!el) return;
  let text = { detecting: '확인 중', local: '이 기기에만 저장' }[Cloud.mode];
  let st = Cloud.mode;
  if (Cloud.mode === 'server') {
    st = Cloud.status;
    if (!Cloud.authed) { text = '로그인 필요'; st = 'error'; }
    else if (Cloud.status === 'offline') text = '오프라인 · 연결되면 자동 저장';
    else if (Cloud.status === 'error') text = '동기화 오류';
    else if (Cloud.status === 'saving' || Cloud.dirty) { text = '저장 중'; st = 'saving'; }
    else text = '동기화됨';
  }
  el.innerHTML = `<i aria-hidden="true"></i><span>${text}</span>`;
  el.title = text;
  el.dataset.state = st;
}

/* ---------- 시작 ---------- */
(async function boot() {
  updateSyncBadge();
  const local = () => { Cloud.mode = 'local'; updateSyncBadge(); document.dispatchEvent(new CustomEvent('cloud:ready')); };
  if (location.protocol === 'file:') return local();
  try {
    const s = await (await fetch('/api/session', { credentials: 'same-origin' })).json();
    if (!s.server) throw new Error();
    Cloud.mode = 'server';
  } catch { return local(); }
  for (const k of LEGACY_KEYS) localStorage.removeItem(k);
  await refreshSession().catch(() => {});
  if (!Cloud.authed) { showLogin(); return; }
  await afterLogin();
})();

// 화면으로 돌아오거나 1분마다: 기록 + 연동 상태(다른 기기에서 연결/해제했을 수 있음) 갱신
async function refreshAll() {
  if (!isServer()) return;
  const before = JSON.stringify(Cloud.integrations);
  await refreshSession().catch(() => {});
  if (JSON.stringify(Cloud.integrations) !== before) render();
  await syncNow();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshAll(); });
window.addEventListener('online', syncNow);
window.addEventListener('pagehide', () => { if (isServer() && Cloud.dirty) syncNow(); });
setInterval(() => { if (document.visibilityState === 'visible') refreshAll(); }, 60000);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
