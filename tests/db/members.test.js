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
