// 기록 데이터베이스 (Node 내장 SQLite) — 기록 한 건이 한 행
//   records(k, kind, date, v, deleted, seq, updated_at)
// 삭제는 행을 지우지 않고 deleted=1 로 표시해 다른 기기에도 삭제가 전달되게 합니다.
import fs from 'node:fs';
import path from 'node:path';

let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  console.error('이 서버는 Node.js 22.13 이상이 필요합니다 (내장 SQLite 사용). 현재 버전: ' + process.version);
  process.exit(1);
}

const KEY_RE = /^[a-z]{2,12}\|[^\u0000]{1,300}$/;

export function openDb(file, { backupDir = null, backupEveryMs = 60 * 60 * 1000, keepBackups = 48 } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try { fs.chmodSync(file, 0o600); } catch { /* 무시 */ }
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      k TEXT PRIMARY KEY, kind TEXT NOT NULL, date TEXT, v TEXT,
      deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_records_seq ON records(seq);
    CREATE INDEX IF NOT EXISTS idx_records_kind_date ON records(kind, date);
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
  `);
  const getSeq = db.prepare("SELECT value FROM kv WHERE key = 'seq'");
  const setSeq = db.prepare("INSERT INTO kv(key, value) VALUES('seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  const since = db.prepare('SELECT k, v, deleted FROM records WHERE seq > ? ORDER BY seq, k');
  const upsert = db.prepare(`INSERT INTO records(k, kind, date, v, deleted, seq, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(k) DO UPDATE SET kind = excluded.kind, date = excluded.date, v = excluded.v, deleted = excluded.deleted, seq = excluded.seq, updated_at = excluded.updated_at`);
  const countLive = db.prepare('SELECT COUNT(*) AS n FROM records WHERE deleted = 0');
  const countAll = db.prepare('SELECT COUNT(*) AS n FROM records');

  let lastBackup = 0;
  const seq = () => Number(getSeq.get()?.value || 0);

  function write(changes, info) {
    const next = seq() + 1, now = new Date().toISOString();
    db.exec('BEGIN');
    try {
      for (const c of changes) {
        const { kind, date } = info(c.k, c.v);
        upsert.run(c.k, kind, date, c.d ? null : JSON.stringify(c.v), c.d ? 1 : 0, next, now);
      }
      setSeq.run(String(next));
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return next;
  }

  /**
   * 한 번의 요청으로 주고받기:
   *  1) 이 기기가 마지막으로 본 시점(cursor) 이후 서버에서 바뀐 줄을 모으고
   *  2) 이 기기가 보낸 변경을 기록한 뒤 (같은 줄이면 방금 보낸 쪽이 최신)
   *  3) 이 기기가 방금 쓴 줄을 뺀 나머지를 돌려줍니다.
   */
  function sync(cursor, changes, info) {
    for (const c of changes) {
      if (!c || typeof c.k !== 'string' || !KEY_RE.test(c.k)) throw new RangeError('잘못된 기록 키입니다.');
      if (!c.d && c.v === undefined) throw new RangeError('값이 없는 기록입니다.');
    }
    const remote = since.all(Number(cursor) || 0);
    const newCursor = changes.length ? write(changes, info) : seq();
    const pushed = new Set(changes.map((c) => c.k));
    if (changes.length) backup();
    return {
      cursor: newCursor,
      changes: remote.filter((r) => !pushed.has(r.k)).map((r) => (r.deleted ? { k: r.k, d: 1 } : { k: r.k, v: JSON.parse(r.v) })),
    };
  }

  function backup() {
    if (!backupDir || Date.now() - lastBackup < backupEveryMs) return;
    lastBackup = Date.now();
    try {
      fs.mkdirSync(backupDir, { recursive: true });
      const target = path.join(backupDir, `mylife-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
      db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
      fs.chmodSync(target, 0o600);
      const files = fs.readdirSync(backupDir).filter((f) => f.endsWith('.db')).sort();
      for (const f of files.slice(0, Math.max(0, files.length - keepBackups))) fs.unlinkSync(path.join(backupDir, f));
    } catch (e) {
      console.error('백업 실패:', e.message);
    }
  }

  return { sync, write, seq, count: () => countLive.get().n, isEmpty: () => countAll.get().n === 0 };
}
