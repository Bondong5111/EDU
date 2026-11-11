# 토스증권 조회 중계 서버

웹사이트가 토스증권 보유 주식을 불러올 수 있게 해주는 작은 서버입니다. **조회(계좌 목록·보유 주식·환율)만** 중계하고 주문 API는 열지 않습니다.

## 왜 별도 서버가 필요한가요?

1. `client_secret`은 브라우저에 넣으면 누구나 볼 수 있어 서버에만 둬야 합니다.
2. 토스증권은 **미리 등록한 고정 IP**에서 온 요청만 받습니다. 서버리스(Cloudflare Workers, Vercel 등)는 나가는 IP가 계속 바뀌어 쓸 수 없습니다.
3. 클라이언트당 유효한 토큰은 1개뿐이라, 서버 하나가 토큰을 공유·재사용해야 합니다.

## 준비물

- Node.js 18 이상
- 고정 공인 IP가 있는 컴퓨터: 집 PC·NAS·라즈베리파이, 또는 VPS(Oracle Cloud 무료, AWS Lightsail 등)
- 웹사이트(HTTPS)에서 부를 수 있는 HTTPS 주소 → 아래 Cloudflare Tunnel 방법이 가장 쉽습니다

## 1. 토스증권에서 키 발급 + IP 등록

1. 토스증권 웹(WTS) 로그인 → 설정 → Open API 에서 `client_id`, `client_secret` 발급
2. 같은 화면 하단 **허용 IP 관리**에 이 서버의 공인 IP 등록 (`curl https://ifconfig.me`로 확인)

> ⚠️ 이 키는 주문 권한도 있습니다. 절대 공유하거나 GitHub에 올리지 마세요.

## 2. 서버 실행

```bash
export TOSS_CLIENT_ID='tsck_live_...'
export TOSS_CLIENT_SECRET='...'
export PROXY_TOKEN="$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")"
export ALLOWED_ORIGIN='https://<GitHub아이디>.github.io'
echo "웹사이트 설정에 넣을 PROXY_TOKEN: $PROXY_TOKEN"
node server/toss-proxy.mjs        # → http://127.0.0.1:8787
```

## 3. HTTPS 주소 만들기 (Cloudflare Tunnel 예시)

GitHub Pages는 HTTPS라서, 중계 서버도 HTTPS여야 브라우저가 호출할 수 있습니다.

```bash
# 임시 주소로 바로 테스트
cloudflared tunnel --url http://127.0.0.1:8787
# → https://xxxx.trycloudflare.com 이 출력됩니다
```

계속 쓰려면 Cloudflare 계정에서 이름 있는 터널(예: `toss.내도메인.com`)을 만들고, `pm2`나 systemd로 두 프로그램이 항상 켜져 있게 하세요.
터널을 써도 토스증권으로 나가는 요청은 이 컴퓨터의 공인 IP에서 나가므로 IP 등록은 그대로 유효합니다.

## 4. 웹사이트에 등록

웹사이트 **설정 → 연동**에 중계 서버 주소와 `PROXY_TOKEN`을 넣고 **토스 연결 테스트**를 누르세요.

## 문제 해결

| 증상 | 원인 |
|---|---|
| `ip-not-allowed` | 서버 공인 IP가 허용 IP에 없음 (가정용 인터넷은 IP가 가끔 바뀜) |
| `토큰 발급 실패 … invalid_client` | client_id / client_secret 오타 |
| 웹에서 "중계 서버에 연결할 수 없습니다" | 서버 꺼짐, HTTP 주소 사용, ALLOWED_ORIGIN 불일치 |
| `token-revoked` 반복 | 다른 프로그램이 같은 키로 토큰을 새로 발급하고 있음 |
