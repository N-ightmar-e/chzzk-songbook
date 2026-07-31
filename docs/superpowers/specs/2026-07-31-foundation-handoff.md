# 기반 브랜치 인계 사항

`feat/multitenant-foundation` (계획 1, Task 1~11) 실행 중 발견됐으나 그 범위에서 고치지
않기로 판정한 것들이다. 계획 2·3이 반드시 다뤄야 한다.

실행 근거: `docs/superpowers/plans/2026-07-31-multitenant-foundation.md`
설계 근거: `docs/superpowers/specs/2026-07-31-multitenant-songbook-design.md`

## ⛔ 배포 게이트 — 계획 2 완료 전까지 배포 금지

`app/api/songs`(POST) · `app/api/songs/bulk`(POST) · `app/api/upload`(POST) 세 라우트에
**인증·CSRF·레이트리밋이 전무하다.** 이 브랜치가 만든 결함이 아니라 이전 상태에서 승계했고,
계획 2에서 걷어내기로 한 것이다. 그때까지 배포하면 안 된다.

- **Vercel 배포 시** — `lib/store.js` 가 `process.cwd()/.data/` 에, `app/api/upload` 가
  `public/uploads/` 에 쓴다. Lambda 파일시스템은 `/tmp` 외 읽기 전용이라 EROFS로 500이 난다.
  더 나쁜 것은 `GET /api/songs` 까지 같이 죽는다는 점이다 — `lib/store.js` 의 `read()` 가
  캐시 미스 시 `write()` 를 호출하는데 라우트에 try/catch가 없다. 랜딩 페이지 곡 목록이 통째로 빈다.
- **자체 호스팅 시** — 누구나 곡을 등록할 수 있고, 업로드에 상한이 없어 디스크 고갈이 가능하다.
  경로 탈출·스크립트 실행은 막혀 있으나(확장자를 서버가 화이트리스트에서 재생성, 파일명은 UUID)
  **매직바이트 검증이 없어** 이미지 확장자로 임의 바이트를 호스팅할 수 있다.

이 브랜치는 배포 가능한 제품이 아니라 기반이다. 병합 자체는 안전하다.

## 계획 2 (노래책·곡·자켓 업로드)

1. **무방비 라우트 3개 제거 + Supabase Storage 이설.** 위 배포 게이트를 여는 작업이다.
   업로드는 스펙의 매직바이트 검증을 반드시 포함한다 — 확장자와 `Content-Type` 은 위조된다.
2. **인가 매트릭스를 통합(HTTP) 방식으로 재작성.** 첫 라우트가 생기는 즉시.
   현재 `tests/db/authz.test.js` 의 `attempt()` 는 `requireSongbookAccess` 에 actor를 주입해
   **쿠키 → 서명 검증 → 세션 조회 → 유저 조인 경로를 통째로 건너뛴다.** 스펙이 이름을 붙여
   경계한 형태다("인가를 모킹하면 인가가 동작하지 않아도 테스트가 통과한다"). 라우트가 0개인
   현 시점에는 불가피했으나, 라우트가 생기면 즉시 전환해야 한다.
3. **라우트가 `requireSongbookAccess` 에 `user` 를 넘기지 않는다**를 계획의 명시적 제약으로 둘 것.
   `lib/authz.js` 에 프로덕션 차단 가드가 있으나(개발·테스트에서는 여전히 주입 가능),
   습관이 굳으면 위험하다. `accessLevel` 은 `user.role` 을 DB 재조회 없이 신뢰한다.
4. **`ownsSongbook`(`app/api/auth/callback/route.js`)을 `lib/db/songbooks.js` 로 이설.**
   현재 라우트가 `getDb()` 를 직접 호출하는 유일한 지점이고, Supabase `error` 도 검사하지 않는다
   (실패 방향은 안전 — 토큰 미저장). 이설하면 `failed()` 관례가 자동 적용돼 둘 다 해소된다.
   **"라우트에서 `getDb()` 직접 호출 0건"을 완료 기준에 포함할 것.**
5. **쓰기 요청 `Origin` 헤더 검증**을 공통 처리로 넣을 것. 쓰기 경로가 늘어나기 전이 싸다.
   현재 `logout` 에도 미적용이다.
6. 중복 정리 — `failed()` 헬퍼가 `lib/db/users.js`·`sessions.js`·`tokens.js` 에 3중복이고
   `lib/authz.js` 에 같은 일을 하는 인라인 코드가 2곳 있다. `UUID_RE` 는 `lib/authz.js` 와
   `lib/db/sessions.js` 에 2중복.
7. `tests/helpers/setup.js` 의 `.env` 파서가 값의 따옴표를 벗기지 않는다.
   `docs/SETUP.md` 에 경고가 있어 완화됐으나 파서 자체를 고치는 편이 낫다.
8. `lastLoginAt` 보존 테스트가 `toBeTruthy()` 만 확인한다. `toBe` 로 강화(한 줄).

## 계획 3 (매니저·공개 페이지·정리)

1. **`ensurePlaceholderUsers` 에 같은 `channelId` 가 중복으로 들어오면** Postgres가
   `ON CONFLICT DO UPDATE command cannot affect row a second time` 를 던진다.
   매니저 자동 동기화가 `streaming-roles` 결과로 이 함수를 호출하므로 실제 위험이다.
   호출 전 dedupe를 명시하거나 함수 안에서 `new Set` 으로 정규화할 것.
   (`fetchChannels` 는 이미 dedupe한다. 그 dedup·falsy 제거를 검증하는 테스트도 없으니 한 세트로 다룰 것.)
2. **매니저이면서 동시에 전역 operator 인 유저**는 `accessLevel` 에서 멤버 체크가 operator 체크보다
   먼저라 항상 `'manager'` 로 판정된다. 결과적으로 그 노래책에서 운영자 권한을 잃는다.
   소유자+operator 는 owner 가 더 넓어 맞지만, 매니저+operator 는 **더 좁은 쪽이 선택**되는 셈이다.
   fail-closed 라 보안 구멍은 아니나, 운영자 기능을 만들 때 "가장 넓은 권한을 고른다"로
   정리할지 결정할 것.
3. **`TokenRefreshBusyError`(`lib/db/tokens.js`) 를 catch 하는 곳이 아직 없다.**
   동기화 라우트가 생기면 500이 아니라 "동기화 중입니다" 안내로 변환해야 한다.
4. `getValidAccessToken` 이 실제로 쓰이기 시작하면 `lib/chzzk.js` 의 `unwrap` 두 실패 분기에서
   `ChzzkApiError.code` 타입을 정규화할 것 (`json?.code` 원시값 vs `Number(json.code)`).
5. `lib/db/users.js` 의 `toUser` 가 `channel_synced_at` 을 매핑하지 않는다.
   관리 화면이 "마지막 동기화 시각"을 요구할 때 추가.
6. **`getDb()` 를 Server Component 에서 부를 때 정적 프리렌더에 주의할 것.**
   `boundFetch` 가 Next 패치 fetch이므로 `app/[handle]/page.jsx` 같은 Server Component가
   `getDb()` 를 부르면 빌드 타임에 구워질 수 있다. 동적 렌더를 명시해야 한다.
   현재는 DB를 만지는 Server Component가 0개이고 라우트 핸들러는 `cookies()`/`request.url`
   사용으로 전부 dynamic이라 문제가 없다.
7. `app/page.jsx` 가 `authError` 값 3종(`state`, `1`, `unconfigured`)을 구분하지 않고 같은
   토스트를 띄운다. 특히 `unconfigured`(OAuth 미설정)에 "다시 시도해 주세요"는 틀린 안내다 —
   재시도로 해결되지 않는다.

## 이 브랜치에서 내린 판정 (뒤집으려면 근거가 필요하다)

- **RLS는 주 방어선이 아니다.** 치지직은 Supabase Third-Party Auth 지원 발급자가 아니므로
  `auth.uid()` 를 쓸 수 없다. 서버 전용 접근 + 앱 레벨 인가를 택했고, RLS는 deny-all 심층방어다.
  따라서 `lib/authz.js` 가 유일한 접근 통제 지점이다.
- **Data API 권한은 명시적으로 회수해야 한다.** "새 테이블 자동 미노출"은 2026-10-30부터
  강제라 그 이전 프로젝트에는 적용되지 않는다. 실측으로 확인했다 — 회수 전에는 publishable·anon
  키로 `user_tokens` 까지 HTTP 200이 돌아왔다(행은 RLS가 막아 빈 배열).
  `supabase/migrations/0002_revoke_data_api_access.sql` 이 이를 막는다.
- **소유자의 토큰만 저장한다.** 시청자 토큰은 사용처가 없다. 저장하지 않은 데이터는 유출되지 않는다.
- **권한 없음은 403이 아니라 404다.** 403은 비공개 노래책의 존재를 누설한다.
- **세션 연장 실패는 throw하지 않는다.** 부가 작업의 실패가 인증을 죽이면 안 된다.
  대신 DB에 반영되지 않은 값을 반환하지 않는다.

## 운영 메모

- **운영·테스트 Supabase 프로젝트가 하나로 공용이다.** DB 통합 테스트는 매번 테이블을 비우므로
  `pnpm test:db` 가 개발 데이터를 지운다. 또한 **두 프로세스가 동시에 돌리면 서로의 행을 지워
  가짜 실패**가 난다(증상: 성공 직후 행이 사라짐, FK violation, `expected null to be '...'`).
  실제 데이터가 쌓이기 시작하면 테스트용 프로젝트를 분리할 것(무료).
- **`CHZZK_REDIRECT_URI` 의 포트와 `pnpm dev --port` 가 일치해야 한다.** 어긋나면 콜백이
  조용히 실패하고 증상이 "로그인을 눌러도 아무 일도 안 일어남"이라 원인 추적이 어렵다.
