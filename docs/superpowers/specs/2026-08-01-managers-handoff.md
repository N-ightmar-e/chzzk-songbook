# 계획 3(매니저와 공개 페이지) 인계 문서

계획 3 실행 중 나온 판단과 남은 항목을 적는다. 실행 원장은 git-ignore 대상이라 사라지므로
남아야 할 것만 옮긴다. 계획 2의 인계 문서는 `2026-08-01-songbooks-handoff.md` 이고,
거기 적힌 항목 중 해소된 것은 아래 "해소됨" 절에 적었다.

계획 3 최종 상태: `pnpm test` 72 / `pnpm test:db` 106 / `pnpm test:e2e` 72 / `pnpm build` 통과.

---

## 배포 게이트 (아직 열리지 않았다)

**실제 치지직 OAuth 왕복이 사람 손으로 확인되지 않았다.** 스펙의 마지막 미해결 항목은
`/auth/v1/token` 응답이 공통 응답 봉투(`{code, message, content}`)를 쓰는지다.
`lib/chzzk.js` 는 양쪽을 받도록 짜여 있지만, 실물 확인 전에는 배포하지 않는다.

`pnpm dev --port 3001` 로 띄우고 로그인한다. `CHZZK_REDIRECT_URI` 의 포트와 치지직
개발자센터 등록값과 `--port` 가 **셋 다 3001** 이어야 한다. 어긋나면 콜백이 조용히 실패한다.

**확인할 때 함께 봐 둘 것:** 치지직 앱의 "채널 관리자 조회" 스코프가 회수된 상태에서
`streaming-roles` 가 **403 을 주는지, HTTP 200 + 빈 목록을 주는지.** 후자라면 스코프 회수
한 번에 자동 동기화된 매니저가 전부 해제된다(아래 참조).

---

## 남은 항목

### 코드

- **실패한 동기화는 `members_synced_at` 을 갱신하지 않아 쿨다운(60초)이 걸리지 않는다.**
  소유자가 버튼을 연타하면 치지직 API 를 반복 호출한다. `ownerOnly` + same-origin 제한이라
  영향은 작다.
- **로그인 콜백이 소유 노래책마다 순차로 동기화를 `await` 한다.** 현재 유저당 노래책 1개
  제한이라 최대 1회지만, 제한이 풀리면 로그인 지연이 선형 증가한다.
- **치지직이 HTTP 200 + 빈 목록을 주면 `source='chzzk_sync'` 매니저가 전부 해제된다.**
  "스트리머가 관리자를 다 뺐다"와 구분되지 않으며 이는 의도된 동작이다. `source='invite'`
  는 보호되고 다음 성공 동기화에서 복구되므로 자기치유적이다. 다만 위 스코프 회수
  시나리오에서는 위험하다 — 실물 확인 후 필요하면 "빈 목록이면 삭제하지 않는다" 가드를
  넣는다.
- **초대 URL 을 `request.url` 의 origin(Host 헤더 유래)으로 조립한다.** 요청자가 소유자
  본인이고 토큰을 이미 쥐고 있어 악용 이득이 없다. 리버스 프록시 뒤에 두면 신뢰 가능한
  호스트 설정을 검토한다.
- **`GET /api/songbooks/[id]/songs` 가 `ownerId`·`chzzkSyncEnabled`·`membersSyncedAt` 을
  노출한다.** 시청자 페이지(`/@slug`)는 이 라우트를 쓰지 않고 서버 컴포넌트가 직접 조회해
  필드를 골라 내려보내므로 실제 노출 경로는 없다. 이 라우트를 외부에 쓰게 되면 좁힌다.
- **배열(`text[]`)·jsonb 타입 미검증.** 배열이 아닌 값이 오면 400 이 아니라 500 이 난다.
  누설·우회는 없다.
- **`app/[handle]/page.jsx` 와 `app/api/songbooks/[id]/songs/route.js` 가 "비공개면 404"
  판정을 각각 갖고 있다.** 둘 다 `accessLevel` 을 쓰고 현재는 일치한다. 이 프로젝트에서
  같은 불변식을 한 곳만 고쳐 비대칭이 남는 문제가 **네 번** 발생했으므로, 셋째 호출자가
  생기면 그때 공용 함수로 뽑는다.

### 테스트

- **`/@slug` 의 "비공개 노래책을 참여자는 본다(200)" 경로가 테스트에 없다.**
  위험한 방향(비로그인에게 노출)은 덮여 있으므로 보안 공백이 아니라 기능 공백이다.
- **`pnpm test:watch` 가 통합 테스트에서 실패한다.** `tests/helpers/global-server.js` 의
  가드가 `process.argv` 에 `"tests/integration"` 이 있을 때만 서버를 띄우는데, `test:watch`
  는 경로 인자가 없다. Windows 역슬래시 경로로 직접 돌릴 때도 같다.
  `pnpm test` / `test:db` / `test:e2e` 세 정규 명령은 영향 없다.
- **`.env.test` 파서가 2벌인데 `tests/helpers/global-server.js` 만 따옴표를 안 벗긴다.**
  현재 `.env.test` 가 따옴표 없이 쓰여 있어 잠재 상태다. 따옴표를 쓰는 순간 spawn 된 dev
  서버만 값이 깨져 "테스트 프로세스는 되는데 서버는 DB 연결 실패" 로 나타난다.
  `docs/SETUP.md` 의 관련 경고도 stale 하다.

### 스펙

- **인가 매트릭스에 "매니저 목록 조회" 행이 없다.** 구현은 `min:'manager'` 인데 정본인
  매트릭스에 근거가 없다. 매트릭스에 행을 추가한다.
- **`GET /api/songbooks/[slug]/songs` vs 구현의 `[id]`.** 스펙과 라우트가 다르다.
  한쪽으로 정리한다.

---

## 계획 2 인계 항목 중 해소된 것

- `mrUrl`·`keyLinks` 스킴 검증 → `lib/db/songs.js` 의 `isSafeLink` 로 **저장 시점**에 건다.
  `validateSongInput` 한 곳에 넣어 POST·bulk·PATCH 세 경로가 같은 판정을 쓴다.
- 자켓 교체 시 고아 파일 → `PATCH /api/songs/[id]` 가 `isJacketPathOf` 가드를 태운 뒤
  이전 파일을 지운다. `updateSong` 성공 뒤에, 경로가 실제로 바뀐 경우에만.
- `app/page.jsx` 의 죽은 `setSongs` → 랜딩 재작성으로 사라짐.
- `lib/store.js`·`data/songs.js` 삭제 → 완료. 시드는 `scripts/seed-dev.mjs` 로 이설.
- 시청자 경로의 응답 필드 과다 노출 → `/@slug` 가 화이트리스트로 골라 내려보낸다.

---

## 운영 주의 (계획 2에서 이어짐, 여전히 유효)

**`pnpm test:db` 와 `pnpm test:e2e` 를 동시에 돌리지 마라.** 두 가지가 겹친다.

1. 운영·테스트 Supabase 프로젝트를 **공용**한다. `truncateAll` 이 서로의 행을 지운다.
2. e2e 는 포트 3100 에 개발 서버를 띄운다. 두 프로세스가 각자 띄우면 서로를 죽인다.

증상이 "테스트가 가끔 무더기로 깨진다"(특히 `truncateAll` 관련 FK 오류)로 나타난다.
**테스트를 완화하지 말고 단독 재실행으로 재현되는지부터 확인하라.** 계획 2·3 실행 중
합쳐 5회 발생했고 전부 경합이었다.

테스트용 Supabase 프로젝트를 따로 파면(무료) 1번이 사라진다. 사용자 결정 대기 중.

**서브에이전트에게 검증을 시킬 때 누가 돌릴지 한쪽으로 정하라.** 그리고 서브에이전트가
유휴로 전환한 것을 "작업 포기"로 해석해 같은 작업을 가져가지 마라 — 실제로 동시 편집
충돌을 만들었다.

---

## 알아 둘 함정

- **Next.js dynamic segment 는 퍼센트 인코딩 원문으로 온다.** `app/[handle]` 의
  `params.handle` 이 `/@dutto` 요청에 `"%40dutto"` 로 들어온다. `decodeURIComponent` 로
  풀어야 하며, 깨진 인코딩(`%zz`)은 던지므로 `try/catch` 로 404 처리한다.
  `@` 나 유니코드를 쓰는 dynamic segment 라우트를 또 만들면 재발한다.
- **PostgREST 는 같은 테이블을 두 번 참조하는 FK 를 구분하지 못한다.**
  `songbook_members` 는 `user_id`·`invited_by` 로, `songbook_invites` 는
  `created_by`·`accepted_by` 로 `users` 를 참조한다. `users(...)` 로 임베드하면
  "more than one relationship was found" 로 거부되니 `users!user_id(...)` 처럼 FK 컬럼을
  명시한다.
- **`useSearchParams()` 는 Suspense 경계를 요구한다**(Next.js 15 App Router).
  없으면 빌드가 프리렌더 단계에서 실패한다.

---

## 사람 확인 대기

1. **전체 흐름** — `pnpm dev --port 3001` → 로그인 → `/manage` 에서 노래책 생성 →
   곡 등록·CSV·자켓·유튜브 썸네일 → 매니저 초대 링크 발급·수락 → `/@내주소` 시청자 화면.
2. **실제 치지직 로그인** — 위 1번에서 함께 확인된다. 배포 게이트가 여기 달려 있다.
3. **테스트용 Supabase 분리** 여부.
