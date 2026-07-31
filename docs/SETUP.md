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
3. 로그인 리디렉션 URL을 등록한다. **개발 서버 포트와 반드시 일치해야 한다.**
   `.env` 의 `CHZZK_REDIRECT_URI` 와 치지직에 등록한 값, 그리고 `pnpm dev --port <포트>` 가
   전부 같은 포트를 가리켜야 한다. 어긋나면 로그인 후 콜백이 조용히 실패한다
   (증상: 로그인을 눌러도 아무 일도 일어나지 않음).
   예: `http://localhost:3001/api/auth/callback` → `pnpm dev --port 3001`
4. 최근 90일간 API Scope 사용량이 0이면 애플리케이션이 삭제되니 주의한다.

## Supabase

프로젝트를 만들고 SQL Editor에서 `supabase/migrations/` 의 파일을 **번호 순서대로 전부**
실행한다. `0002` 는 Data API 권한 회수라 빠뜨리면 공개 키로 테이블이 열린 채 남는다.

운영 데이터가 쌓이기 시작하면 테스트용 프로젝트를 따로 만든다(무료). DB 통합 테스트는
매번 테이블을 비우므로, 하나를 공용으로 쓰면 `pnpm test:db` 가 개발 데이터를 지운다.

적용 후 아래로 확인한다.

```sql
select count(*) from pg_tables where schemaname='public';              -- 8
select count(*) from pg_tables where schemaname='public' and rowsecurity; -- 8
select count(*) from pg_policies where schemaname='public';            -- 0
```

정책이 0개인 것은 의도다. 서버가 secret 키로 RLS를 우회해 접근하고, RLS는 심층방어로만 건다.

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
