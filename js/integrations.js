'use strict';
/* =========================================================
 * 외부 연동: 토스증권 · 구글 캘린더 · 팻시크릿 (통합 서버 경유) · 삼성헬스 (CSV)
 * 로드 순서: app.js → sync.js → integrations.js
 * ========================================================= */
const timeAgo = (iso) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  return m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`;
};
const meta = () => (state.meta ||= {});
const LOCAL_ONLY_MSG = '통합 서버에서 실행하면 사용할 수 있어요 (server/README.md 참고)';

/* =========================================================
 * 토스증권
 * ========================================================= */
let tossBusy = false, tossError = '';
const tossReady = () => isServer() && Cloud.integrations.toss?.configured;

async function syncToss({ silent = false } = {}) {
  if (!tossReady()) { if (!silent) toast(isServer() ? '서버에 토스증권 키가 설정되지 않았습니다 (server/.env)' : LOCAL_ONLY_MSG); return; }
  if (tossBusy) return;
  tossBusy = true; tossError = ''; updateIntegrationUI();
  try {
    const d = await api('/api/toss/holdings');
    state.toss = { items: d.items, usdKrw: d.usdKrw, fetchedAt: d.fetchedAt, accountSeq: d.accountSeq };
    if (d.usdKrw) state.settings.usdKrw = d.usdKrw;
    meta().tossAt = d.fetchedAt;
    save();
    if (!silent) toast(`토스증권 보유 종목 ${d.items.length}개를 불러왔습니다`);
  } catch (e) {
    tossError = e.message;
    if (!silent) toast(e.message);
  } finally {
    tossBusy = false;
    render();
  }
}

/* =========================================================
 * 구글 캘린더
 * ========================================================= */
let gBusy = false;
const gConnected = () => isServer() && !!Cloud.integrations.google?.connected;

function fromGoogle(item, prev) {
  const toLocal = (t) => {
    if (t?.dateTime) { const d = new Date(t.dateTime); return { date: ymd(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }; }
    return { date: t?.date || '', time: '' };
  };
  const s = toLocal(item.start), e = toLocal(item.end);
  return {
    id: 'g_' + item.id, source: 'google', gid: item.id, link: item.htmlLink || '',
    title: item.summary || '(제목 없음)', date: s.date, start: s.time,
    end: s.time && e.date === s.date ? e.time : '',
    cat: prev?.cat || 'etc', memo: [item.location, item.description].filter(Boolean).join(' · ').slice(0, 200),
    done: prev?.done || false,
  };
}

async function syncGoogle({ silent = false } = {}) {
  if (!gConnected()) { if (!silent) toast(isServer() ? '나 > 연동 · 설정에서 구글 캘린더를 먼저 연결하세요' : LOCAL_ONLY_MSG); return; }
  if (gBusy) return;
  gBusy = true; updateIntegrationUI();
  try {
    const from = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1);
    const to = new Date(calCursor.getFullYear(), calCursor.getMonth() + 3, 1);
    const q = new URLSearchParams({ calendarId: state.settings.googleCalendarId || 'primary', timeMin: from.toISOString(), timeMax: to.toISOString() });
    const items = await api('/api/google/events?' + q);
    const fromStr = ymd(from), toStr = ymd(to);
    const prev = Object.fromEntries(state.events.filter((e) => e.source === 'google').map((e) => [e.gid, e]));
    state.events = state.events.filter((e) => !(e.source === 'google' && e.date >= fromStr && e.date < toStr));
    const fresh = items.map((i) => fromGoogle(i, prev[i.id])).filter((e) => e.date);
    state.events.push(...fresh);
    meta().gcalAt = new Date().toISOString();
    save();
    if (!silent) toast(`구글 캘린더 일정 ${fresh.length}개를 가져왔습니다`);
  } catch (e) {
    if (e.status === 409) await refreshSession().catch(() => {});
    if (!silent || e.status === 409) toast(e.message);
  } finally {
    gBusy = false;
    render();
  }
}

async function createInGoogle(ev) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let start, end;
  if (ev.start) {
    let endTime = ev.end;
    if (!endTime) { const [h, m] = ev.start.split(':').map(Number); endTime = h >= 23 ? '23:59' : `${pad(h + 1)}:${pad(m)}`; }
    start = { dateTime: `${ev.date}T${ev.start}:00`, timeZone: tz };
    end = { dateTime: `${ev.date}T${endTime}:00`, timeZone: tz };
  } else {
    const n = parseYmd(ev.date); n.setDate(n.getDate() + 1);
    start = { date: ev.date }; end = { date: ymd(n) };
  }
  return api('/api/google/events', { method: 'POST', body: { calendarId: state.settings.googleCalendarId || 'primary', event: { summary: ev.title, description: ev.memo || undefined, start, end } } });
}

// "구글 캘린더에도 추가": app.js 의 submit 처리(폼 초기화)보다 먼저 값을 읽기 위해 capture 단계
$('#event-form').addEventListener('submit', () => {
  if ($('#ev-id').value || !$('#ev-gcal').checked || !gConnected()) return;
  const ev = { title: $('#ev-title').value.trim(), date: $('#ev-date').value, start: $('#ev-start').value, end: $('#ev-end').value, memo: $('#ev-memo').value.trim(), cat: $('#ev-cat').value };
  if (!ev.title || !ev.date) return;
  setTimeout(async () => {
    try {
      const item = await createInGoogle(ev);
      const idx = state.events.findLastIndex((x) => !x.source && x.title === ev.title && x.date === ev.date);
      const mapped = { ...fromGoogle(item), cat: ev.cat };
      if (idx >= 0) state.events.splice(idx, 1, mapped); else state.events.push(mapped);
      save(); render();
      toast('구글 캘린더에도 추가했습니다');
    } catch (err) { toast('구글 캘린더 추가 실패: ' + err.message); }
  }, 0);
}, true);

async function disconnectGoogle() {
  if (!confirm('구글 캘린더 연결을 해제할까요? 이미 가져온 일정은 남아 있습니다.')) return;
  await api('/api/google/disconnect', { method: 'POST' });
  await refreshSession();
  toast('구글 캘린더 연결을 해제했습니다');
  render();
}

/* =========================================================
 * 팻시크릿: 식단(섭취 칼로리·탄단지)과 체중을 날짜별 기록으로
 * ========================================================= */
let fsBusy = false, fsError = '', fsQueued = 0; // fsQueued: 가져오는 중에 들어온 더 긴 기간 요청
const FS_FOOD = ['kcal', 'carb', 'protein', 'fat'];
const fsConnected = () => isServer() && !!Cloud.integrations.fatsecret?.connected;

async function connectFatsecret() {
  try {
    const { url } = await api('/api/fatsecret/connect');
    location.href = url;
  } catch (e) { toast(e.message); }
}

// months: 이번 달을 포함해 몇 달 치를 가져올지
async function syncFatsecret({ silent = false, months = 3 } = {}) {
  if (!fsConnected()) { if (!silent) toast(isServer() ? '나 > 연동 · 설정에서 팻시크릿을 먼저 연결하세요' : LOCAL_ONLY_MSG); return; }
  if (fsBusy) { if (!silent) fsQueued = Math.max(fsQueued, months); return; }
  fsBusy = true; fsError = ''; updateIntegrationUI();
  try {
    const now = new Date();
    const q = new URLSearchParams({ from: ymd(new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)), to: todayStr() });
    const d = await api('/api/fatsecret/diary?' + q);
    // 식단 값은 팻시크릿이 원본: 가져온 기간 안에서 팻시크릿에 없는 날의 식단 값은 지움 (체중·다른 기록은 그대로)
    for (const [date, log] of Object.entries(state.logs)) {
      if (date < d.from || date > d.to || d.days[date]?.kcal != null || !FS_FOOD.some((f) => log[f] != null)) continue;
      for (const f of FS_FOOD) delete log[f];
      if (!Object.keys(log).length) delete state.logs[date];
    }
    let food = 0, weight = 0;
    for (const [date, v] of Object.entries(d.days)) {
      const patch = Object.fromEntries(Object.entries(v).filter(([, x]) => x != null));
      if (!Object.keys(patch).length) continue;
      state.logs[date] = { ...state.logs[date], ...patch };
      if (patch.kcal != null) food++;
      if (patch.weight != null) weight++;
    }
    meta().fatsecretAt = d.fetchedAt;
    save();
    if (!silent) toast(`팻시크릿에서 식단 ${food}일, 체중 ${weight}일을 가져왔습니다`);
  } catch (e) {
    fsError = e.message;
    if (e.status === 409) { fsError = ''; await refreshSession().catch(() => {}); }
    if (!silent || e.status === 409) toast(e.message);
  } finally {
    fsBusy = false;
    const again = fsQueued; fsQueued = 0;
    if (again && fsConnected() && !fsError) syncFatsecret({ months: again }); else render();
  }
}

async function disconnectFatsecret() {
  if (!confirm('팻시크릿 연결을 해제할까요? 이미 가져온 식단·체중 기록은 남아 있습니다.')) return;
  await api('/api/fatsecret/disconnect', { method: 'POST' });
  await refreshSession();
  toast('팻시크릿 연결을 해제했습니다');
  render();
}

/* =========================================================
 * 삼성헬스 CSV 가져오기
 * 파일 예: com.samsung.shealth.sleep.<시각>.csv
 *  1행 메타데이터, 2행 헤더(접두사 포함), 3행~ 데이터. 시각은 UTC + time_offset(예: UTC+0900)
 * ========================================================= */
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ''));
}
function tableOf(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const hi = rows.findIndex((r, i) => i < 5 && r.some((c) => /(^|\.)(start_time|day_time|create_time)$/.test(c.trim())));
  if (hi < 0) return null;
  const cols = rows[hi].map((c) => c.trim().split('.').pop());
  return rows.slice(hi + 1).map((r) => Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? '').trim()])));
}
function localDate(ts, offset) {
  if (!ts) return null;
  if (/^\d{12,}$/.test(ts)) ts = new Date(Number(ts)).toISOString();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(ts);
  if (!m) return null;
  const ms = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]);
  const om = /UTC([+-])(\d{2}):?(\d{2})/.exec(offset || '');
  if (!om) return { date: `${m[1]}-${m[2]}-${m[3]}`, ms };
  const local = new Date(ms + (om[1] === '-' ? -1 : 1) * (om[2] * 60 + +om[3]) * 60000);
  return { date: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`, ms };
}
function readSamsung(name, text) {
  const n = name.toLowerCase();
  const type = /pedometer_day_summary/.test(n) ? 'steps' : /shealth\.sleep\.\d/.test(n) ? 'sleep'
    : /shealth\.exercise\.\d/.test(n) ? 'exercise' : /health\.weight\.\d/.test(n) ? 'weight' : null;
  if (!type) return null;
  const rows = tableOf(text);
  if (!rows) return null;
  const out = {};
  for (const r of rows) {
    if (type === 'steps') {
      const d = /^\d+$/.test(r.day_time || '') ? new Date(Number(r.day_time)).toISOString().slice(0, 10) : localDate(r.day_time)?.date;
      const v = Number(r.step_count);
      if (d && v >= 0) out[d] = Math.max(out[d] || 0, v);
    } else if (type === 'sleep') {
      const s = localDate(r.start_time, r.time_offset), e = localDate(r.end_time, r.time_offset);
      if (s && e && e.ms > s.ms) out[e.date] = (out[e.date] || 0) + (e.ms - s.ms) / 3600000;
    } else if (type === 'exercise') {
      const s = localDate(r.start_time, r.time_offset), dur = Number(r.duration);
      if (s && dur > 0) out[s.date] = (out[s.date] || 0) + dur / 60000;
    } else {
      const s = localDate(r.start_time, r.time_offset), w = Number(r.weight);
      if (s && w > 0) out[s.date] = w;
    }
  }
  return { type, out };
}
async function importSamsung(files) {
  const merged = { steps: {}, sleep: {}, exercise: {}, weight: {} };
  let skipped = 0;
  for (const f of files) {
    const r = readSamsung(f.name, await f.text());
    if (!r) { skipped++; continue; }
    for (const [d, v] of Object.entries(r.out)) {
      merged[r.type][d] = r.type === 'steps' ? Math.max(merged.steps[d] || 0, v) : r.type === 'weight' ? v : (merged[r.type][d] || 0) + v;
    }
  }
  const label = { sleep: '수면', steps: '걸음 수', exercise: '운동', weight: '체중' };
  const summary = Object.entries(merged).filter(([, m]) => Object.keys(m).length).map(([k, m]) => `${label[k]} ${Object.keys(m).length}일`);
  if (!summary.length) {
    $('#sh-result').textContent = `인식한 데이터가 없습니다 (파일 ${files.length}개). sleep · pedometer_day_summary · exercise · weight CSV를 선택했는지 확인하세요.`;
    return;
  }
  const msg = `${summary.join(', ')} 데이터를 찾았습니다${skipped ? ` (인식 못 한 파일 ${skipped}개 제외)` : ''}.`;
  if (!confirm(msg + '\n날짜별 기록에 반영할까요? 같은 날짜의 해당 항목은 덮어씁니다.')) return;
  const round = (v, k) => (k === 'steps' || k === 'exercise' ? Math.round(v) : Math.round(v * 10) / 10);
  for (const [k, m] of Object.entries(merged)) {
    for (const [d, v] of Object.entries(m)) state.logs[d] = { ...state.logs[d], [k]: round(v, k) };
  }
  meta().samsungAt = new Date().toISOString();
  save();
  $('#sh-result').textContent = '✅ ' + msg + ' 반영 완료';
  render();
}
$('#sh-files').addEventListener('change', (ev) => { const f = [...ev.target.files]; ev.target.value = ''; if (f.length) importSamsung(f); });

/* =========================================================
 * 연동 현황 UI (홈 · 설정 · 각 탭)
 * ========================================================= */
function connections() {
  const server = isServer();
  const ig = Cloud.integrations;
  const syncText = { idle: '동기화됨', saving: '저장 중', offline: '오프라인', error: '오류' }[Cloud.status];
  return [
    {
      id: 'cloud', icon: 'cloud', name: '클라우드 동기화',
      ok: server && Cloud.status === 'idle' && !Cloud.dirty,
      text: Cloud.mode === 'local' ? '이 기기에만 저장 중' : !Cloud.authed ? '로그인 필요' : `${Cloud.dirty ? '저장 중' : syncText}${Cloud.lastSyncAt ? ' · ' + timeAgo(Cloud.lastSyncAt) : ''}`,
    },
    {
      id: 'toss', icon: 'trend', name: '토스증권',
      ok: tossReady() && !!state.toss && !tossError,
      text: !server ? '서버 필요' : !ig.toss?.configured ? '서버에 키 미설정' : tossBusy ? '불러오는 중…' : tossError ? '⚠️ ' + tossError
        : state.toss ? `${state.toss.items.length}종목 · ${timeAgo(state.toss.fetchedAt)}` : '아직 불러오지 않음',
    },
    {
      id: 'google', icon: 'calendar', name: '구글 캘린더',
      ok: gConnected(),
      text: !server ? '서버 필요' : !ig.google?.configured ? '서버에 OAuth 미설정' : !ig.google?.connected ? '연결 안 됨'
        : gBusy ? '가져오는 중…' : `연결됨${meta().gcalAt ? ' · ' + timeAgo(meta().gcalAt) : ''}`,
    },
    {
      id: 'fatsecret', icon: 'food', name: '팻시크릿',
      ok: fsConnected() && !fsError,
      text: !server ? '서버 필요' : !ig.fatsecret?.configured ? '서버에 키 미설정' : !ig.fatsecret.connected ? '연결 안 됨'
        : fsBusy ? '가져오는 중…' : fsError ? '⚠️ ' + fsError : `연결됨${meta().fatsecretAt ? ' · ' + timeAgo(meta().fatsecretAt) : ''}`,
    },
    {
      id: 'samsung', icon: 'heart', name: '삼성헬스',
      ok: !!meta().samsungAt,
      text: meta().samsungAt ? `CSV 가져옴 · ${timeAgo(meta().samsungAt)}` : 'CSV로 가져오기',
    },
  ];
}

function renderDashLinks() {
  const el = $('#dash-links');
  if (!el) return;
  el.innerHTML = connections().map((c) =>
    `<button class="conn-chip ${c.ok ? 'ok' : ''}" data-goto="me" data-pane="settings" title="${esc(c.name)}: ${esc(c.text)}">
      <span>${ico(c.icon)}</span><span class="conn-name">${esc(c.name)}</span><span class="conn-text">${esc(c.text)}</span></button>`).join('');
}

function renderIntegPanel() {
  const el = $('#integ-panel');
  if (!el) return;
  const server = isServer();
  const ig = Cloud.integrations;
  const actions = {
    cloud: server ? '<button class="btn ghost small" data-act="logout">로그아웃</button><button class="btn ghost small" data-act="logout-all">모든 기기 로그아웃</button>' : '',
    toss: tossReady() ? '<button class="btn small" data-act="toss">지금 불러오기</button>' : '',
    google: !server || !ig.google?.configured ? ''
      : ig.google.connected ? '<button class="btn small" data-act="gsync">지금 가져오기</button><button class="btn ghost small" data-act="gdisconnect">연결 해제</button>'
      : '<button class="btn small" data-act="gconnect">구글 계정 연결</button>',
    fatsecret: !server || !ig.fatsecret?.configured ? ''
      : ig.fatsecret.connected ? '<button class="btn small" data-act="fsync">지금 가져오기</button><button class="btn ghost small" data-act="fdisconnect">연결 해제</button>'
      : '<button class="btn small" data-act="fconnect">팻시크릿 계정 연결</button>',
    samsung: '<label class="btn ghost small" for="sh-files">CSV 가져오기</label>',
  };
  el.innerHTML = connections().map((c) => `
    <div class="integ-row">
      <span class="integ-icon">${ico(c.icon)}</span>
      <div class="grow"><strong>${esc(c.name)}</strong> <span class="dot-status ${c.ok ? 'ok' : ''}"></span><div class="sub">${esc(c.text)}</div></div>
      <div class="integ-actions">${actions[c.id]}</div>
    </div>`).join('') +
    (Cloud.mode === 'local' ? `<div class="notice">지금은 <strong>이 기기에만</strong> 저장됩니다. 통합 서버(<code>server/server.mjs</code>)로 실행하면 휴대폰·PC 데이터가 하나로 동기화되고 토스증권·구글 캘린더·팻시크릿이 자동으로 연결됩니다.</div>` : '');
  $('#gcal-id-row').hidden = !gConnected();
  $('#set-gcal-id').value = state.settings.googleCalendarId || 'primary';
  $('#set-usdkrw').value = state.settings.usdKrw ?? '';
}

$('#integ-panel').addEventListener('click', (ev) => {
  const act = ev.target.closest('[data-act]')?.dataset.act;
  if (act === 'logout') logout(false);
  if (act === 'logout-all') logout(true);
  if (act === 'toss') syncToss();
  if (act === 'gsync') syncGoogle();
  if (act === 'gdisconnect') disconnectGoogle().catch((e) => toast(e.message));
  if (act === 'gconnect') location.href = '/api/google/connect';
  if (act === 'fconnect') connectFatsecret();
  if (act === 'fsync') syncFatsecret();
  if (act === 'fdisconnect') disconnectFatsecret().catch((e) => toast(e.message));
});
$('#integ-extra').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const fx = parseFloat($('#set-usdkrw').value);
  if (fx > 0) state.settings.usdKrw = fx;
  state.settings.googleCalendarId = $('#set-gcal-id').value.trim() || 'primary';
  save(); toast('저장했습니다'); render();
});

function updateIntegrationUI() {
  // 주식 탭
  const t = connections().find((c) => c.id === 'toss');
  $('#toss-status').textContent = t.text;
  $('#toss-sync').hidden = !tossReady();
  $('#toss-sync').disabled = tossBusy;
  $('#toss-clear').hidden = !state.toss;
  // 일정 탭
  const g = connections().find((c) => c.id === 'google');
  $('#gcal-status').textContent = '구글 캘린더 · ' + g.text;
  $('#gcal-sync').hidden = !gConnected();
  $('#gcal-sync').disabled = gBusy;
  $('#gcal-connect').hidden = gConnected() || !isServer() || !Cloud.integrations.google?.configured;
  $('#ev-gcal-wrap').hidden = !gConnected() || !!$('#ev-id').value;
  renderDashLinks();
  if (document.querySelector('#view-me.active') && ui.meTab === 'settings') renderIntegPanel();
}

$('#toss-sync').addEventListener('click', () => syncToss());
$('#toss-clear').addEventListener('click', () => {
  if (confirm('불러온 토스증권 보유 종목을 이 사이트에서 지울까요? (토스 계좌에는 영향 없음)')) { state.toss = null; save(); render(); }
});
$('#gcal-connect').addEventListener('click', () => { location.href = '/api/google/connect'; });
$('#gcal-sync').addEventListener('click', () => syncGoogle());
$('#ev-cancel').addEventListener('click', updateIntegrationUI);
document.addEventListener('click', (e) => { if (e.target.classList.contains('ev-edit')) updateIntegrationUI(); });

/* ---------- 자동 갱신: 화면을 열 때 오래된 데이터만 조용히 ---------- */
const stale = (iso, min) => !iso || Date.now() - new Date(iso) > min * 60000;
function autoRefresh() {
  if (!isServer()) return;
  const active = document.querySelector('.view.active')?.id;
  if ((active === 'view-stocks' || active === 'view-dashboard') && tossReady() && !tossBusy && !tossError && stale(state.toss?.fetchedAt, 10)) syncToss({ silent: true });
  if ((active === 'view-records' || active === 'view-dashboard') && gConnected() && !gBusy && stale(meta().gcalAt, 15)) syncGoogle({ silent: true });
  if (active !== 'view-stocks' && fsConnected() && !fsBusy && !fsError && stale(meta().fatsecretAt, 60)) syncFatsecret({ silent: true, months: 2 });
}

const baseRender = render;
render = function () {
  baseRender();
  updateIntegrationUI();
  autoRefresh();
};

document.addEventListener('cloud:ready', () => {
  // 구글 연결 후 돌아왔을 때 안내
  const g = new URLSearchParams(location.search).get('google');
  if (g) {
    toast({ connected: '구글 캘린더가 연결되었습니다', denied: '구글 연결을 취소했습니다', error: '구글 연결에 실패했습니다. 다시 시도하세요' }[g] || '');
    history.replaceState(null, '', location.pathname + location.hash);
  }
  // 팻시크릿 연결 후 돌아왔을 때: 지난 1년 치를 한 번에 가져옴
  const f = new URLSearchParams(location.search).get('fatsecret');
  if (f) {
    toast({ connected: '팻시크릿이 연결되었습니다. 지난 1년 기록을 가져오는 중…', denied: '팻시크릿 연결을 취소했습니다', error: '팻시크릿 연결에 실패했습니다. 다시 시도하세요' }[f] || '');
    history.replaceState(null, '', location.pathname + location.hash);
    ui.meTab = 'settings';
    if (f === 'connected' && fsConnected()) syncFatsecret({ months: 12 });
  }
  render();
});
render();
