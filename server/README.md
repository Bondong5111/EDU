# MY LIFE 통합 서버

이 서버 하나만 켜두면 됩니다.

- 🌐 **웹사이트 제공**: 휴대폰·PC 어디서든 같은 주소로 접속, 홈 화면에 앱처럼 설치 가능
- 🔒 **비밀번호 로그인** (30일 유지, 5회 틀리면 15분 잠금)
- ☁️ **모든 기기 자동 동기화**: 여러 기기에서 동시에 바꿔도 항목 단위로 자동 병합
- 💾 **자동 백업**: 1시간마다 `server/data/backups/`에 최근 48개 보관
- 📈 **토스증권**: 보유 주식·평가손익·환율 자동 갱신 (조회 전용, 주문 기능 없음)
- 📅 **구글 캘린더**: 한 번 연결하면 계속 유지, 일정 자동 가져오기 + 새 일정 구글에 추가

의존성 설치가 필요 없습니다 (Node.js 18 이상, `--env-file`은 20.6 이상).

---

## 1. 서버 컴퓨터 고르기

토스증권은 **미리 등록한 고정 IP**에서 온 요청만 받으므로 아래 중 하나에서 실행하세요.

| 선택지 | 장점 | 비용 |
|---|---|---|
| 집 PC · NAS · 라즈베리파이 | 데이터가 집에만 있음 | 전기료 (항상 켜둬야 함) |
| VPS (Oracle Cloud 무료 티어, AWS Lightsail 등) | 항상 켜져 있음, IP 고정 | 무료 ~ 월 몇 천원 |

> 토스증권을 안 쓸 거라면 IP 제약은 신경 쓰지 않아도 됩니다.

## 2. 설정 파일 만들기

```bash
cp server/.env.example server/.env
```

`server/.env`를 열어 채웁니다.

| 항목 | 필수 | 설명 |
|---|---|---|
| `APP_PASSWORD` | ✅ | 로그인 비밀번호 (8자 이상, 길게) |
| `BASE_URL` | ✅ | 휴대폰에서 접속할 주소. 예: `https://life.mydomain.com` |
| `TOSS_CLIENT_ID` / `TOSS_CLIENT_SECRET` | | 토스증권 WTS → 설정 → Open API에서 발급 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | | 아래 4번 참고 |

`server/.env`와 `server/data/`는 `.gitignore`에 들어 있어 GitHub에 올라가지 않습니다.

## 3. 실행

```bash
node --env-file=server/.env server/server.mjs
# → MY LIFE 서버: http://127.0.0.1:8787
```

항상 켜두려면 pm2를 쓰면 편합니다.

```bash
npm i -g pm2
pm2 start "node --env-file=server/.env server/server.mjs" --name mylife
pm2 save && pm2 startup
```

### 휴대폰에서 접속할 HTTPS 주소 만들기 (Cloudflare Tunnel)

공유기 포트포워딩 없이 HTTPS 주소를 만들 수 있습니다.

```bash
# 빠른 테스트용 임시 주소
cloudflared tunnel --url http://127.0.0.1:8787
```

계속 쓰려면 Cloudflare 계정에 도메인을 연결하고 이름 있는 터널(예: `life.mydomain.com → http://127.0.0.1:8787`)을 만드세요.
그 주소를 `BASE_URL`에 넣고, 터널 뒤에서는 `TRUST_PROXY=1`로 두면 로그인 시도 제한이 실제 접속 IP 기준으로 동작합니다.

> 터널을 써도 토스증권으로 나가는 요청은 이 컴퓨터의 공인 IP에서 나가므로, 그 IP(`curl https://ifconfig.me`)를 토스증권 허용 IP에 등록하면 됩니다.

## 4. 구글 캘린더 연결 준비

1. [Google Cloud 콘솔](https://console.cloud.google.com/) → 프로젝트 생성 → **Google Calendar API** 사용 설정
2. **OAuth 동의 화면**: 사용자 유형 *외부*, 본인 계정을 테스트 사용자로 추가
3. **사용자 인증 정보 → OAuth 클라이언트 ID → 웹 애플리케이션**
   - 승인된 리디렉션 URI: `{BASE_URL}/api/google/callback`
4. 클라이언트 ID·보안 비밀을 `.env`에 넣고 서버 재시작 → 웹사이트 **설정 → 연동 현황 → 구글 계정 연결**

> ⚠️ OAuth 동의 화면이 **테스트** 상태면 구글이 7일마다 연결을 끊습니다. 계속 쓰려면 동의 화면을 **프로덕션으로 게시**하세요. 본인만 쓰는 앱이라 검증 신청은 필요 없고, 로그인할 때 "확인되지 않은 앱" 경고만 한 번 나옵니다.

## 5. 휴대폰 홈 화면에 설치

- **안드로이드(Chrome)**: 주소 접속 → 메뉴 → *홈 화면에 추가* / *앱 설치*
- **아이폰(Safari)**: 공유 버튼 → *홈 화면에 추가*

## 데이터 · 보안

- 데이터: `server/data/db.json` (권한 600), 백업: `server/data/backups/`
- 비밀값(세션 서명 키, 구글 refresh token): `server/data/secrets.json`
- 토스증권 키는 `.env`에만 있고 브라우저로 전달되지 않습니다. 서버는 계좌·보유 주식·환율 **조회**만 호출합니다.
- 상태를 바꾸는 요청에는 커스텀 헤더가 필요하고(CSRF 방지), 정적 파일은 허용 목록에 있는 것만 제공합니다.
- 기기를 잃어버렸다면 **설정 → 모든 기기 로그아웃**.

## 문제 해결

| 증상 | 해결 |
|---|---|
| 토스 `ip-not-allowed` | 서버 공인 IP가 토스증권 허용 IP에 없음 (가정용 인터넷은 IP가 가끔 바뀜) |
| 토스 `invalid_client` | client_id / client_secret 오타 |
| 토스 `token-revoked` 반복 | 같은 키를 다른 프로그램에서도 쓰고 있음 (클라이언트당 토큰 1개) |
| 구글 연결 후 `?google=error` | 리디렉션 URI가 `{BASE_URL}/api/google/callback`과 정확히 같은지 확인 |
| 구글이 일주일 후 끊김 | OAuth 동의 화면을 프로덕션으로 게시 |
| 상단 아이콘이 📴 | 서버에 연결 안 됨. 바꾼 내용은 기기에 남아 있다가 연결되면 자동 저장 |
