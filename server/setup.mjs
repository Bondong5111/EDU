#!/usr/bin/env node
/**
 * 처음 설정 도우미:  npm run setup
 * 질문에 답하면 server/.env 를 만들어 줍니다. 값은 이 컴퓨터의 파일에만 저장됩니다.
 * 다시 실행하면 기존 값을 유지한 채 바꿀 항목만 고칠 수 있습니다 (Enter = 그대로).
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { pageIdFrom } from './lib/notion.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(DIR, '.env');
const EXAMPLE = path.join(DIR, '.env.example');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`Node.js 22.13 이상이 필요합니다 (지금 ${process.versions.node}). https://nodejs.org 에서 LTS 버전을 설치하세요.`);
  process.exit(1);
}

/* ---------- 입력 ---------- */
const tty = process.stdin.isTTY;
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
const lines = tty ? null : rl[Symbol.asyncIterator](); // 터미널이 아니면(테스트 등) 한 줄씩 읽음
let hidden = false;
if (tty) { // 비밀값을 입력하는 동안은 글자를 화면에 찍지 않음
  const write = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (s) => { if (!hidden || /[\r\n]/.test(s)) write(hidden ? '\n' : s); };
}
async function ask(question, { secret = false } = {}) {
  if (!tty) { process.stdout.write(question); const { value } = await lines.next(); process.stdout.write('\n'); return (value ?? '').trim(); }
  return new Promise((resolve) => {
    rl.question(question, (a) => { hidden = false; resolve(a.trim()); });
    hidden = secret;
  });
}

/* ---------- .env 읽기 · 쓰기 ---------- */
const exists = fs.existsSync(ENV_FILE);
let text = fs.readFileSync(exists ? ENV_FILE : EXAMPLE, 'utf8');
const current = exists ? parseEnv(text) : {};

// 값을 .env 한 줄로. 따옴표 때문에 그대로 못 쓰는 값은 null
function line(key, value) {
  if (/[\r\n]/.test(value)) return null;
  if (/^[\w.:/@+-]*$/.test(value)) return `${key}=${value}`;
  if (!value.includes("'")) return `${key}='${value}'`;
  if (!/["\\`]/.test(value)) return `${key}="${value}"`;
  return null;
}
function set(key, value) {
  const l = line(key, value);
  const re = new RegExp(`^${key}=.*$`, 'm');
  text = re.test(text) ? text.replace(re, () => l) : text.replace(/\n*$/, `\n${l}\n`);
}

console.log('\nMY LIFE 설정을 시작합니다. 입력한 값은 이 컴퓨터의 server/.env 파일에만 저장됩니다.\n');

/* ---------- 1. 로그인 비밀번호 ---------- */
for (;;) {
  const keep = current.APP_PASSWORD?.length >= 8;
  const pw = await ask(`1) 사이트 로그인 비밀번호 (8자 이상, 입력해도 화면에 보이지 않습니다)${keep ? ' [Enter = 기존 비밀번호 유지]' : ''}: `, { secret: true });
  if (!pw && keep) break;
  if (pw.length < 8) { console.log('   8자 이상으로 입력하세요.'); continue; }
  if (line('APP_PASSWORD', pw) === null) { console.log("   작은따옴표(')와 큰따옴표(\")·역슬래시를 함께 쓴 비밀번호는 저장할 수 없습니다. 다른 비밀번호로 해주세요."); continue; }
  if ((await ask('   한 번 더 입력: ', { secret: true })) !== pw) { console.log('   두 번 입력한 값이 다릅니다.'); continue; }
  set('APP_PASSWORD', pw);
  break;
}

/* ---------- 2. 토스증권 (선택) ---------- */
const hasToss = !!(current.TOSS_CLIENT_ID && current.TOSS_CLIENT_SECRET);
console.log(`\n2) 토스증권 Open API (선택)${hasToss ? ' — 이미 입력되어 있습니다' : ''}`);
console.log('   토스증권 PC 웹(WTS) → 설정 → Open API 에서 발급한 client_id / client_secret 을 넣습니다.');
const tossId = await ask(`   client_id [Enter = ${hasToss ? '그대로' : '건너뛰기'}]: `);
if (tossId) {
  const tossSecret = await ask('   client_secret (화면에 보이지 않습니다): ', { secret: true });
  if (tossSecret && line('TOSS_CLIENT_ID', tossId) && line('TOSS_CLIENT_SECRET', tossSecret)) {
    set('TOSS_CLIENT_ID', tossId); set('TOSS_CLIENT_SECRET', tossSecret);
  } else console.log('   값이 비어 있거나 저장할 수 없는 문자가 있어 건너뜁니다.');
}

/* ---------- 3. 노션 (선택) ---------- */
const hasNotion = !!(current.NOTION_TOKEN && current.NOTION_PAGE);
console.log(`\n3) 노션 (선택)${hasNotion ? ' — 이미 입력되어 있습니다' : ''}`);
console.log('   기록을 노션 표로 자동 정리합니다. 만드는 방법은 server/README.md 의 "노션 연결 준비"를 보세요.');
const notionToken = await ask(`   노션 연결 토큰 (ntn_ 으로 시작, 화면에 보이지 않습니다) [Enter = ${hasNotion ? '그대로' : '건너뛰기'}]: `, { secret: true });
if (notionToken) {
  for (;;) {
    const page = await ask('   표를 만들 노션 페이지 주소 (페이지에서 ··· → 링크 복사): ');
    if (!page) { console.log('   페이지 주소가 없어 노션은 건너뜁니다.'); break; }
    if (!pageIdFrom(page)) { console.log('   주소에서 페이지를 찾지 못했습니다. 노션 페이지의 링크를 그대로 붙여넣으세요.'); continue; }
    if (line('NOTION_TOKEN', notionToken) && line('NOTION_PAGE', page)) { set('NOTION_TOKEN', notionToken); set('NOTION_PAGE', page); }
    else console.log('   저장할 수 없는 문자가 있어 건너뜁니다.');
    break;
  }
}
rl.close();

/* ---------- 저장 + 확인 ---------- */
fs.writeFileSync(ENV_FILE, text, { mode: 0o600 });
fs.chmodSync(ENV_FILE, 0o600);
const saved = parseEnv(fs.readFileSync(ENV_FILE, 'utf8'));
if (!(saved.APP_PASSWORD?.length >= 8)) { console.error('\n저장한 설정을 다시 읽지 못했습니다. server/.env 를 직접 열어 확인하세요.'); process.exit(1); }
console.log(`\n✅ 설정을 저장했습니다: ${ENV_FILE}`);

if (saved.TOSS_CLIENT_ID && saved.TOSS_CLIENT_SECRET) {
  let ip = '';
  try { ip = (await (await fetch('https://ifconfig.me/ip', { signal: AbortSignal.timeout(5000) })).text()).trim(); } catch { /* 오프라인이면 생략 */ }
  console.log('\n토스증권은 미리 등록한 IP 에서 온 요청만 받습니다.');
  console.log(/^[\d.:a-fA-F]{7,45}$/.test(ip)
    ? `   이 컴퓨터의 공인 IP: ${ip}\n   토스증권 Open API 설정의 "허용 IP" 에 이 주소를 등록한 뒤, 아래 명령으로 연결을 확인하세요.`
    : '   이 컴퓨터의 공인 IP(https://ifconfig.me 에서 확인)를 토스증권 Open API 설정의 "허용 IP" 에 등록한 뒤, 아래 명령으로 연결을 확인하세요.');
  console.log('     npm run check');
}
if (saved.NOTION_TOKEN && saved.NOTION_PAGE) console.log('\n노션: 아래 명령으로 연결을 확인하세요 (토스 확인과 함께 나옵니다).\n     npm run check');
console.log('\n이제 서버를 켜세요:');
console.log('     npm start');
console.log(`   그다음 브라우저에서 ${saved.BASE_URL || 'http://localhost:8787'} 을 열고 방금 정한 비밀번호로 로그인합니다.\n`);
