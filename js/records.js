'use strict';
/**
 * 기록 단위(레코드) 변환 — 브라우저와 서버가 함께 씁니다.
 *
 * 화면은 state 객체 하나로 그리지만, 저장·동기화는 "기록 한 건 = 레코드 한 줄" 단위로 합니다.
 *   log|2026-11-17|mood   → 4            (하루 기록의 항목 하나)
 *   check|2026-11-17|h1   → 1            (습관 체크 한 번)
 *   event|<id>            → {title, …}   (일정 한 건)
 *   snap|2026-11-17       → {v, c, cur}  (그날의 자산 스냅샷)
 * 이렇게 쪼개면 바뀐 줄만 주고받을 수 있고, 두 기기가 서로 다른 줄을 고치면 충돌하지 않습니다.
 */
(function (root) {
  const SEP = '|';
  const LISTS = { strengths: 'strength', habits: 'habit', goals: 'goal', events: 'event', trades: 'trade', watchlist: 'watch' };
  const MAPS = { prices: 'price', targets: 'target', snapshots: 'snap', reviews: 'review' };
  const FIELDS = { profile: 'profile', settings: 'setting', meta: 'meta' }; // 객체의 필드 하나가 레코드 하나
  const DOCS = { toss: 'toss', sajuNote: 'sajunote' };
  const SORTED = ['strengths', 'habits', 'goals', 'watchlist']; // 만든 순서(id)대로 유지
  const byKind = (table) => Object.fromEntries(Object.entries(table).map(([prop, kind]) => [kind, prop]));
  const LIST_OF = byKind(LISTS), MAP_OF = byKind(MAPS), FIELD_OF = byKind(FIELDS), DOC_OF = byKind(DOCS);

  const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

  function flatten(s) {
    const out = {};
    for (const [prop, kind] of Object.entries(LISTS)) for (const it of s[prop] || []) if (it && it.id != null) out[kind + SEP + it.id] = it;
    for (const table of [MAPS, FIELDS]) {
      for (const [prop, kind] of Object.entries(table)) for (const [k, v] of Object.entries(s[prop] || {})) if (v != null) out[kind + SEP + k] = v;
    }
    for (const [prop, id] of Object.entries(DOCS)) if (s[prop] != null && s[prop] !== '') out['doc' + SEP + id] = s[prop];
    for (const [date, log] of Object.entries(s.logs || {})) {
      for (const [f, v] of Object.entries(log || {})) if (v != null && v !== '') out['log' + SEP + date + SEP + f] = v;
    }
    for (const [date, ids] of Object.entries(s.habitChecks || {})) for (const id of ids || []) out['check' + SEP + date + SEP + id] = 1;
    return out;
  }

  // base → cur 로 가기 위한 변경 목록. {k, v} 는 쓰기, {k, d: 1} 은 삭제
  function diff(base, cur) {
    const changes = [];
    for (const k of Object.keys(cur)) if (!(k in base) || !same(base[k], cur[k])) changes.push({ k, v: cur[k] });
    for (const k of Object.keys(base)) if (!(k in cur)) changes.push({ k, d: 1 });
    return changes;
  }

  function applyToFlat(flat, c) {
    if (c.d) delete flat[c.k]; else flat[c.k] = c.v;
  }

  // 변경 목록을 state 에 반영 (state 를 직접 수정)
  function apply(s, changes) {
    const touched = new Set();
    for (const ch of changes) {
      // 값은 복사해서 넣음: 호출한 쪽(동기화 기준본)과 객체를 공유하면 이후 수정이 양쪽에 같이 반영되어 변경을 놓침
      const c = ch.v && typeof ch.v === 'object' ? { ...ch, v: JSON.parse(JSON.stringify(ch.v)) } : ch;
      const i = c.k.indexOf(SEP);
      if (i < 0) continue;
      const kind = c.k.slice(0, i), rest = c.k.slice(i + 1);
      if (LIST_OF[kind]) {
        const prop = LIST_OF[kind];
        const arr = (s[prop] ||= []);
        const idx = arr.findIndex((x) => String(x.id) === rest);
        if (c.d) { if (idx >= 0) arr.splice(idx, 1); } else if (idx >= 0) arr[idx] = c.v; else arr.push(c.v);
        touched.add(prop);
      } else if (MAP_OF[kind] || FIELD_OF[kind]) {
        const obj = (s[MAP_OF[kind] || FIELD_OF[kind]] ||= {});
        if (c.d) delete obj[rest]; else obj[rest] = c.v;
      } else if (kind === 'doc' && DOC_OF[rest]) {
        s[DOC_OF[rest]] = c.d ? (rest === 'sajunote' ? '' : null) : c.v;
      } else if (kind === 'log') {
        const date = rest.slice(0, 10), f = rest.slice(11);
        const logs = (s.logs ||= {});
        if (c.d) { if (logs[date]) { delete logs[date][f]; if (!Object.keys(logs[date]).length) delete logs[date]; } } else (logs[date] ||= {})[f] = c.v;
      } else if (kind === 'check') {
        const date = rest.slice(0, 10), id = rest.slice(11);
        const checks = (s.habitChecks ||= {});
        const arr = (checks[date] || []).filter((x) => String(x) !== id);
        if (!c.d) arr.push(id);
        if (arr.length) checks[date] = arr; else delete checks[date];
      }
    }
    for (const prop of SORTED) if (touched.has(prop)) s[prop].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
    return s;
  }

  // 서버 색인용: 레코드의 종류와 날짜
  function info(k, v) {
    const i = k.indexOf(SEP);
    const kind = i < 0 ? '' : k.slice(0, i), rest = k.slice(i + 1);
    let date = null;
    if (kind === 'log' || kind === 'check' || kind === 'snap' || kind === 'review') date = rest.slice(0, 10);
    else if ((kind === 'event' || kind === 'trade') && v && typeof v.date === 'string') date = v.date.slice(0, 10);
    return { kind, date };
  }

  const api = { flatten, diff, apply, applyToFlat, info, same };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Records = api;
})(typeof window !== 'undefined' ? window : globalThis);
