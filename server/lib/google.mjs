// 구글 캘린더 — 서버 측 OAuth(Authorization Code + refresh token). 한 번 연결하면 계속 유지됩니다.
import { HttpError } from './toss.mjs';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

export function createGoogle({
  clientId, clientSecret, redirectUri, secrets,
  authBase = 'https://accounts.google.com', tokenBase = 'https://oauth2.googleapis.com', apiBase = 'https://www.googleapis.com',
}) {
  const configured = !!(clientId && clientSecret && redirectUri);
  let access = null; // { value, expiresAt }

  const connected = () => !!secrets.value.google?.refreshToken;

  function authUrl(state) {
    const q = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE,
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
    });
    return `${authBase}/o/oauth2/v2/auth?${q}`;
  }

  async function tokenRequest(params) {
    const res = await fetch(`${tokenBase}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, body };
  }

  async function exchange(code) {
    const { ok, body } = await tokenRequest({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
    if (!ok || !body.refresh_token) throw new HttpError(502, `구글 연결 실패: ${body.error_description || body.error || 'refresh token 없음'}`);
    access = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
    await secrets.write({ ...secrets.value, google: { refreshToken: body.refresh_token, connectedAt: new Date().toISOString() } });
  }

  async function accessToken() {
    if (!connected()) throw new HttpError(409, '구글 캘린더가 연결되어 있지 않습니다.');
    if (access && Date.now() < access.expiresAt) return access.value;
    const { ok, body } = await tokenRequest({ refresh_token: secrets.value.google.refreshToken, grant_type: 'refresh_token' });
    if (!ok) {
      if (body.error === 'invalid_grant') { // 사용자가 권한을 회수했거나 만료됨 → 연결 해제
        await secrets.write({ ...secrets.value, google: null });
        throw new HttpError(409, '구글 연결이 만료되었습니다. 설정에서 다시 연결하세요.');
      }
      throw new HttpError(502, `구글 토큰 갱신 실패: ${body.error || 'unknown'}`);
    }
    access = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
    return access.value;
  }

  async function api(path, opts = {}) {
    const res = await fetch(`${apiBase}/calendar/v3${path}`, {
      ...opts,
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) access = null;
    if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, `구글 캘린더 오류 (${res.status}): ${body.error?.message || ''}`);
    return body;
  }

  const calPath = (calendarId) => {
    const id = calendarId || 'primary';
    if (!/^[\w.@#+-]{1,200}$/.test(id)) throw new HttpError(400, '캘린더 ID 형식이 올바르지 않습니다.');
    return `/calendars/${encodeURIComponent(id)}`;
  };

  async function listEvents({ calendarId, timeMin, timeMax }) {
    if (isNaN(Date.parse(timeMin)) || isNaN(Date.parse(timeMax))) throw new HttpError(400, '기간이 올바르지 않습니다.');
    const items = [];
    let pageToken = '';
    for (let page = 0; page < 20; page++) {
      const q = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
      if (pageToken) q.set('pageToken', pageToken);
      const body = await api(`${calPath(calendarId)}/events?${q}`);
      items.push(...(body.items || []));
      pageToken = body.nextPageToken;
      if (!pageToken) break;
    }
    return items
      .filter((i) => i.status !== 'cancelled')
      .map(({ id, summary, description, location, start, end, htmlLink }) => ({ id, summary, description, location, start, end, htmlLink }));
  }

  async function createEvent({ calendarId, event }) {
    const pick = (t) => (t && (t.dateTime || t.date) ? { dateTime: t.dateTime, date: t.date, timeZone: t.timeZone } : null);
    const body = {
      summary: String(event?.summary || '').slice(0, 300),
      description: event?.description ? String(event.description).slice(0, 2000) : undefined,
      start: pick(event?.start), end: pick(event?.end),
    };
    if (!body.summary || !body.start || !body.end) throw new HttpError(400, '제목과 시작·종료 시각이 필요합니다.');
    const r = await api(`${calPath(calendarId)}/events`, { method: 'POST', body: JSON.stringify(body) });
    return { id: r.id, summary: r.summary, start: r.start, end: r.end, htmlLink: r.htmlLink };
  }

  async function disconnect() {
    const rt = secrets.value.google?.refreshToken;
    access = null;
    await secrets.write({ ...secrets.value, google: null });
    if (rt) await fetch(`${tokenBase}/revoke`, { method: 'POST', body: new URLSearchParams({ token: rt }) }).catch(() => {});
  }

  return { configured, connected, authUrl, exchange, listEvents, createEvent, disconnect };
}
