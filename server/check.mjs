#!/usr/bin/env node
/**
 * 연동 점검:  npm run check
 * server/.env 의 키로 토스증권에 실제로 조회해 보고 결과를 알려줍니다 (조회만 합니다).
 */
import { createToss } from './lib/toss.mjs';

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

console.log('\n[그 밖의 연동]');
console.log(`  구글 캘린더: ${state(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)}`);
console.log(`  팻시크릿: ${state(env.FATSECRET_CONSUMER_KEY && env.FATSECRET_CONSUMER_SECRET)}`);
console.log('  이 둘은 사이트의 나 → 연동 · 설정에서 계정을 연결합니다.\n');
process.exit(failed ? 1 : 0);
