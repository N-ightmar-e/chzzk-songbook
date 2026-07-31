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
