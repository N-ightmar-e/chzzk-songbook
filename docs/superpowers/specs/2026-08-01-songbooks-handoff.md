# 계획 2(노래책과 곡) 인계 문서

계획 2 실행 중 나온 판단과 이연 항목 중 **계획 3 이후로 넘어가는 것**을 적는다.
실행 원장은 git-ignore 대상이라 사라지므로, 남아야 할 것만 여기에 옮긴다.

계획 2 최종 상태: `pnpm test` 64 / `pnpm test:db` 77 / `pnpm test:e2e` 47 / `pnpm build` 통과.

---

## 배포 게이트 (계획 1에서 이어짐 — 아직 열리지 않았다)

**실제 치지직 OAuth 왕복이 사람 손으로 확인되지 않았다.** 스펙의 마지막 미해결 항목은
`/auth/v1/token` 응답이 공통 응답 봉투(`{code, message, content}`)를 쓰는지 여부다.
`lib/chzzk.js` 는 봉투와 평문 양쪽을 받도록 짜여 있지만, 실물로 확인되기 전에는
배포하지 않는다. 확인 방법은 `pnpm dev --port 3001` 로 띄우고 로그인해 보는 것이다.

`CHZZK_REDIRECT_URI` 의 포트와 치지직 개발자센터에 등록한 값과 `--port` 가
**셋 다 3001** 이어야 한다. 어긋나면 콜백이 조용히 실패한다(증상: 로그인을 눌러도
아무 일도 일어나지 않음).

---

## 계획 3이 반드시 처리해야 할 것

### 1. `mrUrl` 스킴 검증 — **저장 시점에** 걸어야 한다

`mrUrl` 은 지금 아무 검증 없이 임의 문자열을 받는다. 계획 3의 `/@slug` 시청자 페이지가
이 값을 `href` 로 렌더하면 `javascript:` 값이 저장형 XSS 가 된다.

**렌더 시점 필터만 넣으면 안 된다.** 계획 2가 이미 임의 값 저장을 허용했으므로, 렌더만
막으면 DB 에 오염된 행이 남는다. `POST /api/songbooks/[id]/songs`, `.../songs/bulk`,
`PATCH /api/songs/[id]` 의 저장 시점에 `http:`/`https:` 화이트리스트를 걸고, 기존 행
정리를 함께 한다. `keyLinks` 의 값들도 같은 처리가 필요하다.

**같은 불변식을 여러 함수가 지켜야 할 때는 공용 함수로 뽑아라.** 이 브랜치에서 한 곳만
고쳐 비대칭이 남는 문제가 **세 번** 발생했다(`createSongbook`/`changeSlug` 의 slug 이력
검사, 그리고 `jacketPath` 검증). `jacketPath` 는 `lib/storage.js` 의 `isJacketPathOf` 로
공용화해 해결했으니 같은 형태를 따르면 된다.

### 2. 자켓 고아 파일 정리 — **순서 주의**

자켓을 교체할 때 이전 Storage 객체가 지워지지 않아 고아로 남는다. 썸네일 버튼을 연타해도
매번 새 uuid 로 올리고 이전 것을 안 지운다.

정리 로직은 "옛 경로를 지운다"는 동작이라 **삭제 경로가 하나 더 늘어난다.** `isJacketPathOf`
로 스코프를 확인한 뒤에만 지우도록 반드시 같은 가드를 태워라.

### 3. `lib/store.js` 와 `data/songs.js` 삭제

`lib/store.js` 는 DB 이전의 프로토타입(로컬 JSON 파일 기반)이고 참조가 0건이다.
`createSong`/`createSongs` 라는 동명 함수가 있어 grep 결과를 오염시키므로 지우는 게 좋다.
`data/songs.js` 는 `CHANNEL` 상수 때문에 `app/page.jsx` 가 아직 import 한다 —
그 페이지를 재작성할 때 함께 정리한다.

**삭제는 별도 커밋으로 분리한다**(사용자 방침).

### 4. `GET /api/songbooks/[id]/songs` 의 응답 필드 좁히기

공개 노래책이면 비로그인에게도 `songbook` 객체가 통째로 나간다 — `ownerId`,
`chzzkSyncEnabled`, `membersSyncedAt` 이 포함된다. 시청자에게 필요 없는 내부 UUID 와
운영 상태다. `/@slug` 페이지가 이 데이터를 쓰게 되므로 그때 형태를 정하면 된다.

`jacketPath` 원문도 응답에 들어간다. 계획 2에서 이게 크로스 테넌트 삭제 공격의 1단계였다
(쓰기 검증으로 막았지만, 굳이 내보낼 이유가 없다).

### 5. 스펙과 라우트 경로 불일치

스펙 API 목록은 `GET /api/songbooks/[slug]/songs` 인데 구현은 `[id]` 다. `/@slug` 페이지가
slug→id 해석을 한 번 더 해야 한다. 스펙을 갱신하든 라우트를 맞추든 한쪽으로 정리한다.

---

## 개발 환경에서 이미 깨져 있는 것

### `pnpm test:watch` 가 통합 테스트에서 실패한다

`tests/helpers/global-server.js` 의 가드가 `process.argv` 에 `"tests/integration"` 이
있을 때만 서버를 띄운다. `test:watch` 는 경로 인자가 없어 가드가 거짓이 되고, e2e 가
skip 이 아니라 **실패**한다(`inject("e2eBaseUrl")` 이 undefined → `startServer()` throw).
Windows 역슬래시 경로(`tests\integration\...`)로 직접 돌릴 때도 같다.

`pnpm test` / `test:db` / `test:e2e` 세 정규 명령은 영향 없다.

### `.env.test` 파서가 2벌인데 한쪽만 따옴표를 벗긴다

`tests/helpers/setup.js` 는 벗기고 `tests/helpers/global-server.js` 는 안 벗긴다.
현재 `.env.test` 가 따옴표 없이 쓰여 있어 잠재 상태지만, 따옴표를 쓰는 순간
spawn 된 dev 서버만 값이 깨져 "테스트 프로세스는 되는데 서버는 DB 연결 실패" 로 나타난다.

`docs/SETUP.md` 의 관련 경고도 stale 하다 — 이제 안 벗기는 건 `global-server.js` 쪽이다.

---

## 운영 주의

### `pnpm test:db` 와 `pnpm test:e2e` 를 동시에 돌리지 마라

두 가지가 겹친다.

1. 운영·테스트 Supabase 프로젝트를 **공용**한다. `truncateAll` 이 서로의 행을 지워
   가짜 실패가 난다. 계획 2 실행 중 3회 발생했다.
2. e2e 는 포트 3100 에 개발 서버를 띄운다. 두 프로세스가 각자 띄우면 서로를 죽여
   `ECONNREFUSED` 와 포트 잔류가 난다. 계획 2 실행 중 1회 발생했다.

증상이 "테스트가 가끔 깨진다" 로 나타나므로, **테스트를 완화하지 말고 단독 재실행으로
재현되는지부터 확인하라.**

테스트용 Supabase 프로젝트를 따로 파면(무료) 1번이 사라진다. 사용자 결정 대기 중.

### 서브에이전트에게 검증을 시킬 때

"검증을 다시 돌려 달라"고 지시하면서 본인도 같은 시각에 돌리면 위 2번이 재현된다.
누가 돌릴지 한쪽으로 정하라.

---

## 그대로 두기로 한 것 (계획 3에서 고칠 필요 없음)

- `titleAliases`/`artistAliases`(text[]), `keyLinks`(jsonb) 타입 미검증 — 배열이 아니면
  400 이 아니라 500 이 난다. 누설·우회는 없다. 위 `mrUrl` 작업과 묶으면 효율적이다.
- 잘못된 videoId 에 `i.ytimg.com` 이 200 + 회색 플레이스홀더 JPEG 를 주면 조용히 저장된다.
  진짜 JPEG 라 매직바이트 검증 통과가 정상 동작이다. UX 문제이고 보안 영향 없다.
- 유튜브 응답 전체를 메모리에 올린 뒤 `MAX_BYTES` 를 검사한다. 호스트가 고정이라 무해.
- `MAX_SONGS_PER_SONGBOOK = 5000` 이 두 파일에 중복.
- 파일 선택 `accept` 에 `image/gif` 가 있는데 서버는 GIF 를 거부한다.
- 잘못된 JSON 본문이 400 이 아니라 500 을 낸다.
- `POST /api/auth/logout` 에만 `requireSameOrigin` 이 없다(`SameSite=Lax` 라 무해).
- `CsvImport` 가 `songbookId` null 방어가 없다(단건 등록 버튼은 막혀 있어 비대칭).

---

## 사람 확인 대기

1. **관리 화면** — `pnpm dev --port 3001` → `/manage`. 노래책 생성, 설정 변경, 곡 등록,
   CSV 가져오기, 자켓 업로드, 유튜브 썸네일까지.
2. **실제 치지직 로그인** — 위 1번에서 함께 확인된다. 배포 게이트가 여기 달려 있다.
3. **테스트용 Supabase 분리** 여부.
