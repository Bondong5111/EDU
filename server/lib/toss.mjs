// 토스증권 Open API — 조회 전용 (계좌 목록 · 보유 주식 · 환율). 주문 API 는 구현하지 않습니다.
// 스펙: https://openapi.tossinvest.com/openapi-docs/latest/openapi.json
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createToss({ clientId, clientSecret, apiBase = 'https://openapi.tossinvest.com' }) {
  const configured = !!(clientId && clientSecret);
  let token = null;        // { value, expiresAt }
  let tokenPromise = null; // 동시 발급 방지 (새로 발급하면 직전 토큰이 무효화됨)
  const cache = new Map();

  async function issueToken() {
    const res = await fetch(`${apiBase}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      throw new HttpError(502, `토스증권 토큰 발급 실패 (${res.status}): ${body.error_description || body.error || '응답 없음'}`);
    }
    token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in || 3600) * 1000 - 5 * 60 * 1000 };
    return token.value;
  }
  function getToken(force) {
    if (!force && token && Date.now() < token.expiresAt) return token.value;
    tokenPromise ||= issueToken().finally(() => { tokenPromise = null; });
    return tokenPromise;
  }

  async function get(path, account) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers = { Authorization: `Bearer ${await getToken(attempt > 0)}` };
      if (account != null) headers['X-Tossinvest-Account'] = String(account);
      const res = await fetch(apiBase + path, { headers });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401 && attempt === 0) continue; // 만료·폐기 → 재발급 후 1회 재시도
      if (!res.ok) {
        const code = body?.error?.code || body?.error || '';
        const hint = code === 'ip-not-allowed' ? ' — 서버의 공인 IP 를 토스증권 허용 IP 에 등록하세요.' : '';
        throw new HttpError(res.status === 429 ? 429 : 502, `토스증권 API 오류 (${res.status} ${code})${hint}`);
      }
      return body.result;
    }
  }

  async function cached(key, ttl, fn) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const value = await fn();
    cache.set(key, { at: Date.now(), value });
    return value;
  }

  const accounts = () => cached('accounts', 60_000, () => get('/api/v1/accounts')); // 계좌 API 초당 1회 제한

  async function holdings(accountSeq) {
    const list = await accounts();
    const seq = accountSeq ?? list?.[0]?.accountSeq;
    if (seq == null) throw new HttpError(404, '토스증권 계좌가 없습니다.');
    if (!list.some((a) => String(a.accountSeq) === String(seq))) throw new HttpError(400, '알 수 없는 계좌입니다.');
    const [h, fx] = await Promise.all([
      cached('holdings:' + seq, 3_000, () => get('/api/v1/holdings', seq)),
      cached('fx', 60_000, () => get('/api/v1/exchange-rate?baseCurrency=USD&quoteCurrency=KRW')).catch(() => null),
    ]);
    return { accountSeq: Number(seq), items: h?.items || [], usdKrw: fx?.rate != null ? Number(fx.rate) : null, fetchedAt: new Date().toISOString() };
  }

  return { configured, accounts, holdings };
}
