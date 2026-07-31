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
