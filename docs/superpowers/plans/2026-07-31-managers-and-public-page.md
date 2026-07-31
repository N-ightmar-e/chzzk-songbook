# 매니저·공개 페이지·정리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스트리머가 스태프에게 노래책 관리를 맡길 수 있게 하고, 시청자가 `/@slug` 로 노래책을 보고 신청 명령어를 복사할 수 있게 한다. 그리고 파일 기반 시절의 잔여 자산을 걷어낸다.

**Architecture:** 매니저는 두 경로로 생긴다 — 치지직 채널 관리자 자동 동기화(`streaming-roles`)와 수동 초대 링크. 둘을 `songbook_members.source` 로 구분해 서로를 덮어쓰지 않게 한다. 시청자 페이지는 `/@slug` 를 dynamic segment로 받고, 옛 slug는 301로 현재 주소를 안내한다.

**Tech Stack:** Next.js 15.5 (App Router, JS/JSX), Node 22, pnpm, Supabase (Postgres + Storage), vitest

**설계 근거:** `docs/superpowers/specs/2026-07-31-multitenant-songbook-design.md`
**인계 사항:** `docs/superpowers/specs/2026-07-31-foundation-handoff.md` 의 "계획 3" 절
**선행:** 계획 1(기반, 병합 완료), 계획 2(노래책·곡·업로드)

**이 계획의 범위:** 스펙 구현순서 7~9단계 + 인계 문서의 계획 3 항목 7개.

## Global Constraints

- **패키지 매니저는 pnpm.** 새 의존성 추가 금지.
- **`NEXT_PUBLIC_` 접두사 환경변수를 만들지 않는다.**
- **언어는 JavaScript.** `.ts` 금지. 경로 별칭은 `@/`.
- **주석·에러 메시지·UI 문구는 한국어.**
- **커밋 메시지에 AI 작성 표시(`Co-Authored-By`, `Generated with`, 🤖)를 절대 넣지 않는다.**
- **라우트 핸들러에서 `getDb()` 를 직접 호출하지 않는다.**
- **모든 쓰기 라우트는 첫 줄에서 `requireSongbookAccess` 를 호출한다.**
- **`requireSongbookAccess` 에 `user` 를 넘기지 않는다.** 프로덕션에서는 throw되지만 개발·테스트에서는 통과하므로 습관이 굳으면 위험하다.
- **인가 매트릭스는 스펙의 표가 정본.** 권한 없음은 403이 아니라 404. **매니저 초대·해제는 `min: 'ownerOnly'`** — 운영자도 배제된다.
- **DB 테스트는 운영·테스트 프로젝트를 공용한다.** 두 프로세스가 동시에 돌리면 가짜 실패가 난다.
- **`CHZZK_REDIRECT_URI` 포트는 3001.**

## 계획 2 완료 시점의 상태

```
lib/slug.js       normalizeSlug / validateSlug / RESERVED_SLUGS
lib/uuid.js       UUID_RE / isUuid
lib/image.js      detectImageType
lib/storage.js    JACKETS_BUCKET / uploadJacket / deleteJacket / jacketPublicUrl / UploadError
lib/db/errors.js  failed
lib/db/songbooks.js  createSongbook / findSongbookBySlug / findSongbookByHistoricalSlug
                     findSongbookById / listSongbooksForUser / updateSongbook / changeSlug
                     isSlugTaken / countSongbooksOwnedBy / ownsAnySongbook
lib/db/songs.js   listSongs / findSongById / createSong / createSongs / updateSong
                  deleteSong / countSongs / validateSongInput
lib/http.js       errorResponse / requireSameOrigin

app/manage/**                     관리 화면
app/api/songbooks/**              노래책·곡 API
app/api/songs/[id]                곡 수정·삭제

tests/helpers/server.js  통합 테스트 하네스 (실 HTTP)
lib/storage.js    isJacketPathOf — 자켓 경로가 해당 노래책 소유인지 판정(공용)
pnpm test 64 / pnpm test:db 77 / pnpm test:e2e 47
```

> **⚠️ 각 Task 의 "Expected: N passed" 숫자는 낡았다.** 이 계획은 계획 2가 끝나기 전에
> 작성돼 `test:db` 65 / `test:e2e` 33 을 기준선으로 계산했다. 실제 기준선은 위와 같이
> **`test:db` 77 / `test:e2e` 47** 이다(각각 +12 / +14).
>
> Task 1 의 숫자는 아래에서 보정했다. **Task 2 이후의 숫자는 보정하지 않았으므로,
> 컨트롤러가 각 Task 를 디스패치하기 직전에 실측 기준선으로 다시 계산해 브리프에 적는다.**
> 구현자는 절대값이 아니라 **증분**(이 Task 가 추가한 테스트 수)이 맞는지로 판단할 것.

**아직 남아 있는 잔여 자산 (이 계획이 지운다):**

```
lib/store.js        파일 기반 곡 저장소. 참조는 이미 0건
data/songs.js       시드 60여 곡 + CHANNEL 상수. app/page.jsx 가 CHANNEL 만 쓴다
.data/              런타임 산출물 (gitignore됨)
```

## File Structure

| 파일 | 책임 |
|---|---|
| `lib/db/members.js` (신규) | `songbook_members` + `songbook_invites` 쿼리 |
| `lib/db/users.js` (수정) | `channel_synced_at` 매핑, 중복 channelId 정규화 |
| `lib/chzzk.js` (수정) | `ChzzkApiError.code` 타입 정규화 |
| `lib/sync.js` (신규) | 치지직 채널 관리자 동기화 절차 |
| `lib/invite.js` (신규) | 초대 토큰 생성·해시. 순수 함수 |
| `app/api/songbooks/[id]/members/**` (신규) | 동기화·초대·해제 |
| `app/api/invites/[token]/accept/route.js` (신규) | 초대 수락 |
| `app/manage/[slug]/members/page.jsx` (신규) | 매니저 관리 화면 |
| `app/invite/[token]/page.jsx` (신규) | 초대 수락 화면 |
| `app/[handle]/page.jsx` (신규) | `/@slug` 시청자 노래책 |
| `app/page.jsx` (재작성) | 랜딩 |
| `data/genres.js` | 유지 |

---

### Task 1: 채널 정보 동기화 + 이연 항목 정리

**Files:**
- Modify: `lib/db/users.js`, `lib/chzzk.js`
- Create: `lib/db/channels.js`
- Modify: `tests/db/users.test.js`
- Create: `tests/db/channels.test.js`

**Interfaces:**
- Consumes: `fetchChannels`, `ensurePlaceholderUsers`
- Produces:
  - `lib/db/users.js`: `toUser` 에 `channelSyncedAt` 추가
  - `lib/db/channels.js`: `refreshChannelInfo(channelIds): Promise<number>` — 치지직에서 이름·이미지·인증마크를 받아 `users` 에 반영, 갱신된 행 수 반환

인계 문서의 계획 3 항목 1·4·5를 여기서 처리한다.

**중복 channelId 문제:** `ensurePlaceholderUsers` 에 같은 `channelId` 가 두 번 들어오면
Postgres가 `ON CONFLICT DO UPDATE command cannot affect row a second time` 를 던진다.
`streaming-roles` 결과를 그대로 넘기면 실제로 터질 수 있다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/db/users.test.js` 에 아래 `it` 3개를 추가한다(기존 테스트는 그대로 둔다):

```js
  it("같은 channelId가 중복으로 들어와도 던지지 않는다", async () => {
    // Postgres는 같은 upsert 문에서 같은 행을 두 번 고치면
    // "ON CONFLICT DO UPDATE command cannot affect row a second time" 을 던진다.
    // 치지직 관리자 목록이 중복을 줄 수 있으므로 함수가 스스로 정규화해야 한다.
    const users = await ensurePlaceholderUsers([
      { channelId: "dup", channelName: "첫번째" },
      { channelId: "dup", channelName: "두번째" },
    ]);
    expect(users).toHaveLength(1);
  });

  it("falsy channelId를 걸러낸다", async () => {
    const users = await ensurePlaceholderUsers([
      { channelId: "", channelName: "빈값" },
      { channelId: null, channelName: "널" },
      { channelId: "ok", channelName: "정상" },
    ]);
    expect(users).toHaveLength(1);
    expect(users[0].chzzkChannelId).toBe("ok");
  });

  it("toUser가 channelSyncedAt을 매핑한다", async () => {
    const [user] = await ensurePlaceholderUsers([
      { channelId: "synced", channelName: "동기화됨" },
    ]);
    expect(user.channelSyncedAt).toBeTruthy();
  });
```

`tests/db/channels.test.js`:

```js
import { it, expect, beforeEach, vi, afterEach } from "vitest";
import { describeDb, truncateAll } from "../helpers/db.js";
import { getDb } from "@/lib/db/client";
import { upsertUserFromLogin, findUserByChannelId } from "@/lib/db/users";
import { refreshChannelInfo } from "@/lib/db/channels";

function jsonRes(body) {
  return { ok: true, status: 200, json: async () => body };
}

describeDb("lib/db/channels", () => {
  beforeEach(async () => {
    await truncateAll(getDb());
    process.env.CHZZK_CLIENT_ID = "cid";
    process.env.CHZZK_CLIENT_SECRET = "csecret";
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("치지직에서 받은 이름·이미지·인증마크를 반영한다", async () => {
    await upsertUserFromLogin({ chzzkChannelId: "ch1", chzzkChannelName: "옛이름" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes({
      code: 200,
      content: { data: [{
        channelId: "ch1", channelName: "새이름",
        channelImageUrl: "https://img.example/a.png", verifiedMark: true,
      }] },
    })));

    const updated = await refreshChannelInfo(["ch1"]);
    expect(updated).toBe(1);

    const user = await findUserByChannelId("ch1");
    expect(user.chzzkChannelName).toBe("새이름");
    expect(user.chzzkChannelImage).toBe("https://img.example/a.png");
    expect(user.chzzkVerified).toBe(true);
    expect(user.channelSyncedAt).toBeTruthy();
  });

  it("빈 목록이면 치지직을 호출하지 않는다", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await refreshChannelInfo([])).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });

  it("치지직이 모르는 채널은 조용히 넘어간다", async () => {
    await upsertUserFromLogin({ chzzkChannelId: "ch1", chzzkChannelName: "이름" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes({ code: 200, content: { data: [] } })));
    expect(await refreshChannelInfo(["ch1"])).toBe(0);
  });

  it("lastLoginAt을 건드리지 않는다", async () => {
    const before = await upsertUserFromLogin({ chzzkChannelId: "ch1", chzzkChannelName: "이름" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes({
      code: 200, content: { data: [{ channelId: "ch1", channelName: "새이름" }] },
    })));
    await refreshChannelInfo(["ch1"]);
    const after = await findUserByChannelId("ch1");
    expect(after.lastLoginAt).toBe(before.lastLoginAt);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm test:db`
Expected: FAIL — `Cannot find module '@/lib/db/channels'` 및 users 테스트 3건 실패

- [ ] **Step 3: `lib/db/users.js` 수정**

`toUser` 에 한 줄 추가한다:

```js
    channelSyncedAt: row.channel_synced_at,
```

`ensurePlaceholderUsers` 의 시작 부분을 아래로 바꾼다:

```js
export async function ensurePlaceholderUsers(channels) {
  if (!channels || channels.length === 0) return [];

  // 같은 channelId 가 두 번 들어오면 Postgres가
  // "ON CONFLICT DO UPDATE command cannot affect row a second time" 을 던진다.
  // 치지직 관리자 목록이 중복을 줄 수 있으므로 여기서 정규화한다.
  const byChannelId = new Map();
  for (const channel of channels) {
    if (!channel?.channelId) continue;
    byChannelId.set(channel.channelId, channel);
  }
  if (byChannelId.size === 0) return [];

  const rows = [...byChannelId.values()].map((c) => ({
    chzzk_channel_id: c.channelId,
    chzzk_channel_name: c.channelName,
    chzzk_channel_image: c.channelImageUrl ?? null,
    chzzk_verified: Boolean(c.verifiedMark),
    channel_synced_at: new Date().toISOString(),
  }));
```

이후 `.upsert(rows, ...)` 부분은 그대로 둔다.

- [ ] **Step 4: `lib/chzzk.js` 의 `code` 타입 정규화**

`unwrap` 의 `!res.ok` 분기에서 `code: json?.code` 를 아래로 바꾼다:

```js
      code: json?.code == null ? undefined : Number(json.code),
```

두 실패 분기가 같은 타입을 담게 된다. `lib/db/tokens.js` 의 `err?.code === 401` 이
문자열 `"401"` 을 놓치던 갭이 사라진다.

- [ ] **Step 5: `lib/db/channels.js` 작성**

```js
// 치지직 채널 정보를 users 에 반영한다.
// fetchChannels 는 Client 인증이라 사용자 토큰이 필요 없다 —
// 한 번도 로그인한 적 없는 채널의 이름·이미지도 가져올 수 있다.
import { fetchChannels } from "@/lib/chzzk";
import { ensurePlaceholderUsers } from "@/lib/db/users";

export async function refreshChannelInfo(channelIds) {
  const ids = [...new Set((channelIds ?? []).filter(Boolean))];
  if (ids.length === 0) return 0;

  const channels = await fetchChannels(ids);
  if (channels.length === 0) return 0;

  // ensurePlaceholderUsers 는 last_login_at 을 건드리지 않는다.
  // 이미 로그인한 유저의 기록을 지우면 안 되기 때문이다.
  const users = await ensurePlaceholderUsers(channels);
  return users.length;
}
```

- [ ] **Step 6: 커밋 (채널 동기화)**

```bash
git add lib/db/users.js lib/db/channels.js lib/chzzk.js tests/db/users.test.js tests/db/channels.test.js
git commit -m "feat: 채널 정보 동기화 추가하고 중복 channelId 처리"
```

- [ ] **Step 7: `mrUrl` 과 `keyLinks` 값의 스킴을 저장 시점에 검증한다**

계획 2 인계 항목이다. `mrUrl` 은 지금 아무 검증 없이 임의 문자열을 받는다.
**현재 이 값을 `href` 로 렌더하는 곳은 없어서 활성 취약점은 아니다** — 잠재 상태다.
다만 이 계획이 시청자 페이지를 만들고 나면 누군가 링크로 거는 것이 자연스러워지고,
그때 렌더 시점에만 막으면 **이미 저장된 오염 행이 남는다.** 그래서 저장 시점에 건다.

`lib/db/songs.js` 에 순수 함수를 추가한다:

```js
// mrUrl·keyLinks 값은 링크로 렌더될 수 있다. javascript: 같은 스킴이 저장되면
// 렌더하는 쪽에서 매번 막아야 하고, 한 곳이라도 빠지면 저장형 XSS 가 된다.
// 저장 시점에 http/https 만 통과시켜 그 부담을 없앤다.
export function isSafeLink(value) {
  if (value == null || value === "") return true; // 비어 있는 건 허용한다
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return false;
  }
  return url.protocol === "http:" || url.protocol === "https:";
}
```

`validateSongInput` 에 검사를 넣는다. **`validateSongInput` 은 POST·bulk·PATCH 세
경로가 모두 거치므로 여기 한 곳에 넣으면 세 경로가 같은 판정을 쓴다.** 계획 2에서
같은 불변식을 한 곳만 고쳐 비대칭이 남는 문제가 세 번 있었다 — 라우트마다 인라인으로
복제하지 말 것.

```js
  if (!isSafeLink(input?.mrUrl)) errors.mrUrl = "MR 주소는 http/https 링크여야 해요.";
  const badKey = Object.entries(input?.keyLinks ?? {})
    .find(([, link]) => !isSafeLink(link));
  if (badKey) errors.keyLinks = `${badKey[0]}키 링크는 http/https 링크여야 해요.`;
```

`keyLinks` 가 객체가 아닌 값(문자열·배열)일 때 `Object.entries` 가 던지지 않는지
확인할 것 — 문자열이면 인덱스별로 순회하므로 링크 검사에 걸려 400 이 난다. 그게 맞다.

`tests/songs.test.js`(단위, DB 불필요)에 추가한다. 없으면 만든다:

```js
  it("javascript: 스킴의 mrUrl 을 거부한다", () => {
    const errors = validateSongInput({ ...VALID, mrUrl: "javascript:alert(1)" });
    expect(errors.mrUrl).toBeTruthy();
  });

  it("http/https mrUrl 과 빈 값은 통과한다", () => {
    expect(validateSongInput({ ...VALID, mrUrl: "https://youtu.be/abc" }).mrUrl).toBeUndefined();
    expect(validateSongInput({ ...VALID, mrUrl: "" }).mrUrl).toBeUndefined();
  });

  it("keyLinks 값의 스킴도 검사한다", () => {
    const errors = validateSongInput({ ...VALID, keyLinks: { "2": "javascript:alert(1)" } });
    expect(errors.keyLinks).toBeTruthy();
  });
```

`VALID` 는 `{ title: "곡", artist: "가수", genre: "발라드" }` 로 두면 된다.

- [ ] **Step 8: 자켓을 교체할 때 이전 파일을 지운다**

계획 2 인계 항목이다. 자켓을 바꾸면 이전 Storage 객체가 고아로 남는다.
썸네일 버튼을 연타해도 매번 새 uuid 로 올리고 이전 것을 안 지운다.

`app/api/songs/[id]/route.js` 의 PATCH 에서, `jacketPath` 가 실제로 **바뀔 때만**
이전 파일을 지운다. `updateSong` 이 성공한 뒤에 지워야 한다 — 먼저 지우면 저장이
실패했을 때 파일만 사라진다.

```js
    const previous = existing.jacketPath;
    const song = await updateSong(id, input);
    // 자켓이 바뀌었으면 이전 파일을 지운다. 스코프 가드를 반드시 태운다 —
    // 정리 로직은 삭제 경로를 하나 더 늘리는 것이라, 가드 없이 넣으면
    // 계획 2에서 막은 크로스 테넌트 삭제가 이 자리로 되살아난다.
    if (previous && previous !== song.jacketPath && isJacketPathOf(existing.songbookId, previous)) {
      await deleteJacket(previous);
    }
```

`isJacketPathOf` 와 `deleteJacket` 은 이미 이 파일이 `@/lib/storage` 에서 가져오고
있는지 확인하고, 없으면 import 에 추가한다.

통합 테스트를 `tests/integration/songs.test.js` 의 "곡 API 인가" 스위트에 추가한다.
실제 Storage 객체를 만들어야 하므로 `uploadJacket` 을 직접 부른다:

```js
  it("자켓을 교체하면 이전 파일이 지워진다", async () => {
    const first = await uploadJacket(book.id, pngFile());
    const second = await uploadJacket(book.id, pngFile());
    const song = await createSong(book.id, { ...SONG, jacketPath: first.path });

    const res = await fetch(`${server.baseUrl}/api/songs/${song.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: server.baseUrl, cookie: ownerCookie },
      body: JSON.stringify({ jacketPath: second.path }),
    });
    expect(res.status).toBe(200);

    // 이전 파일은 사라지고 새 파일은 남아야 한다.
    const { data } = await getDb().storage.from(JACKETS_BUCKET).list(book.id);
    const names = (data ?? []).map((f) => f.name);
    expect(names).not.toContain(first.path.split("/")[1]);
    expect(names).toContain(second.path.split("/")[1]);

    await deleteJacket(second.path);
  });
```

`pngFile()` 은 `tests/db/storage.test.js` 의 `fakeFile(PNG_BYTES)` 와 같은 형태로
이 파일 안에 만든다(헬퍼를 새 파일로 빼지 말 것 — 쓰는 곳이 둘뿐이다).
`uploadJacket`, `deleteJacket`, `JACKETS_BUCKET` 을 import 에 추가한다.

- [ ] **Step 9: 검증**

Run: `pnpm test`
Expected: 67 passed (기존 64 + Step 7 의 3)

Run: `pnpm test:db`
Expected: 84 passed (기존 77 + users 3 + channels 4)

Run: `pnpm test:e2e`
Expected: 48 passed (기존 47 + Step 8 의 1)

Run: `pnpm build`
Expected: 통과

- [ ] **Step 10: 커밋 (이연 정리)**

성격이 다르므로 Step 6 과 나눈다.

```bash
git add lib/db/songs.js tests/songs.test.js
git commit -m "fix: MR 주소와 키 링크의 스킴을 저장 시점에 검증한다"

git add "app/api/songs/[id]/route.js" tests/integration/songs.test.js
git commit -m "fix: 자켓을 교체할 때 이전 파일을 지운다"
```

---

### Task 2: 매니저 저장소

**Files:**
- Create: `lib/db/members.js`, `lib/invite.js`
- Create: `tests/invite.test.js`, `tests/db/members.test.js`

**Interfaces:**
- Consumes: `getDb`, `failed`, `isUuid`
- Produces:
  - `lib/invite.js`: `createInviteToken(): {token, tokenHash}`, `hashInviteToken(token): string`
  - `lib/db/members.js`:
    - `listMembers(songbookId): Promise<Array<{userId, role, source, createdAt, user}>>`
    - `addManager(songbookId, userId, { source, invitedBy }): Promise<void>` — 이미 있으면 무시
    - `removeManager(songbookId, userId): Promise<void>`
    - `replaceSyncedManagers(songbookId, userIds, { invitedBy }): Promise<{added, removed}>` — `source='chzzk_sync'` 행만 대상
    - `isManager(songbookId, userId): Promise<boolean>`
    - `createInvite(songbookId, createdBy): Promise<{token, expiresAt}>`
    - `acceptInvite(token, userId): Promise<{status, songbookId}>` — `status`: `'accepted'|'already'|'owner'|'invalid'`

**초대 토큰은 원문을 저장하지 않는다.** 해시만 남기므로 DB가 통째로 유출돼도 초대 링크를
재사용할 수 없다. 만료는 7일.

**`replaceSyncedManagers` 가 `source='chzzk_sync'` 행만 건드리는 것이 핵심이다.**
이 구분이 없으면 자동 동기화가 수동으로 초대한 매니저를 지워버린다.

- [ ] **Step 1: 초대 토큰 테스트 작성**

`tests/invite.test.js`:

```js
import { describe, it, expect } from "vitest";
import { createInviteToken, hashInviteToken } from "@/lib/invite";

describe("lib/invite", () => {
  it("토큰과 해시를 만든다", () => {
    const { token, tokenHash } = createInviteToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("토큰과 해시가 다르다", () => {
    // 해시가 토큰과 같으면 DB 유출 시 초대 링크를 그대로 재사용할 수 있다.
    const { token, tokenHash } = createInviteToken();
    expect(tokenHash).not.toBe(token);
  });

  it("같은 토큰은 같은 해시를 준다", () => {
    const { token, tokenHash } = createInviteToken();
    expect(hashInviteToken(token)).toBe(tokenHash);
  });

  it("매번 다른 토큰을 만든다", () => {
    expect(createInviteToken().token).not.toBe(createInviteToken().token);
  });

  it("빈 값·null도 던지지 않고 해시한다", () => {
    expect(hashInviteToken("")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(null)).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: `lib/invite.js` 작성**

```js
// 초대 토큰. 원문은 DB에 넣지 않고 해시만 저장한다 —
// DB가 유출돼도 초대 링크를 재사용할 수 없게 하기 위해서다.
import crypto from "node:crypto";

export function hashInviteToken(token) {
  return crypto.createHash("sha256").update(String(token ?? "")).digest("hex");
}

export function createInviteToken() {
  const token = crypto.randomBytes(32).toString("hex");
  return { token, tokenHash: hashInviteToken(token) };
}
```

- [ ] **Step 3: 매니저 저장소 테스트 작성**

`tests/db/members.test.js`:

```js
import { it, expect, beforeEach } from "vitest";
import { describeDb, truncateAll } from "../helpers/db.js";
import { getDb } from "@/lib/db/client";
import { upsertUserFromLogin } from "@/lib/db/users";
import { createSongbook } from "@/lib/db/songbooks";
import {
  listMembers, addManager, removeManager, replaceSyncedManagers,
  isManager, createInvite, acceptInvite,
} from "@/lib/db/members";

describeDb("lib/db/members", () => {
  let owner, a, b, c, book;

  beforeEach(async () => {
    await truncateAll(getDb());
    owner = await upsertUserFromLogin({ chzzkChannelId: "o", chzzkChannelName: "주인" });
    a = await upsertUserFromLogin({ chzzkChannelId: "a", chzzkChannelName: "A" });
    b = await upsertUserFromLogin({ chzzkChannelId: "b", chzzkChannelName: "B" });
    c = await upsertUserFromLogin({ chzzkChannelId: "c", chzzkChannelName: "C" });
    book = await createSongbook({ ownerId: owner.id, slug: "book", title: "노래책" });
  });

  it("매니저를 추가하고 목록에서 본다", async () => {
    await addManager(book.id, a.id, { source: "invite", invitedBy: owner.id });
    const members = await listMembers(book.id);
    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe(a.id);
    expect(members[0].source).toBe("invite");
    expect(members[0].user.chzzkChannelName).toBe("A");
  });

  it("같은 사람을 두 번 추가해도 한 행이다", async () => {
    await addManager(book.id, a.id, { source: "invite", invitedBy: owner.id });
    await addManager(book.id, a.id, { source: "chzzk_sync", invitedBy: owner.id });
    const members = await listMembers(book.id);
    expect(members).toHaveLength(1);
    // 먼저 들어온 source 를 유지한다 — 동기화가 수동 초대를 덮어쓰지 않는다.
    expect(members[0].source).toBe("invite");
  });

  it("매니저를 해제한다", async () => {
    await addManager(book.id, a.id, { source: "invite", invitedBy: owner.id });
    await removeManager(book.id, a.id);
    expect(await listMembers(book.id)).toHaveLength(0);
  });

  it("isManager가 참여 여부를 준다", async () => {
    expect(await isManager(book.id, a.id)).toBe(false);
    await addManager(book.id, a.id, { source: "invite", invitedBy: owner.id });
    expect(await isManager(book.id, a.id)).toBe(true);
  });

  it("동기화는 chzzk_sync 행만 갈아끼운다", async () => {
    await addManager(book.id, a.id, { source: "invite", invitedBy: owner.id });
    await addManager(book.id, b.id, { source: "chzzk_sync", invitedBy: owner.id });

    // 치지직에서 b 가 빠지고 c 가 들어왔다
    const result = await replaceSyncedManagers(book.id, [c.id], { invitedBy: owner.id });
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);

    const members = await listMembers(book.id);
    const ids = members.map((m) => m.userId).sort();
    // a(수동 초대)는 살아있고, b(동기화)는 사라지고, c(동기화)가 들어왔다
    expect(ids).toEqual([a.id, c.id].sort());
    expect(members.find((m) => m.userId === a.id).source).toBe("invite");
  });

  it("동기화 목록이 비면 chzzk_sync 행이 전부 사라진다", async () => {
    await addManager(book.id, a.id, { source: "invite", invitedBy: owner.id });
    await addManager(book.id, b.id, { source: "chzzk_sync", invitedBy: owner.id });
    await replaceSyncedManagers(book.id, [], { invitedBy: owner.id });
    const members = await listMembers(book.id);
    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe(a.id);
  });

  it("동기화가 소유자를 매니저로 넣지 않는다", async () => {
    await replaceSyncedManagers(book.id, [owner.id, a.id], { invitedBy: owner.id });
    const members = await listMembers(book.id);
    expect(members.map((m) => m.userId)).toEqual([a.id]);
  });

  it("초대를 만들고 수락한다", async () => {
    const { token } = await createInvite(book.id, owner.id);
    const result = await acceptInvite(token, a.id);
    expect(result.status).toBe("accepted");
    expect(result.songbookId).toBe(book.id);
    expect(await isManager(book.id, a.id)).toBe(true);
  });

  it("초대 토큰 원문이 DB에 저장되지 않는다", async () => {
    const { token } = await createInvite(book.id, owner.id);
    const { data } = await getDb().from("songbook_invites").select("token_hash").single();
    expect(data.token_hash).not.toBe(token);
    expect(data.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("이미 수락된 토큰은 재사용할 수 없다", async () => {
    const { token } = await createInvite(book.id, owner.id);
    await acceptInvite(token, a.id);
    expect((await acceptInvite(token, b.id)).status).toBe("invalid");
  });

  it("없는 토큰은 invalid", async () => {
    expect((await acceptInvite("없는토큰", a.id)).status).toBe("invalid");
  });

  it("만료된 토큰은 invalid", async () => {
    const { token } = await createInvite(book.id, owner.id);
    await getDb().from("songbook_invites")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("songbook_id", book.id);
    expect((await acceptInvite(token, a.id)).status).toBe("invalid");
  });

  it("이미 매니저인 사람이 수락하면 already", async () => {
    await addManager(book.id, a.id, { source: "invite", invitedBy: owner.id });
    const { token } = await createInvite(book.id, owner.id);
    expect((await acceptInvite(token, a.id)).status).toBe("already");
  });

  it("소유자 본인이 수락하면 owner — 매니저로 강등되지 않는다", async () => {
    const { token } = await createInvite(book.id, owner.id);
    const result = await acceptInvite(token, owner.id);
    expect(result.status).toBe("owner");
    expect(await isManager(book.id, owner.id)).toBe(false);
  });

  it("초대 만료는 7일이다", async () => {
    const { expiresAt } = await createInvite(book.id, owner.id);
    const days = (new Date(expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });
});
```

- [ ] **Step 4: 테스트가 실패하는지 확인**

Run: `pnpm test tests/invite.test.js`
Expected: FAIL — `Cannot find module '@/lib/invite'` (Step 2 후에는 통과)

Run: `pnpm test:db`
Expected: FAIL — `Cannot find module '@/lib/db/members'`

- [ ] **Step 5: `lib/db/members.js` 작성**

```js
// songbook_members + songbook_invites 저장소.
//
// source 로 자동 동기화와 수동 초대를 구분하는 것이 핵심이다.
// 이 구분이 없으면 치지직 동기화가 수동으로 초대한 매니저를 지워버린다.
import { getDb } from "@/lib/db/client";
import { failed } from "@/lib/db/errors";
import { isUuid } from "@/lib/uuid";
import { createInviteToken, hashInviteToken } from "@/lib/invite";
import { findSongbookById } from "@/lib/db/songbooks";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function listMembers(songbookId) {
  if (!isUuid(songbookId)) return [];
  const { data, error } = await getDb()
    .from("songbook_members")
    .select("user_id, role, source, created_at, users(chzzk_channel_id, chzzk_channel_name, chzzk_channel_image, chzzk_verified)")
    .eq("songbook_id", songbookId)
    .order("created_at", { ascending: true });
  if (error) failed(error, "매니저 목록 조회");

  return (data ?? []).map((row) => ({
    userId: row.user_id,
    role: row.role,
    source: row.source,
    createdAt: row.created_at,
    user: {
      chzzkChannelId: row.users?.chzzk_channel_id ?? null,
      chzzkChannelName: row.users?.chzzk_channel_name ?? null,
      chzzkChannelImage: row.users?.chzzk_channel_image ?? null,
      chzzkVerified: row.users?.chzzk_verified ?? false,
    },
  }));
}

// 이미 있으면 아무것도 하지 않는다 — 먼저 들어온 source 를 유지한다.
export async function addManager(songbookId, userId, { source, invitedBy = null }) {
  const { error } = await getDb()
    .from("songbook_members")
    .upsert(
      { songbook_id: songbookId, user_id: userId, role: "manager", source, invited_by: invitedBy },
      { onConflict: "songbook_id,user_id", ignoreDuplicates: true },
    );
  if (error) failed(error, "매니저 추가");
}

export async function removeManager(songbookId, userId) {
  const { error } = await getDb()
    .from("songbook_members").delete()
    .eq("songbook_id", songbookId).eq("user_id", userId);
  if (error) failed(error, "매니저 해제");
}

export async function isManager(songbookId, userId) {
  if (!isUuid(songbookId) || !isUuid(userId)) return false;
  const { data, error } = await getDb()
    .from("songbook_members").select("user_id")
    .eq("songbook_id", songbookId).eq("user_id", userId).maybeSingle();
  if (error) failed(error, "매니저 확인");
  return Boolean(data);
}

// 치지직 동기화 결과를 반영한다. source='chzzk_sync' 행만 추가·삭제하고
// source='invite' 행은 절대 건드리지 않는다.
export async function replaceSyncedManagers(songbookId, userIds, { invitedBy = null } = {}) {
  const db = getDb();
  const songbook = await findSongbookById(songbookId);
  if (!songbook) failed({ message: "노래책 없음" }, "매니저 동기화");

  // 소유자는 songbooks.owner_id 로 이미 표현된다. 매니저로 중복 등록하지 않는다.
  const wanted = new Set([...new Set(userIds ?? [])].filter((id) => id && id !== songbook.ownerId));

  const { data: existing, error } = await db
    .from("songbook_members").select("user_id, source").eq("songbook_id", songbookId);
  if (error) failed(error, "매니저 동기화");

  const syncedIds = new Set(
    (existing ?? []).filter((r) => r.source === "chzzk_sync").map((r) => r.user_id),
  );
  const anyIds = new Set((existing ?? []).map((r) => r.user_id));

  const toRemove = [...syncedIds].filter((id) => !wanted.has(id));
  const toAdd = [...wanted].filter((id) => !anyIds.has(id));

  if (toRemove.length > 0) {
    const { error: removeError } = await db
      .from("songbook_members").delete()
      .eq("songbook_id", songbookId).eq("source", "chzzk_sync").in("user_id", toRemove);
    if (removeError) failed(removeError, "매니저 동기화");
  }

  if (toAdd.length > 0) {
    const rows = toAdd.map((userId) => ({
      songbook_id: songbookId, user_id: userId,
      role: "manager", source: "chzzk_sync", invited_by: invitedBy,
    }));
    const { error: addError } = await db.from("songbook_members").insert(rows);
    if (addError) failed(addError, "매니저 동기화");
  }

  await db.from("songbooks")
    .update({ members_synced_at: new Date().toISOString() })
    .eq("id", songbookId);

  return { added: toAdd.length, removed: toRemove.length };
}

export async function createInvite(songbookId, createdBy) {
  const { token, tokenHash } = createInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  const { error } = await getDb().from("songbook_invites").insert({
    songbook_id: songbookId, token_hash: tokenHash,
    created_by: createdBy, expires_at: expiresAt,
  });
  if (error) failed(error, "초대 생성");

  // 원문 토큰은 여기서만 존재한다. DB에는 해시만 남는다.
  return { token, expiresAt };
}

// status: 'accepted' | 'already' | 'owner' | 'invalid'
// 없는 토큰·만료된 토큰·이미 쓴 토큰을 전부 'invalid' 로 뭉뚱그린다 —
// 구분하면 토큰 존재 여부가 누설된다.
export async function acceptInvite(token, userId) {
  const db = getDb();
  const { data: invite, error } = await db
    .from("songbook_invites").select()
    .eq("token_hash", hashInviteToken(token)).maybeSingle();
  if (error) failed(error, "초대 조회");

  if (!invite) return { status: "invalid", songbookId: null };
  if (invite.accepted_at) return { status: "invalid", songbookId: null };
  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    return { status: "invalid", songbookId: null };
  }

  const songbook = await findSongbookById(invite.songbook_id);
  if (!songbook) return { status: "invalid", songbookId: null };

  // 소유자가 자기 초대를 수락해 매니저로 강등되면 안 된다.
  if (songbook.ownerId === userId) {
    return { status: "owner", songbookId: songbook.id };
  }

  const already = await isManager(songbook.id, userId);
  if (!already) {
    await addManager(songbook.id, userId, { source: "invite", invitedBy: invite.created_by });
  }

  // 토큰은 1회용이다. 이미 매니저였더라도 소모한다.
  const { error: acceptError } = await db
    .from("songbook_invites")
    .update({ accepted_by: userId, accepted_at: new Date().toISOString() })
    .eq("id", invite.id);
  if (acceptError) failed(acceptError, "초대 수락");

  return { status: already ? "already" : "accepted", songbookId: songbook.id };
}
```

- [ ] **Step 6: 검증**

Run: `pnpm test`
Expected: 69 passed (기존 64 + invite 5)

Run: `pnpm test:db`
Expected: 87 passed (기존 72 + members 15)

- [ ] **Step 7: 커밋**

```bash
git add lib/invite.js lib/db/members.js tests/invite.test.js tests/db/members.test.js
git commit -m "feat: 매니저·초대 저장소 추가"
```

---

### Task 3: 치지직 관리자 자동 동기화

**Files:**
- Create: `lib/sync.js`
- Create: `app/api/songbooks/[id]/members/sync/route.js`
- Modify: `app/api/auth/callback/route.js`
- Create: `tests/db/sync.test.js`

**Interfaces:**
- Consumes: `getValidAccessToken`, `fetchStreamingRoles`, `fetchChannels`, `replaceSyncedManagers`, `refreshChannelInfo`
- Produces:
  - `lib/sync.js`: `syncChzzkManagers(songbookId, ownerId): Promise<{status, added, removed, reason}>`
    - `status`: `'synced'` | `'skipped'` (토큰 없음·동기화 꺼짐·쿨다운) | `'busy'` | `'failed'`
  - `POST /api/songbooks/[id]/members/sync` (`min: 'ownerOnly'`)
  - 로그인 콜백에서 소유자면 자동 동기화 시도

**절차 (스펙 기준):**
1. `streaming-roles` 호출 (401이면 토큰 갱신 후 1회 재시도 — `getValidAccessToken` 이 처리)
2. `STREAMING_CHANNEL_OWNER` 제외 — 소유자는 `songbooks.owner_id` 로 이미 표현된다
3. 남은 `managerChannelId` 로 `users` upsert (`refreshChannelInfo`)
4. `source='chzzk_sync'` 행만 갈아끼움
5. `members_synced_at` 갱신

**동기화 실패가 로그인을 막지 않는다.** 콜백에서 예외를 삼키고 로그만 남긴다.

**쿨다운 1분** — 치지직 API 429를 피한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/db/sync.test.js`:

```js
import { it, expect, beforeEach, vi, afterEach } from "vitest";
import { describeDb, truncateAll } from "../helpers/db.js";
import { getDb } from "@/lib/db/client";
import { upsertUserFromLogin } from "@/lib/db/users";
import { createSongbook, updateSongbook } from "@/lib/db/songbooks";
import { addManager, listMembers } from "@/lib/db/members";
import { saveTokens } from "@/lib/db/tokens";
import { syncChzzkManagers } from "@/lib/sync";

function chzzkResponses({ roles = [], channels = [] }) {
  return vi.fn().mockImplementation(async (url) => {
    const body = String(url).includes("streaming-roles")
      ? { code: 200, content: { data: roles } }
      : { code: 200, content: { data: channels } };
    return { ok: true, status: 200, json: async () => body };
  });
}

describeDb("lib/sync", () => {
  let owner, book;

  beforeEach(async () => {
    await truncateAll(getDb());
    process.env.CHZZK_CLIENT_ID = "cid";
    process.env.CHZZK_CLIENT_SECRET = "csecret";
    owner = await upsertUserFromLogin({ chzzkChannelId: "owner-ch", chzzkChannelName: "주인" });
    book = await createSongbook({ ownerId: owner.id, slug: "book", title: "노래책" });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("토큰이 없으면 건너뛴다", async () => {
    const result = await syncChzzkManagers(book.id, owner.id);
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("no-token");
  });

  it("동기화가 꺼져 있으면 건너뛴다", async () => {
    await saveTokens(owner.id, { accessToken: "AT", refreshToken: "RT", expiresIn: 86400 });
    await updateSongbook(book.id, { chzzkSyncEnabled: false });
    const result = await syncChzzkManagers(book.id, owner.id);
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("disabled");
  });

  it("관리자를 매니저로 등록한다", async () => {
    await saveTokens(owner.id, { accessToken: "AT", refreshToken: "RT", expiresIn: 86400 });
    vi.stubGlobal("fetch", chzzkResponses({
      roles: [
        { managerChannelId: "m1", managerChannelName: "매니저1", userRole: "STREAMING_CHANNEL_MANAGER" },
        { managerChannelId: "owner-ch", managerChannelName: "주인", userRole: "STREAMING_CHANNEL_OWNER" },
      ],
      channels: [{ channelId: "m1", channelName: "매니저1", verifiedMark: false }],
    }));

    const result = await syncChzzkManagers(book.id, owner.id);
    expect(result.status).toBe("synced");
    expect(result.added).toBe(1);

    const members = await listMembers(book.id);
    // STREAMING_CHANNEL_OWNER 는 제외된다 — 소유자는 owner_id 로 표현된다.
    expect(members).toHaveLength(1);
    expect(members[0].user.chzzkChannelId).toBe("m1");
    expect(members[0].source).toBe("chzzk_sync");
  });

  it("수동 초대 매니저를 지우지 않는다", async () => {
    const invited = await upsertUserFromLogin({ chzzkChannelId: "inv", chzzkChannelName: "초대됨" });
    await addManager(book.id, invited.id, { source: "invite", invitedBy: owner.id });
    await saveTokens(owner.id, { accessToken: "AT", refreshToken: "RT", expiresIn: 86400 });

    vi.stubGlobal("fetch", chzzkResponses({ roles: [], channels: [] }));
    await syncChzzkManagers(book.id, owner.id);

    const members = await listMembers(book.id);
    expect(members).toHaveLength(1);
    expect(members[0].source).toBe("invite");
  });

  it("쿨다운 안에는 다시 부르지 않는다", async () => {
    await saveTokens(owner.id, { accessToken: "AT", refreshToken: "RT", expiresIn: 86400 });
    const f = chzzkResponses({ roles: [], channels: [] });
    vi.stubGlobal("fetch", f);

    await syncChzzkManagers(book.id, owner.id);
    const callsAfterFirst = f.mock.calls.length;
    const second = await syncChzzkManagers(book.id, owner.id);

    expect(second.status).toBe("skipped");
    expect(second.reason).toBe("cooldown");
    expect(f.mock.calls.length).toBe(callsAfterFirst);
  });

  it("치지직 오류는 failed로 돌려주고 던지지 않는다", async () => {
    await saveTokens(owner.id, { accessToken: "AT", refreshToken: "RT", expiresIn: 86400 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 500, json: async () => ({ code: 500, message: "INTERNAL_SERVER_ERROR" }),
    }));

    const result = await syncChzzkManagers(book.id, owner.id);
    expect(result.status).toBe("failed");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm test:db`
Expected: FAIL — `Cannot find module '@/lib/sync'`

- [ ] **Step 3: `lib/sync.js` 작성**

```js
// 치지직 채널 관리자를 노래책 매니저로 동기화한다.
//
// 스트리머가 치지직에서 이미 관리하는 스태프를 다시 입력시키지 않는 것이 목적이다.
// 동기화 실패는 절대 로그인을 막지 않는다 — 상태를 돌려주고 호출자가 판단한다.
import { fetchStreamingRoles } from "@/lib/chzzk";
import { getValidAccessToken, TokenRefreshBusyError } from "@/lib/db/tokens";
import { findSongbookById } from "@/lib/db/songbooks";
import { refreshChannelInfo } from "@/lib/db/channels";
import { findUserByChannelId } from "@/lib/db/users";
import { replaceSyncedManagers } from "@/lib/db/members";

const COOLDOWN_MS = 60 * 1000; // 치지직 429 방지

export async function syncChzzkManagers(songbookId, ownerId) {
  const songbook = await findSongbookById(songbookId);
  if (!songbook) return { status: "failed", reason: "not-found", added: 0, removed: 0 };
  if (!songbook.chzzkSyncEnabled) {
    return { status: "skipped", reason: "disabled", added: 0, removed: 0 };
  }
  if (
    songbook.membersSyncedAt &&
    Date.now() - new Date(songbook.membersSyncedAt).getTime() < COOLDOWN_MS
  ) {
    return { status: "skipped", reason: "cooldown", added: 0, removed: 0 };
  }

  let accessToken;
  try {
    accessToken = await getValidAccessToken(ownerId);
  } catch (err) {
    if (err instanceof TokenRefreshBusyError) {
      return { status: "busy", reason: "refreshing", added: 0, removed: 0 };
    }
    console.error("매니저 동기화 — 토큰 조회 실패:", err.message);
    return { status: "failed", reason: "token", added: 0, removed: 0 };
  }
  // 소유자가 다시 로그인하면 토큰이 복구된다. 그때까지 조용히 건너뛴다.
  if (!accessToken) return { status: "skipped", reason: "no-token", added: 0, removed: 0 };

  let roles;
  try {
    roles = await fetchStreamingRoles(accessToken);
  } catch (err) {
    console.error("매니저 동기화 — 관리자 조회 실패:", err.message);
    return { status: "failed", reason: "chzzk", added: 0, removed: 0 };
  }

  // 소유자는 songbooks.owner_id 로 이미 표현된다. 매니저로 중복 등록하지 않는다.
  const channelIds = [
    ...new Set(
      roles
        .filter((r) => r.userRole !== "STREAMING_CHANNEL_OWNER")
        .map((r) => r.managerChannelId)
        .filter(Boolean),
    ),
  ];

  try {
    // 로그인한 적 없는 채널도 users 행을 갖게 한다. Client 인증이라 그 사람 토큰이 필요 없다.
    await refreshChannelInfo(channelIds);

    const userIds = [];
    for (const channelId of channelIds) {
      const user = await findUserByChannelId(channelId);
      if (user) userIds.push(user.id);
    }

    const result = await replaceSyncedManagers(songbookId, userIds, { invitedBy: ownerId });
    return { status: "synced", reason: null, ...result };
  } catch (err) {
    console.error("매니저 동기화 — 반영 실패:", err.message);
    return { status: "failed", reason: "db", added: 0, removed: 0 };
  }
}
```

- [ ] **Step 4: 동기화 라우트 작성**

`app/api/songbooks/[id]/members/sync/route.js`:

```js
import { NextResponse } from "next/server";
import { requireSongbookAccess } from "@/lib/authz";
import { errorResponse, requireSameOrigin } from "@/lib/http";
import { syncChzzkManagers } from "@/lib/sync";

export async function POST(request, { params }) {
  try {
    requireSameOrigin(request);
    const { id } = await params;
    // 매니저 인사권은 소유자만 갖는다. 운영자도 배제된다.
    const { user } = await requireSongbookAccess(id, { min: "ownerOnly" });

    const result = await syncChzzkManagers(id, user.id);
    // 동기화 실패도 200으로 돌려주고 상태를 담는다 —
    // 화면이 "동기화 실패" 를 안내해야지 요청 자체가 실패하면 안 된다.
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 5: 로그인 콜백에서 자동 동기화**

`app/api/auth/callback/route.js` 의 토큰 저장 부분 아래에 추가한다.
`import { syncChzzkManagers } from "@/lib/sync";` 와
`import { listSongbooksForUser } from "@/lib/db/songbooks";` 를 추가한다.

```js
    if (await ownsAnySongbook(user.id)) {
      await saveTokens(user.id, token);

      // 소유한 노래책의 매니저를 갱신한다. 실패해도 로그인을 막지 않는다.
      try {
        const books = await listSongbooksForUser(user.id);
        for (const book of books.filter((b) => b.role === "owner")) {
          await syncChzzkManagers(book.id, user.id);
        }
      } catch (syncError) {
        console.error("로그인 후 매니저 동기화 실패:", syncError.message);
      }
    }
```

- [ ] **Step 6: 검증**

Run: `pnpm test:db`
Expected: 93 passed (기존 87 + sync 6)

Run: `pnpm build`
Expected: 성공

- [ ] **Step 7: 커밋**

```bash
git add lib/sync.js app/api/songbooks tests/db/sync.test.js app/api/auth/callback/route.js
git commit -m "feat: 치지직 채널 관리자 자동 동기화 추가"
```

---

### Task 4: 초대·해제 API + 인가 검증

**Files:**
- Create: `app/api/songbooks/[id]/invites/route.js`
- Create: `app/api/songbooks/[id]/members/route.js`
- Create: `app/api/songbooks/[id]/members/[userId]/route.js`
- Create: `app/api/invites/[token]/accept/route.js`
- Create: `tests/integration/members.test.js`

**Interfaces:**
- Produces:
  - `GET  /api/songbooks/[id]/members` — 목록 (`min: 'manager'`)
  - `POST /api/songbooks/[id]/invites` — 초대 생성 (`min: 'ownerOnly'`)
  - `DELETE /api/songbooks/[id]/members/[userId]` — 해제 (`min: 'ownerOnly'`)
  - `POST /api/invites/[token]/accept` — 수락 (로그인 필요)

**초대·해제가 `ownerOnly` 인 이유:** 운영자 역할의 목적은 남용 대응이지 남의 노래책
인사권이 아니다. 스펙 매트릭스가 운영자에게 404를 준다.

- [ ] **Step 1: 실패하는 통합 테스트 작성**

`tests/integration/members.test.js`:

```js
import { it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { describeE2e, startServer } from "../helpers/server.js";
import { cookieForUser } from "../helpers/session.js";
import { truncateAll } from "../helpers/db.js";
import { getDb } from "@/lib/db/client";
import { upsertUserFromLogin } from "@/lib/db/users";
import { createSongbook } from "@/lib/db/songbooks";
import { addManager, createInvite, isManager } from "@/lib/db/members";

describeE2e("매니저 API 인가", () => {
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
    await addManager(book.id, manager.id, { source: "invite", invitedBy: owner.id });

    ownerCookie = await cookieForUser(owner);
    managerCookie = await cookieForUser(manager);
    strangerCookie = await cookieForUser(stranger);
    operatorCookie = await cookieForUser(operator);
  });

  function invite(cookie) {
    return fetch(`${server.baseUrl}/api/songbooks/${book.id}/invites`, {
      method: "POST",
      headers: { origin: server.baseUrl, ...(cookie ? { cookie } : {}) },
    });
  }

  // 스펙 매트릭스: 매니저 초대·해제는 min:'ownerOnly' — 소유자만, 운영자도 404
  it("비로그인은 401", async () => { expect((await invite(undefined)).status).toBe(401); });
  it("타인은 404", async () => { expect((await invite(strangerCookie)).status).toBe(404); });
  it("매니저는 404", async () => { expect((await invite(managerCookie)).status).toBe(404); });
  it("운영자도 404 — 남의 노래책 인사권은 없다", async () => {
    expect((await invite(operatorCookie)).status).toBe(404);
  });
  it("소유자는 201", async () => { expect((await invite(ownerCookie)).status).toBe(201); });

  it("초대 응답에 토큰과 링크가 들어있다", async () => {
    const body = await (await invite(ownerCookie)).json();
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(body.url).toContain(`/invite/${body.token}`);
  });

  it("매니저 목록은 매니저도 본다", async () => {
    const res = await fetch(`${server.baseUrl}/api/songbooks/${book.id}/members`, {
      headers: { cookie: managerCookie },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).members).toHaveLength(1);
  });

  it("타인은 매니저 목록을 못 본다", async () => {
    const res = await fetch(`${server.baseUrl}/api/songbooks/${book.id}/members`, {
      headers: { cookie: strangerCookie },
    });
    expect(res.status).toBe(404);
  });

  function removeMember(cookie, userId) {
    return fetch(`${server.baseUrl}/api/songbooks/${book.id}/members/${userId}`, {
      method: "DELETE",
      headers: { origin: server.baseUrl, ...(cookie ? { cookie } : {}) },
    });
  }

  it("소유자는 매니저를 해제한다", async () => {
    expect((await removeMember(ownerCookie, manager.id)).status).toBe(200);
    expect(await isManager(book.id, manager.id)).toBe(false);
  });

  it("매니저는 스스로를 해제할 수 없다", async () => {
    expect((await removeMember(managerCookie, manager.id)).status).toBe(404);
  });

  it("운영자도 해제할 수 없다", async () => {
    expect((await removeMember(operatorCookie, manager.id)).status).toBe(404);
  });
});

describeE2e("초대 수락", () => {
  let server, owner, invitee, book, inviteeCookie;

  beforeAll(async () => { server = await startServer(); });
  afterAll(() => { server?.stop(); });

  beforeEach(async () => {
    await truncateAll(getDb());
    owner = await upsertUserFromLogin({ chzzkChannelId: "o", chzzkChannelName: "주인" });
    invitee = await upsertUserFromLogin({ chzzkChannelId: "i", chzzkChannelName: "초대받은이" });
    book = await createSongbook({ ownerId: owner.id, slug: "book", title: "노래책" });
    inviteeCookie = await cookieForUser(invitee);
  });

  function accept(token, cookie) {
    return fetch(`${server.baseUrl}/api/invites/${token}/accept`, {
      method: "POST",
      headers: { origin: server.baseUrl, ...(cookie ? { cookie } : {}) },
    });
  }

  it("비로그인은 401", async () => {
    const { token } = await createInvite(book.id, owner.id);
    expect((await accept(token, undefined)).status).toBe(401);
  });

  it("수락하면 매니저가 된다", async () => {
    const { token } = await createInvite(book.id, owner.id);
    const res = await accept(token, inviteeCookie);
    expect(res.status).toBe(200);
    expect(await isManager(book.id, invitee.id)).toBe(true);
  });

  it("없는 토큰은 410", async () => {
    // 없는 토큰·만료·재사용을 전부 410으로 뭉뚱그린다 — 존재를 누설하지 않는다.
    expect((await accept("f".repeat(64), inviteeCookie)).status).toBe(410);
  });

  it("이미 쓴 토큰은 410", async () => {
    const { token } = await createInvite(book.id, owner.id);
    await accept(token, inviteeCookie);
    const other = await upsertUserFromLogin({ chzzkChannelId: "x", chzzkChannelName: "X" });
    expect((await accept(token, await cookieForUser(other))).status).toBe(410);
  });

  it("소유자 본인이 수락하면 400 — 매니저로 강등되지 않는다", async () => {
    const { token } = await createInvite(book.id, owner.id);
    const res = await accept(token, await cookieForUser(owner));
    expect(res.status).toBe(400);
    expect(await isManager(book.id, owner.id)).toBe(false);
  });

  it("이미 매니저면 200 (멱등)", async () => {
    await addManager(book.id, invitee.id, { source: "invite", invitedBy: owner.id });
    const { token } = await createInvite(book.id, owner.id);
    expect((await accept(token, inviteeCookie)).status).toBe(200);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm test:e2e`
Expected: FAIL — 라우트가 없어 404

- [ ] **Step 3: 매니저 목록 라우트**

`app/api/songbooks/[id]/members/route.js`:

```js
import { NextResponse } from "next/server";
import { requireSongbookAccess } from "@/lib/authz";
import { errorResponse } from "@/lib/http";
import { listMembers } from "@/lib/db/members";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    await requireSongbookAccess(id, { min: "manager" });
    return NextResponse.json({ members: await listMembers(id) });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 4: 초대 생성 라우트**

`app/api/songbooks/[id]/invites/route.js`:

```js
import { NextResponse } from "next/server";
import { requireSongbookAccess } from "@/lib/authz";
import { errorResponse, requireSameOrigin } from "@/lib/http";
import { createInvite } from "@/lib/db/members";

export async function POST(request, { params }) {
  try {
    requireSameOrigin(request);
    const { id } = await params;
    // 인사권은 소유자만. 운영자도 배제된다.
    const { user } = await requireSongbookAccess(id, { min: "ownerOnly" });

    const { token, expiresAt } = await createInvite(id, user.id);
    const url = new URL(`/invite/${token}`, new URL(request.url).origin).toString();

    // 원문 토큰은 이 응답에만 존재한다. DB에는 해시만 남는다.
    return NextResponse.json({ token, url, expiresAt }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 5: 매니저 해제 라우트**

`app/api/songbooks/[id]/members/[userId]/route.js`:

```js
import { NextResponse } from "next/server";
import { requireSongbookAccess } from "@/lib/authz";
import { errorResponse, requireSameOrigin } from "@/lib/http";
import { removeManager } from "@/lib/db/members";

export async function DELETE(request, { params }) {
  try {
    requireSameOrigin(request);
    const { id, userId } = await params;
    await requireSongbookAccess(id, { min: "ownerOnly" });

    await removeManager(id, userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 6: 초대 수락 라우트**

`app/api/invites/[token]/accept/route.js`:

```js
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/authz";
import { errorResponse, requireSameOrigin } from "@/lib/http";
import { acceptInvite } from "@/lib/db/members";

export async function POST(request, { params }) {
  try {
    requireSameOrigin(request);
    const { token } = await params;

    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
    }

    const result = await acceptInvite(token, user.id);

    // 없는 토큰·만료·재사용을 전부 410으로 뭉뚱그린다 — 토큰 존재 여부를 누설하지 않는다.
    if (result.status === "invalid") {
      return NextResponse.json({ error: "초대가 만료되었거나 이미 사용됐어요." }, { status: 410 });
    }
    if (result.status === "owner") {
      return NextResponse.json(
        { error: "이미 이 노래책의 소유자예요." },
        { status: 400 },
      );
    }

    return NextResponse.json({ status: result.status, songbookId: result.songbookId });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 7: 검증**

Run: `pnpm test:e2e`
Expected: 51 passed (기존 33 + 매니저 인가 12 + 초대 수락 6)

Run: `pnpm build`
Expected: 성공

- [ ] **Step 8: 커밋**

```bash
git add app/api/songbooks app/api/invites tests/integration/members.test.js
git commit -m "feat: 매니저 초대·해제 API 추가"
```

---

### Task 5: 매니저 관리 화면 + 초대 수락 화면

**Files:**
- Create: `app/manage/[slug]/members/page.jsx`
- Create: `app/invite/[token]/page.jsx`
- Modify: `app/manage/[slug]/page.jsx`

**Interfaces:**
- Consumes: Task 3·4의 API
- Produces: `/manage/[slug]/members`, `/invite/[token]`

- [ ] **Step 1: 매니저 관리 화면 작성**

`app/manage/[slug]/members/page.jsx`:

```jsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import "../../manage.css";

const SYNC_MESSAGE = {
  synced: "동기화했어요.",
  busy: "토큰을 갱신하는 중이에요. 잠시 후 다시 시도해 주세요.",
  failed: "동기화하지 못했어요. 잠시 후 다시 시도해 주세요.",
};
const SKIP_REASON = {
  "no-token": "동기화를 켜려면 치지직으로 다시 로그인해 주세요.",
  disabled: "이 노래책은 자동 동기화가 꺼져 있어요.",
  cooldown: "방금 동기화했어요. 잠시 후 다시 시도해 주세요.",
};

export default function MembersPage() {
  const { slug } = useParams();
  const [book, setBook] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [inviteUrl, setInviteUrl] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const me = await (await fetch("/api/me")).json();
    const found = (me.songbooks ?? []).find((b) => b.slug === slug);
    setBook(found ?? null);
    if (found) {
      const res = await fetch(`/api/songbooks/${found.id}/members`);
      if (res.ok) setMembers((await res.json()).members ?? []);
    }
    setLoading(false);
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  async function sync() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/songbooks/${book.id}/members/sync`, { method: "POST" });
      if (!res.ok) {
        setNotice("동기화 권한이 없어요.");
        return;
      }
      const result = await res.json();
      setNotice(
        result.status === "skipped"
          ? SKIP_REASON[result.reason] ?? "동기화를 건너뛰었어요."
          : SYNC_MESSAGE[result.status] ?? "동기화했어요.",
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function invite() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/songbooks/${book.id}/invites`, { method: "POST" });
      if (!res.ok) {
        setNotice("초대 링크를 만들지 못했어요.");
        return;
      }
      const body = await res.json();
      setInviteUrl(body.url);
    } finally {
      setBusy(false);
    }
  }

  async function remove(member) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/songbooks/${book.id}/members/${member.userId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setNotice("해제하지 못했어요.");
        return;
      }
      if (member.source === "chzzk_sync") {
        setNotice("해제했어요. 다만 치지직에서 관리자 지정을 해제하지 않으면 다음 동기화에서 다시 추가돼요.");
      }
      await load();
    } finally {
      setBusy(false);
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

  const isOwner = book.role === "owner";

  return (
    <main className="manage">
      <h1>{book.title} · 매니저</h1>
      <Link className="btn btn-ghost" href={`/manage/${slug}`}>설정</Link>

      {isOwner && (
        <div className="manage-actions">
          <button className="btn btn-ghost" type="button" onClick={sync} disabled={busy}>
            치지직 관리자 동기화
          </button>
          <button className="btn btn-primary" type="button" onClick={invite} disabled={busy}>
            초대 링크 만들기
          </button>
        </div>
      )}

      {notice && <p className="manage-hint">{notice}</p>}

      {inviteUrl && (
        <div className="manage-invite">
          <p>이 링크를 전달하세요. 7일 뒤 만료되고 한 번만 쓸 수 있어요.</p>
          <code>{inviteUrl}</code>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => navigator.clipboard?.writeText(inviteUrl)}
          >
            복사
          </button>
        </div>
      )}

      {members.length === 0 ? (
        <p className="manage-hint">아직 매니저가 없어요.</p>
      ) : (
        <ul className="manage-list">
          {members.map((member) => (
            <li key={member.userId}>
              {member.user.chzzkChannelImage && (
                <img
                  src={member.user.chzzkChannelImage}
                  alt=""
                  width={32}
                  height={32}
                  className="manage-avatar"
                />
              )}
              <span>
                {member.user.chzzkChannelName}
                {member.user.chzzkVerified && <span className="manage-verified" title="치지직 인증 채널">✓</span>}
              </span>
              <span className="manage-role">
                {member.source === "chzzk_sync" ? "치지직 관리자" : "초대"}
              </span>
              {isOwner && (
                <button className="btn btn-ghost" type="button" onClick={() => remove(member)} disabled={busy}>
                  해제
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 2: 초대 수락 화면 작성**

`app/invite/[token]/page.jsx`:

```jsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

export default function InvitePage() {
  const { token } = useParams();
  const router = useRouter();
  const [state, setState] = useState({ phase: "checking" });

  useEffect(() => {
    (async () => {
      const me = await (await fetch("/api/me")).json();
      if (!me.user) {
        setState({ phase: "login" });
        return;
      }

      const res = await fetch(`/api/invites/${token}/accept`, { method: "POST" });
      const body = await res.json();

      if (res.ok) {
        setState({ phase: "done", songbookId: body.songbookId });
        return;
      }
      setState({ phase: "error", message: body.error ?? "초대를 수락하지 못했어요." });
    })();
  }, [token]);

  return (
    <main className="manage">
      <h1>노래책 매니저 초대</h1>

      {state.phase === "checking" && <p>확인하는 중…</p>}

      {state.phase === "login" && (
        <>
          <p>초대를 수락하려면 치지직으로 로그인해 주세요.</p>
          {/* 로그인 후 이 페이지로 돌아오면 자동으로 수락된다. */}
          <a className="btn btn-primary" href="/api/auth/login">치지직으로 로그인</a>
        </>
      )}

      {state.phase === "done" && (
        <>
          <p>매니저가 되었어요.</p>
          <button className="btn btn-primary" type="button" onClick={() => router.push("/manage")}>
            노래책 관리로
          </button>
        </>
      )}

      {state.phase === "error" && (
        <>
          <p className="manage-error">{state.message}</p>
          <button className="btn btn-ghost" type="button" onClick={() => router.push("/")}>
            처음으로
          </button>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 3: 설정 화면에 매니저 링크와 동기화 토글 추가**

`app/manage/[slug]/page.jsx` 에서:
- `곡 관리` 링크 옆에 `<Link className="btn btn-ghost" href={\`/manage/${slug}/members\`}>매니저</Link>` 추가
- `form` 안 `manage-check` 라벨 아래에 동기화 토글을 하나 더 추가:

```jsx
          <label className="manage-check">
            <input
              type="checkbox"
              checked={form.chzzkSyncEnabled ?? true}
              onChange={(e) => setForm({ ...form, chzzkSyncEnabled: e.target.checked })}
            />
            치지직 채널 관리자를 매니저로 자동 등록
          </label>
```

- [ ] **Step 4: CSS 추가**

`app/manage/manage.css` 끝에 추가한다:

```css
.manage-actions { display: flex; gap: 0.5rem; margin: 1.25rem 0; flex-wrap: wrap; }
.manage-avatar { border-radius: 50%; }
.manage-verified { margin-left: 0.25rem; color: var(--accent, #4ade80); font-size: 0.75rem; }
.manage-invite {
  display: grid; gap: 0.5rem; padding: 1rem; margin: 1rem 0;
  border: 1px solid var(--line); border-radius: 0.75rem;
}
.manage-invite code { word-break: break-all; font-size: 0.8125rem; }
```

- [ ] **Step 5: 검증**

Run: `pnpm build`
Expected: 성공. 라우트에 `/manage/[slug]/members`, `/invite/[token]` 이 보인다.

Run: `pnpm test && pnpm test:db && pnpm test:e2e`
Expected: 69 / 93 / 51

- [ ] **Step 6: 커밋**

```bash
git add app/manage app/invite
git commit -m "feat: 매니저 관리·초대 수락 화면 추가"
```

---

### Task 6: `/@slug` 시청자 페이지

**Files:**
- Create: `app/[handle]/page.jsx`
- Create: `app/[handle]/SongbookView.jsx`
- Create: `tests/integration/handle.test.js`

**Interfaces:**
- Consumes: `findSongbookBySlug`, `findSongbookByHistoricalSlug`, `listSongs`, `findUserById`
- Produces: `/@slug` 공개 노래책 페이지

**Next.js 함정:** 폴더명 `@foo` 는 parallel route slot 문법이라 URL 세그먼트가 되지 않는다.
`app/[handle]/page.jsx` 로 받아 `params.handle` 이 `"@dutto"` 로 들어오는 것을 쓴다.
`@` 로 시작하지 않으면 404. 정적 세그먼트(`manage`, `invite`, `api`)가 dynamic보다 우선
매칭되므로 충돌하지 않는다.

**해석 순서:** `@` 없으면 404 → 현재 slug 조회 → 없으면 이력 조회 후 현재 slug로 301 → 그것도
없으면 404.

**Server Component 주의:** 이 페이지는 `getDb()` 를 부르므로 빌드 타임 정적 프리렌더에
말려들면 안 된다. `export const dynamic = "force-dynamic";` 를 명시한다.

- [ ] **Step 1: 실패하는 통합 테스트 작성**

`tests/integration/handle.test.js`:

```js
import { it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { describeE2e, startServer } from "../helpers/server.js";
import { truncateAll } from "../helpers/db.js";
import { getDb } from "@/lib/db/client";
import { upsertUserFromLogin } from "@/lib/db/users";
import { createSongbook, changeSlug, updateSongbook } from "@/lib/db/songbooks";
import { createSong } from "@/lib/db/songs";

describeE2e("/@slug 시청자 페이지", () => {
  let server, owner, book;

  beforeAll(async () => { server = await startServer(); });
  afterAll(() => { server?.stop(); });

  beforeEach(async () => {
    await truncateAll(getDb());
    owner = await upsertUserFromLogin({ chzzkChannelId: "o", chzzkChannelName: "새벽감자" });
    book = await createSongbook({ ownerId: owner.id, slug: "dutto", title: "듀토 노래책" });
    await createSong(book.id, { title: "사건의 지평선", artist: "윤하", genre: "K-POP" });
  });

  it("공개 노래책을 보여준다", async () => {
    const res = await fetch(`${server.baseUrl}/@dutto`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("듀토 노래책");
    expect(html).toContain("사건의 지평선");
  });

  it("채널명을 노출한다 — slug보다 신뢰할 수 있는 신원이다", async () => {
    const html = await (await fetch(`${server.baseUrl}/@dutto`)).text();
    expect(html).toContain("새벽감자");
  });

  it("없는 slug는 404", async () => {
    expect((await fetch(`${server.baseUrl}/@없는주소`)).status).toBe(404);
  });

  it("@ 없는 경로는 404", async () => {
    expect((await fetch(`${server.baseUrl}/dutto`)).status).toBe(404);
  });

  it("옛 slug는 현재 주소로 리다이렉트한다", async () => {
    await changeSlug(book.id, "newdutto");
    const res = await fetch(`${server.baseUrl}/@dutto`, { redirect: "manual" });
    expect([301, 308]).toContain(res.status);
    expect(res.headers.get("location")).toContain("/@newdutto");
  });

  it("비공개 노래책은 비로그인에게 404", async () => {
    await updateSongbook(book.id, { isPublic: false });
    expect((await fetch(`${server.baseUrl}/@dutto`)).status).toBe(404);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm test:e2e`
Expected: FAIL — 라우트가 없어 404 (리다이렉트 테스트도 실패)

- [ ] **Step 3: `app/[handle]/page.jsx` 작성 (Server Component)**

```jsx
import { notFound, redirect, permanentRedirect } from "next/navigation";
import { findSongbookBySlug, findSongbookByHistoricalSlug } from "@/lib/db/songbooks";
import { findUserById } from "@/lib/db/users";
import { listSongs } from "@/lib/db/songs";
import { jacketPublicUrl } from "@/lib/storage";
import { currentUser, accessLevel } from "@/lib/authz";
import SongbookView from "./SongbookView";

// DB를 만지므로 빌드 타임 정적 프리렌더에 말려들면 안 된다.
export const dynamic = "force-dynamic";

export default async function HandlePage({ params }) {
  const { handle } = await params;

  // Next.js에서 폴더명 @foo 는 parallel route slot 문법이라 URL이 되지 않는다.
  // dynamic segment 로 받아 여기서 @ 를 검사한다.
  if (!handle?.startsWith("@")) notFound();
  const slug = handle.slice(1).toLowerCase();

  let songbook = await findSongbookBySlug(slug);

  if (!songbook) {
    // 주소를 바꾼 노래책이면 현재 주소로 보낸다. 공유된 옛 링크가 죽지 않는다.
    const history = await findSongbookByHistoricalSlug(slug);
    if (history?.currentSlug) permanentRedirect(`/@${history.currentSlug}`);
    notFound();
  }

  if (!songbook.isPublic) {
    // 비공개는 참여자만. 없는 것과 구분되지 않게 404.
    const user = await currentUser();
    const level = await accessLevel(user, songbook.id);
    if (!level) notFound();
  }

  const [owner, songs] = await Promise.all([
    findUserById(songbook.ownerId),
    listSongs(songbook.id),
  ]);

  return (
    <SongbookView
      songbook={{
        slug: songbook.slug,
        title: songbook.title,
        intro: songbook.intro,
      }}
      channel={{
        name: owner?.chzzkChannelName ?? null,
        image: owner?.chzzkChannelImage ?? null,
        verified: owner?.chzzkVerified ?? false,
        chzzkUrl: owner?.chzzkChannelId
          ? `https://chzzk.naver.com/${owner.chzzkChannelId}`
          : null,
      }}
      songs={songs.map((song) => ({ ...song, jacketUrl: jacketPublicUrl(song.jacketPath) }))}
    />
  );
}
```

- [ ] **Step 4: `app/[handle]/SongbookView.jsx` 작성**

기존 `app/page.jsx` 의 시청자 UI(그리드/리스트 전환, 별칭 검색, 장르 필터, 페이지네이션,
신청 명령어 복사, 로그인 넛지)를 **그대로 옮긴다.** 바뀌는 것은 아래 넷뿐이다.

1. `CHANNEL` 상수 import를 제거하고 props의 `channel` 을 쓴다.
2. `fetch("/api/songs")` 로 곡을 받던 것을 제거한다 — props로 받는다.
3. 헤더에 **치지직 채널 링크와 인증 배지**를 노출한다. slug는 검증된 신원이 아니지만
   `verifiedMark` 는 치지직이 보증한 값이라 사칭 방어의 핵심이다:
   ```jsx
   <div className="channel">
     {channel.image && <img src={channel.image} alt="" className="channel-avatar" />}
     {channel.chzzkUrl ? (
       <a href={channel.chzzkUrl} target="_blank" rel="noreferrer noopener">
         {channel.name}
         {channel.verified && <span className="verified" title="치지직 인증 채널">✓</span>}
       </a>
     ) : (
       <span>{channel.name}</span>
     )}
   </div>
   ```
4. 검색은 `song.titleAliases` / `song.artistAliases` 를 함께 훑는다 — 기존 `app/page.jsx` 가
   이미 그렇게 돼 있으면 그대로 두고, 아니면 아래처럼 맞춘다:
   ```js
   const haystack = [
     song.title, song.artist,
     ...(song.titleAliases ?? []), ...(song.artistAliases ?? []),
   ].join(" ").toLowerCase();
   ```

파일 첫 줄은 `"use client";` 다.

- [ ] **Step 5: 검증**

Run: `pnpm test:e2e`
Expected: 57 passed (기존 51 + handle 6)

Run: `pnpm build`
Expected: 성공. 라우트에 `ƒ /[handle]` 이 **dynamic(ƒ)** 으로 보여야 한다.
`○`(static)이면 `dynamic = "force-dynamic"` 이 빠진 것이다.

- [ ] **Step 6: 커밋**

```bash
git add app/\[handle\] tests/integration/handle.test.js
git commit -m "feat: /@slug 시청자 노래책 페이지 추가"
```

---

### Task 7: 랜딩 페이지 재작성

**Files:**
- Rewrite: `app/page.jsx`
- Modify: `app/globals.css` (필요한 경우)

**Interfaces:**
- Consumes: `/api/me`
- Produces: 서비스 소개 + 로그인 + 내 노래책으로 이동

기존 `app/page.jsx` 는 **단일 노래책 시청자 화면**이었다. 그 역할은 Task 6의 `/@slug` 가
가져갔으므로, 랜딩은 소개와 진입점만 남긴다.

인계 문서의 계획 3 항목 7(`authError` 값별 안내)을 여기서 처리한다.

- [ ] **Step 1: `app/page.jsx` 를 아래로 교체**

```jsx
"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

// 로그인 실패 사유별 안내. 재시도로 해결되는 것과 아닌 것을 구분한다 —
// OAuth 미설정에 "다시 시도해 주세요" 는 틀린 안내다.
const AUTH_ERROR = {
  state: "로그인 요청이 만료됐어요. 다시 시도해 주세요.",
  unconfigured: "아직 치지직 로그인이 준비되지 않았어요. 잠시 후 다시 찾아와 주세요.",
  1: "로그인에 실패했어요. 다시 시도해 주세요.",
};

export default function LandingPage() {
  const params = useSearchParams();
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, []);

  const authError = params.get("authError");
  const errorMessage = authError
    ? AUTH_ERROR[authError] ?? AUTH_ERROR[1]
    : null;

  const books = me?.songbooks ?? [];

  return (
    <main className="landing">
      <h1>치지직 노래책</h1>
      <p className="landing-lead">
        채팅창에 물어보지 않아도, 부를 수 있는 곡이 한눈에.
      </p>

      {errorMessage && <p className="landing-error">{errorMessage}</p>}

      {loading ? (
        <p>불러오는 중…</p>
      ) : me?.user ? (
        <div className="landing-actions">
          {books.length > 0 && (
            <Link className="btn btn-primary" href={`/@${books[0].slug}`}>
              내 노래책 보기
            </Link>
          )}
          <Link className="btn btn-ghost" href="/manage">노래책 관리</Link>
        </div>
      ) : (
        <div className="landing-actions">
          <a className="btn btn-primary" href="/api/auth/login">치지직으로 로그인</a>
        </div>
      )}

      <section className="landing-how">
        <h2>어떻게 쓰나요</h2>
        <ol>
          <li>치지직으로 로그인해서 노래책을 만듭니다.</li>
          <li>부를 수 있는 곡을 등록합니다. 스프레드시트에서 CSV로 한 번에 올릴 수도 있어요.</li>
          <li>시청자에게 <code>/@내주소</code> 를 알려주면, 곡을 골라 신청 명령어를 복사해 갑니다.</li>
        </ol>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: 랜딩 CSS 추가**

`app/globals.css` 끝에 추가한다. 기존 규칙은 건드리지 않는다.

```css
/* ───── 랜딩 ───── */
.landing { max-width: 40rem; margin: 0 auto; padding: 4rem 1.25rem; }
.landing h1 { font-size: 2rem; margin-bottom: 0.5rem; }
.landing-lead { color: var(--muted); margin-bottom: 2rem; }
.landing-error { color: var(--danger, #f87171); font-size: 0.875rem; margin-bottom: 1rem; }
.landing-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 3rem; }
.landing-how h2 { font-size: 1.125rem; margin-bottom: 0.75rem; }
.landing-how ol { display: grid; gap: 0.5rem; padding-left: 1.25rem; color: var(--muted); }
.landing-how code {
  padding: 0.125rem 0.375rem; border-radius: 0.25rem;
  background: var(--surface, rgba(255,255,255,0.06));
}
```

`var(--muted)`, `var(--surface)` 등이 `app/globals.css` 에 실제로 어떤 이름으로 정의돼
있는지 확인하고 맞춘다.

- [ ] **Step 3: 검증**

Run: `pnpm build`
Expected: 성공

수동 확인 (상위 세션에 `pnpm dev --port 3001` 요청):
1. `/` 접속 → 소개와 로그인 버튼
2. `/?authError=unconfigured` → "잠시 후 다시 찾아와 주세요" (재시도 안내가 아님)
3. `/?authError=state` → "다시 시도해 주세요"
4. 로그인 후 `/` → "내 노래책 보기" 와 "노래책 관리"

- [ ] **Step 4: 커밋**

```bash
git add app/page.jsx app/globals.css
git commit -m "feat: 랜딩 페이지를 서비스 소개와 진입점으로 재작성"
```

---

### Task 8: 잔여 자산 삭제

**Files:**
- Delete: `lib/store.js`, `data/songs.js`
- Modify: `.gitignore` (필요한 경우)
- Create: `scripts/seed-dev.mjs` (선택)

**Interfaces:**
- Consumes: 없음
- Produces: 없음

**파괴적 변경이다.** 삭제 전에 참조가 0건인지 반드시 확인한다.

- [ ] **Step 1: 참조 전수 확인**

```bash
grep -rn "lib/store" app/ lib/ tests/ scripts/ 2>/dev/null
grep -rn "data/songs" app/ lib/ tests/ scripts/ 2>/dev/null
grep -rn "CHANNEL" app/ lib/ tests/ 2>/dev/null
```

**세 명령 모두 결과가 없어야 한다.** 하나라도 나오면 삭제하지 말고 보고한다.
`data/genres.js` 는 계속 쓰이므로 남긴다 — 혼동하지 말 것.

- [ ] **Step 2: 시드 데이터를 개발용 스크립트로 이설 (선택)**

`data/songs.js` 의 60여 곡은 개발 중 화면을 채우는 데 쓸모가 있다. 버리기 아까우면
`scripts/seed-dev.mjs` 로 옮긴다. 필요 없으면 이 Step을 건너뛰고 삭제한다.

```js
// 개발용 시드. 노래책 하나에 예시 곡을 넣는다.
// 사용법: node --env-file=.env scripts/seed-dev.mjs <songbook-slug>
import { findSongbookBySlug } from "../lib/db/songbooks.js";
import { createSongs } from "../lib/db/songs.js";

const SONGS = [
  { title: "너의 모든 순간", artist: "성시경", genre: "발라드", popular: true },
  { title: "사건의 지평선", artist: "윤하", genre: "K-POP", popular: true },
  { title: "밤편지", artist: "아이유", genre: "발라드" },
  { title: "夜に駆ける", artist: "YOASOBI", genre: "J-POP", popular: true },
  { title: "Bohemian Rhapsody", artist: "Queen", genre: "락" },
];

const slug = process.argv[2];
if (!slug) {
  console.error("사용법: node --env-file=.env scripts/seed-dev.mjs <songbook-slug>");
  process.exit(1);
}

const book = await findSongbookBySlug(slug);
if (!book) {
  console.error(`노래책을 찾을 수 없습니다: ${slug}`);
  process.exit(1);
}

const created = await createSongs(book.id, SONGS);
console.log(`${created.length}곡 등록했습니다.`);
```

`@/` 별칭은 Next 밖에서 해석되지 않으므로 상대 경로를 쓴다.

- [ ] **Step 3: 삭제**

```bash
git rm lib/store.js data/songs.js
rm -rf .data
```

- [ ] **Step 4: 검증**

Run: `pnpm build`
Expected: 성공

Run: `pnpm test && pnpm test:db && pnpm test:e2e`
Expected: 69 / 93 / 57

Run: `grep -rn "lib/store\|data/songs" app/ lib/ tests/`
Expected: 결과 없음

- [ ] **Step 5: 커밋**

```bash
git add -A lib/store.js data/songs.js scripts
git commit -m "chore: 파일 기반 저장소와 시드 데이터 제거

lib/store.js 는 Supabase 저장소로 대체됐고 참조가 0건이다.
data/songs.js 의 CHANNEL 상수는 노래책별 소유자 정보로 대체됐다."
```

---

## 완료 기준

- [ ] `pnpm test` 69 passed
- [ ] `pnpm test:db` 93 passed
- [ ] `pnpm test:e2e` 57 passed
- [ ] `pnpm build` 통과, `/[handle]` 이 **dynamic(ƒ)** 으로 표시됨
- [ ] `grep -rn "getDb()" app/` 결과 없음
- [ ] `grep -rn "lib/store\|data/songs" app/ lib/ tests/` 결과 없음
- [ ] `grep -rn "NEXT_PUBLIC_" app/ lib/` 결과 없음
- [ ] 매니저 초대·해제가 **소유자만** 가능하다 — 운영자도 404 (통합 테스트로 검증)
- [ ] 자동 동기화가 **수동 초대 매니저를 지우지 않는다**
- [ ] 초대 토큰 원문이 DB에 없다
- [ ] `/@slug` 가 치지직 채널명·인증 배지를 노출한다
- [ ] 옛 slug가 현재 주소로 리다이렉트된다
- [ ] `git status` 깨끗

## 이 계획 이후

스펙의 "범위 밖" 항목이 남는다 — 운영자 전용 UI, 공개 노래책 탐색, 신청 목록 서버 저장,
스트리머 대시보드, 결제·후원 연동, 주기적 배치 동기화, IP 기반 rate limit, 소유권 양도 UI.

**배포는 계획 2의 Task 7이 무방비 라우트를 제거한 시점부터 가능하다.** 이 계획이 끝나면
시청자 페이지까지 갖춰져 실사용이 가능한 상태가 된다.
