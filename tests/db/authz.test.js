import { it, expect, beforeEach, vi, afterEach } from "vitest";
import { describeDb, truncateAll } from "../helpers/db.js";
import { getDb } from "@/lib/db/client";
import { upsertUserFromLogin } from "@/lib/db/users";
import { accessLevel } from "@/lib/authz";

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
});
