#!/usr/bin/env node
/**
 * MY LIFE 통합 서버 (의존성 없음, Node 18+)
 *  - 웹사이트 제공 + 비밀번호 로그인
 *  - 모든 기기 데이터 동기화 (JSON 파일 저장 + 시간별 백업)
 *  - 토스증권 조회 / 구글 캘린더 연동
 *
 * 실행:  node --env-file=server/.env server/server.mjs
 * 설정값은 server/.env.example 참고
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { JsonFile } from './lib/store.mjs';
import { openDb } from './lib/db.mjs';
import Records from '../js/records.js';
import { createToss, HttpError } from './lib/toss.mjs';
import { createGoogle } from './lib/google.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const PORT = Number(env.PORT || 8787);
const HOST = env.HOST || '127.0.0.1';
const BASE_URL = (env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const DATA_DIR = path.resolve(ROOT, env.DATA_DIR || 'server/data');
const SECURE = BASE_URL.startsWith('https://');
const TRUST_PROXY = env.TRUST_PROXY === '1';
const SESSION_DAYS = 30;

if (!env.APP_PASSWORD || env.APP_PASSWORD.length < 8) {
  console.error('APP_PASSWORD 환경변수(8자 이상)를 설정하세요. server/.env.example 참고');
  process.exit(1);
}

/* ---------- 저장소 ---------- */
const db = openDb(path.join(DATA_DIR, 'mylife.db'), { backupDir: path.join(DATA_DIR, 'backups') });
const secrets = new JsonFile(path.join(DATA_DIR, 'secrets.json'), { sessionKey: null, google: null });
await secrets.load();

// 이전 버전(db.json 한 문서)에서 올라온 경우: 기록 단위로 풀어서 옮김
const legacyFile = path.join(DATA_DIR, 'db.json');
if (db.isEmpty()) {
  try {
    const legacy = JSON.parse(await fs.readFile(legacyFile, 'utf8'));
    if (legacy?.data) {
      const flat = Records.flatten(legacy.data);
      const changes = Object.entries(flat).map(([k, v]) => ({ k, v }));
      if (changes.length) db.write(changes, Records.info);
      await fs.rename(legacyFile, legacyFile + '.migrated');
      console.log(`이전 데이터 ${changes.length}건을 새 데이터베이스로 옮겼습니다.`);
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('이전 데이터 변환 실패:', e.message);
  }
}
if (!secrets.value.sessionKey) await secrets.write({ ...secrets.value, sessionKey: crypto.randomBytes(32).toString('hex') });

const toss = createToss({ clientId: env.TOSS_CLIENT_ID, clientSecret: env.TOSS_CLIENT_SECRET, apiBase: env.TOSS_API_BASE });
const google = createGoogle({
  clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET,
  redirectUri: `${BASE_URL}/api/google/callback`, secrets,
  ...(env.GOOGLE_TEST_BASE ? { authBase: env.GOOGLE_TEST_BASE, tokenBase: env.GOOGLE_TEST_BASE, apiBase: env.GOOGLE_TEST_BASE } : {}),
});

/* ---------- 세션 (HMAC 서명 쿠키) ---------- */
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (s) => b64(crypto.createHmac('sha256', secrets.value.sessionKey).update(s).digest());
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p.length === 2));
}
function makeCookie(name, value, maxAgeSec) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${SECURE ? '; Secure' : ''}`;
}
function isAuthed(req) {
  const v = cookies(req).ml_sid;
  if (!v) return false;
  const [exp, sig] = v.split('.');
  return !!exp && !!sig && safeEq(sig, sign('sid:' + exp)) && Number(exp) > Date.now();
}
function newSessionCookie() {
  const exp = String(Date.now() + SESSION_DAYS * 86400e3);
  return makeCookie('ml_sid', `${exp}.${sign('sid:' + exp)}`, SESSION_DAYS * 86400);
}

/* ---------- 로그인 시도 제한 ---------- */
const failures = new Map(); // ip -> { count, until }
const clientIp = (req) => (TRUST_PROXY && (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',')[0].trim())) || req.socket.remoteAddress;
function checkPassword(pw) {
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(pw), h(env.APP_PASSWORD));
}

/* ---------- 응답 도우미 ---------- */
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
function json(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
  res.end(JSON.stringify(data));
}
function redirect(res, to, headers = {}) {
  res.writeHead(302, { Location: to, 'Cache-Control': 'no-store', ...headers });
  res.end();
}
async function readJson(req, limit = 8 * 1024 * 1024) {
  let size = 0; const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, '데이터가 너무 큽니다.');
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new HttpError(400, 'JSON 형식이 아닙니다.'); }
}

/* ---------- 정적 파일 (허용 목록만) ---------- */
const STATIC = /^\/(index\.html|manifest\.webmanifest|sw\.js|(css|js|icons)\/[\w.-]+|fonts\/[\w-]+\/(woff2-dynamic-subset\/)?[\w.-]+\.(css|woff2|txt))$/;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
async function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (!STATIC.test(pathname)) return false;
  const file = path.join(ROOT, pathname);
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  } catch { return false; }
}

/* ---------- API ---------- */
const pendingOAuth = new Map(); // state -> expiresAt

const routes = {
  'GET /api/session': async (req) => ({
    server: true,
    authed: isAuthed(req),
    integrations: isAuthed(req) ? {
      toss: { configured: toss.configured },
      google: { configured: google.configured, connected: google.connected(), connectedAt: secrets.value.google?.connectedAt || null },
    } : undefined,
  }),

  'POST /api/login': async (req, res) => {
    const ip = clientIp(req);
    const f = failures.get(ip);
    if (f && f.count >= 5 && f.until > Date.now()) throw new HttpError(429, `로그인 시도가 너무 많습니다. ${Math.ceil((f.until - Date.now()) / 60000)}분 후 다시 시도하세요.`);
    const { password } = await readJson(req, 4096);
    if (!checkPassword(password || '')) {
      const n = (f && f.until > Date.now() ? f.count : 0) + 1;
      failures.set(ip, { count: n, until: Date.now() + 15 * 60e3 });
      await new Promise((r) => setTimeout(r, 400));
      throw new HttpError(401, '비밀번호가 올바르지 않습니다.');
    }
    failures.delete(ip);
    res.setHeader('Set-Cookie', newSessionCookie());
    return { ok: true };
  },

  'POST /api/logout': async (req, res) => {
    res.setHeader('Set-Cookie', makeCookie('ml_sid', '', 0));
    return { ok: true };
  },

  // 모든 기기 로그아웃: 서명 키 교체
  'POST /api/logout-all': async (req, res) => {
    await secrets.write({ ...secrets.value, sessionKey: crypto.randomBytes(32).toString('hex') });
    res.setHeader('Set-Cookie', makeCookie('ml_sid', '', 0));
    return { ok: true };
  },

  // 기록 동기화: 바뀐 줄만 주고받음
  'POST /api/sync': async (req) => {
    const { cursor, changes } = await readJson(req);
    if (!Array.isArray(changes) || changes.length > 100000) throw new HttpError(400, '변경 목록 형식이 올바르지 않습니다.');
    try {
      return db.sync(cursor, changes, Records.info);
    } catch (e) {
      if (e instanceof RangeError) throw new HttpError(400, e.message);
      throw e;
    }
  },

  'GET /api/toss/accounts': async () => {
    if (!toss.configured) throw new HttpError(409, '서버에 토스증권 키가 설정되지 않았습니다.');
    return (await toss.accounts()).map(({ accountSeq, accountType, accountNo }) => ({ accountSeq, accountType, accountNoMasked: String(accountNo || '').replace(/.(?=.{4})/g, '*') }));
  },
  'GET /api/toss/holdings': async (req, res, url) => {
    if (!toss.configured) throw new HttpError(409, '서버에 토스증권 키가 설정되지 않았습니다.');
    return toss.holdings(url.searchParams.get('account') || undefined);
  },

  'GET /api/google/connect': async (req, res) => {
    if (!google.configured) throw new HttpError(409, '서버에 구글 OAuth 설정이 없습니다.');
    const state = crypto.randomBytes(16).toString('hex');
    pendingOAuth.set(state, Date.now() + 10 * 60e3);
    redirect(res, google.authUrl(state));
  },
  'GET /api/google/callback': async (req, res, url) => {
    const state = url.searchParams.get('state');
    const exp = pendingOAuth.get(state);
    pendingOAuth.delete(state);
    if (!exp || exp < Date.now()) return redirect(res, '/?google=error#me');
    if (url.searchParams.get('error')) return redirect(res, '/?google=denied#me');
    try {
      await google.exchange(url.searchParams.get('code'));
      redirect(res, '/?google=connected#records');
    } catch (e) {
      console.error('google callback', e.message);
      redirect(res, '/?google=error#me');
    }
  },
  'POST /api/google/disconnect': async () => { await google.disconnect(); return { ok: true }; },
  'GET /api/google/events': async (req, res, url) => google.listEvents({
    calendarId: url.searchParams.get('calendarId'), timeMin: url.searchParams.get('timeMin'), timeMax: url.searchParams.get('timeMax'),
  }),
  'POST /api/google/events': async (req) => {
    const { calendarId, event } = await readJson(req, 64 * 1024);
    return google.createEvent({ calendarId, event });
  },
};
const PUBLIC = new Set(['GET /api/session', 'POST /api/login', 'GET /api/google/callback']);

/* ---------- 서버 ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE_URL);
  const key = `${req.method} ${url.pathname}`;
  try {
    if (url.pathname.startsWith('/api/')) {
      const handler = routes[key];
      if (!handler) throw new HttpError(404, '없는 API 입니다.');
      // CSRF 방지: 상태를 바꾸는 요청은 커스텀 헤더 필수 (다른 사이트에서는 붙일 수 없음)
      if (req.method !== 'GET' && req.headers['x-mylife'] !== '1') throw new HttpError(403, '잘못된 요청입니다.');
      if (!PUBLIC.has(key) && !isAuthed(req)) throw new HttpError(401, '로그인이 필요합니다.');
      if (key === 'GET /api/google/callback' && !isAuthed(req)) return redirect(res, '/?google=error#me');
      const out = await handler(req, res, url);
      if (!res.headersSent && out !== undefined) json(res, 200, out);
      return;
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && (await serveStatic(req, res, url.pathname))) return;
    json(res, 404, { error: '페이지를 찾을 수 없습니다.' });
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(new Date().toISOString(), key, e.message);
    if (!res.headersSent) json(res, status, { error: status >= 500 && !e.status ? '서버 오류' : e.message, ...(e.payload || {}) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`MY LIFE 서버: http://${HOST}:${PORT}  (공개 주소: ${BASE_URL})`);
  console.log(`  데이터: ${DATA_DIR} (기록 ${db.count()}건)`);
  console.log(`  토스증권: ${toss.configured ? '설정됨' : '미설정'} · 구글 캘린더: ${google.configured ? (google.connected() ? '연결됨' : '설정됨(미연결)') : '미설정'}`);
});
