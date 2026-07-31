# 개발 환경 설정

## 필요한 것

- Node 22 이상
- pnpm 10 이상
- Supabase 프로젝트 2개 (운영용, 테스트용)
- 치지직 개발자센터 애플리케이션

## 치지직 애플리케이션 등록

1. 치지직 개발자센터에서 앱을 등록한다.
   **애플리케이션 ID·이름에 `chzzk`, `치지직`, `naver`, `네이버` 를 포함할 수 없다.**
2. API Scope에 `유저 정보 조회` 와 `채널 관리자 조회` 를 포함한다.
3. 로그인 리디렉션 URL에 `http://localhost:3000/api/auth/callback` 을 등록한다.
4. 최근 90일간 API Scope 사용량이 0이면 애플리케이션이 삭제되니 주의한다.

## Supabase

프로젝트 2개를 만들고, 각각의 SQL Editor에서
`supabase/migrations/0001_initial_schema.sql` 을 실행한다.

- 운영용 → `.env` 의 `SUPABASE_URL` / `SUPABASE_SECRET_KEY`
- 테스트용 → `.env.test` 의 같은 변수

키는 대시보드 Settings → API Keys의 **secret key**(`sb_secret_...`)를 쓴다.
이 키는 RLS를 우회하므로 절대 클라이언트로 내보내지 않는다.
`NEXT_PUBLIC_` 접두사를 붙이면 브라우저로 전송되므로 붙이지 않는다.

> **값은 따옴표 없이 적는다.** `KEY=값` 이지 `KEY="값"` 이 아니다.
> `.env.test` 파서(`tests/helpers/setup.js`)는 따옴표를 벗기지 않으므로,
> 따옴표를 붙이면 값에 그대로 섞여 들어가 인증이 실패한다.

## 실행

```bash
pnpm install
cp .env.example .env    # 값 채우기
pnpm dev
```

## 테스트

```bash
pnpm test        # 단위 테스트. DB 불필요
pnpm test:db     # DB 통합 테스트. .env.test 필요
```
