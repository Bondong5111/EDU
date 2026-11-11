// JSON 파일 저장소: 원자적 쓰기(임시 파일 → rename) + 쓰기 직렬화 + 시간별 백업
import fs from 'node:fs/promises';
import path from 'node:path';

export class JsonFile {
  constructor(file, initial, { backupDir = null, backupEveryMs = 60 * 60 * 1000, keepBackups = 48 } = {}) {
    this.file = file;
    this.initial = initial;
    this.value = null;
    this.chain = Promise.resolve();
    this.backupDir = backupDir;
    this.backupEveryMs = backupEveryMs;
    this.keepBackups = keepBackups;
    this.lastBackup = 0;
  }

  async load() {
    try {
      this.value = JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw new Error(`${this.file} 을(를) 읽지 못했습니다: ${e.message}`);
      this.value = structuredClone(this.initial);
      await this.write(this.value);
    }
    return this.value;
  }

  write(value) {
    this.value = value;
    const run = async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
      await fs.rename(tmp, this.file);
      await this.backup();
    };
    this.chain = this.chain.then(run, run);
    return this.chain;
  }

  async backup() {
    if (!this.backupDir || Date.now() - this.lastBackup < this.backupEveryMs) return;
    this.lastBackup = Date.now();
    await fs.mkdir(this.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.copyFile(this.file, path.join(this.backupDir, `${path.basename(this.file, '.json')}-${stamp}.json`));
    const files = (await fs.readdir(this.backupDir)).filter((f) => f.endsWith('.json')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - this.keepBackups))) {
      await fs.unlink(path.join(this.backupDir, f)).catch(() => {});
    }
  }
}
