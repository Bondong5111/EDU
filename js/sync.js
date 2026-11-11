'use strict';
/* =========================================================
 * 클라우드 동기화
 *  - 통합 서버(server/server.mjs)에서 열면: 로그인 → 모든 기기 데이터 동기화
 *  - 파일로 열거나 정적 호스팅이면: 이 기기에만 저장 (기존 방식)
 * app.js 다음에 로드됩니다.
 * ========================================================= */
const REV_KEY = 'myPlanner.rev';
const DIRTY_KEY = 'myPlanner.dirty';
const Cloud = {
  mode: 'detecting', // detecting | local | server
  authed: false,
  rev: Number(localStorage.getItem(REV_KEY)) || 0,
  dirty: localStorage.getItem(DIRTY_KEY) === '1',
  status: 'idle',    // idle | saving | offline | error
  lastSyncAt: null,
  integrations: {},
  pushTimer: null,
  pushing: false,
};

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
const hasLocalContent = () => ['events', 'trades', 'habits', 'goals', 'strengths', 'watchlist'].some((k) => state[k]?.length) ||
  Object.keys(state.logs || {}).length > 0 || !!state.profile?.name;

function setRev(rev) { Cloud.rev = rev; try { localStorage.setItem(REV_KEY, String(rev)); } catch { /* 무시 */ } }
function setDirty(v) { Cloud.dirty = v; try { v ? localStorage.setItem(DIRTY_KEY, '1') : localStorage.removeItem(DIRTY_KEY); } catch { /* 무시 */ } }

/* ---------- 3-way 병합 ----------
 * base   = 마지막으로 서버와 맞췄던 데이터
 * local  = 이 기기의 현재 데이터
 * remote = 서버의 최신 데이터
 * 양쪽에서 바뀐 부분을 항목(id)·키 단위로 합칩니다. 같은 항목을 양쪽에서 바꿨으면 이 기기 쪽이 우선. */
const BASE_KEY = 'myPlanner.base';
let syncBase = (() => { try { return JSON.parse(localStorage.getItem(BASE_KEY)); } catch { return null; } })();
// 반드시 깊은 복사로 보관: state 와 객체를 공유하면 편집이 base 까지 바꿔 병합이 변경을 놓침
function setBase(obj) {
  const json = JSON.stringify(obj ?? {});
  syncBase = JSON.parse(json);
  try { localStorage.setItem(BASE_KEY, json); } catch { /* 무시 */ }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isIdArr = (v) => Array.isArray(v) && v.every((x) => isObj(x) && 'id' in x);
function merge3(base, local, remote) {
  if (same(local, base)) return remote;
  if (same(remote, base) || same(local, remote)) return local;
  if (isIdArr(local) && isIdArr(remote) && (base === undefined || base === null || isIdArr(base))) {
    const B = new Map((base || []).map((x) => [x.id, x]));
    const L = new Map(local.map((x) => [x.id, x]));
    const R = new Set(remote.map((x) => x.id));
    const out = [];
    for (const r of remote) {
      if (L.has(r.id)) out.push(merge3(B.get(r.id), L.get(r.id), r));
      else if (!B.has(r.id) || !same(B.get(r.id), r)) out.push(r); // 서버에서 추가·수정 (이 기기에서 지운 건 수정 안 된 경우만 삭제)
    }
    for (const l of local) {
      if (R.has(l.id)) continue;
      if (!B.has(l.id) || !same(B.get(l.id), l)) out.push(l);      // 이 기기에서 추가 (또는 서버가 지웠지만 여기서 고친 것)
    }
    return out;
  }
  if (isObj(local) && isObj(remote)) {
    const b = isObj(base) ? base : {};
    const out = {};
    for (const k of new Set([...Object.keys(remote), ...Object.keys(local), ...Object.keys(b)])) {
      const v = merge3(b[k], local[k], remote[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return local;
}

/* ---------- 저장 → 서버 반영 ---------- */
let editSeq = 0;
const localSave = save;
save = function () {
  localSave();
  if (!isServer()) return;
  editSeq++;
  setDirty(true);
  clearTimeout(Cloud.pushTimer);
  Cloud.pushTimer = setTimeout(push, 600);
  updateSyncBadge();
};

const snapshot = () => JSON.parse(JSON.stringify(state));

function adopt(remote) {
  state = mergeState(JSON.parse(JSON.stringify(remote.data || {})));
  localSave();
  setRev(remote.rev);
  setBase(remote.data || {});
  setDirty(false);
  Cloud.lastSyncAt = new Date();
  render();
}

// 서버 최신본과 이 기기 변경을 합친 뒤, 아직 안 올린 변경이 있으면 다시 올림
function mergeWith(remote) {
  const merged = merge3(syncBase ?? {}, snapshot(), remote.data ?? {});
  state = mergeState(JSON.parse(JSON.stringify(merged)));
  localSave();
  setRev(remote.rev);
  setBase(remote.data ?? {});
  const changed = !same(merged, remote.data ?? {});
  setDirty(changed);
  Cloud.lastSyncAt = new Date();
  render();
  return changed;
}

async function push() {
  if (!isServer() || Cloud.pushing) return;
  Cloud.pushing = true; Cloud.status = 'saving'; updateSyncBadge();
  let again = false;
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const seq = editSeq, snap = snapshot();
      try {
        const r = await api('/api/data', { method: 'PUT', body: { baseRev: Cloud.rev, data: snap } });
        setRev(r.rev); setBase(snap);
        setDirty(editSeq !== seq); // 올리는 동안 또 바뀌었으면 한 번 더
        again = Cloud.dirty;
        Cloud.status = 'idle'; Cloud.lastSyncAt = new Date();
        break;
      } catch (e) {
        if (e.status !== 409 || !e.data) throw e;
        if (!mergeWith(e.data)) { Cloud.status = 'idle'; break; } // 합쳐 보니 서버와 같음
      }
    }
  } catch (e) {
    if (e.offline) {
      Cloud.status = 'offline';
      setTimeout(() => Cloud.dirty && push(), 15000);
    } else {
      Cloud.status = 'error';
      if (e.status !== 401) toast('동기화 실패: ' + e.message);
    }
  } finally {
    Cloud.pushing = false;
    updateSyncBadge();
    if (again) setTimeout(push, 0);
  }
}

async function pull() {
  if (!isServer() || Cloud.pushing) return;
  if (Cloud.dirty) return push();
  try {
    const r = await api('/api/data?rev=' + Cloud.rev);
    Cloud.status = 'idle'; Cloud.lastSyncAt = new Date();
    if (!r.unchanged && r.data) {
      if (Cloud.dirty) { if (mergeWith(r)) push(); } // 받는 사이에 편집이 생겼으면 병합
      else adopt(r);
    }
  } catch (e) {
    Cloud.status = e.offline ? 'offline' : 'error';
  }
  updateSyncBadge();
}

// 로그인 직후 첫 동기화
async function initialSync() {
  const r = await api('/api/data');
  if (!r.data) {
    // 서버가 비어 있음 → 이 기기의 데이터를 올림 (처음 쓰는 경우)
    setRev(r.rev); setBase({});
    if (hasLocalContent()) { setDirty(true); await push(); toast('이 기기의 데이터를 서버에 올렸습니다. 이제 모든 기기에서 볼 수 있어요.'); }
    return;
  }
  if (Cloud.dirty || (!syncBase && hasLocalContent())) {
    // 오프라인 동안 바꾼 내용, 또는 로그인 전부터 이 기기에 있던 데이터 → 서버 데이터와 합침
    if (mergeWith(r)) await push();
    return;
  }
  adopt(r);
}

/* ---------- 로그인 화면 ---------- */
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
  try { await initialSync(); } catch (e) { toast('동기화 실패: ' + e.message); }
  updateSyncBadge();
  render();
  document.dispatchEvent(new CustomEvent('cloud:ready'));
}

async function logout(all = false) {
  if (!confirm(all ? '모든 기기에서 로그아웃할까요?' : '로그아웃할까요? 이 기기에 저장된 사본은 지워집니다.')) return;
  if (Cloud.dirty) await push();
  await api(all ? '/api/logout-all' : '/api/logout', { method: 'POST' }).catch(() => {});
  for (const k of [STORAGE_KEY, REV_KEY, DIRTY_KEY, BASE_KEY]) localStorage.removeItem(k);
  location.reload();
}

/* ---------- 상태 표시 ---------- */
function updateSyncBadge() {
  const el = $('#sync-badge');
  if (!el) return;
  const map = {
    detecting: ['…', '확인 중'],
    local: ['📱', '이 기기에만 저장'],
  };
  let [icon, text] = map[Cloud.mode] || [];
  if (Cloud.mode === 'server') {
    if (!Cloud.authed) [icon, text] = ['🔒', '로그인 필요'];
    else if (Cloud.status === 'saving' || Cloud.dirty) [icon, text] = ['⏳', '저장 중'];
    else if (Cloud.status === 'offline') [icon, text] = ['📴', '오프라인 — 연결되면 자동 저장'];
    else if (Cloud.status === 'error') [icon, text] = ['⚠️', '동기화 오류'];
    else [icon, text] = ['☁️', '동기화됨'];
  }
  el.innerHTML = `<i aria-hidden="true"></i><span>${text}</span>`;
  el.title = `${icon} ${text}`;
  el.dataset.state = Cloud.mode === 'server' ? Cloud.status : Cloud.mode;
}

/* ---------- 시작 ---------- */
(async function boot() {
  updateSyncBadge();
  if (location.protocol === 'file:') { Cloud.mode = 'local'; updateSyncBadge(); document.dispatchEvent(new CustomEvent('cloud:ready')); return; }
  try {
    const s = await (await fetch('/api/session', { credentials: 'same-origin' })).json();
    if (!s.server) throw new Error();
    Cloud.mode = 'server';
  } catch {
    Cloud.mode = 'local'; updateSyncBadge(); document.dispatchEvent(new CustomEvent('cloud:ready')); return;
  }
  await refreshSession().catch(() => {});
  if (!Cloud.authed) { showLogin(); return; }
  await afterLogin();
})();

// 화면으로 돌아오거나 1분마다: 데이터 + 연동 상태(다른 기기에서 연결/해제했을 수 있음) 갱신
async function refreshAll() {
  if (!isServer()) return;
  const before = JSON.stringify(Cloud.integrations);
  await refreshSession().catch(() => {});
  if (JSON.stringify(Cloud.integrations) !== before) render();
  await pull();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshAll(); });
window.addEventListener('online', () => (Cloud.dirty ? push() : pull()));
window.addEventListener('beforeunload', (e) => { if (isServer() && Cloud.dirty) { push(); e.preventDefault(); } });
setInterval(() => { if (document.visibilityState === 'visible') refreshAll(); }, 60000);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
