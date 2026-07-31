# 노래책·곡·자켓 업로드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 노래책을 만들고 그 안에 곡을 등록·수정·삭제할 수 있게 한다. 그 과정에서 **인증 없이 열려 있는 라우트 3개를 제거해 배포 게이트를 연다.**

**Architecture:** 모든 쓰기는 `lib/authz.js` 의 `requireSongbookAccess` 를 첫 줄에서 통과한다. DB 접근은 `lib/db/*` 모듈로만 하고 라우트에서 `getDb()` 를 직접 부르지 않는다. 자켓은 Supabase Storage에 두고 업로드는 서버가 매직바이트까지 검증한다.

**Tech Stack:** Next.js 15.5 (App Router, JS/JSX), Node 22, pnpm, Supabase (Postgres + Storage), vitest

**설계 근거:** `docs/superpowers/specs/2026-07-31-multitenant-songbook-design.md`
**인계 사항:** `docs/superpowers/specs/2026-07-31-foundation-handoff.md`
**선행 완료:** `docs/superpowers/plans/2026-07-31-multitenant-foundation.md` (계획 1, main에 병합됨)

**이 계획의 범위:** 스펙 구현순서 4~6단계 + 인계 문서의 계획 2 항목 8개.
매니저 동기화·초대·`/@handle` 시청자 페이지·기존 자산 삭제는 계획 3이다.

## Global Constraints

- **패키지 매니저는 pnpm.** 모든 명령은 `pnpm`.
- **새 의존성 추가 금지.** 필요하다고 판단되면 멈추고 보고할 것.
- **`NEXT_PUBLIC_` 접두사 환경변수를 만들지 않는다.** 붙이면 값이 브라우저로 전송된다.
- **언어는 JavaScript.** `.ts` 파일 금지. 경로 별칭은 `@/` → 프로젝트 루트.
- **주석·에러 메시지·UI 문구는 한국어.**
- **커밋 메시지에 AI 작성 표시(`Co-Authored-By`, `Generated with`, 🤖)를 절대 넣지 않는다.**
- **라우트 핸들러에서 `getDb()` 를 직접 호출하지 않는다.** DB 접근은 `lib/db/*` 를 거친다.
- **모든 쓰기 라우트는 첫 줄에서 `requireSongbookAccess` 를 호출한다.** (노래책 생성은 예외 — 대상이 아직 없다.)
- **`requireSongbookAccess` 에 `user` 를 넘기지 않는다.** 테스트 전용 시임이며, 라우트가 요청 유래 값을 넘기면 인가가 통째로 우회된다.
- **slug 형식:** `^[a-z0-9][a-z0-9_-]{1,29}$`, 소문자로 정규화 후 저장.
- **인가 매트릭스는 스펙의 표가 정본.** 권한 없음은 403이 아니라 404.
- **DB 테스트는 운영·테스트 프로젝트를 공용한다.** 두 프로세스가 동시에 돌리면 `truncateAll` 이 서로의 행을 지워 가짜 실패가 난다. 테스트를 완화하지 말고 재현 여부로 판단할 것.
- **`CHZZK_REDIRECT_URI` 포트는 3001.** 개발 서버는 `pnpm dev --port 3001`.

## 현재 상태 (계획 1 완료 시점)

```
lib/env.js        requireEnv / optionalEnv / isProduction / assertProductionEnv
lib/crypto.js     encryptSecret / decryptSecret (AES-256-GCM, v1:iv:tag:ct)
lib/chzzk.js      ChzzkApiError / isConfigured / buildAuthorizeUrl / exchangeCodeForToken
                  fetchMe / refreshAccessToken / revokeToken / fetchChannels / fetchStreamingRoles
lib/session.js    SESSION_COOKIE_NAME / signSessionId / verifySessionCookie
                  getSessionCookie / setSessionCookie / clearSessionCookie
lib/authz.js      AuthzError / currentUser / accessLevel / requireSongbookAccess
lib/http.js       errorResponse
lib/db/client.js  getDb
lib/db/users.js   upsertUserFromLogin / ensurePlaceholderUsers / findUserById / findUserByChannelId
lib/db/tokens.js  saveTokens / deleteTokens / getValidAccessToken / TokenRefreshBusyError
lib/db/sessions.js createSession / resolveSession / revokeSession
instrumentation.js  프로덕션 필수 환경변수 검증

테스트: pnpm test 42 passed, pnpm test:db 37 passed, pnpm build 통과
```

**아직 무방비인 것 (이 계획이 제거한다):**

```
app/api/songs/route.js       GET/POST — 인증 없음, lib/store.js(파일) 사용
app/api/songs/bulk/route.js  POST     — 인증 없음, lib/store.js 사용
app/api/upload/route.js      POST     — 인증 없음, public/uploads/ 에 파일 저장
```

## File Structure

| 파일 | 책임 |
|---|---|
| `lib/slug.js` (신규) | slug 정규화·형식 검증·예약어 판정. 순수 함수 |
| `lib/db/songbooks.js` (신규) | `songbooks` + `songbook_slug_history` 쿼리 |
| `lib/db/songs.js` (신규) | `songs` 쿼리 |
| `lib/storage.js` (신규) | Supabase Storage 업로드·삭제. 이미지 검증 포함 |
| `lib/image.js` (신규) | 매직바이트 판별. 순수 함수 |
| `lib/http.js` (수정) | `errorResponse` + `requireSameOrigin` |
| `lib/db/errors.js` (신규) | `failed()` 공용화 (현재 3중복) |
| `lib/uuid.js` (신규) | `UUID_RE` 공용화 (현재 2중복) |
| `app/api/songbooks/**` (신규) | 노래책 생성·설정 변경 |
| `app/api/songs/**` (교체) | 곡 CRUD. 전부 `songbook_id` 스코프 |
| `app/api/upload/route.js` (교체) | Storage 업로드 |
| `app/manage/**` (신규) | 관리 화면 |
| `supabase/migrations/0003_*.sql` (신규) | `jackets` 버킷 생성 |
| `tests/helpers/server.js` (신규) | 통합 테스트 하네스 (실 HTTP) |
| `tests/integration/**` (신규) | 인가 매트릭스 통합 테스트 |

`lib/db/` 를 테이블 묶음별로 쪼개는 기존 방침을 유지한다.

## 테스트 전략 — 이 계획에서 바뀌는 것

계획 1의 `tests/db/authz.test.js` 는 `requireSongbookAccess` 에 actor를 **주입**해서
쿠키 → 서명 검증 → 세션 조회 → 유저 조인 경로를 통째로 건너뛴다. 스펙이 이름을 붙여 경계한
형태다 — "인가를 모킹하면 인가가 동작하지 않아도 테스트가 통과한다".

라우트가 생기는 이 계획부터는 **실제 HTTP로 검증한다.** `tests/helpers/server.js` 가
`next dev` 를 별도 포트로 띄우고, 테스트는 진짜 쿠키를 붙여 요청한다. 기존 단위 테스트는
남겨두되(빠른 피드백용), **인가 매트릭스의 정본은 통합 테스트**다.

세 갈래로 나뉜다.

- `pnpm test` — 순수 단위. DB·서버 불필요
- `pnpm test:db` — DB 통합. `.env.test` 필요
- `pnpm test:e2e` — HTTP 통합. `.env.test` + 서버 자동 기동

---

### Task 1: 공용 유틸 추출 + slug 규칙

**Files:**
- Create: `lib/uuid.js`, `lib/db/errors.js`, `lib/slug.js`
- Modify: `lib/authz.js`, `lib/db/sessions.js`, `lib/db/users.js`, `lib/db/tokens.js`
- Create: `tests/slug.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `lib/uuid.js`: `UUID_RE`, `isUuid(value): boolean`
  - `lib/db/errors.js`: `failed(error, what): never` — throw
  - `lib/slug.js`: `normalizeSlug(raw): string`, `validateSlug(slug): string|null` (오류 메시지 또는 null), `RESERVED_SLUGS: Set`

`failed()` 가 `lib/db/users.js`·`sessions.js`·`tokens.js` 에 3중복이고 `lib/authz.js` 에 같은
일을 하는 인라인 코드가 2곳 있다. `UUID_RE` 는 `lib/authz.js`·`lib/db/sessions.js` 2중복이다.
곧 `songbooks.js`·`songs.js` 가 붙으면 5중복이 되므로 지금 걷어낸다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/slug.test.js`:

```js
import { describe, it, expect } from "vitest";
import { normalizeSlug, validateSlug, RESERVED_SLUGS } from "@/lib/slug";
import { isUuid } from "@/lib/uuid";

describe("lib/slug", () => {
  it("대문자를 소문자로 정규화한다", () => {
    expect(normalizeSlug("Dutto")).toBe("dutto");
  });

  it("앞뒤 공백을 제거한다", () => {
    expect(normalizeSlug("  dutto  ")).toBe("dutto");
  });

  it("null·undefined를 빈 문자열로 다룬다", () => {
    expect(normalizeSlug(null)).toBe("");
    expect(normalizeSlug(undefined)).toBe("");
  });

  it("올바른 slug는 null을 준다", () => {
    expect(validateSlug("dutto")).toBeNull();
    expect(validateSlug("a1")).toBeNull();
    expect(validateSlug("new-jeans_2")).toBeNull();
  });

  it("2자 미만은 거부한다", () => {
    expect(validateSlug("a")).toMatch(/2/);
  });

  it("30자 초과는 거부한다", () => {
    expect(validateSlug("a".repeat(31))).toMatch(/30/);
  });

  it("숫자·영문이 아닌 첫 글자를 거부한다", () => {
    expect(validateSlug("-abc")).toBeTruthy();
    expect(validateSlug("_abc")).toBeTruthy();
  });

  it("대문자를 거부한다 (정규화 전 값이 들어온 경우)", () => {
    expect(validateSlug("Dutto")).toBeTruthy();
  });

  it("한글·유니코드를 거부한다", () => {
    // 셀프서비스 선착순이라 시각적으로 동일한 문자로 사칭이 가능하다.
    expect(validateSlug("새벽감자")).toBeTruthy();
    expect(validateSlug("duttо")).toBeTruthy(); // 키릴 о
  });

  it("공백·특수문자를 거부한다", () => {
    expect(validateSlug("my book")).toBeTruthy();
    expect(validateSlug("my.book")).toBeTruthy();
    expect(validateSlug("my/book")).toBeTruthy();
  });

  it("예약어를 거부한다", () => {
    for (const reserved of ["admin", "official", "chzzk", "naver", "api"]) {
      expect(validateSlug(reserved)).toMatch(/사용할 수 없/);
    }
  });

  it("예약어 목록이 사칭 방지 대상을 담는다", () => {
    expect(RESERVED_SLUGS.has("chzzk")).toBe(true);
    expect(RESERVED_SLUGS.has("staff")).toBe(true);
  });
});

describe("lib/uuid", () => {
  it("uuid를 판별한다", () => {
    expect(isUuid("11111111-2222-3333-4444-555555555555")).toBe(true);
  });
  it("uuid가 아닌 값을 거부한다", () => {
    expect(isUuid("아님")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm test tests/slug.test.js`
Expected: FAIL — `Cannot find module '@/lib/slug'`

- [ ] **Step 3: `lib/uuid.js` 작성**

```js
// uuid 형식 판별. DB에 넘기기 전에 거른다 —
// uuid가 아닌 값을 조회하면 Postgres가 22P02 invalid input syntax 를 던진다.
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}
```

- [ ] **Step 4: `lib/db/errors.js` 작성**

```js
// Supabase는 { data, error } 를 반환하고 예외를 던지지 않는다.
// error 를 확인하지 않고 data 를 쓰면 실패가 조용히 null 로 흘러간다.
export function failed(error, what) {
  throw new Error(`${what} 실패: ${error.message}`);
}
```

- [ ] **Step 5: `lib/slug.js` 작성**

```js
// slug 규칙. 노래책 주소 /@slug 에 쓰인다.
//
// 유니코드를 불허하는 이유: 셀프서비스 선착순이라, 시각적으로 동일한 유니코드 문자
// (homograph)로 유명 스트리머를 사칭할 수 있다. 예약어 차단도 라우팅 충돌이 아니라
// 사칭 방지가 목적이다(@ 접두사라 시스템 경로와는 애초에 충돌하지 않는다).
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{1,29}$/;

export const RESERVED_SLUGS = new Set([
  "admin", "official", "staff", "support", "help",
  "chzzk", "naver", "songbook", "api", "system",
]);

export function normalizeSlug(raw) {
  return String(raw ?? "").trim().toLowerCase();
}

// 문제가 없으면 null, 있으면 사용자에게 보여줄 한국어 메시지를 반환한다.
export function validateSlug(slug) {
  const value = String(slug ?? "");
  if (value.length < 2) return "주소는 2자 이상이어야 해요.";
  if (value.length > 30) return "주소는 30자 이하여야 해요.";
  if (!SLUG_RE.test(value)) {
    return "주소는 영문 소문자·숫자로 시작하고, 영문 소문자·숫자·- _ 만 쓸 수 있어요.";
  }
  if (RESERVED_SLUGS.has(value)) return "이 주소는 사용할 수 없어요.";
  return null;
}
```

- [ ] **Step 6: 기존 파일에서 중복 제거**

아래 4개 파일을 수정한다. **동작을 바꾸지 말고 import로 교체만 한다.**

`lib/authz.js`:
- 파일 상단의 `const UUID_RE = /.../` 줄을 삭제하고 `import { UUID_RE } from "@/lib/uuid";` 추가
- `accessLevel` 안의 인라인 에러 처리 2곳(`throw new Error(\`노래책 조회 실패: ...\`)`,
  `throw new Error(\`멤버 조회 실패: ...\`)`)을 `failed(error, "노래책 조회")` /
  `failed(memberError, "멤버 조회")` 로 교체하고 `import { failed } from "@/lib/db/errors";` 추가

`lib/db/sessions.js`:
- 로컬 `failed` 함수 정의를 삭제하고 `import { failed } from "@/lib/db/errors";` 추가
- 로컬 `UUID_RE` 정의를 삭제하고 `import { UUID_RE } from "@/lib/uuid";` 추가

`lib/db/users.js`, `lib/db/tokens.js`:
- 각각의 로컬 `failed` 정의를 삭제하고 `import { failed } from "@/lib/db/errors";` 추가

- [ ] **Step 7: 테스트 확인**

Run: `pnpm test`
Expected: 56 passed (기존 42 + slug 12 + uuid 2)

Run: `pnpm test:db`
Expected: 37 passed (변동 없음 — 리팩터링이므로 동작이 같아야 한다)

Run: `pnpm build`
Expected: 성공

- [ ] **Step 8: 커밋**

```bash
git add lib/uuid.js lib/db/errors.js lib/slug.js lib/authz.js lib/db/sessions.js lib/db/users.js lib/db/tokens.js tests/slug.test.js
git commit -m "refactor: 공용 유틸 추출하고 slug 규칙 추가"
```

---

### Task 2: 노래책 저장소

**Files:**
- Create: `lib/db/songbooks.js`
- Create: `tests/db/songbooks.test.js`
- Modify: `app/api/auth/callback/route.js`

**Interfaces:**
- Consumes: `getDb`, `failed`, `isUuid`, `normalizeSlug`
- Produces:
  - `createSongbook({ ownerId, slug, title, intro }): Promise<Songbook>`
  - `findSongbookBySlug(slug): Promise<Songbook|null>` — 현재 slug만
  - `findSongbookByHistoricalSlug(slug): Promise<{songbookId, currentSlug}|null>`
  - `findSongbookById(id): Promise<Songbook|null>`
  - `listSongbooksForUser(userId): Promise<Array<Songbook & {role}>>` — 소유 + 매니저
  - `updateSongbook(id, { title, intro, isPublic }): Promise<Songbook>`
  - `changeSlug(id, newSlug): Promise<Songbook>` — 옛 slug를 이력으로 이동
  - `isSlugTaken(slug): Promise<boolean>` — 현재 slug + 이력 양쪽 검사
  - `countSongbooksOwnedBy(userId): Promise<number>`
  - `ownsAnySongbook(userId): Promise<boolean>`
  - `Songbook` = `{ id, ownerId, slug, title, intro, isPublic, chzzkSyncEnabled, membersSyncedAt, createdAt, updatedAt }`

`ownsAnySongbook` 은 `app/api/auth/callback/route.js` 의 인라인 `ownsSongbook` 을 대체한다.
그 함수는 라우트가 `getDb()` 를 직접 부르는 유일한 지점이고 Supabase `error` 도 검사하지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/db/songbooks.test.js`:

```js
import { it, expect, beforeEach } from "vitest";
import { describeDb, truncateAll } from "../helpers/db.js";
import { getDb } from "@/lib/db/client";
import { upsertUserFromLogin } from "@/lib/db/users";
import {
  createSongbook, findSongbookBySlug, findSongbookById, findSongbookByHistoricalSlug,
  listSongbooksForUser, updateSongbook, changeSlug, isSlugTaken,
  countSongbooksOwnedBy, ownsAnySongbook,
} from "@/lib/db/songbooks";

describeDb("lib/db/songbooks", () => {
  let owner, other;

  beforeEach(async () => {
    await truncateAll(getDb());
    owner = await upsertUserFromLogin({ chzzkChannelId: "owner", chzzkChannelName: "주인" });
    other = await upsertUserFromLogin({ chzzkChannelId: "other", chzzkChannelName: "타인" });
  });

  it("노래책을 만들고 slug로 찾는다", async () => {
    const book = await createSongbook({ ownerId: owner.id, slug: "dutto", title: "듀토 노래책" });
    expect(book.id).toBeTruthy();
    expect(book.slug).toBe("dutto");
    expect(book.isPublic).toBe(true);
    expect(book.chzzkSyncEnabled).toBe(true);

    const found = await findSongbookBySlug("dutto");
    expect(found.id).toBe(book.id);
  });

  it("없는 slug는 null을 준다", async () => {
    expect(await findSongbookBySlug("없음")).toBeNull();
  });

  it("uuid가 아닌 id로 조회해도 던지지 않고 null을 준다", async () => {
    expect(await findSongbookById("uuid아님")).toBeNull();
  });

  it("slug 중복을 거부한다", async () => {
    await createSongbook({ ownerId: owner.id, slug: "dutto", title: "A" });
    await expect(
      createSongbook({ ownerId: other.id, slug: "dutto", title: "B" }),
    ).rejects.toThrow();
  });

  it("isSlugTaken은 현재 slug를 잡는다", async () => {
    await createSongbook({ ownerId: owner.id, slug: "dutto", title: "A" });
    expect(await isSlugTaken("dutto")).toBe(true);
    expect(await isSlugTaken("free")).toBe(false);
  });

  it("slug를 바꾸면 옛 slug가 이력으로 남는다", async () => {
    const book = await createSongbook({ ownerId: owner.id, slug: "old", title: "A" });
    const updated = await changeSlug(book.id, "new");
    expect(updated.slug).toBe("new");

    const history = await findSongbookByHistoricalSlug("old");
    expect(history.songbookId).toBe(book.id);
    expect(history.currentSlug).toBe("new");
  });

  it("옛 slug는 제3자가 선점할 수 없다", async () => {
    // 유명 스트리머가 주소를 바꾼 직후 제3자가 가로채 사칭하는 것을 막는다.
    const book = await createSongbook({ ownerId: owner.id, slug: "old", title: "A" });
    await changeSlug(book.id, "new");
    expect(await isSlugTaken("old")).toBe(true);
    await expect(
      createSongbook({ ownerId: other.id, slug: "old", title: "B" }),
    ).rejects.toThrow();
  });

  it("같은 노래책이 slug를 두 번 바꿔도 이력이 쌓인다", async () => {
    const book = await createSongbook({ ownerId: owner.id, slug: "a1", title: "A" });
    await changeSlug(book.id, "b1");
    await changeSlug(book.id, "c1");
    expect((await findSongbookByHistoricalSlug("a1")).currentSlug).toBe("c1");
    expect((await findSongbookByHistoricalSlug("b1")).currentSlug).toBe("c1");
  });

  it("설정을 바꾼다", async () => {
    const book = await createSongbook({ ownerId: owner.id, slug: "dutto", title: "A" });
    const updated = await updateSongbook(book.id, {
      title: "새 제목", intro: "소개", isPublic: false,
    });
    expect(updated.title).toBe("새 제목");
    expect(updated.intro).toBe("소개");
    expect(updated.isPublic).toBe(false);
  });

  it("소유자의 노래책 수를 센다", async () => {
    expect(await countSongbooksOwnedBy(owner.id)).toBe(0);
    await createSongbook({ ownerId: owner.id, slug: "dutto", title: "A" });
    expect(await countSongbooksOwnedBy(owner.id)).toBe(1);
    expect(await countSongbooksOwnedBy(other.id)).toBe(0);
  });

  it("ownsAnySongbook은 소유 여부를 준다", async () => {
    expect(await ownsAnySongbook(owner.id)).toBe(false);
    await createSongbook({ ownerId: owner.id, slug: "dutto", title: "A" });
    expect(await ownsAnySongbook(owner.id)).toBe(true);
    expect(await ownsAnySongbook(other.id)).toBe(false);
  });

  it("listSongbooksForUser는 소유와 매니저 참여를 모두 준다", async () => {
    const mine = await createSongbook({ ownerId: owner.id, slug: "mine", title: "내것" });
    const theirs = await createSongbook({ ownerId: other.id, slug: "theirs", title: "남것" });
    await getDb().from("songbook_members").insert({
      songbook_id: theirs.id, user_id: owner.id, role: "manager", source: "invite",
    });

    const list = await listSongbooksForUser(owner.id);
    const byId = Object.fromEntries(list.map((b) => [b.id, b.role]));
    expect(byId[mine.id]).toBe("owner");
    expect(byId[theirs.id]).toBe("manager");
    expect(list).toHaveLength(2);
  });

  it("참여하지 않은 노래책은 목록에 없다", async () => {
    await createSongbook({ ownerId: other.id, slug: "theirs", title: "남것" });
    expect(await listSongbooksForUser(owner.id)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm test:db`
Expected: FAIL — `Cannot find module '@/lib/db/songbooks'`

- [ ] **Step 3: `lib/db/songbooks.js` 작성**

```js
// songbooks + songbook_slug_history 저장소. DB는 snake_case, 앱은 camelCase.
import { getDb } from "@/lib/db/client";
import { failed } from "@/lib/db/errors";
import { isUuid } from "@/lib/uuid";
import { normalizeSlug } from "@/lib/slug";

function toSongbook(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    slug: row.slug,
    title: row.title,
    intro: row.intro,
    isPublic: row.is_public,
    chzzkSyncEnabled: row.chzzk_sync_enabled,
    membersSyncedAt: row.members_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createSongbook({ ownerId, slug, title, intro = null }) {
  const { data, error } = await getDb()
    .from("songbooks")
    .insert({ owner_id: ownerId, slug: normalizeSlug(slug), title, intro })
    .select()
    .single();
  if (error) failed(error, "노래책 생성");
  return toSongbook(data);
}

export async function findSongbookBySlug(slug) {
  const { data, error } = await getDb()
    .from("songbooks").select().eq("slug", normalizeSlug(slug)).maybeSingle();
  if (error) failed(error, "노래책 조회");
  return toSongbook(data);
}

export async function findSongbookById(id) {
  if (!isUuid(id)) return null;
  const { data, error } = await getDb()
    .from("songbooks").select().eq("id", id).maybeSingle();
  if (error) failed(error, "노래책 조회");
  return toSongbook(data);
}

// 옛 slug로 들어온 요청을 현재 slug로 안내하기 위한 조회.
export async function findSongbookByHistoricalSlug(slug) {
  const { data, error } = await getDb()
    .from("songbook_slug_history")
    .select("songbook_id, songbooks(slug)")
    .eq("slug", normalizeSlug(slug))
    .maybeSingle();
  if (error) failed(error, "옛 주소 조회");
  if (!data) return null;
  return { songbookId: data.songbook_id, currentSlug: data.songbooks?.slug ?? null };
}

// 현재 slug와 이력을 모두 검사한다. 이력을 빼면 옛 주소를 제3자가 선점해 사칭할 수 있다.
export async function isSlugTaken(slug) {
  const value = normalizeSlug(slug);
  const db = getDb();

  const { data: current, error: currentError } = await db
    .from("songbooks").select("id").eq("slug", value).maybeSingle();
  if (currentError) failed(currentError, "주소 중복 확인");
  if (current) return true;

  const { data: past, error: pastError } = await db
    .from("songbook_slug_history").select("slug").eq("slug", value).maybeSingle();
  if (pastError) failed(pastError, "주소 중복 확인");
  return Boolean(past);
}

export async function updateSongbook(id, { title, intro, isPublic, chzzkSyncEnabled }) {
  const patch = { updated_at: new Date().toISOString() };
  if (title !== undefined) patch.title = title;
  if (intro !== undefined) patch.intro = intro;
  if (isPublic !== undefined) patch.is_public = isPublic;
  if (chzzkSyncEnabled !== undefined) patch.chzzk_sync_enabled = chzzkSyncEnabled;

  const { data, error } = await getDb()
    .from("songbooks").update(patch).eq("id", id).select().single();
  if (error) failed(error, "노래책 설정 변경");
  return toSongbook(data);
}

// slug 교체. 옛 값을 이력에 남겨 링크를 살리고 재선점을 막는다.
export async function changeSlug(id, newSlug) {
  const db = getDb();
  const value = normalizeSlug(newSlug);

  const current = await findSongbookById(id);
  if (!current) failed({ message: "노래책을 찾을 수 없음" }, "주소 변경");
  if (current.slug === value) return current;

  const { data, error } = await db
    .from("songbooks")
    .update({ slug: value, updated_at: new Date().toISOString() })
    .eq("id", id).select().single();
  if (error) failed(error, "주소 변경");

  const { error: historyError } = await db
    .from("songbook_slug_history")
    .insert({ slug: current.slug, songbook_id: id });
  if (historyError) failed(historyError, "옛 주소 보존");

  return toSongbook(data);
}

export async function countSongbooksOwnedBy(userId) {
  const { count, error } = await getDb()
    .from("songbooks").select("id", { count: "exact", head: true }).eq("owner_id", userId);
  if (error) failed(error, "노래책 수 조회");
  return count ?? 0;
}

export async function ownsAnySongbook(userId) {
  return (await countSongbooksOwnedBy(userId)) > 0;
}

// 소유한 것 + 매니저로 참여중인 것. 각 항목에 role 을 붙여준다.
export async function listSongbooksForUser(userId) {
  const db = getDb();

  const { data: owned, error: ownedError } = await db
    .from("songbooks").select().eq("owner_id", userId);
  if (ownedError) failed(ownedError, "노래책 목록 조회");

  const { data: memberRows, error: memberError } = await db
    .from("songbook_members").select("songbook_id").eq("user_id", userId);
  if (memberError) failed(memberError, "참여 노래책 조회");

  const ownedIds = new Set((owned ?? []).map((r) => r.id));
  const managedIds = (memberRows ?? [])
    .map((r) => r.songbook_id)
    .filter((id) => !ownedIds.has(id));

  let managed = [];
  if (managedIds.length > 0) {
    const { data, error } = await db.from("songbooks").select().in("id", managedIds);
    if (error) failed(error, "참여 노래책 조회");
    managed = data ?? [];
  }

  return [
    ...(owned ?? []).map((r) => ({ ...toSongbook(r), role: "owner" })),
    ...managed.map((r) => ({ ...toSongbook(r), role: "manager" })),
  ];
}
```

- [ ] **Step 4: 테스트 확인**

Run: `pnpm test:db`
Expected: 50 passed (기존 37 + songbooks 13)

- [ ] **Step 5: `app/api/auth/callback/route.js` 의 인라인 쿼리 교체**

파일 상단의 `import { getDb } from "@/lib/db/client";` 를 삭제하고
`import { ownsAnySongbook } from "@/lib/db/songbooks";` 를 추가한다.

로컬 `ownsSongbook` 함수 정의(주석 포함)를 통째로 삭제하고, 호출부
`if (await ownsSongbook(user.id))` 를 `if (await ownsAnySongbook(user.id))` 로 바꾼다.

이러면 라우트에서 `getDb()` 직접 호출이 0건이 되고, 검사하지 않던 Supabase `error` 도
`failed()` 관례를 타게 된다.

- [ ] **Step 6: 라우트에서 getDb 직접 호출이 없는지 확인**

Run: `grep -rn "getDb()" app/`
Expected: 결과 없음

Run: `pnpm build`
Expected: 성공

- [ ] **Step 7: 커밋**

```bash
git add lib/db/songbooks.js tests/db/songbooks.test.js app/api/auth/callback/route.js
git commit -m "feat: 노래책 저장소 추가하고 콜백의 직접 쿼리 제거"
```

---

### Task 3: 통합 테스트 하네스

**Files:**
- Create: `tests/helpers/server.js`
- Create: `tests/helpers/session.js`
- Create: `tests/integration/smoke.test.js`
- Modify: `package.json`, `vitest.config.js`

**Interfaces:**
- Consumes: `createSession`, `signSessionId`, `SESSION_COOKIE_NAME`
- Produces:
  - `tests/helpers/server.js`: `startServer(): Promise<{baseUrl, stop}>`, `describeE2e`
  - `tests/helpers/session.js`: `cookieForUser(user): Promise<string>` — 실제 세션을 만들고 서명된 쿠키 문자열 반환

**왜 필요한가:** 계획 1의 인가 테스트는 `requireSongbookAccess` 에 actor를 주입해 쿠키·세션·유저
조회 경로를 건너뛴다. 스펙이 명시적으로 경계한 형태다. 라우트가 생기는 지금부터는 **실제 HTTP로**
검증한다. `cookieForUser` 는 진짜 세션을 만들고 진짜 서명을 붙이므로, 서버가 쿠키를 검증하고
세션을 조회하고 유저를 조인하는 전 경로가 실행된다.

- [ ] **Step 1: `tests/helpers/server.js` 작성**

```js
// 통합 테스트용 개발 서버. 스위트 전체에서 한 번만 띄운다.
import { spawn } from "node:child_process";
import { describe } from "vitest";

const PORT = 3100; // 개발 서버(3001)와 겹치지 않게
const BASE_URL = `http://localhost:${PORT}`;
const READY_TIMEOUT_MS = 120_000;

export const describeE2e =
  process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY ? describe : describe.skip;

async function waitForReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/me`);
      if (res.ok) return;
    } catch {
      // 아직 안 떴다
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`개발 서버가 ${READY_TIMEOUT_MS}ms 안에 뜨지 않았습니다.`);
}

export async function startServer() {
  const child = spawn("pnpm", ["exec", "next", "dev", "--port", String(PORT)], {
    stdio: "ignore",
    shell: process.platform === "win32",
    env: { ...process.env },
  });

  try {
    await waitForReady();
  } catch (err) {
    child.kill();
    throw err;
  }

  return {
    baseUrl: BASE_URL,
    stop() {
      child.kill();
    },
  };
}
```

- [ ] **Step 2: `tests/helpers/session.js` 작성**

```js
// 테스트용 세션 쿠키. 실제 세션 행을 만들고 실제 서명을 붙인다 —
// 이래야 서버가 쿠키 검증 → 세션 조회 → 유저 조인 전 경로를 실행한다.
import { createSession } from "@/lib/db/sessions";
import { signSessionId, SESSION_COOKIE_NAME } from "@/lib/session";

export async function cookieForUser(user) {
  const session = await createSession({ userId: user.id, userAgent: "vitest" });
  return `${SESSION_COOKIE_NAME}=${signSessionId(session.id)}`;
}

// 비로그인 요청용. 쿠키 헤더를 아예 안 붙인다.
export const NO_COOKIE = undefined;
```

- [ ] **Step 3: `package.json` 스크립트 추가**

`scripts` 를 아래로 교체한다:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run --exclude 'tests/db/**' --exclude 'tests/integration/**'",
    "test:db": "vitest run tests/db",
    "test:e2e": "vitest run tests/integration",
    "test:watch": "vitest"
  },
```

- [ ] **Step 4: `vitest.config.js` 의 타임아웃 상향**

`test` 블록에 두 줄을 추가한다(기존 항목은 그대로 둔다):

```js
    // 통합 테스트는 개발 서버 기동을 기다린다.
    testTimeout: 30_000,
    hookTimeout: 150_000,
```

- [ ] **Step 5: 스모크 통합 테스트 작성**

`tests/integration/smoke.test.js`:

```js
import { it, expect, beforeAll, afterAll } from "vitest";
import { describeE2e, startServer } from "../helpers/server.js";
import { cookieForUser } from "../helpers/session.js";
import { truncateAll } from "../helpers/db.js";
import { getDb } from "@/lib/db/client";
import { upsertUserFromLogin } from "@/lib/db/users";

describeE2e("통합 테스트 하네스", () => {
  let server;

  beforeAll(async () => { server = await startServer(); });
  afterAll(() => { server?.stop(); });

  it("서버가 뜨고 /api/me 가 응답한다", async () => {
    const res = await fetch(`${server.baseUrl}/api/me`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toBeNull();
  });

  it("실제 세션 쿠키로 로그인 상태가 된다", async () => {
    await truncateAll(getDb());
    const user = await upsertUserFromLogin({
      chzzkChannelId: "e2e-user", chzzkChannelName: "통합테스트",
    });
    const cookie = await cookieForUser(user);

    const res = await fetch(`${server.baseUrl}/api/me`, { headers: { cookie } });
    const body = await res.json();
    expect(body.user?.channelName).toBe("통합테스트");
  });

  it("위조된 쿠키는 비로그인으로 처리된다", async () => {
    const res = await fetch(`${server.baseUrl}/api/me`, {
      headers: { cookie: "songbook_session=위조.값" },
    });
    const body = await res.json();
    expect(body.user).toBeNull();
  });
});
```

- [ ] **Step 6: 테스트 확인**

Run: `pnpm test:e2e`
Expected: 3 passed. 첫 실행은 서버 기동 때문에 1분 이상 걸릴 수 있다.

Run: `pnpm test`
Expected: 56 passed (통합 테스트가 제외되는지 확인)

- [ ] **Step 7: 커밋**

```bash
git add tests/helpers/server.js tests/helpers/session.js tests/integration/smoke.test.js package.json vitest.config.js
git commit -m "test: 실제 HTTP로 검증하는 통합 테스트 하네스 추가"
```

---

### Task 4: 노래책 API + 인가 매트릭스 통합 검증

**Files:**
- Create: `app/api/songbooks/route.js`, `app/api/songbooks/[id]/route.js`
- Modify: `lib/http.js`
- Create: `tests/integration/songbooks.test.js`

**Interfaces:**
- Consumes: `requireSongbookAccess`, `currentUser`, `lib/db/songbooks.js`, `validateSlug`
- Produces:
  - `lib/http.js`: `requireSameOrigin(request): void` — 다르면 `AuthzError(403)` throw
  - `POST /api/songbooks` — 노래책 생성 (로그인 필요, 유저당 1개)
  - `PATCH /api/songbooks/[id]` — 설정 변경 (`min: 'owner'`)

**`Origin` 검증을 넣는 이유:** `SameSite=Lax` 가 cross-site POST의 쿠키 전송을 이미 막지만,
이중으로 건다. 쓰기 경로가 늘어나기 전인 지금이 가장 싸다.

- [ ] **Step 1: `lib/http.js` 에 Origin 검증 추가**

파일 끝에 추가한다:

```js
// 쓰기 요청의 Origin 을 검증한다. SameSite=Lax 가 cross-site POST의 쿠키 전송을
// 이미 막지만, 이중 방어다. Origin 이 없는 요청(서버 간 호출, 일부 클라이언트)은
// 통과시킨다 — 브라우저는 쓰기 요청에 항상 Origin 을 붙인다.
export function requireSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const target = new URL(request.url).origin;
  if (origin !== target) {
    throw new AuthzError(403, "허용되지 않은 요청이에요.");
  }
}
```

- [ ] **Step 2: 실패하는 통합 테스트 작성**

`tests/integration/songbooks.test.js`:

```js
import { it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { describeE2e, startServer } from "../helpers/server.js";
import { cookieForUser } from "../helpers/session.js";
import { truncateAll } from "../helpers/db.js";
import { getDb } from "@/lib/db/client";
import { upsertUserFromLogin } from "@/lib/db/users";
import { createSongbook } from "@/lib/db/songbooks";

describeE2e("노래책 API 인가", () => {
  let server, owner, manager, stranger, operator, book;
  let ownerCookie, managerCookie, strangerCookie, operatorCookie;

  beforeAll(async () => { server = await startServer(); });
  afterAll(() => { server?.stop(); });

  beforeEach(async () => {
    const db = getDb();
    await truncateAll(db);
    owner = await upsertUserFromLogin({ chzzkChannelId: "o", chzzkChannelName: "주인" });
    manager = await upsertUserFromLogin({ chzzkChannelId: "m", chzzkChannelName: "매니저" });
    stranger = await upsertUserFromLogin({ chzzkChannelId: "s", chzzkChannelName: "타인" });
    operator = await upsertUserFromLogin({ chzzkChannelId: "op", chzzkChannelName: "운영자" });
    await db.from("users").update({ role: "operator" }).eq("id", operator.id);

    book = await createSongbook({ ownerId: owner.id, slug: "book", title: "노래책" });
    await db.from("songbook_members").insert({
      songbook_id: book.id, user_id: manager.id, role: "manager", source: "invite",
    });

    ownerCookie = await cookieForUser(owner);
    managerCookie = await cookieForUser(manager);
    strangerCookie = await cookieForUser(stranger);
    operatorCookie = await cookieForUser(operator);
  });

  function patch(cookie, body = { title: "바뀐 제목" }) {
    return fetch(`${server.baseUrl}/api/songbooks/${book.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: server.baseUrl,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  // 스펙 인가 매트릭스: 설정 변경은 min:'owner' — 소유자·운영자 통과, 매니저·타인 404
  it("비로그인은 401", async () => {
    expect((await patch(undefined)).status).toBe(401);
  });

  it("타인은 404 (403이 아니다 — 존재를 누설하면 안 된다)", async () => {
    expect((await patch(strangerCookie)).status).toBe(404);
  });

  it("매니저는 404", async () => {
    expect((await patch(managerCookie)).status).toBe(404);
  });

  it("소유자는 200", async () => {
    expect((await patch(ownerCookie)).status).toBe(200);
  });

  it("운영자는 200", async () => {
    expect((await patch(operatorCookie)).status).toBe(200);
  });

  it("없는 노래책은 404", async () => {
    const res = await fetch(
      `${server.baseUrl}/api/songbooks/00000000-0000-0000-0000-000000000000`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: server.baseUrl, cookie: ownerCookie },
        body: JSON.stringify({ title: "x" }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("cross-origin 쓰기는 403", async () => {
    const res = await fetch(`${server.baseUrl}/api/songbooks/${book.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
        cookie: ownerCookie,
      },
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(403);
  });
});

describeE2e("노래책 생성", () => {
  let server, user, cookie;

  beforeAll(async () => { server = await startServer(); });
  afterAll(() => { server?.stop(); });

  beforeEach(async () => {
    await truncateAll(getDb());
    user = await upsertUserFromLogin({ chzzkChannelId: "u", chzzkChannelName: "유저" });
    cookie = await cookieForUser(user);
  });

  function create(body, withCookie = cookie) {
    return fetch(`${server.baseUrl}/api/songbooks`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: server.baseUrl,
        ...(withCookie ? { cookie: withCookie } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  it("비로그인은 401", async () => {
    expect((await create({ slug: "abc", title: "T" }, undefined)).status).toBe(401);
  });

  it("만든다", async () => {
    const res = await create({ slug: "MyBook", title: "내 노래책" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.songbook.slug).toBe("mybook"); // 소문자로 정규화
  });

  it("형식이 틀린 slug는 400", async () => {
    expect((await create({ slug: "새벽감자", title: "T" })).status).toBe(400);
    expect((await create({ slug: "a", title: "T" })).status).toBe(400);
    expect((await create({ slug: "my book", title: "T" })).status).toBe(400);
  });

  it("예약어 slug는 400", async () => {
    expect((await create({ slug: "admin", title: "T" })).status).toBe(400);
  });

  it("제목이 없으면 400", async () => {
    expect((await create({ slug: "abc", title: "  " })).status).toBe(400);
  });

  it("중복 slug는 409", async () => {
    await create({ slug: "taken", title: "A" });
    const other = await upsertUserFromLogin({ chzzkChannelId: "u2", chzzkChannelName: "유저2" });
    const res = await create({ slug: "taken", title: "B" }, await cookieForUser(other));
    expect(res.status).toBe(409);
  });

  it("유저당 노래책은 하나뿐이다", async () => {
    await create({ slug: "first", title: "A" });
    const res = await create({ slug: "second", title: "B" });
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `pnpm test:e2e`
Expected: FAIL — 라우트가 없어 404가 나온다

- [ ] **Step 4: `app/api/songbooks/route.js` 작성**

```js
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/authz";
import { errorResponse, requireSameOrigin } from "@/lib/http";
import { normalizeSlug, validateSlug } from "@/lib/slug";
import { createSongbook, isSlugTaken, countSongbooksOwnedBy } from "@/lib/db/songbooks";

const MAX_SONGBOOKS_PER_USER = 1;

export async function POST(request) {
  try {
    requireSameOrigin(request);

    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
    }

    const input = await request.json();
    const slug = normalizeSlug(input?.slug);
    const title = String(input?.title ?? "").trim();

    const slugError = validateSlug(slug);
    if (slugError) return NextResponse.json({ error: slugError }, { status: 400 });
    if (!title) {
      return NextResponse.json({ error: "노래책 이름을 입력해 주세요." }, { status: 400 });
    }

    if ((await countSongbooksOwnedBy(user.id)) >= MAX_SONGBOOKS_PER_USER) {
      return NextResponse.json(
        { error: "노래책은 계정당 하나만 만들 수 있어요." },
        { status: 409 },
      );
    }

    // 현재 slug와 옛 slug를 모두 검사한다. 옛 주소를 제3자가 선점하면 사칭이 된다.
    if (await isSlugTaken(slug)) {
      return NextResponse.json({ error: "이미 쓰이는 주소예요." }, { status: 409 });
    }

    const songbook = await createSongbook({
      ownerId: user.id,
      slug,
      title,
      intro: String(input?.intro ?? "").trim() || null,
    });
    return NextResponse.json({ songbook }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 5: `app/api/songbooks/[id]/route.js` 작성**

```js
import { NextResponse } from "next/server";
import { requireSongbookAccess } from "@/lib/authz";
import { errorResponse, requireSameOrigin } from "@/lib/http";
import { normalizeSlug, validateSlug } from "@/lib/slug";
import { updateSongbook, changeSlug, isSlugTaken } from "@/lib/db/songbooks";

export async function PATCH(request, { params }) {
  try {
    requireSameOrigin(request);
    const { id } = await params;

    // 인가가 먼저다. 존재 여부·권한 판정을 여기서 끝낸다.
    await requireSongbookAccess(id, { min: "owner" });

    const input = await request.json();
    const patch = {};
    if (input?.title !== undefined) {
      const title = String(input.title).trim();
      if (!title) {
        return NextResponse.json({ error: "노래책 이름을 입력해 주세요." }, { status: 400 });
      }
      patch.title = title;
    }
    if (input?.intro !== undefined) patch.intro = String(input.intro).trim() || null;
    if (input?.isPublic !== undefined) patch.isPublic = Boolean(input.isPublic);
    if (input?.chzzkSyncEnabled !== undefined) {
      patch.chzzkSyncEnabled = Boolean(input.chzzkSyncEnabled);
    }

    let songbook = Object.keys(patch).length > 0
      ? await updateSongbook(id, patch)
      : null;

    if (input?.slug !== undefined) {
      const slug = normalizeSlug(input.slug);
      const slugError = validateSlug(slug);
      if (slugError) return NextResponse.json({ error: slugError }, { status: 400 });
      if (await isSlugTaken(slug)) {
        return NextResponse.json({ error: "이미 쓰이는 주소예요." }, { status: 409 });
      }
      songbook = await changeSlug(id, slug);
    }

    if (!songbook) {
      return NextResponse.json({ error: "바꿀 내용이 없어요." }, { status: 400 });
    }
    return NextResponse.json({ songbook });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 6: 테스트 확인**

Run: `pnpm test:e2e`
Expected: 전부 통과 (smoke 3 + 인가 7 + 생성 7 = 17)

Run: `pnpm test && pnpm test:db && pnpm build`
Expected: 56 / 50 / 성공

- [ ] **Step 7: 커밋**

```bash
git add app/api/songbooks lib/http.js tests/integration/songbooks.test.js
git commit -m "feat: 노래책 API와 인가 매트릭스 통합 검증 추가"
```

---

### Task 5: 곡 저장소

**Files:**
- Create: `lib/db/songs.js`
- Create: `tests/db/songs.test.js`

**Interfaces:**
- Consumes: `getDb`, `failed`, `isUuid`
- Produces:
  - `listSongs(songbookId): Promise<Song[]>`
  - `findSongById(id): Promise<Song|null>`
  - `createSong(songbookId, input): Promise<Song>`
  - `createSongs(songbookId, inputs): Promise<Song[]>`
  - `updateSong(id, input): Promise<Song>`
  - `deleteSong(id): Promise<{jacketPath: string|null}>` — 삭제된 자켓 경로를 돌려준다
  - `countSongs(songbookId): Promise<number>`
  - `Song` = camelCase 변환된 `songs` 행

`deleteSong` 이 `jacketPath` 를 돌려주는 이유: 호출자가 Storage 객체도 지워야 한다.
DB만 지우면 고아 파일이 쌓인다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/db/songs.test.js`:

```js
import { it, expect, beforeEach } from "vitest";
import { describeDb, truncateAll } from "../helpers/db.js";
import { getDb } from "@/lib/db/client";
import { upsertUserFromLogin } from "@/lib/db/users";
import { createSongbook } from "@/lib/db/songbooks";
import {
  listSongs, findSongById, createSong, createSongs, updateSong, deleteSong, countSongs,
} from "@/lib/db/songs";

const BASE = { title: "사건의 지평선", artist: "윤하", genre: "K-POP" };

describeDb("lib/db/songs", () => {
  let book, otherBook;

  beforeEach(async () => {
    await truncateAll(getDb());
    const owner = await upsertUserFromLogin({ chzzkChannelId: "o", chzzkChannelName: "주인" });
    const other = await upsertUserFromLogin({ chzzkChannelId: "o2", chzzkChannelName: "주인2" });
    book = await createSongbook({ ownerId: owner.id, slug: "book", title: "A" });
    otherBook = await createSongbook({ ownerId: other.id, slug: "other", title: "B" });
  });

  it("곡을 등록하고 목록에서 찾는다", async () => {
    const song = await createSong(book.id, BASE);
    expect(song.title).toBe("사건의 지평선");
    expect(song.songbookId).toBe(book.id);
    const list = await listSongs(book.id);
    expect(list).toHaveLength(1);
  });

  it("기본값이 채워진다", async () => {
    const song = await createSong(book.id, BASE);
    expect(song.key).toBe(0);
    expect(song.price).toBe(0);
    expect(song.popular).toBe(false);
    expect(song.titleAliases).toEqual([]);
    expect(song.artistAliases).toEqual([]);
    expect(song.keyLinks).toEqual({});
    expect(song.jacketPath).toBeNull();
  });

  it("별칭 배열을 저장하고 돌려준다", async () => {
    const song = await createSong(book.id, {
      ...BASE, titleAliases: ["역몽", "사카유메"], artistAliases: ["YUNHA"],
    });
    expect(song.titleAliases).toEqual(["역몽", "사카유메"]);
    expect(song.artistAliases).toEqual(["YUNHA"]);
  });

  it("다른 노래책의 곡은 목록에 섞이지 않는다", async () => {
    await createSong(book.id, BASE);
    await createSong(otherBook.id, { ...BASE, title: "다른 곡" });
    expect(await listSongs(book.id)).toHaveLength(1);
    expect(await listSongs(otherBook.id)).toHaveLength(1);
  });

  it("uuid가 아닌 songbookId는 빈 배열을 준다", async () => {
    expect(await listSongs("uuid아님")).toEqual([]);
  });

  it("여러 곡을 한 번에 등록한다", async () => {
    const created = await createSongs(book.id, [
      BASE, { ...BASE, title: "밤편지", artist: "아이유" },
    ]);
    expect(created).toHaveLength(2);
    expect(await countSongs(book.id)).toBe(2);
  });

  it("빈 배열이면 DB를 건드리지 않는다", async () => {
    expect(await createSongs(book.id, [])).toEqual([]);
  });

  it("키 범위를 벗어나면 거부한다", async () => {
    await expect(createSong(book.id, { ...BASE, key: 7 })).rejects.toThrow();
    await expect(createSong(book.id, { ...BASE, key: -7 })).rejects.toThrow();
  });

  it("음수 가격을 거부한다", async () => {
    await expect(createSong(book.id, { ...BASE, price: -1 })).rejects.toThrow();
  });

  it("곡을 수정한다", async () => {
    const song = await createSong(book.id, BASE);
    const updated = await updateSong(song.id, { title: "고친 제목", price: 3000, popular: true });
    expect(updated.title).toBe("고친 제목");
    expect(updated.price).toBe(3000);
    expect(updated.popular).toBe(true);
    expect(updated.artist).toBe("윤하"); // 안 넘긴 필드는 유지
  });

  it("곡을 지우고 자켓 경로를 돌려준다", async () => {
    const song = await createSong(book.id, { ...BASE, jacketPath: "abc/def.webp" });
    const result = await deleteSong(song.id);
    expect(result.jacketPath).toBe("abc/def.webp");
    expect(await findSongById(song.id)).toBeNull();
  });

  it("자켓이 없는 곡을 지우면 jacketPath가 null이다", async () => {
    const song = await createSong(book.id, BASE);
    expect((await deleteSong(song.id)).jacketPath).toBeNull();
  });

  it("노래책을 지우면 곡도 함께 사라진다", async () => {
    await createSong(book.id, BASE);
    await getDb().from("songbooks").delete().eq("id", book.id);
    expect(await listSongs(book.id)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm test:db`
Expected: FAIL — `Cannot find module '@/lib/db/songs'`

- [ ] **Step 3: `lib/db/songs.js` 작성**

```js
// songs 저장소. 모든 조회·쓰기가 songbook_id 스코프 안에서 일어난다.
import { getDb } from "@/lib/db/client";
import { failed } from "@/lib/db/errors";
import { isUuid } from "@/lib/uuid";

function toSong(row) {
  if (!row) return null;
  return {
    id: row.id,
    songbookId: row.songbook_id,
    jacketPath: row.jacket_path,
    title: row.title,
    titleAliases: row.title_aliases ?? [],
    artist: row.artist,
    artistAliases: row.artist_aliases ?? [],
    mrUrl: row.mr_url,
    mrVideoId: row.mr_video_id,
    mrTitle: row.mr_title,
    mrChannel: row.mr_channel,
    key: row.key,
    keyLinks: row.key_links ?? {},
    genre: row.genre,
    price: row.price,
    popular: row.popular,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// 앱 입력(camelCase) → DB 행(snake_case). undefined 인 필드는 넣지 않아
// 부분 수정 시 기존 값이 유지되게 한다.
function toRow(input) {
  const row = {};
  const map = {
    jacketPath: "jacket_path", title: "title", titleAliases: "title_aliases",
    artist: "artist", artistAliases: "artist_aliases", mrUrl: "mr_url",
    mrVideoId: "mr_video_id", mrTitle: "mr_title", mrChannel: "mr_channel",
    key: "key", keyLinks: "key_links", genre: "genre", price: "price", popular: "popular",
  };
  for (const [appKey, dbKey] of Object.entries(map)) {
    if (input[appKey] !== undefined) row[dbKey] = input[appKey];
  }
  return row;
}

export async function listSongs(songbookId) {
  if (!isUuid(songbookId)) return [];
  const { data, error } = await getDb()
    .from("songs").select().eq("songbook_id", songbookId)
    .order("created_at", { ascending: false });
  if (error) failed(error, "곡 목록 조회");
  return (data ?? []).map(toSong);
}

export async function findSongById(id) {
  if (!isUuid(id)) return null;
  const { data, error } = await getDb()
    .from("songs").select().eq("id", id).maybeSingle();
  if (error) failed(error, "곡 조회");
  return toSong(data);
}

export async function createSong(songbookId, input) {
  const { data, error } = await getDb()
    .from("songs").insert({ songbook_id: songbookId, ...toRow(input) }).select().single();
  if (error) failed(error, "곡 등록");
  return toSong(data);
}

export async function createSongs(songbookId, inputs) {
  if (!inputs || inputs.length === 0) return [];
  const rows = inputs.map((input) => ({ songbook_id: songbookId, ...toRow(input) }));
  const { data, error } = await getDb().from("songs").insert(rows).select();
  if (error) failed(error, "곡 일괄 등록");
  return (data ?? []).map(toSong);
}

export async function updateSong(id, input) {
  const { data, error } = await getDb()
    .from("songs")
    .update({ ...toRow(input), updated_at: new Date().toISOString() })
    .eq("id", id).select().single();
  if (error) failed(error, "곡 수정");
  return toSong(data);
}

// 지운 곡의 자켓 경로를 돌려준다. 호출자가 Storage 객체도 지워야 고아 파일이 안 쌓인다.
export async function deleteSong(id) {
  const { data, error } = await getDb()
    .from("songs").delete().eq("id", id).select("jacket_path").maybeSingle();
  if (error) failed(error, "곡 삭제");
  return { jacketPath: data?.jacket_path ?? null };
}

export async function countSongs(songbookId) {
  if (!isUuid(songbookId)) return 0;
  const { count, error } = await getDb()
    .from("songs").select("id", { count: "exact", head: true })
    .eq("songbook_id", songbookId);
  if (error) failed(error, "곡 수 조회");
  return count ?? 0;
}
```

- [ ] **Step 4: 테스트 확인**

Run: `pnpm test:db`
Expected: 63 passed (기존 50 + songs 13)

- [ ] **Step 5: 커밋**

```bash
git add lib/db/songs.js tests/db/songs.test.js
git commit -m "feat: 곡 저장소 추가"
```

---

### Task 6: 자켓 Storage

**Files:**
- Create: `supabase/migrations/0003_jackets_bucket.sql`
- Create: `lib/image.js`, `lib/storage.js`
- Create: `tests/image.test.js`
- Create: `tests/db/storage.test.js`

**Interfaces:**
- Consumes: `getDb`
- Produces:
  - `lib/image.js`: `detectImageType(buffer): 'jpeg'|'png'|'webp'|null`
  - `lib/storage.js`: `JACKETS_BUCKET`, `uploadJacket(songbookId, file): Promise<{path, publicUrl}>`, `deleteJacket(path): Promise<void>`, `jacketPublicUrl(path): string|null`
  - 제약: 2MB, `image/jpeg`·`image/png`·`image/webp`, **매직바이트 일치 필수**

**매직바이트를 검사하는 이유:** 파일명과 `Content-Type` 은 클라이언트가 자유롭게 위조한다.
확장자만 믿으면 이미지 확장자로 임의 바이트를 호스팅하게 된다. 계획 1의 최종 리뷰가
현재 업로드 라우트의 실제 결함으로 지적한 항목이다.

- [ ] **Step 1: 버킷 마이그레이션 작성**

`supabase/migrations/0003_jackets_bucket.sql`:

```sql
-- 자켓 이미지 버킷. 공개 읽기(자켓은 시청자에게 보이라고 있다),
-- 쓰기는 서버가 sb_secret_ 키로만 한다.
-- storage.objects 의 RLS 정책을 만들지 않으므로 anon/authenticated 는 쓸 수 없다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'jackets', 'jackets', true, 2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
```

- [ ] **Step 2: 마이그레이션 적용 요청**

이 단계는 **상위 세션에 요청**한다. Supabase MCP 로 적용하거나 대시보드 SQL Editor에서
실행해야 한다. 적용 후 아래로 확인한다:

```sql
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'jackets';
```

Expected: 1행, `public = true`, `file_size_limit = 2097152`

- [ ] **Step 3: 매직바이트 판별 테스트 작성**

`tests/image.test.js`:

```js
import { describe, it, expect } from "vitest";
import { detectImageType } from "@/lib/image";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = Buffer.concat([
  Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP"),
]);

describe("lib/image", () => {
  it("JPEG를 판별한다", () => {
    expect(detectImageType(jpeg)).toBe("jpeg");
  });

  it("PNG를 판별한다", () => {
    expect(detectImageType(png)).toBe("png");
  });

  it("WebP를 판별한다", () => {
    expect(detectImageType(webp)).toBe("webp");
  });

  it("HTML을 이미지로 보지 않는다", () => {
    // .jpg 확장자로 위장한 HTML — 이게 이 함수의 존재 이유다.
    expect(detectImageType(Buffer.from("<html><script>alert(1)</script>"))).toBeNull();
  });

  it("SVG를 이미지로 보지 않는다", () => {
    // SVG는 스크립트를 담을 수 있어 화이트리스트에서 제외한다.
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
  });

  it("GIF를 거부한다 (화이트리스트에 없다)", () => {
    expect(detectImageType(Buffer.from("GIF89a"))).toBeNull();
  });

  it("빈 버퍼·짧은 버퍼를 던지지 않고 null로 다룬다", () => {
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
    expect(detectImageType(Buffer.from([0xff]))).toBeNull();
    expect(detectImageType(null)).toBeNull();
  });

  it("RIFF지만 WEBP가 아니면 거부한다", () => {
    const wav = Buffer.concat([
      Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WAVE"),
    ]);
    expect(detectImageType(wav)).toBeNull();
  });
});
```

- [ ] **Step 4: 테스트가 실패하는지 확인**

Run: `pnpm test tests/image.test.js`
Expected: FAIL — `Cannot find module '@/lib/image'`

- [ ] **Step 5: `lib/image.js` 작성**

```js
// 매직바이트로 이미지 종류를 판별한다.
// 파일명과 Content-Type 은 클라이언트가 위조하므로 신뢰하지 않는다.
// SVG는 스크립트를 담을 수 있어 화이트리스트에서 제외한다.

function startsWith(buffer, bytes) {
  if (buffer.length < bytes.length) return false;
  return bytes.every((byte, i) => buffer[i] === byte);
}

export function detectImageType(buffer) {
  if (!buffer || buffer.length < 8) return null;

  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";

  // WebP: "RIFF" + 4바이트 크기 + "WEBP"
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
    buffer.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "webp";
  }

  return null;
}
```

- [ ] **Step 6: `lib/storage.js` 작성**

```js
// 자켓 이미지 저장소. 업로드는 반드시 서버를 거친다 —
// 클라이언트 직접 업로드나 서명 URL을 쓰면 아래 검증을 건너뛰게 된다.
import crypto from "node:crypto";
import { getDb } from "@/lib/db/client";
import { detectImageType } from "@/lib/image";

export const JACKETS_BUCKET = "jackets";

const MAX_BYTES = 2 * 1024 * 1024;
const EXTENSION = { jpeg: "jpg", png: "png", webp: "webp" };
const CONTENT_TYPE = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

export class UploadError extends Error {
  constructor(message) {
    super(message);
    this.name = "UploadError";
    this.status = 400;
  }
}

export async function uploadJacket(songbookId, file) {
  if (!file || typeof file === "string") {
    throw new UploadError("파일이 없어요.");
  }
  if (file.size > MAX_BYTES) {
    throw new UploadError("2MB 이하 이미지만 올릴 수 있어요.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const type = detectImageType(buffer);
  if (!type) {
    // 확장자·Content-Type 이 아니라 실제 바이트로 판정한다.
    throw new UploadError("JPG·PNG·WEBP 이미지만 올릴 수 있어요.");
  }

  // 확장자는 서버가 만든다. 클라이언트가 준 파일명은 쓰지 않는다.
  const path = `${songbookId}/${crypto.randomUUID()}.${EXTENSION[type]}`;

  const { error } = await getDb().storage
    .from(JACKETS_BUCKET)
    .upload(path, buffer, { contentType: CONTENT_TYPE[type], upsert: false });
  if (error) throw new Error(`자켓 업로드 실패: ${error.message}`);

  return { path, publicUrl: jacketPublicUrl(path) };
}

export async function deleteJacket(path) {
  if (!path) return;
  const { error } = await getDb().storage.from(JACKETS_BUCKET).remove([path]);
  // 이미 없는 파일이어도 곡 삭제를 막지 않는다. 고아 파일보다 나쁜 건
  // 지워진 곡이 목록에 남는 것이다.
  if (error) console.error("자켓 삭제 실패:", error.message);
}

export function jacketPublicUrl(path) {
  if (!path) return null;
  const { data } = getDb().storage.from(JACKETS_BUCKET).getPublicUrl(path);
  return data?.publicUrl ?? null;
}
```

- [ ] **Step 7: Storage 통합 테스트 작성**

`tests/db/storage.test.js`:

```js
import { it, expect, beforeEach } from "vitest";
import { describeDb } from "../helpers/db.js";
import { uploadJacket, deleteJacket, jacketPublicUrl, UploadError } from "@/lib/storage";

// 1x1 투명 PNG
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function fakeFile(bytes, { size = bytes.length } = {}) {
  return {
    size,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

describeDb("lib/storage", () => {
  const songbookId = "00000000-0000-0000-0000-0000000000aa";
  const uploaded = [];

  beforeEach(() => { uploaded.length = 0; });

  it("PNG를 올리고 공개 URL을 준다", async () => {
    const result = await uploadJacket(songbookId, fakeFile(PNG_BYTES));
    uploaded.push(result.path);
    expect(result.path).toMatch(new RegExp(`^${songbookId}/[0-9a-f-]+\\.png$`));
    expect(result.publicUrl).toContain("/jackets/");
    await deleteJacket(result.path);
  });

  it("확장자를 서버가 정한다 — 클라이언트 파일명을 쓰지 않는다", async () => {
    const result = await uploadJacket(songbookId, fakeFile(PNG_BYTES));
    expect(result.path.endsWith(".png")).toBe(true);
    await deleteJacket(result.path);
  });

  it("이미지가 아닌 바이트를 거부한다", async () => {
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    await expect(uploadJacket(songbookId, fakeFile(html))).rejects.toThrow(UploadError);
  });

  it("2MB 초과를 거부한다", async () => {
    await expect(
      uploadJacket(songbookId, fakeFile(PNG_BYTES, { size: 3 * 1024 * 1024 })),
    ).rejects.toThrow(/2MB/);
  });

  it("파일이 없으면 거부한다", async () => {
    await expect(uploadJacket(songbookId, null)).rejects.toThrow(UploadError);
    await expect(uploadJacket(songbookId, "문자열")).rejects.toThrow(UploadError);
  });

  it("없는 파일을 지워도 던지지 않는다", async () => {
    await expect(deleteJacket("없는/경로.png")).resolves.toBeUndefined();
  });

  it("경로가 null이면 URL도 null이다", () => {
    expect(jacketPublicUrl(null)).toBeNull();
  });
});
```

- [ ] **Step 8: 테스트 확인**

Run: `pnpm test`
Expected: 64 passed (기존 56 + image 8)

Run: `pnpm test:db`
Expected: 70 passed (기존 63 + storage 7)

- [ ] **Step 9: 커밋**

```bash
git add supabase/migrations/0003_jackets_bucket.sql lib/image.js lib/storage.js tests/image.test.js tests/db/storage.test.js
git commit -m "feat: 자켓 Storage와 매직바이트 검증 추가"
```

---

### Task 7: 곡 API 교체 + 무방비 라우트 제거

**Files:**
- Delete: `app/api/songs/route.js`, `app/api/songs/bulk/route.js`, `app/api/upload/route.js`
- Create: `app/api/songbooks/[id]/songs/route.js`, `app/api/songbooks/[id]/songs/bulk/route.js`, `app/api/songbooks/[id]/jacket/route.js`, `app/api/songs/[id]/route.js`
- Create: `tests/integration/songs.test.js`

**Interfaces:**
- Consumes: `requireSongbookAccess`, `lib/db/songs.js`, `lib/storage.js`
- Produces:
  - `GET  /api/songbooks/[id]/songs` — 목록 (공개 노래책은 비로그인 가능)
  - `POST /api/songbooks/[id]/songs` — 등록 (`min: 'manager'`)
  - `POST /api/songbooks/[id]/songs/bulk` — CSV 일괄 (`min: 'manager'`)
  - `POST /api/songbooks/[id]/jacket` — 자켓 업로드 (`min: 'manager'`)
  - `PATCH /api/songs/[id]` — 수정 (`min: 'manager'`)
  - `DELETE /api/songs/[id]` — 삭제 + Storage 객체 삭제 (`min: 'manager'`)

**이 Task가 배포 게이트를 연다.** 인증 없이 열려 있던 라우트 3개가 사라지고, 파일시스템
의존도 함께 사라진다.

**상한:** 노래책당 곡 5,000개, CSV 1회 1,000곡. **CSV가 상한을 넘기면 부분 등록하지 않고
전체를 거부한다** — 어디까지 들어갔는지 사용자가 알 수 없는 상태가 더 나쁘다.

- [ ] **Step 1: 실패하는 통합 테스트 작성**

`tests/integration/songs.test.js`:

```js
import { it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { describeE2e, startServer } from "../helpers/server.js";
import { cookieForUser } from "../helpers/session.js";
import { truncateAll } from "../helpers/db.js";
import { getDb } from "@/lib/db/client";
import { upsertUserFromLogin } from "@/lib/db/users";
import { createSongbook, updateSongbook } from "@/lib/db/songbooks";
import { createSong } from "@/lib/db/songs";

const SONG = { title: "사건의 지평선", artist: "윤하", genre: "K-POP" };

describeE2e("곡 API 인가", () => {
  let server, owner, manager, stranger, operator, book;
  let ownerCookie, managerCookie, strangerCookie, operatorCookie;

  beforeAll(async () => { server = await startServer(); });
  afterAll(() => { server?.stop(); });

  beforeEach(async () => {
    const db = getDb();
    await truncateAll(db);
    owner = await upsertUserFromLogin({ chzzkChannelId: "o", chzzkChannelName: "주인" });
    manager = await upsertUserFromLogin({ chzzkChannelId: "m", chzzkChannelName: "매니저" });
    stranger = await upsertUserFromLogin({ chzzkChannelId: "s", chzzkChannelName: "타인" });
    operator = await upsertUserFromLogin({ chzzkChannelId: "op", chzzkChannelName: "운영자" });
    await db.from("users").update({ role: "operator" }).eq("id", operator.id);

    book = await createSongbook({ ownerId: owner.id, slug: "book", title: "노래책" });
    await db.from("songbook_members").insert({
      songbook_id: book.id, user_id: manager.id, role: "manager", source: "invite",
    });

    ownerCookie = await cookieForUser(owner);
    managerCookie = await cookieForUser(manager);
    strangerCookie = await cookieForUser(stranger);
    operatorCookie = await cookieForUser(operator);
  });

  function post(cookie) {
    return fetch(`${server.baseUrl}/api/songbooks/${book.id}/songs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: server.baseUrl,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(SONG),
    });
  }

  // 스펙 매트릭스: 곡 등록은 min:'manager' — 매니저·소유자·운영자 통과, 타인 404
  it("비로그인은 401", async () => { expect((await post(undefined)).status).toBe(401); });
  it("타인은 404", async () => { expect((await post(strangerCookie)).status).toBe(404); });
  it("매니저는 201", async () => { expect((await post(managerCookie)).status).toBe(201); });
  it("소유자는 201", async () => { expect((await post(ownerCookie)).status).toBe(201); });
  it("운영자는 201", async () => { expect((await post(operatorCookie)).status).toBe(201); });

  it("공개 노래책의 곡 목록은 비로그인도 본다", async () => {
    await createSong(book.id, SONG);
    const res = await fetch(`${server.baseUrl}/api/songbooks/${book.id}/songs`);
    expect(res.status).toBe(200);
    expect((await res.json()).songs).toHaveLength(1);
  });

  it("비공개 노래책의 곡 목록은 비로그인에게 404", async () => {
    await updateSongbook(book.id, { isPublic: false });
    const res = await fetch(`${server.baseUrl}/api/songbooks/${book.id}/songs`);
    expect(res.status).toBe(404);
  });

  it("비공개 노래책도 매니저는 본다", async () => {
    await updateSongbook(book.id, { isPublic: false });
    const res = await fetch(`${server.baseUrl}/api/songbooks/${book.id}/songs`, {
      headers: { cookie: managerCookie },
    });
    expect(res.status).toBe(200);
  });

  it("제목·가수·장르가 없으면 400", async () => {
    const res = await fetch(`${server.baseUrl}/api/songbooks/${book.id}/songs`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.baseUrl, cookie: ownerCookie },
      body: JSON.stringify({ title: "  ", artist: "", genre: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("타인은 남의 곡을 수정할 수 없다", async () => {
    const song = await createSong(book.id, SONG);
    const res = await fetch(`${server.baseUrl}/api/songs/${song.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: server.baseUrl, cookie: strangerCookie },
      body: JSON.stringify({ title: "탈취" }),
    });
    expect(res.status).toBe(404);
  });

  it("타인은 남의 곡을 지울 수 없다", async () => {
    const song = await createSong(book.id, SONG);
    const res = await fetch(`${server.baseUrl}/api/songs/${song.id}`, {
      method: "DELETE",
      headers: { origin: server.baseUrl, cookie: strangerCookie },
    });
    expect(res.status).toBe(404);
  });

  it("매니저는 곡을 수정·삭제한다", async () => {
    const song = await createSong(book.id, SONG);
    const patched = await fetch(`${server.baseUrl}/api/songs/${song.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: server.baseUrl, cookie: managerCookie },
      body: JSON.stringify({ title: "고침" }),
    });
    expect(patched.status).toBe(200);

    const deleted = await fetch(`${server.baseUrl}/api/songs/${song.id}`, {
      method: "DELETE",
      headers: { origin: server.baseUrl, cookie: managerCookie },
    });
    expect(deleted.status).toBe(200);
  });

  it("없는 곡은 404", async () => {
    const res = await fetch(
      `${server.baseUrl}/api/songs/00000000-0000-0000-0000-000000000000`,
      {
        method: "DELETE",
        headers: { origin: server.baseUrl, cookie: ownerCookie },
      },
    );
    expect(res.status).toBe(404);
  });
});

describeE2e("제거된 무방비 라우트", () => {
  let server;
  beforeAll(async () => { server = await startServer(); });
  afterAll(() => { server?.stop(); });

  // 인증 없이 열려 있던 라우트들이다. 반드시 사라져야 한다.
  it("POST /api/songs 는 더 이상 없다", async () => {
    const res = await fetch(`${server.baseUrl}/api/songs`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.baseUrl },
      body: JSON.stringify(SONG),
    });
    expect(res.status).toBe(404);
  });

  it("POST /api/songs/bulk 는 더 이상 없다", async () => {
    const res = await fetch(`${server.baseUrl}/api/songs/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.baseUrl },
      body: JSON.stringify({ songs: [SONG] }),
    });
    expect(res.status).toBe(404);
  });

  it("POST /api/upload 는 더 이상 없다", async () => {
    const res = await fetch(`${server.baseUrl}/api/upload`, {
      method: "POST",
      headers: { origin: server.baseUrl },
      body: new FormData(),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm test:e2e`
Expected: FAIL — 새 라우트가 없고 옛 라우트가 아직 살아있다

- [ ] **Step 3: 공용 입력 검증 작성**

`lib/db/songs.js` 끝에 추가한다:

```js
// 곡 입력 검증. 라우트와 CSV 양쪽에서 쓴다.
export function validateSongInput(input) {
  const errors = {};
  if (!String(input?.title ?? "").trim()) errors.title = "곡 제목을 입력해 주세요.";
  if (!String(input?.artist ?? "").trim()) errors.artist = "가수를 입력해 주세요.";
  if (!String(input?.genre ?? "").trim()) errors.genre = "장르를 선택해 주세요.";
  const key = Number(input?.key ?? 0);
  if (!Number.isInteger(key) || key < -6 || key > 6) errors.key = "키는 -6~+6 사이여야 해요.";
  const price = Number(input?.price ?? 0);
  if (!Number.isFinite(price) || price < 0) errors.price = "가격은 0원 이상이어야 해요.";
  return errors;
}
```

- [ ] **Step 4: `app/api/songbooks/[id]/songs/route.js` 작성**

```js
import { NextResponse } from "next/server";
import { requireSongbookAccess, currentUser, accessLevel, AuthzError } from "@/lib/authz";
import { errorResponse, requireSameOrigin } from "@/lib/http";
import { findSongbookById } from "@/lib/db/songbooks";
import { listSongs, createSong, countSongs, validateSongInput } from "@/lib/db/songs";
import { jacketPublicUrl } from "@/lib/storage";

const MAX_SONGS_PER_SONGBOOK = 5000;

function withJacketUrl(song) {
  return { ...song, jacketUrl: jacketPublicUrl(song.jacketPath) };
}

// 공개 노래책은 비로그인도 본다. 비공개는 참여자만 — 없는 것과 구분되지 않게 404.
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const songbook = await findSongbookById(id);
    if (!songbook) throw new AuthzError(404, "찾을 수 없어요.");

    if (!songbook.isPublic) {
      const user = await currentUser();
      const level = await accessLevel(user, id);
      if (!level) throw new AuthzError(404, "찾을 수 없어요.");
    }

    const songs = await listSongs(id);
    return NextResponse.json({ songbook, songs: songs.map(withJacketUrl) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request, { params }) {
  try {
    requireSameOrigin(request);
    const { id } = await params;
    await requireSongbookAccess(id, { min: "manager" });

    const input = await request.json();
    const errors = validateSongInput(input);
    if (Object.keys(errors).length > 0) {
      return NextResponse.json({ errors }, { status: 400 });
    }

    if ((await countSongs(id)) >= MAX_SONGS_PER_SONGBOOK) {
      return NextResponse.json(
        { error: `노래책 하나에 ${MAX_SONGS_PER_SONGBOOK}곡까지 등록할 수 있어요.` },
        { status: 409 },
      );
    }

    const song = await createSong(id, input);
    return NextResponse.json({ song: withJacketUrl(song) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 5: `app/api/songbooks/[id]/songs/bulk/route.js` 작성**

```js
import { NextResponse } from "next/server";
import { requireSongbookAccess } from "@/lib/authz";
import { errorResponse, requireSameOrigin } from "@/lib/http";
import { createSongs, countSongs, validateSongInput } from "@/lib/db/songs";

const MAX_PER_REQUEST = 1000;
const MAX_SONGS_PER_SONGBOOK = 5000;

export async function POST(request, { params }) {
  try {
    requireSameOrigin(request);
    const { id } = await params;
    await requireSongbookAccess(id, { min: "manager" });

    const input = await request.json();
    const songs = Array.isArray(input?.songs) ? input.songs : [];

    if (songs.length === 0) {
      return NextResponse.json({ error: "등록할 곡이 없어요." }, { status: 400 });
    }
    if (songs.length > MAX_PER_REQUEST) {
      return NextResponse.json(
        { error: `한 번에 ${MAX_PER_REQUEST}곡까지 등록할 수 있어요.` },
        { status: 400 },
      );
    }

    for (const [index, song] of songs.entries()) {
      const errors = validateSongInput(song);
      if (Object.keys(errors).length > 0) {
        return NextResponse.json(
          { error: `${index + 1}번째 곡에 문제가 있어요.`, index, errors },
          { status: 400 },
        );
      }
    }

    // 상한을 넘기면 부분 등록하지 않고 전체를 거부한다 —
    // 어디까지 들어갔는지 사용자가 알 수 없는 상태가 더 나쁘다.
    const current = await countSongs(id);
    if (current + songs.length > MAX_SONGS_PER_SONGBOOK) {
      const over = current + songs.length - MAX_SONGS_PER_SONGBOOK;
      return NextResponse.json(
        {
          error: `${over}곡이 상한을 넘어요. 노래책 하나에 ${MAX_SONGS_PER_SONGBOOK}곡까지 등록할 수 있어요.`,
        },
        { status: 409 },
      );
    }

    const created = await createSongs(id, songs);
    return NextResponse.json({ created: created.length, songs: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 6: `app/api/songs/[id]/route.js` 작성**

```js
import { NextResponse } from "next/server";
import { requireSongbookAccess, AuthzError } from "@/lib/authz";
import { errorResponse, requireSameOrigin } from "@/lib/http";
import { findSongById, updateSong, deleteSong, validateSongInput } from "@/lib/db/songs";
import { deleteJacket, jacketPublicUrl } from "@/lib/storage";

// 곡 → 노래책을 먼저 찾고, 그 노래책에 대한 권한을 본다.
// 곡이 없을 때와 권한이 없을 때가 모두 404여야 존재가 누설되지 않는다.
async function requireSongAccess(songId) {
  const song = await findSongById(songId);
  if (!song) throw new AuthzError(404, "찾을 수 없어요.");
  await requireSongbookAccess(song.songbookId, { min: "manager" });
  return song;
}

export async function PATCH(request, { params }) {
  try {
    requireSameOrigin(request);
    const { id } = await params;
    // requireSongAccess 가 이미 조회한 곡을 재사용한다 — 같은 행을 두 번 읽지 않는다.
    const existing = await requireSongAccess(id);

    const input = await request.json();
    // 부분 수정이므로 기존 값과 합쳐서 검증한다.
    const errors = validateSongInput({ ...existing, ...input });
    if (Object.keys(errors).length > 0) {
      return NextResponse.json({ errors }, { status: 400 });
    }

    const song = await updateSong(id, input);
    return NextResponse.json({ song: { ...song, jacketUrl: jacketPublicUrl(song.jacketPath) } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request, { params }) {
  try {
    requireSameOrigin(request);
    const { id } = await params;
    await requireSongAccess(id);

    const { jacketPath } = await deleteSong(id);
    // DB만 지우면 Storage에 고아 파일이 쌓인다.
    await deleteJacket(jacketPath);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 7: `app/api/songbooks/[id]/jacket/route.js` 작성**

```js
import { NextResponse } from "next/server";
import { requireSongbookAccess } from "@/lib/authz";
import { errorResponse, requireSameOrigin } from "@/lib/http";
import { uploadJacket, UploadError } from "@/lib/storage";

export async function POST(request, { params }) {
  try {
    requireSameOrigin(request);
    const { id } = await params;
    await requireSongbookAccess(id, { min: "manager" });

    const form = await request.formData();
    const result = await uploadJacket(id, form.get("file"));
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof UploadError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return errorResponse(err);
  }
}
```

- [ ] **Step 8: 무방비 라우트 3개 삭제**

```bash
rm app/api/songs/route.js app/api/songs/bulk/route.js app/api/upload/route.js
rmdir app/api/songs/bulk app/api/upload 2>/dev/null || true
```

`app/api/songs/` 디렉터리는 `[id]/route.js` 가 있으므로 남는다.

- [ ] **Step 9: 테스트 확인**

Run: `pnpm test:e2e`
Expected: 전부 통과 (smoke 3 + 노래책 14 + 곡 13 + 제거확인 3 = 33)

Run: `pnpm test && pnpm test:db`
Expected: 64 / 70

Run: `pnpm build`
Expected: 성공. **`/api/upload` 가 라우트 목록에서 사라졌는지 확인한다.**

- [ ] **Step 10: 커밋 (기능 추가와 삭제를 분리한다)**

```bash
git add app/api/songbooks app/api/songs/\[id\] lib/db/songs.js tests/integration/songs.test.js
git commit -m "feat: 곡 API를 노래책 스코프와 인가 아래로 이설"

git add -u app/api/songs/route.js app/api/songs/bulk app/api/upload
git commit -m "fix: 인증 없이 열려 있던 곡 등록·업로드 라우트 제거

인증·CSRF·레이트리밋이 없었고 파일시스템에 직접 쓰고 있었다.
서버리스에서는 동작하지 않으며 자체 호스팅에서는 누구나 곡을 등록할 수 있었다."
```

---

### Task 8: 관리 화면

**Files:**
- Create: `app/manage/page.jsx`, `app/manage/layout.jsx`
- Create: `app/manage/[slug]/page.jsx`
- Create: `app/manage/[slug]/songs/page.jsx`
- Move: `app/admin/songs/new/page.jsx` → `app/manage/[slug]/songs/new/page.jsx`
- Move: `app/admin/songs/new/CsvImport.jsx` → `app/manage/[slug]/songs/new/CsvImport.jsx`
- Move: `app/admin/admin.css` → `app/manage/manage.css`
- Modify: `app/api/me/route.js`

**Interfaces:**
- Consumes: 앞선 Task의 API 전부
- Produces: `/manage`, `/manage/[slug]`, `/manage/[slug]/songs`, `/manage/[slug]/songs/new`
- `GET /api/me` 응답에 `songbooks: Array<{id, slug, title, role}>` 추가

**이설 원칙:** 기존 등록 화면(581줄)과 CSV 화면(266줄)의 **UI 로직은 그대로 옮긴다.**
바뀌는 것은 API 엔드포인트와 자켓 업로드 응답 처리뿐이다. 불필요한 리팩터링을 하지 않는다.

- [ ] **Step 1: `/api/me` 에 참여 노래책 추가**

`app/api/me/route.js` 를 아래로 바꾼다:

```js
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/authz";
import { isConfigured } from "@/lib/chzzk";
import { listSongbooksForUser } from "@/lib/db/songbooks";
import { errorResponse } from "@/lib/http";

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ user: null, songbooks: [], oauthConfigured: isConfigured() });
    }

    const songbooks = (await listSongbooksForUser(user.id)).map((b) => ({
      id: b.id, slug: b.slug, title: b.title, role: b.role,
    }));

    return NextResponse.json({
      user: {
        id: user.id,
        channelName: user.chzzkChannelName,
        channelImage: user.chzzkChannelImage,
        verified: user.chzzkVerified,
      },
      songbooks,
      oauthConfigured: isConfigured(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: 기존 화면 이설 (내용 변경 없이 이동)**

```bash
mkdir -p app/manage/\[slug\]/songs/new
git mv app/admin/songs/new/page.jsx app/manage/\[slug\]/songs/new/page.jsx
git mv app/admin/songs/new/CsvImport.jsx app/manage/\[slug\]/songs/new/CsvImport.jsx
git mv app/admin/admin.css app/manage/manage.css
git mv app/admin/layout.jsx app/manage/layout.jsx
rmdir app/admin/songs/new app/admin/songs app/admin 2>/dev/null || true
```

`app/manage/layout.jsx` 안의 `import "./admin.css"` 를 `import "./manage.css"` 로 바꾼다.

- [ ] **Step 3: 이설한 화면의 API 호출 교체**

`app/manage/[slug]/songs/new/page.jsx` 를 수정한다. **UI 로직은 건드리지 말고 아래 3가지만 바꾼다.**

1. 컴포넌트가 `params` 에서 `slug` 를 받도록 한다. 클라이언트 컴포넌트이므로
   `useParams` 를 쓴다. 파일 상단 import에 `useParams` 를 추가:
   ```js
   import { useParams } from "next/navigation";
   ```
   컴포넌트 본문 첫 줄에 추가:
   ```js
   const { slug } = useParams();
   const [songbookId, setSongbookId] = useState(null);
   ```
   그리고 slug → id 해석을 위한 effect를 추가:
   ```js
   // 라우트는 slug를 받지만 API는 노래책 id를 받는다.
   useEffect(() => {
     fetch("/api/me")
       .then((r) => r.json())
       .then((d) => {
         const book = (d.songbooks ?? []).find((b) => b.slug === slug);
         setSongbookId(book?.id ?? null);
       })
       .catch(() => setSongbookId(null));
   }, [slug]);
   ```

2. 자켓 업로드 호출(`fetch("/api/upload", ...)`)을
   `fetch(\`/api/songbooks/${songbookId}/jacket\`, ...)` 로 바꾼다.
   응답 필드가 `{ url }` 에서 `{ path, publicUrl }` 로 바뀌었으므로,
   미리보기에는 `publicUrl` 을, 곡 저장에는 `path` 를 쓴다.
   곡 payload의 `jacket` 필드를 `jacketPath` 로 바꾼다.

3. 곡 등록 호출(`fetch("/api/songs", ...)`)을
   `fetch(\`/api/songbooks/${songbookId}/songs\`, ...)` 로 바꾼다.

`app/manage/[slug]/songs/new/CsvImport.jsx` 도 같은 방식으로 수정한다.
- 부모에게서 `songbookId` 를 prop으로 받도록 시그니처를 바꾼다.
- `fetch("/api/songs")` → `fetch(\`/api/songbooks/${songbookId}/songs\`)` (중복 검사용 목록 조회)
- `fetch("/api/songs/bulk")` → `fetch(\`/api/songbooks/${songbookId}/songs/bulk\`)`
- 자켓 자동 채움이 `jacket` 필드를 쓰고 있으면 `jacketPath` 로 바꾼다.
  단 CSV의 자켓은 유튜브 썸네일 URL이라 Storage 경로가 아니다. **이 경우 `jacketPath` 대신
  `mrUrl` 만 저장하고 자켓은 비운다** — 외부 URL을 `jacket_path` 에 넣으면 `jacketPublicUrl`
  이 잘못된 주소를 만든다.

- [ ] **Step 4: `/manage` 목록 화면 작성**

`app/manage/page.jsx`:

```jsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import "./manage.css";

export default function ManagePage() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch("/api/me");
    setMe(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function create(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/songbooks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, title }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "노래책을 만들지 못했어요.");
        return;
      }
      setSlug("");
      setTitle("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className="manage"><p>불러오는 중…</p></main>;

  if (!me?.user) {
    return (
      <main className="manage">
        <h1>노래책 관리</h1>
        <p>치지직으로 로그인하면 노래책을 만들 수 있어요.</p>
        <a className="btn btn-primary" href="/api/auth/login">치지직으로 로그인</a>
      </main>
    );
  }

  const books = me.songbooks ?? [];

  return (
    <main className="manage">
      <h1>노래책 관리</h1>

      {books.length > 0 && (
        <ul className="manage-list">
          {books.map((book) => (
            <li key={book.id}>
              <Link href={`/manage/${book.slug}`}>
                <strong>{book.title}</strong>
                <span>/@{book.slug}</span>
              </Link>
              <span className="manage-role">
                {book.role === "owner" ? "소유자" : "매니저"}
              </span>
              <Link className="btn btn-ghost" href={`/manage/${book.slug}/songs`}>
                곡 관리
              </Link>
            </li>
          ))}
        </ul>
      )}

      {books.some((b) => b.role === "owner") ? (
        <p className="manage-hint">노래책은 계정당 하나만 만들 수 있어요.</p>
      ) : (
        <form className="manage-form" onSubmit={create}>
          <h2>노래책 만들기</h2>
          <label>
            주소
            <span className="manage-prefix">/@</span>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="dutto"
              maxLength={30}
              required
            />
          </label>
          <label>
            이름
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="듀토의 노래책"
              required
            />
          </label>
          {error && <p className="manage-error">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? "만드는 중…" : "만들기"}
          </button>
        </form>
      )}
    </main>
  );
}
```

- [ ] **Step 5: `/manage/[slug]` 설정 화면 작성**

`app/manage/[slug]/page.jsx`:

```jsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import "../manage.css";

export default function SongbookSettingsPage() {
  const { slug } = useParams();
  const router = useRouter();
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ title: "", intro: "", isPublic: true, slug: "" });
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        const found = (d.songbooks ?? []).find((b) => b.slug === slug);
        setBook(found ?? null);
        if (found) setForm((f) => ({ ...f, title: found.title, slug: found.slug }));
        setLoading(false);
      });
  }, [slug]);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/songbooks/${book.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "저장하지 못했어요.");
        return;
      }
      setSaved(true);
      if (body.songbook.slug !== slug) router.replace(`/manage/${body.songbook.slug}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className="manage"><p>불러오는 중…</p></main>;
  if (!book) {
    return (
      <main className="manage">
        <p>찾을 수 없어요.</p>
        <Link className="btn btn-ghost" href="/manage">돌아가기</Link>
      </main>
    );
  }

  const readOnly = book.role !== "owner";

  return (
    <main className="manage">
      <h1>{book.title} 설정</h1>
      <Link className="btn btn-ghost" href={`/manage/${slug}/songs`}>곡 관리</Link>

      {readOnly ? (
        <p className="manage-hint">설정 변경은 소유자만 할 수 있어요.</p>
      ) : (
        <form className="manage-form" onSubmit={save}>
          <label>
            이름
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
            />
          </label>
          <label>
            주소
            <span className="manage-prefix">/@</span>
            <input
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              maxLength={30}
              required
            />
          </label>
          <label>
            소개
            <textarea
              value={form.intro}
              onChange={(e) => setForm({ ...form, intro: e.target.value })}
              rows={3}
            />
          </label>
          <label className="manage-check">
            <input
              type="checkbox"
              checked={form.isPublic}
              onChange={(e) => setForm({ ...form, isPublic: e.target.checked })}
            />
            시청자에게 공개
          </label>
          {error && <p className="manage-error">{error}</p>}
          {saved && <p className="manage-ok">저장했어요.</p>}
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? "저장 중…" : "저장"}
          </button>
        </form>
      )}
    </main>
  );
}
```

- [ ] **Step 6: `/manage/[slug]/songs` 곡 목록 화면 작성**

`app/manage/[slug]/songs/page.jsx`:

```jsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import "../../manage.css";

export default function SongListPage() {
  const { slug } = useParams();
  const [book, setBook] = useState(null);
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const me = await (await fetch("/api/me")).json();
    const found = (me.songbooks ?? []).find((b) => b.slug === slug);
    setBook(found ?? null);
    if (found) {
      const res = await fetch(`/api/songbooks/${found.id}/songs`);
      const body = await res.json();
      setSongs(body.songs ?? []);
    }
    setLoading(false);
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  async function remove(song) {
    setError(null);
    const res = await fetch(`/api/songs/${song.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError("곡을 지우지 못했어요.");
      return;
    }
    setSongs((prev) => prev.filter((s) => s.id !== song.id));
  }

  if (loading) return <main className="manage"><p>불러오는 중…</p></main>;
  if (!book) {
    return (
      <main className="manage">
        <p>찾을 수 없어요.</p>
        <Link className="btn btn-ghost" href="/manage">돌아가기</Link>
      </main>
    );
  }

  return (
    <main className="manage">
      <h1>{book.title} · 곡 {songs.length}개</h1>
      <Link className="btn btn-primary" href={`/manage/${slug}/songs/new`}>곡 등록</Link>
      {error && <p className="manage-error">{error}</p>}

      {songs.length === 0 ? (
        <p className="manage-hint">아직 등록된 곡이 없어요.</p>
      ) : (
        <table className="manage-table">
          <thead>
            <tr><th>제목</th><th>가수</th><th>장르</th><th>키</th><th>가격</th><th /></tr>
          </thead>
          <tbody>
            {songs.map((song) => (
              <tr key={song.id}>
                <td>{song.title}</td>
                <td>{song.artist}</td>
                <td>{song.genre}</td>
                <td>{song.key > 0 ? `+${song.key}` : song.key}</td>
                <td>{song.price.toLocaleString()}원</td>
                <td>
                  <button className="btn btn-ghost" type="button" onClick={() => remove(song)}>
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
```

- [ ] **Step 7: `app/manage/manage.css` 에 새 클래스 추가**

파일 끝에 추가한다. 기존 규칙은 건드리지 않는다.

```css
/* ───── 관리 화면 ───── */
.manage { max-width: 56rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
.manage h1 { font-size: 1.5rem; margin-bottom: 1rem; }
.manage-list { list-style: none; display: grid; gap: 0.75rem; margin: 1.5rem 0; }
.manage-list li {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 1rem; border: 1px solid var(--line); border-radius: 0.75rem;
}
.manage-list li a { display: grid; gap: 0.125rem; text-decoration: none; }
.manage-list li a span { font-size: 0.8125rem; color: var(--muted); }
.manage-role { margin-left: auto; font-size: 0.8125rem; color: var(--muted); }
.manage-form { display: grid; gap: 1rem; max-width: 32rem; margin-top: 1.5rem; }
.manage-form label { display: grid; gap: 0.375rem; font-size: 0.875rem; }
.manage-check { display: flex !important; align-items: center; gap: 0.5rem; }
.manage-prefix { font-size: 0.8125rem; color: var(--muted); }
.manage-error { color: var(--danger, #f87171); font-size: 0.875rem; }
.manage-ok { color: var(--ok, #4ade80); font-size: 0.875rem; }
.manage-hint { color: var(--muted); font-size: 0.875rem; margin-top: 1rem; }
.manage-table { width: 100%; border-collapse: collapse; margin-top: 1.5rem; }
.manage-table th, .manage-table td {
  padding: 0.625rem 0.5rem; text-align: left; border-bottom: 1px solid var(--line);
  font-size: 0.875rem;
}
.manage-table th { color: var(--muted); font-weight: 500; }
```

`var(--line)`, `var(--muted)` 등은 `app/globals.css` 에 이미 정의돼 있다. 없으면 그 파일에서
실제 변수명을 확인해 맞춘다.

- [ ] **Step 8: `app/page.jsx` 의 관리 링크 교체**

`href="/admin/songs/new"` 를 `href="/manage"` 로 바꾸고, 링크 문구를 "노래책 관리"로 바꾼다.
**그 외 랜딩 페이지 로직은 계획 3에서 다루므로 건드리지 않는다.**

- [ ] **Step 9: 검증**

Run: `pnpm build`
Expected: 성공. 라우트 목록에 `/manage`, `/manage/[slug]`, `/manage/[slug]/songs`,
`/manage/[slug]/songs/new` 가 있고 `/admin/*` 이 없어야 한다.

Run: `pnpm test && pnpm test:db && pnpm test:e2e`
Expected: 64 / 70 / 33

수동 확인 — `pnpm dev --port 3001` 로 띄우고 (상위 세션에 요청):
1. `/manage` 접속 → 로그인 안 됐으면 로그인 버튼
2. 로그인 후 노래책 생성 → 목록에 나타남
3. `/manage/<slug>/songs/new` 에서 곡 등록 → 목록에 나타남
4. 자켓 업로드 → 미리보기가 보이고 저장 후에도 유지됨
5. 곡 삭제 → 목록에서 사라짐

- [ ] **Step 10: 커밋**

```bash
git add app/manage app/api/me/route.js app/page.jsx
git add -u app/admin
git commit -m "feat: 관리 화면을 노래책 스코프로 이설"
```

---

### Task 9: 이연 항목 정리

**Files:**
- Modify: `tests/helpers/setup.js`
- Modify: `tests/db/users.test.js`
- Delete: `tests/db/authz.test.js` 의 중복 부분 (아래 참조)

**Interfaces:**
- Consumes: 없음
- Produces: 없음 (정리 작업)

계획 1의 인계 문서가 계획 2로 넘긴 이연 항목 중 남은 것들이다.

- [ ] **Step 1: `.env` 파서가 따옴표를 벗기게 한다**

`tests/helpers/setup.js` 의 값 파싱 부분을 바꾼다.

```js
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // KEY="값" / KEY='값' 형태를 벗긴다. 벗기지 않으면 따옴표가 값에 섞여
    // 인증이 실패하는데, 증상이 "키가 틀렸다"로 나와 원인 추적이 어렵다.
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1);
      }
    }
    if (!(key in process.env)) process.env[key] = value;
```

- [ ] **Step 2: `lastLoginAt` 보존 테스트 강화**

`tests/db/users.test.js` 의 "ensurePlaceholderUsers는 기존 유저의 lastLoginAt을 지우지 않는다"
테스트에서 `expect(again.lastLoginAt).toBeTruthy();` 를 아래로 바꾼다:

```js
    expect(again.lastLoginAt).toBe(loggedIn.lastLoginAt);
```

- [ ] **Step 3: 인가 단위 테스트를 통합 테스트와 중복되지 않게 정리**

`tests/db/authz.test.js` 는 `accessLevel` 의 **판정 로직** 검증으로 남기고,
`requireSongbookAccess` 의 HTTP 상태코드 검증은 통합 테스트가 정본이 되었으므로 제거한다.

구체적으로 `attempt()` 헬퍼와 그것을 쓰는 `it` 5개(`비로그인은 401`, `타인은 404`,
`min manager: ...`, `min owner: ...`, `min ownerOnly: ...`)를 삭제한다.
`accessLevel` 을 직접 검증하는 `it` 7개는 그대로 둔다.

이러면 이연 7·8번(매트릭스 4조합 미테스트, `isAuthz` 미단언)이 함께 해소된다 —
매트릭스의 정본이 실제 HTTP를 타는 통합 테스트로 옮겨갔기 때문이다.

- [ ] **Step 4: 검증**

Run: `pnpm test`
Expected: 64 passed (변동 없음)

Run: `pnpm test:db`
Expected: 65 passed (기존 70 − 삭제한 authz 5)

Run: `pnpm test:e2e`
Expected: 33 passed

- [ ] **Step 5: 커밋**

```bash
git add tests/helpers/setup.js tests/db/users.test.js tests/db/authz.test.js
git commit -m "test: 이연 항목 정리하고 인가 검증을 통합 테스트로 일원화"
```

---

## 완료 기준

- [ ] `pnpm test` 64 passed
- [ ] `pnpm test:db` 65 passed
- [ ] `pnpm test:e2e` 33 passed
- [ ] `pnpm build` 통과
- [ ] **`app/api/songs/route.js`, `app/api/songs/bulk/route.js`, `app/api/upload/route.js` 가 존재하지 않는다**
- [ ] `grep -rn "getDb()" app/` 결과 없음 — 라우트가 DB를 직접 만지지 않는다
- [ ] `grep -rn "lib/store" app/ lib/` 결과 없음 — 파일 기반 저장소 참조가 사라졌다
      (`lib/store.js` 파일 자체는 계획 3에서 지운다)
- [ ] `grep -rn "NEXT_PUBLIC_" app/ lib/` 결과 없음
- [ ] 인가 매트릭스가 **실제 HTTP 요청으로** 검증된다 — 곡 등록·수정·삭제·설정 변경 각각에
      대해 비로그인·타인·매니저·소유자·운영자 5주체
- [ ] 자켓 업로드가 매직바이트를 검증한다 — `.jpg` 로 위장한 HTML이 거부된다
- [ ] `git status` 깨끗

## 다음 계획

계획 3에서 매니저 자동 동기화·초대, `/@handle` 시청자 페이지, 그리고 `lib/store.js`·
`data/songs.js`·잔여 자산 삭제를 다룬다. 인계 사항은
`docs/superpowers/specs/2026-07-31-foundation-handoff.md` 의 "계획 3" 절에 있다.

**배포 게이트는 이 계획의 Task 7이 연다.** 그 전까지는 배포하지 않는다.
