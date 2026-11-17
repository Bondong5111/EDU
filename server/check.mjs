#!/usr/bin/env node
/**
 * 연동 점검:  npm run check
 * server/.env 의 키로 토스증권·노션에 실제로 연결해 보고 결과를 알려줍니다 (조회만 합니다).
 */
import { createToss } from './lib/toss.mjs';
import { createNotion } from './lib/notion.mjs';

const env = process.env;
const state = (on) => (on ? '키 입력됨' : '키 없음 (선택 사항)');
let failed = false;

console.log('\n[토스증권]');
const toss = createToss({ clientId: env.TOSS_CLIENT_ID, clientSecret: env.TOSS_CLIENT_SECRET, apiBase: env.TOSS_API_BASE });
if (!toss.configured) {
  console.log('  키가 없습니다. npm run setup 으로 client_id / client_secret 을 입력하세요.');
} else {
  try {
    const accounts = await toss.accounts();
    console.log(`  ✅ 연결 성공 — 계좌 ${accounts.length}개`);
    for (const a of accounts) console.log(`     · ${a.accountType || '계좌'} ${String(a.accountNo || '').replace(/.(?=.{4})/g, '*')}`);
    if (accounts.length) {
      const h = await toss.holdings();
      console.log(`  ✅ 보유 종목 ${h.items.length}개${h.usdKrw ? ` · 환율 1달러 = ${h.usdKrw}원` : ''}`);
    }
    console.log('  사이트의 자산 탭을 열면 자동으로 불러옵니다.');
  } catch (e) {
    failed = true;
    console.log(`  ❌ ${e.message}`);
    if (/ip-not-allowed/.test(e.message)) {
      let ip = '';
      try { ip = (await (await fetch('https://ifconfig.me/ip', { signal: AbortSignal.timeout(5000) })).text()).trim(); } catch { /* 생략 */ }
      if (/^[\d.:a-fA-F]{7,45}$/.test(ip)) console.log(`     이 컴퓨터의 공인 IP: ${ip}`);
    } else if (/invalid_client|401/.test(e.message)) {
      console.log('     client_id / client_secret 이 맞는지 확인하세요 (npm run setup 으로 다시 입력).');
    } else if (/fetch failed/.test(e.message)) {
      console.log('     인터넷 연결을 확인하세요.');
    }
  }
}

console.log('\n[노션]');
const notion = createNotion({ token: env.NOTION_TOKEN, parent: env.NOTION_PAGE, store: { value: {}, write: async () => {} }, loadState: () => ({}), apiBase: env.NOTION_TEST_BASE, log: {} });
if (!env.NOTION_TOKEN) {
  console.log('  키가 없습니다 (선택 사항). npm run setup 으로 토큰과 페이지 주소를 입력하세요.');
} else if (!notion.configured) {
  failed = true;
  console.log('  ❌ NOTION_PAGE 에서 페이지를 찾지 못했습니다. 노션 페이지 링크를 그대로 붙여넣으세요.');
} else {
  try {
    const r = await notion.check();
    console.log(`  ✅ 연결 성공 — 연결 이름 "${r.bot}", 페이지 "${r.page}"`);
    console.log('  서버를 켜면 이 페이지 아래에 표 5개를 만들고 기록을 자동으로 보냅니다.');
  } catch (e) {
    failed = true;
    console.log(`  ❌ ${e.message}`);
  }
}

console.log('\n[그 밖의 연동]');
console.log(`  구글 캘린더: ${state(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)}`);
console.log(`  팻시크릿: ${state(env.FATSECRET_CONSUMER_KEY && env.FATSECRET_CONSUMER_SECRET)}`);
console.log('  이 둘은 사이트의 나 → 연동 · 설정에서 계정을 연결합니다.\n');
process.exit(failed ? 1 : 0);
