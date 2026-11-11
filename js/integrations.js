'use strict';
/* =========================================================
 * 외부 연동: 토스증권 · 구글 캘린더 · 삼성헬스
 * app.js 다음에 로드됩니다 (state, save, render 등 전역 사용).
 * ========================================================= */

/* ---------- 비밀값: 이 브라우저에만, 백업 파일과 분리 저장 ---------- */
const SECRET_KEY = 'myPlanner.secrets';
function loadSecrets() {
  try { return JSON.parse(localStorage.getItem(SECRET_KEY)) || {}; } catch { return {}; }
}
let secrets = loadSecrets();
function saveSecrets() {
  try { localStorage.setItem(SECRET_KEY, JSON.stringify(secrets)); } catch (e) { toast('비밀값 저장 실패: ' + e.message); }
}
const timeAgo = (iso) => {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  return m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`;
};

/* =========================================================
 * 토스증권
 * ========================================================= */
const tossConfigured = () => !!(secrets.tossUrl && secrets.tossToken);
let tossBusy = false, tossError = '';

async function tossRequest(path) {
  const url = secrets.tossUrl.replace(/\/+$/, '') + path;
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: 'Bearer ' + secrets.tossToken } });
  } catch {
    throw new Error('중계 서버에 연결할 수 없습니다 (주소·서버 실행 여부·HTTPS·ALLOWED_ORIGIN 확인)');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `중계 서버 오류 (${res.status})`);
  return body;
}

async function syncToss({ silent = false } = {}) {
  if (!tossConfigured()) { if (!silent) { toast('설정 탭에서 토스 중계 서버를 먼저 등록하세요'); showView('settings'); } return; }
  if (tossBusy) return;
  tossBusy = true; tossError = ''; updateTossStatus();
  try {
    const data = await tossRequest('/toss/holdings');
    state.toss = {
      items: data.holdings?.items || [],
      usdKrw: data.usdKrw != null ? Number(data.usdKrw) : null,
      fetchedAt: data.fetchedAt || new Date().toISOString(),
      accountSeq: data.accountSeq,
    };
    if (state.toss.usdKrw) state.settings.usdKrw = state.toss.usdKrw;
    save();
    if (!silent) toast(`토스증권 보유 종목 ${state.toss.items.length}개를 불러왔습니다`);
  } catch (e) {
    tossError = e.message;
    if (!silent) toast(e.message);
  } finally {
    tossBusy = false;
    render();
  }
}

function updateTossStatus() {
  const el = $('#toss-status');
  if (!el) return;
  $('#toss-clear').hidden = !state.toss;
  $('#toss-sync').disabled = tossBusy;
  if (tossBusy) { el.textContent = '불러오는 중…'; return; }
  if (tossError) { el.innerHTML = `<span class="up">⚠️ ${esc(tossError)}</span>`; return; }
  if (!tossConfigured()) { el.textContent = '설정 탭에서 중계 서버를 등록하면 보유 주식을 자동으로 불러옵니다.'; return; }
  el.textContent = state.toss
    ? `${state.toss.items.length}개 종목 · ${timeAgo(state.toss.fetchedAt)} 갱신${state.toss.usdKrw ? ` · 환율 ${state.toss.usdKrw.toLocaleString()}원` : ''}`
    : '아직 불러오지 않았습니다.';
}

$('#toss-sync').addEventListener('click', () => syncToss());
$('#toss-clear').addEventListener('click', () => {
  if (confirm('불러온 토스증권 보유 종목을 이 사이트에서 지울까요? (토스 계좌에는 영향 없음)')) { state.toss = null; save(); render(); }
});
$('#toss-test').addEventListener('click', async () => {
  readIntegForm();
  if (!tossConfigured()) { toast('주소와 PROXY_TOKEN을 입력하세요'); return; }
  try {
    const accounts = await tossRequest('/toss/accounts');
    toast(`연결 성공: 계좌 ${accounts.length}개`);
  } catch (e) { toast('연결 실패: ' + e.message); }
});

/* =========================================================
 * 구글 캘린더 (Google Identity Services, 브라우저 OAuth)
 * ========================================================= */
const GCAL_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const GTOKEN_KEY = 'myPlanner.gtoken';
let gToken = (() => {
  try { const t = JSON.parse(sessionStorage.getItem(GTOKEN_KEY)); return t && t.expiresAt > Date.now() ? t : null; } catch { return null; }
})();
let gTokenClient = null, gBusy = false;
const gConnected = () => !!(gToken && gToken.expiresAt > Date.now());

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('구글 로그인 스크립트를 불러오지 못했습니다'));
    document.head.appendChild(s);
  });
}

async function connectGoogle() {
  const clientId = state.settings.googleClientId;
  if (!clientId) { toast('설정 탭에 구글 OAuth 클라이언트 ID를 입력하세요'); showView('settings'); return false; }
  if (location.protocol === 'file:') { toast('구글 연결은 http(s)로 배포된 주소에서만 동작합니다'); return false; }
  await loadGis();
  return new Promise((resolve) => {
    gTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GCAL_SCOPE,
      callback: (resp) => {
        if (resp.error) { toast('구글 연결 실패: ' + resp.error); resolve(false); return; }
        gToken = { value: resp.access_token, expiresAt: Date.now() + (resp.expires_in - 60) * 1000 };
        try { sessionStorage.setItem(GTOKEN_KEY, JSON.stringify(gToken)); } catch { /* 무시 */ }
        updateGcalStatus();
        resolve(true);
      },
      error_callback: (err) => { toast('구글 연결 취소: ' + (err.message || err.type)); resolve(false); },
    });
    gTokenClient.requestAccessToken();
  });
}

async function gcal(path, opts = {}) {
  if (!gConnected() && !(await connectGoogle())) throw new Error('구글 캘린더에 연결되지 않았습니다');
  const calId = encodeURIComponent(state.settings.googleCalendarId || 'primary');
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId}${path}`, {
    ...opts,
    headers: { Authorization: 'Bearer ' + gToken.value, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (res.status === 401) { gToken = null; sessionStorage.removeItem(GTOKEN_KEY); updateGcalStatus(); throw new Error('구글 인증이 만료되었습니다. 다시 연결하세요'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.message || `구글 캘린더 오류 (${res.status})`);
  return body;
}

// 구글 이벤트 → 로컬 일정
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

async function syncGoogle() {
  if (gBusy) return;
  gBusy = true; updateGcalStatus();
  try {
    // 보고 있는 달 기준 앞 1개월 ~ 뒤 2개월
    const from = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1);
    const to = new Date(calCursor.getFullYear(), calCursor.getMonth() + 3, 1);
    const items = [];
    let pageToken = '';
    do {
      const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
      if (pageToken) q.set('pageToken', pageToken);
      const body = await gcal('/events?' + q);
      items.push(...(body.items || []));
      pageToken = body.nextPageToken || '';
    } while (pageToken);

    const fromStr = ymd(from), toStr = ymd(to);
    const prevById = Object.fromEntries(state.events.filter((e) => e.source === 'google').map((e) => [e.gid, e]));
    state.events = state.events.filter((e) => !(e.source === 'google' && e.date >= fromStr && e.date < toStr));
    const fresh = items.filter((i) => i.status !== 'cancelled').map((i) => fromGoogle(i, prevById[i.id])).filter((e) => e.date);
    state.events.push(...fresh);
    save();
    toast(`구글 캘린더 일정 ${fresh.length}개를 가져왔습니다`);
  } catch (e) {
    toast(e.message);
  } finally {
    gBusy = false;
    render();
  }
}

async function createInGoogle(ev) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const nextDay = (d) => { const x = parseYmd(d); x.setDate(x.getDate() + 1); return ymd(x); };
  let start, end;
  if (ev.start) {
    let endTime = ev.end;
    if (!endTime) { const [h, m] = ev.start.split(':').map(Number); endTime = `${pad(Math.min(h + 1, 23))}:${pad(h >= 23 ? 59 : m)}`; }
    start = { dateTime: `${ev.date}T${ev.start}:00`, timeZone: tz };
    end = { dateTime: `${ev.date}T${endTime}:00`, timeZone: tz };
  } else {
    start = { date: ev.date };
    end = { date: nextDay(ev.date) };
  }
  return gcal('/events', { method: 'POST', body: JSON.stringify({ summary: ev.title, description: ev.memo || undefined, start, end }) });
}

// 일정 저장 시 "구글 캘린더에도 추가" — app.js 의 submit 처리보다 먼저 값을 읽기 위해 capture 단계 사용
$('#event-form').addEventListener('submit', (e) => {
  if ($('#ev-id').value || !$('#ev-gcal').checked || !gConnected()) return;
  const ev = { title: $('#ev-title').value.trim(), date: $('#ev-date').value, start: $('#ev-start').value, end: $('#ev-end').value, memo: $('#ev-memo').value.trim(), cat: $('#ev-cat').value };
  if (!ev.title || !ev.date) return;
  setTimeout(async () => {
    try {
      const item = await createInGoogle(ev);
      // 방금 만든 로컬 일정을 구글 일정으로 교체 (다음 가져오기 때 중복 방지)
      const idx = state.events.findLastIndex((x) => !x.source && x.title === ev.title && x.date === ev.date);
      const mapped = { ...fromGoogle(item), cat: ev.cat };
      if (idx >= 0) state.events.splice(idx, 1, mapped); else state.events.push(mapped);
      save(); render();
      toast('구글 캘린더에도 추가했습니다');
    } catch (err) { toast('구글 캘린더 추가 실패: ' + err.message); }
  }, 0);
}, true);

function updateGcalStatus() {
  const el = $('#gcal-status');
  if (!el) return;
  const n = state.events.filter((e) => e.source === 'google').length;
  $('#gcal-sync').hidden = !gConnected();
  $('#gcal-sync').disabled = gBusy;
  $('#gcal-connect').hidden = gConnected();
  $('#ev-gcal-wrap').hidden = !gConnected() || !!$('#ev-id').value;
  el.textContent = gBusy ? '가져오는 중…'
    : gConnected() ? `구글 캘린더 연결됨${n ? ` · 가져온 일정 ${n}개` : ''}`
    : state.settings.googleClientId ? `구글 캘린더 미연결${n ? ` · 이전에 가져온 일정 ${n}개` : ''}` : '설정 탭에서 구글 OAuth 클라이언트 ID를 등록하세요';
}
$('#gcal-connect').addEventListener('click', async () => { if (await connectGoogle()) syncGoogle(); });
$('#gcal-sync').addEventListener('click', syncGoogle);

/* =========================================================
 * 삼성헬스 CSV 가져오기
 * 내보내기 파일 예: com.samsung.shealth.sleep.<시각>.csv
 *  1행: 메타데이터, 2행: 헤더(com.samsung.health.sleep.start_time 처럼 접두사 포함), 3행~: 데이터
 *  시각은 UTC 로 기록되고 time_offset(예: UTC+0900) 열이 함께 있습니다.
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

// "2024-01-15 23:10:00.000" (UTC) + "UTC+0900" → 현지 날짜
function localDate(ts, offset) {
  if (!ts) return null;
  if (/^\d{12,}$/.test(ts)) ts = new Date(Number(ts)).toISOString(); // 밀리초 epoch
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(ts);
  if (!m) return null;
  const om = /UTC([+-])(\d{2}):?(\d{2})/.exec(offset || '');
  if (!om) return { date: `${m[1]}-${m[2]}-${m[3]}`, ms: Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) };
  const ms = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]);
  const local = new Date(ms + (om[1] === '-' ? -1 : 1) * (om[2] * 60 + +om[3]) * 60000);
  return { date: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`, ms };
}

function readSamsung(name, text) {
  const n = name.toLowerCase();
  const type =
    /pedometer_day_summary/.test(n) ? 'steps'
    : /shealth\.sleep\.\d/.test(n) ? 'sleep'
    : /shealth\.exercise\.\d/.test(n) ? 'exercise'
    : /health\.weight\.\d/.test(n) ? 'weight' : null;
  if (!type) return null;
  const rows = tableOf(text);
  if (!rows) return null;
  const out = {}; // date -> value
  for (const r of rows) {
    if (type === 'steps') {
      // day_time = 해당 날짜 0시(UTC)의 epoch ms. 기기별로 행이 나뉠 수 있어 최댓값 사용
      const d = r.day_time && /^\d+$/.test(r.day_time) ? new Date(Number(r.day_time)).toISOString().slice(0, 10) : localDate(r.day_time)?.date;
      const v = Number(r.step_count);
      if (d && v >= 0) out[d] = Math.max(out[d] || 0, v);
    } else if (type === 'sleep') {
      const s = localDate(r.start_time, r.time_offset), e = localDate(r.end_time, r.time_offset);
      if (!s || !e || e.ms <= s.ms) continue;
      out[e.date] = (out[e.date] || 0) + (e.ms - s.ms) / 3600000; // 깬 날짜 기준
    } else if (type === 'exercise') {
      const s = localDate(r.start_time, r.time_offset), dur = Number(r.duration);
      if (s && dur > 0) out[s.date] = (out[s.date] || 0) + dur / 60000;
    } else if (type === 'weight') {
      const s = localDate(r.start_time, r.time_offset), w = Number(r.weight);
      if (s && w > 0) out[s.date] = w; // 같은 날은 마지막 값
    }
  }
  return { type, out };
}

$('#sh-files').addEventListener('change', async (ev) => {
  const files = [...ev.target.files];
  ev.target.value = '';
  if (!files.length) return;
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
  const round = (v, k) => (k === 'steps' ? Math.round(v) : k === 'exercise' ? Math.round(v) : Math.round(v * 10) / 10);
  for (const [k, m] of Object.entries(merged)) {
    for (const [d, v] of Object.entries(m)) state.logs[d] = { ...state.logs[d], [k]: round(v, k) };
  }
  save();
  $('#sh-result').textContent = '✅ ' + msg + ' 반영 완료';
  render();
});

/* =========================================================
 * 설정 폼 · 렌더 훅
 * ========================================================= */
function readIntegForm() {
  secrets.tossUrl = $('#set-toss-url').value.trim();
  secrets.tossToken = $('#set-toss-token').value.trim();
  saveSecrets();
}
function fillIntegForm() {
  $('#set-toss-url').value = secrets.tossUrl || '';
  $('#set-toss-token').value = secrets.tossToken || '';
  $('#set-usdkrw').value = state.settings.usdKrw ?? '';
  $('#set-gclient').value = state.settings.googleClientId || '';
  $('#set-gcal-id').value = state.settings.googleCalendarId || 'primary';
}
$('#integ-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  readIntegForm();
  const fx = parseFloat($('#set-usdkrw').value);
  if (fx > 0) state.settings.usdKrw = fx;
  const newClient = $('#set-gclient').value.trim();
  if (newClient !== state.settings.googleClientId) { gToken = null; sessionStorage.removeItem(GTOKEN_KEY); }
  state.settings.googleClientId = newClient;
  state.settings.googleCalendarId = $('#set-gcal-id').value.trim() || 'primary';
  save(); toast('연동 설정을 저장했습니다'); render();
});

const baseRender = render;
render = function () {
  baseRender();
  const active = document.querySelector('.view.active')?.id;
  if (active === 'view-settings') fillIntegForm();
  updateTossStatus();
  updateGcalStatus();
  // 주식·홈 화면을 열 때 10분 넘게 지난 토스 데이터는 조용히 갱신
  if ((active === 'view-stocks' || active === 'view-dashboard') && tossConfigured() && !tossBusy && !tossError &&
      (!state.toss || Date.now() - new Date(state.toss.fetchedAt) > 10 * 60 * 1000)) {
    syncToss({ silent: true });
  }
};
$('#ev-cancel').addEventListener('click', updateGcalStatus);
document.addEventListener('click', (e) => { if (e.target.classList.contains('ev-edit')) updateGcalStatus(); });
render();
