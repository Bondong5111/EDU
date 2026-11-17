// 팻시크릿(FatSecret) — 기존 계정의 식단·체중 일지 조회 전용. 3-legged OAuth 1.0 (HMAC-SHA1)
// 문서: https://platform.fatsecret.com/docs/guides/authentication/oauth1/three-legged
// 쓰기(일지 추가·수정·삭제) API 는 구현하지 않습니다.
import crypto from 'node:crypto';
import { HttpError } from './toss.mjs';

// RFC 3986 퍼센트 인코딩 (encodeURIComponent 가 남겨두는 ! * ' ( ) 까지)
export const enc = (s) => encodeURIComponent(String(s)).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export function baseString(method, url, params) {
  const pairs = Object.entries(params).map(([k, v]) => [enc(k), enc(v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return [method.toUpperCase(), enc(url), enc(pairs.map((p) => p.join('=')).join('&'))].join('&');
}
export const signature = (base, consumerSecret, tokenSecret = '') =>
  crypto.createHmac('sha1', `${enc(consumerSecret)}&${enc(tokenSecret)}`).update(base).digest('base64');

const DAY = 86400000;
const toInt = (date) => Math.round(Date.parse(date + 'T00:00:00Z') / DAY); // 1970-01-01 부터의 일수
const toDate = (n) => new Date(Number(n) * DAY).toISOString().slice(0, 10);
const list = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const num = (v, digits) => { const n = Number(v); if (!Number.isFinite(n)) return null; const p = 10 ** digits; return Math.round(n * p) / p; };

export function createFatsecret({
  consumerKey, consumerSecret, callbackUrl, secrets,
  authBase = 'https://authentication.fatsecret.com', apiBase = 'https://platform.fatsecret.com',
}) {
  const configured = !!(consumerKey && consumerSecret && callbackUrl);
  const pending = new Map(); // 요청 토큰 -> { secret, exp }  (승인 화면에 다녀오는 동안만 보관)
  const connected = () => !!secrets.value.fatsecret?.token;

  function signed(method, url, params, tokenSecret) {
    const all = {
      ...params,
      oauth_consumer_key: consumerKey, oauth_signature_method: 'HMAC-SHA1', oauth_version: '1.0',
      oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_nonce: crypto.randomBytes(16).toString('hex'),
    };
    all.oauth_signature = signature(baseString(method, url, all), consumerSecret, tokenSecret);
    return new URLSearchParams(all);
  }

  // 1단계: 요청 토큰 → 사용자를 보낼 승인 주소
  async function connectUrl() {
    const url = `${authBase}/oauth/request_token`;
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: signed('POST', url, { oauth_callback: callbackUrl }),
    });
    const text = await res.text();
    const p = new URLSearchParams(text);
    const token = p.get('oauth_token'), secret = p.get('oauth_token_secret');
    if (!res.ok || !token || !secret) throw new HttpError(502, `팻시크릿 연결 시작 실패 (${res.status}): ${text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 160)}`);
    for (const [k, v] of pending) if (v.exp < Date.now()) pending.delete(k);
    pending.set(token, { secret, exp: Date.now() + 15 * 60e3 });
    return `${authBase}/oauth/authorize?oauth_token=${enc(token)}`;
  }

  // 3단계: 승인된 요청 토큰 → 접근 토큰 (만료 없음, 사용자가 팻시크릿에서 회수할 때까지 유효)
  async function exchange(token, verifier) {
    const p = pending.get(token);
    pending.delete(token);
    if (!p || p.exp < Date.now()) throw new HttpError(400, '연결 요청이 만료되었습니다. 다시 시도하세요.');
    const url = `${authBase}/oauth/access_token`;
    const res = await fetch(`${url}?${signed('GET', url, { oauth_token: token, oauth_verifier: verifier }, p.secret)}`);
    const text = await res.text();
    const out = new URLSearchParams(text);
    if (!res.ok || !out.get('oauth_token') || !out.get('oauth_token_secret')) throw new HttpError(502, `팻시크릿 연결 실패 (${res.status})`);
    await secrets.write({ ...secrets.value, fatsecret: { token: out.get('oauth_token'), secret: out.get('oauth_token_secret'), connectedAt: new Date().toISOString() } });
  }

  async function call(method, params = {}) {
    const fs = secrets.value.fatsecret;
    if (!fs?.token) throw new HttpError(409, '팻시크릿이 연결되어 있지 않습니다.');
    const url = `${apiBase}/rest/server.api`;
    const res = await fetch(`${url}?${signed('GET', url, { method, format: 'json', oauth_token: fs.token, ...params }, fs.secret)}`);
    const body = await res.json().catch(() => null);
    const err = body?.error;
    if (err || !res.ok || !body) {
      const code = Number(err?.code);
      if (code === 9) { // 접근 토큰이 회수됨 → 연결 해제
        await secrets.write({ ...secrets.value, fatsecret: null });
        throw new HttpError(409, '팻시크릿 연결이 끊어졌습니다. 설정에서 다시 연결하세요.');
      }
      const hint = code === 21 ? ' — 서버의 공인 IP 를 팻시크릿 개발자 페이지의 허용 IP 에 등록하세요.'
        : code === 5 || code === 8 ? ' — FATSECRET_CONSUMER_KEY / SECRET 을 확인하세요.'
        : code === 11 || code === 12 ? ' — 호출 한도를 넘었습니다. 잠시 후 다시 시도하세요.' : '';
      throw new HttpError(code === 11 || code === 12 ? 429 : 502, `팻시크릿 API 오류 (${err?.code ?? res.status}${err?.message ? ' ' + String(err.message).slice(0, 120) : ''})${hint}`);
    }
    return body;
  }

  // 기간의 날짜별 합계: { 'YYYY-MM-DD': { kcal, carb, protein, fat, weight } }
  // 월 단위 API 라서 한 달에 2번(식단·체중) 호출합니다.
  async function diary({ from, to }) {
    const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s + 'T00:00:00Z'));
    if (!ok(from) || !ok(to) || from > to) throw new HttpError(400, '기간이 올바르지 않습니다.');
    const months = [];
    for (let y = +from.slice(0, 4), m = +from.slice(5, 7); `${y}-${String(m).padStart(2, '0')}` <= to.slice(0, 7); m === 12 ? (y++, m = 1) : m++) {
      months.push(`${y}-${String(m).padStart(2, '0')}`);
    }
    if (months.length > 24) throw new HttpError(400, '한 번에 24개월까지만 가져올 수 있습니다.');
    const days = {};
    const put = (n, patch) => {
      const d = toDate(n);
      if (d >= from && d <= to) days[d] = { ...days[d], ...patch };
    };
    for (const ym of months) {
      const date = String(toInt(ym + '-15'));
      const food = await call('food_entries.get_month.v2', { date });
      for (const x of list(food.month?.day)) {
        put(x.date_int, { kcal: num(x.calories, 0), carb: num(x.carbohydrate, 1), protein: num(x.protein, 1), fat: num(x.fat, 1) });
      }
      const weight = await call('weights.get_month.v2', { date });
      for (const x of list(weight.month?.day)) {
        const kg = num(x.weight_kg, 1);
        if (kg > 0) put(x.date_int, { weight: kg });
      }
    }
    return { from, to, days, fetchedAt: new Date().toISOString() };
  }

  async function disconnect() {
    pending.clear();
    await secrets.write({ ...secrets.value, fatsecret: null });
  }

  return { configured, connected, connectUrl, exchange, diary, disconnect };
}
