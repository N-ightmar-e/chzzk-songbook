import { it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { describeE2e, startServer } from "../helpers/server.js";
import { cookieForUser } from "../helpers/session.js";
import { truncateAll } from "../helpers/db.js";
import { getDb } from "@/lib/db/client";
import { upsertUserFromLogin } from "@/lib/db/users";
import { createSongbook, changeSlug, updateSongbook } from "@/lib/db/songbooks";
import { createSong } from "@/lib/db/songs";
import { addManager } from "@/lib/db/members";

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

  it("비공개 노래책을 소유자는 본다", async () => {
    // 위 404 테스트만 있으면 "항상 404" 로 만들어도 통과한다.
    // 참여자가 실제로 볼 수 있는지까지 봐야 판정이 뒤집히지 않았음을 안다.
    await updateSongbook(book.id, { isPublic: false });
    const res = await fetch(`${server.baseUrl}/@dutto`, {
      headers: { cookie: await cookieForUser(owner) },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("듀토 노래책");
  });

  it("비공개 노래책을 매니저는 본다", async () => {
    await updateSongbook(book.id, { isPublic: false });
    const manager = await upsertUserFromLogin({ chzzkChannelId: "m", chzzkChannelName: "매니저" });
    await addManager(book.id, manager.id, { source: "invite", invitedBy: owner.id });

    const res = await fetch(`${server.baseUrl}/@dutto`, {
      headers: { cookie: await cookieForUser(manager) },
    });
    expect(res.status).toBe(200);
  });

  it("비공개 노래책은 타인에게 404", async () => {
    await updateSongbook(book.id, { isPublic: false });
    const stranger = await upsertUserFromLogin({ chzzkChannelId: "s", chzzkChannelName: "타인" });
    const res = await fetch(`${server.baseUrl}/@dutto`, {
      headers: { cookie: await cookieForUser(stranger) },
    });
    expect(res.status).toBe(404);
  });
});
