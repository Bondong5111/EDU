#!/usr/bin/env node
/**
 * 토스증권 Open API 조회 전용 중계 서버 (의존성 없음, Node 18+)
 *
 * 왜 필요한가
 *  - client_secret 은 브라우저에 두면 노출되므로 서버에서만 사용해야 합니다.
 *  - 토스증권은 "허용 IP" 로 등록된 고정 IP 에서 온 호출만 받습니다.
 *    → 고정 IP 가 있는 집 PC·NAS·VPS 에서 이 서버를 실행하세요.
 *
 * 안전장치
 *  - 계좌 목록 / 보유 주식 / 환율 "조회"만 중계합니다. 주문 API 는 아예 열어두지 않습니다.
 *  - 웹사이트는 PROXY_TOKEN 을 Authorization 헤더로 보내야 하며, ALLOWED_ORIGIN 에서만 CORS 를 허용합니다.
 *
 * 환경변수
 *  TOSS_CLIENT_ID      (필수) 토스증권 WTS > 설정 > Open API 에서 발급
 *  TOSS_CLIENT_SECRET  (필수)
 *  PROXY_TOKEN         (필수) 웹사이트 설정에 넣을 임의의 긴 비밀 문자열
 *  ALLOWED_ORIGIN      (권장) 예: https://<아이디>.github.io  (쉼표로 여러 개)
 *  PORT                (선택) 기본 8787
 *  HOST                (선택) 기본 127.0.0.1  (터널/리버스 프록시 뒤에서 실행 권장)
 */
import http from 'node:http';
import crypto from 'node:crypto';

const API = process.env.TOSS_API_BASE || 'https://openapi.tossinvest.com'; // 테스트용으로만 바꾸세요
const {
  TOSS_CLIENT_ID, TOSS_CLIENT_SECRET, PROXY_TOKEN,
  ALLOWED_ORIGIN = '', PORT = '8787', HOST = '127.0.0.1',
} = process.env;

if (!TOSS_CLIENT_ID || !TOSS_CLIENT_SECRET || !PROXY_TOKEN) {
  console.error('TOSS_CLIENT_ID, TOSS_CLIENT_SECRET, PROXY_TOKEN 환경변수를 설정하세요.');
  process.exit(1);
}
if (PROXY_TOKEN.length < 24) {
  console.error('PROXY_TOKEN 은 24자 이상으로 정하세요. 예: node -e "console.log(crypto.randomBytes(24).toString(\'hex\'))"');
  process.exit(1);
}
const origins = ALLOWED_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);

/* ---------- 토큰: 클라이언트당 유효 토큰이 1개이므로 하나를 공유·재사용 ---------- */
let token = null; // { value, expiresAt }
let tokenPromise = null;

async function issueToken() {
  const res = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: TOSS_CLIENT_ID, client_secret: TOSS_CLIENT_SECRET }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new HttpError(502, `토큰 발급 실패 (${res.status}): ${body.error_description || body.error || '응답 없음'}`);
  }
  token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in || 3600) * 1000 - 5 * 60 * 1000 };
  return token.value;
}
async function getToken(force = false) {
  if (!force && token && Date.now() < token.expiresAt) return token.value;
  // 동시에 여러 요청이 와도 발급은 한 번만 (새로 발급하면 직전 토큰이 무효화되므로)
  tokenPromise ||= issueToken().finally(() => { tokenPromise = null; });
  return tokenPromise;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function tossGet(path, { account } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = { Authorization: `Bearer ${await getToken(attempt > 0)}` };
    if (account != null) headers['X-Tossinvest-Account'] = String(account);
    const res = await fetch(API + path, { headers });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 && attempt === 0) continue; // 만료·폐기된 토큰 → 재발급 후 1회 재시도
    if (!res.ok) {
      const code = body?.error?.code || body?.error || '';
      const hint = code === 'ip-not-allowed' ? ' — 이 서버의 공인 IP 를 토스증권 허용 IP 에 등록하세요.' : '';
      throw new HttpError(res.status, `토스증권 API 오류 (${res.status} ${code})${hint}`);
    }
    return body.result;
  }
}

/* ---------- 짧은 캐시 (계좌 API 는 초당 1회 제한) ---------- */
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/* ---------- 라우트 (GET 조회만) ---------- */
const routes = {
  '/toss/accounts': () => cached('accounts', 60_000, () => tossGet('/api/v1/accounts')),
  '/toss/holdings': async (q) => {
    const accounts = await cached('accounts', 60_000, () => tossGet('/api/v1/accounts'));
    const seq = q.get('account') || accounts?.[0]?.accountSeq;
    if (seq == null) throw new HttpError(404, '연결된 계좌가 없습니다.');
    if (!accounts.some((a) => String(a.accountSeq) === String(seq))) throw new HttpError(400, '알 수 없는 계좌입니다.');
    const [holdings, fx] = await Promise.all([
      cached('holdings:' + seq, 3_000, () => tossGet('/api/v1/holdings', { account: seq })),
      cached('fx', 60_000, () => tossGet('/api/v1/exchange-rate?baseCurrency=USD&quoteCurrency=KRW')).catch(() => null),
    ]);
    return { accountSeq: Number(seq), holdings, usdKrw: fx?.rate ?? null, fetchedAt: new Date().toISOString() };
  },
  '/toss/health': async () => ({ ok: true }),
};

function safeEqual(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function send(res, status, data, origin) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (origin && origins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'Authorization';
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
  }
  res.writeHead(status, headers);
  res.end(status === 204 ? undefined : JSON.stringify(data));
}

http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') return send(res, 204, null, origin);
  if (req.method !== 'GET') return send(res, 405, { error: '조회(GET)만 지원합니다.' }, origin);
  if (origin && origins.length && !origins.includes(origin)) return send(res, 403, { error: '허용되지 않은 출처입니다.' }, origin);

  const auth = req.headers.authorization || '';
  if (!safeEqual(auth, `Bearer ${PROXY_TOKEN}`)) return send(res, 401, { error: '인증 실패: PROXY_TOKEN 을 확인하세요.' }, origin);

  const handler = routes[url.pathname];
  if (!handler) return send(res, 404, { error: '없는 경로입니다.' }, origin);
  try {
    send(res, 200, await handler(url.searchParams), origin);
  } catch (e) {
    console.error(new Date().toISOString(), url.pathname, e.message);
    send(res, e.status || 500, { error: e.message }, origin);
  }
}).listen(Number(PORT), HOST, () => {
  console.log(`토스 조회 중계 서버: http://${HOST}:${PORT}  (허용 출처: ${origins.join(', ') || '없음 — ALLOWED_ORIGIN 설정 필요'})`);
});
