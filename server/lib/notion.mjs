// 노션 연동 — 사이트에 쌓인 기록을 노션 표 다섯 개로 보냅니다 (사이트 → 노션, 한 방향).
//   날짜별 기록 · 주간 리뷰 · 목표 · 습관 · 할 일·일정
// 노션 내부 연결(internal connection) 토큰과, 그 연결에 공유한 페이지 하나만 있으면 됩니다.
// 그 페이지 아래에 표를 처음 한 번 만들고, 이후에는 바뀐 행만 고칩니다.
// 문서: https://developers.notion.com/reference/intro  (API 버전 2026-03-11)
import crypto from 'node:crypto';
import { HttpError } from './toss.mjs';
import { TABLES, TABLE_ORDER, buildRows } from './notion-rows.mjs';

export const NOTION_VERSION = '2026-03-11';

// 페이지 주소나 ID 에서 32자리 ID 를 꺼냄 (예: https://www.notion.so/내-페이지-1a2b…)
export function pageIdFrom(input) {
  const s = String(input || '').trim();
  const m = s.replace(/-/g, '').match(/([0-9a-f]{32})(?![0-9a-f])/i);
  if (!m) return null;
  const h = m[1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const hash = (v) => crypto.createHash('sha1').update(JSON.stringify(v)).digest('base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createNotion({ token, parent, store, loadState, timeZone, apiBase = 'https://api.notion.com', minGapMs = 350, log = console }) {
  const parentId = pageIdFrom(parent);
  const configured = !!(token && parentId);
  const status = { running: false, lastSyncAt: null, error: '', sent: 0 };
  let last = 0, queued = false, timer = null;

  /* ---------- 요청: 초당 약 3회 이하로 줄 세우고, 429/529 는 Retry-After 만큼 기다렸다 재시도 ---------- */
  async function api(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      const wait = last + minGapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      let res;
      try {
        res = await fetch(apiBase + path, {
          method,
          headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(30000),
        });
      } catch (e) {
        if (attempt < 3) { await sleep(2000 * (attempt + 1)); continue; }
        throw new HttpError(502, `노션에 연결하지 못했습니다: ${e.message}`);
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok) return data;
      if ((res.status === 429 || res.status === 529 || res.status === 409 || res.status >= 500) && attempt < 5) {
        const after = Number(res.headers.get('retry-after') || data?.additional_data?.retry_after) || 2 ** attempt;
        await sleep(Math.min(after, 120) * 1000 + Math.random() * 300);
        continue;
      }
      const err = new HttpError(res.status === 401 || res.status === 403 || res.status === 404 ? 409 : 502, explain(res.status, data));
      err.code = data?.code; err.httpStatus = res.status;
      throw err;
    }
  }
  function explain(status, data) {
    const code = data?.code || '';
    if (status === 401 || code === 'unauthorized') return '노션 토큰이 올바르지 않습니다. NOTION_TOKEN 을 확인하세요.';
    if (code === 'restricted_resource' || status === 403) return '노션 연결에 쓰기 권한이 없습니다. 연결 설정의 Capabilities 에서 내용 읽기·수정·추가를 켜세요.';
    if (status === 404) return '노션 페이지를 찾을 수 없습니다. NOTION_PAGE 의 페이지를 이 연결에 공유했는지 확인하세요.';
    return `노션 API 오류 (${status} ${code}): ${String(data?.message || '').slice(0, 200)}`;
  }

  /* ---------- 표 준비: 없으면 만들고, 지워졌거나 열이 빠졌으면 고침 ---------- */
  const st = () => (store.value ||= {});
  async function save(patch) { await store.write({ ...st(), ...patch }); }

  async function createTable(name) {
    const t = TABLES[name];
    const db = await api('POST', '/v1/databases', {
      parent: { type: 'page_id', page_id: parentId },
      title: [{ type: 'text', text: { content: t.title } }],
      icon: { type: 'emoji', emoji: t.icon },
      initial_data_source: { properties: t.properties },
    });
    const ds = db.data_sources?.[0]?.id;
    if (!ds) throw new HttpError(502, '노션이 표 정보를 돌려주지 않았습니다.');
    return { databaseId: db.id, dataSourceId: ds, url: db.url || null, titleName: Object.keys(t.properties)[0] };
  }

  async function ensureTable(name) {
    const tables = st().tables || {};
    let t = tables[name];
    if (t) {
      let ds = null;
      try { ds = await api('GET', `/v1/data_sources/${t.dataSourceId}`); } catch (e) { if (e.httpStatus !== 404) throw e; }
      if (!ds || ds.in_trash) t = null; // 노션에서 표를 지웠음 → 새로 만들고 모든 행을 다시 보냄
      else {
        // 사용자가 지운 열은 다시 추가. 제목 열 이름을 바꿨으면 바꾼 이름을 따름
        const have = ds.properties || {};
        const ours = TABLES[name].properties;
        const titleName = Object.values(have).find((p) => p.type === 'title')?.name || Object.keys(ours)[0];
        const missing = Object.fromEntries(Object.entries(ours).filter(([k, v]) => !v.title && !(k in have)));
        if (Object.keys(missing).length) await api('PATCH', `/v1/data_sources/${t.dataSourceId}`, { properties: missing });
        // 열을 다시 만들었으면 그 열이 빈 행이 생기므로 행 해시를 지워 전부 다시 보냄
        if (Object.keys(missing).length || titleName !== t.titleName) {
          t = { ...t, titleName };
          await save({ tables: { ...tables, [name]: t }, rows: { ...(st().rows || {}), [name]: Object.fromEntries(Object.entries(st().rows?.[name] || {}).map(([k, r]) => [k, { ...r, hash: '' }])) } });
        }
        return t;
      }
    }
    const created = await createTable(name);
    await save({ tables: { ...(st().tables || {}), [name]: created }, rows: { ...(st().rows || {}), [name]: {} } });
    return created;
  }

  /* ---------- 한 표의 행 맞추기 ---------- */
  async function syncTable(name, wanted) {
    const t = await ensureTable(name);
    const firstCol = Object.keys(TABLES[name].properties)[0];
    const rows = { ...(st().rows?.[name] || {}) };
    const keep = new Set();
    let changed = 0, n = 0;
    const commit = async () => { await save({ rows: { ...(st().rows || {}), [name]: rows } }); };
    for (const r of wanted) {
      keep.add(r.key);
      const props = { ...r.properties };
      if (t.titleName && t.titleName !== firstCol) { props[t.titleName] = props[firstCol]; delete props[firstCol]; }
      const h = hash(props), prev = rows[r.key];
      if (prev && prev.hash === h) continue;
      let pageId = prev?.pageId;
      if (pageId) {
        try {
          const p = await api('PATCH', `/v1/pages/${pageId}`, { properties: props, in_trash: false });
          if (p.in_trash) pageId = null;
        } catch (e) {
          if (e.httpStatus !== 404 && e.code !== 'object_not_found') throw e;
          pageId = null; // 노션에서 행을 영구 삭제함 → 새로 만듦
        }
      }
      if (!pageId) {
        const p = await api('POST', '/v1/pages', { parent: { type: 'data_source_id', data_source_id: t.dataSourceId }, properties: props });
        pageId = p.id;
      }
      rows[r.key] = { pageId, hash: h };
      changed++; status.sent++;
      if (++n % 20 === 0) await commit(); // 중간에 멈춰도 보낸 만큼은 기억
    }
    // 사이트에서 지운 항목 → 노션에서는 휴지통으로
    for (const [key, r] of Object.entries(rows)) {
      if (keep.has(key)) continue;
      try { await api('PATCH', `/v1/pages/${r.pageId}`, { in_trash: true }); } catch (e) { if (e.httpStatus !== 404) throw e; }
      delete rows[key];
      changed++;
    }
    await commit();
    return changed;
  }

  /* ---------- 전체 동기화 ---------- */
  async function run() {
    if (!configured) throw new HttpError(409, '서버에 노션 설정이 없습니다 (NOTION_TOKEN, NOTION_PAGE).');
    if (status.running) { queued = true; return status; }
    status.running = true; status.error = ''; status.sent = 0;
    try {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const all = buildRows(loadState(), today, { timeZone });
      for (const name of TABLE_ORDER) await syncTable(name, all[name]);
      status.lastSyncAt = new Date().toISOString();
      await save({ lastSyncAt: status.lastSyncAt });
      log.log?.(`노션: ${status.sent}건 보냄`);
    } catch (e) {
      status.error = e.message;
      log.error?.('노션 동기화 실패:', e.message);
      throw e;
    } finally {
      status.running = false;
      if (queued) { queued = false; schedule(5000); }
    }
    return status;
  }

  // 기록이 바뀌면 잠시 모았다가 보냄
  function schedule(ms = 90_000) {
    if (!configured) return;
    clearTimeout(timer);
    timer = setTimeout(() => run().catch(() => {}), ms);
    timer.unref?.();
  }

  // 30일 달성률처럼 날짜가 지나면 바뀌는 값이 있어 6시간마다 한 번 맞춤
  function start() {
    if (!configured) return;
    status.lastSyncAt = st().lastSyncAt || null;
    schedule(10_000);
    setInterval(() => run().catch(() => {}), 6 * 3600_000).unref?.();
  }

  const pageUrl = parentId ? `https://www.notion.so/${parentId.replace(/-/g, '')}` : null;
  const info = () => ({ configured, running: status.running, lastSyncAt: status.lastSyncAt || st().lastSyncAt || null, error: status.error, sent: status.sent, url: pageUrl });

  // 연결 점검 (npm run check): 토큰과 페이지 접근만 확인, 아무것도 쓰지 않음
  async function check() {
    const me = await api('GET', '/v1/users/me');
    const page = await api('GET', `/v1/pages/${parentId}`);
    const t = Object.values(page.properties || {}).find((p) => p.type === 'title')?.title?.map((x) => x.plain_text).join('') || '(제목 없음)';
    return { bot: me.name || me.bot?.workspace_name || '연결됨', page: t, tables: Object.keys(st().tables || {}).length };
  }

  return { configured, run, schedule, start, info, check };
}
