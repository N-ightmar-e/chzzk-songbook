import { it, expect, beforeEach, vi, afterEach } from "vitest";
import { describeDb, truncateAll } from "../helpers/db.js";
import { getDb } from "@/lib/db/client";
import { upsertUserFromLogin } from "@/lib/db/users";
import { accessLevel, requireSongbookAccess, AuthzError } from "@/lib/authz";

async function makeUser(channelId, name, role = "user") {
  const user = await upsertUserFromLogin({ chzzkChannelId: channelId, chzzkChannelName: name });
  if (role !== "user") {
    await getDb().from("users").update({ role }).eq("id", user.id);
    return { ...user, role };
  }
  return user;
}

async function makeSongbook(ownerId, slug = "book1") {
  const { data } = await getDb().from("songbooks")
    .insert({ owner_id: ownerId, slug, title: "노래책" }).select().single();
  return data;
}

describeDb("lib/authz", () => {
  let owner, manager, stranger, operator, songbook;

  beforeEach(async () => {
    await truncateAll(getDb());
    owner = await makeUser("owner", "주인");
    manager = await makeUser("manager", "매니저");
    stranger = await makeUser("stranger", "타인");
    operator = await makeUser("operator", "운영자", "operator");
    songbook = await makeSongbook(owner.id);
    await getDb().from("songbook_members").insert({
      songbook_id: songbook.id, user_id: manager.id, role: "manager", source: "invite",
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("소유자는 owner", async () => {
    expect(await accessLevel(owner, songbook.id)).toBe("owner");
  });

  it("매니저는 manager", async () => {
    expect(await accessLevel(manager, songbook.id)).toBe("manager");
  });

  it("타인은 null", async () => {
    expect(await accessLevel(stranger, songbook.id)).toBeNull();
  });

  it("운영자는 operator", async () => {
    expect(await accessLevel(operator, songbook.id)).toBe("operator");
  });

  it("비로그인(null 유저)은 null", async () => {
    expect(await accessLevel(null, songbook.id)).toBeNull();
  });

  it("없는 노래책은 null", async () => {
    expect(await accessLevel(owner, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("소유자가 운영자를 겸하면 owner가 우선한다", async () => {
    await getDb().from("users").update({ role: "operator" }).eq("id", owner.id);
    expect(await accessLevel({ ...owner, role: "operator" }, songbook.id)).toBe("owner");
  });

  // --- requireSongbookAccess ---
  // 위 beforeEach의 픽스처를 그대로 쓴다. user를 명시적으로 넘겨
  // 쿠키·세션 없이 인가 판정만 검증한다.
  async function attempt(user, min) {
    try {
      const result = await requireSongbookAccess(songbook.id, { min, user });
      return { ok: true, level: result.level };
    } catch (err) {
      return { ok: false, status: err.status, isAuthz: err instanceof AuthzError };
    }
  }

  it("비로그인은 401", async () => {
    expect(await attempt(null, "manager")).toMatchObject({ ok: false, status: 401 });
  });

  it("타인은 404 (403이 아니다 — 존재를 누설하면 안 된다)", async () => {
    expect(await attempt(stranger, "manager")).toMatchObject({ ok: false, status: 404 });
  });

  it("min manager: 매니저·소유자·운영자 통과", async () => {
    expect(await attempt(manager, "manager")).toMatchObject({ ok: true });
    expect(await attempt(owner, "manager")).toMatchObject({ ok: true });
    expect(await attempt(operator, "manager")).toMatchObject({ ok: true });
  });

  it("min owner: 소유자·운영자 통과, 매니저 404", async () => {
    expect(await attempt(owner, "owner")).toMatchObject({ ok: true });
    expect(await attempt(operator, "owner")).toMatchObject({ ok: true });
    expect(await attempt(manager, "owner")).toMatchObject({ ok: false, status: 404 });
  });

  it("min ownerOnly: 소유자만 통과, 운영자도 404", async () => {
    expect(await attempt(owner, "ownerOnly")).toMatchObject({ ok: true });
    expect(await attempt(operator, "ownerOnly")).toMatchObject({ ok: false, status: 404 });
    expect(await attempt(manager, "ownerOnly")).toMatchObject({ ok: false, status: 404 });
  });
});
