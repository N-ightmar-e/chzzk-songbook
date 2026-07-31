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
