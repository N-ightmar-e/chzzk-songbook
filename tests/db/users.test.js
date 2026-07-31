import { it, expect, beforeEach } from "vitest";
import { describeDb, truncateAll } from "../helpers/db.js";
import { getDb } from "@/lib/db/client";
import {
  upsertUserFromLogin, ensurePlaceholderUsers, findUserById, findUserByChannelId,
} from "@/lib/db/users";

describeDb("lib/db/users", () => {
  beforeEach(async () => { await truncateAll(getDb()); });

  it("첫 로그인이면 유저를 만들고 lastLoginAt을 채운다", async () => {
    const user = await upsertUserFromLogin({ chzzkChannelId: "ch1", chzzkChannelName: "새벽감자" });
    expect(user.id).toBeTruthy();
    expect(user.chzzkChannelName).toBe("새벽감자");
    expect(user.role).toBe("user");
    expect(user.lastLoginAt).toBeTruthy();
  });

  it("재로그인이면 같은 행을 쓰고 닉네임 변경을 반영한다", async () => {
    const first = await upsertUserFromLogin({ chzzkChannelId: "ch1", chzzkChannelName: "옛이름" });
    const second = await upsertUserFromLogin({ chzzkChannelId: "ch1", chzzkChannelName: "새이름" });
    expect(second.id).toBe(first.id);
    expect(second.chzzkChannelName).toBe("새이름");
  });

  it("placeholder 유저는 lastLoginAt이 null이다", async () => {
    const [user] = await ensurePlaceholderUsers([
      { channelId: "ch2", channelName: "매니저", channelImageUrl: "http://img", verifiedMark: true },
    ]);
    expect(user.lastLoginAt).toBeNull();
    expect(user.chzzkVerified).toBe(true);
    expect(user.chzzkChannelImage).toBe("http://img");
  });

  it("placeholder 유저가 실제로 로그인하면 같은 행에 연결된다", async () => {
    const [placeholder] = await ensurePlaceholderUsers([{ channelId: "ch3", channelName: "매니저" }]);
    const loggedIn = await upsertUserFromLogin({ chzzkChannelId: "ch3", chzzkChannelName: "매니저" });
    expect(loggedIn.id).toBe(placeholder.id);
    expect(loggedIn.lastLoginAt).toBeTruthy();
  });

  it("ensurePlaceholderUsers는 기존 유저의 lastLoginAt을 지우지 않는다", async () => {
    const loggedIn = await upsertUserFromLogin({ chzzkChannelId: "ch4", chzzkChannelName: "주인" });
    const [again] = await ensurePlaceholderUsers([{ channelId: "ch4", channelName: "주인" }]);
    expect(again.id).toBe(loggedIn.id);
    expect(again.lastLoginAt).toBe(loggedIn.lastLoginAt);
  });

  it("ensurePlaceholderUsers는 빈 배열이면 빈 배열을 준다", async () => {
    expect(await ensurePlaceholderUsers([])).toEqual([]);
  });

  it("findUserById / findUserByChannelId는 없으면 null을 준다", async () => {
    expect(await findUserById("00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(await findUserByChannelId("없는채널")).toBeNull();
  });
});
