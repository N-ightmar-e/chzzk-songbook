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
  beforeEach(async () => { await truncateAll(getDb()); });

  // 인증 없이 열려 있던 라우트들이다. 지켜야 할 성질은 "인증 없이 곡이 만들어지지
  // 않는다"이지 "정확히 404가 돌아온다"가 아니다.
  //
  // 상태코드를 못 박으면 안 되는 이유: /api/songs/bulk 는 형제 동적 라우트
  // /api/songs/[id] 에 id="bulk" 로 매치되고, 그 라우트가 PATCH/DELETE 만 export 하므로
  // Next 가 프레임워크 레벨에서 405 를 준다(우리 코드는 실행되지도 않는다).
  // 405 를 404 로 만들려면 테스트를 만족시키기 위한 빈 핸들러를 넣어야 하는데,
  // 그건 순서가 거꾸로다. 대신 아래처럼 실제 성질을 검사한다.
  async function songCount() {
    const { count } = await getDb().from("songs").select("id", { count: "exact", head: true });
    return count ?? 0;
  }

  it("POST /api/songs 로는 곡이 만들어지지 않는다", async () => {
    const res = await fetch(`${server.baseUrl}/api/songs`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.baseUrl },
      body: JSON.stringify(SONG),
    });
    expect(res.ok).toBe(false);
    expect(await songCount()).toBe(0);
  });

  it("POST /api/songs/bulk 로는 곡이 만들어지지 않는다", async () => {
    const res = await fetch(`${server.baseUrl}/api/songs/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.baseUrl },
      body: JSON.stringify({ songs: [SONG] }),
    });
    expect(res.ok).toBe(false);
    expect(await songCount()).toBe(0);
  });

  it("POST /api/upload 는 더 이상 없다", async () => {
    // 이 경로는 형제 동적 라우트가 없어 그대로 404 다.
    const res = await fetch(`${server.baseUrl}/api/upload`, {
      method: "POST",
      headers: { origin: server.baseUrl },
      body: new FormData(),
    });
    expect(res.status).toBe(404);
  });

  it("옛 라우트 파일이 저장소에 남아있지 않다", async () => {
    // 상태코드는 프레임워크 사정에 따라 변할 수 있다. 파일 부재는 변하지 않는다.
    const fs = await import("node:fs");
    expect(fs.existsSync("app/api/songs/route.js")).toBe(false);
    expect(fs.existsSync("app/api/songs/bulk/route.js")).toBe(false);
    expect(fs.existsSync("app/api/upload/route.js")).toBe(false);
  });
});
