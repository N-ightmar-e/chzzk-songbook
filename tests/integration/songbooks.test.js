import { it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { describeE2e, startServer } from "../helpers/server.js";
import { cookieForUser } from "../helpers/session.js";
import { truncateAll } from "../helpers/db.js";
import { getDb } from "@/lib/db/client";
import { upsertUserFromLogin } from "@/lib/db/users";
import { createSongbook, findSongbookById } from "@/lib/db/songbooks";

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

  it("주소를 바꾼다", async () => {
    const res = await patch(ownerCookie, { slug: "MovedBook" });
    expect(res.status).toBe(200);
    expect((await res.json()).songbook.slug).toBe("movedbook"); // 소문자 정규화
  });

  it("형식이 틀린 주소로 바꾸면 400", async () => {
    expect((await patch(ownerCookie, { slug: "새벽감자" })).status).toBe(400);
  });

  it("남이 쓰는 주소로 바꾸면 409", async () => {
    const other = await upsertUserFromLogin({ chzzkChannelId: "x", chzzkChannelName: "X" });
    await createSongbook({ ownerId: other.id, slug: "taken", title: "남의것" });
    expect((await patch(ownerCookie, { slug: "taken" })).status).toBe(409);
  });

  it("검증에 실패하면 다른 필드도 바뀌지 않는다", async () => {
    // 검증 사이에 쓰기가 끼면 400을 받은 클라이언트가 "실패했다"고 믿는데
    // 실제로는 title 만 바뀐 상태가 된다. 그걸 막는 테스트다.
    const before = await findSongbookById(book.id);
    const res = await patch(ownerCookie, { title: "바뀌면 안 됨", slug: "새벽감자" });
    expect(res.status).toBe(400);

    const after = await findSongbookById(book.id);
    expect(after.title).toBe(before.title);
    expect(after.slug).toBe(before.slug);
  });

  it("바꿀 내용이 없으면 400", async () => {
    expect((await patch(ownerCookie, {})).status).toBe(400);
  });

  it("/api/me 가 intro 와 isPublic 을 준다 — 설정 폼이 실제 상태로 초기화되어야 한다", async () => {
    await fetch(`${server.baseUrl}/api/songbooks/${book.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: server.baseUrl, cookie: ownerCookie },
      body: JSON.stringify({ isPublic: false, intro: "비공개 소개" }),
    });

    const res = await fetch(`${server.baseUrl}/api/me`, { headers: { cookie: ownerCookie } });
    const found = (await res.json()).songbooks.find((b) => b.id === book.id);
    expect(found.isPublic).toBe(false);
    expect(found.intro).toBe("비공개 소개");
  });

  it("/api/me 가 설정 화면이 편집하는 필드를 전부 준다", async () => {
    // PATCH /api/songbooks/[id] 가 받는 설정 필드와 /api/me 가 주는 필드가
    // 어긋나면, 폼이 기본값을 서버로 되돌려 보내 사용자가 끈 설정이 다시 켜진다.
    // 실제로 두 번 발생했다(intro·isPublic, 그리고 chzzkSyncEnabled).
    const res = await fetch(`${server.baseUrl}/api/me`, { headers: { cookie: ownerCookie } });
    const found = (await res.json()).songbooks.find((b) => b.id === book.id);
    for (const key of ["title", "slug", "intro", "isPublic", "chzzkSyncEnabled"]) {
      expect(found).toHaveProperty(key);
    }
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

  // withCookie 를 기본 매개변수(= cookie)로 두면 명시적으로 undefined 를 넘겨도
  // 기본값이 적용돼 "비로그인" 의도가 무시된다(JS 기본 매개변수는 인자 생략과
  // 명시적 undefined 를 구분하지 않는다). rest 파라미터로 인자 전달 여부 자체를
  // 확인해 이 둘을 구분한다.
  function create(body, ...cookieArgs) {
    const withCookie = cookieArgs.length > 0 ? cookieArgs[0] : cookie;
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
