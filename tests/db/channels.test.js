import { it, expect, beforeEach, vi, afterEach } from "vitest";
import { describeDb, truncateAll } from "../helpers/db.js";
import { getDb } from "@/lib/db/client";
import { upsertUserFromLogin, findUserByChannelId } from "@/lib/db/users";
import { refreshChannelInfo } from "@/lib/db/channels";

function jsonRes(body) {
  return { ok: true, status: 200, json: async () => body };
}

describeDb("lib/db/channels", () => {
  beforeEach(async () => {
    await truncateAll(getDb());
    process.env.CHZZK_CLIENT_ID = "cid";
    process.env.CHZZK_CLIENT_SECRET = "csecret";
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("치지직에서 받은 이름·이미지·인증마크를 반영한다", async () => {
    await upsertUserFromLogin({ chzzkChannelId: "ch1", chzzkChannelName: "옛이름" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes({
      code: 200,
      content: { data: [{
        channelId: "ch1", channelName: "새이름",
        channelImageUrl: "https://img.example/a.png", verifiedMark: true,
      }] },
    })));

    const updated = await refreshChannelInfo(["ch1"]);
    expect(updated).toBe(1);

    const user = await findUserByChannelId("ch1");
    expect(user.chzzkChannelName).toBe("새이름");
    expect(user.chzzkChannelImage).toBe("https://img.example/a.png");
    expect(user.chzzkVerified).toBe(true);
    expect(user.channelSyncedAt).toBeTruthy();
  });

  it("빈 목록이면 치지직을 호출하지 않는다", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await refreshChannelInfo([])).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });

  it("치지직이 모르는 채널은 조용히 넘어간다", async () => {
    await upsertUserFromLogin({ chzzkChannelId: "ch1", chzzkChannelName: "이름" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes({ code: 200, content: { data: [] } })));
    expect(await refreshChannelInfo(["ch1"])).toBe(0);
  });

  it("lastLoginAt을 건드리지 않는다", async () => {
    const before = await upsertUserFromLogin({ chzzkChannelId: "ch1", chzzkChannelName: "이름" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes({
      code: 200, content: { data: [{ channelId: "ch1", channelName: "새이름" }] },
    })));
    await refreshChannelInfo(["ch1"]);
    const after = await findUserByChannelId("ch1");
    expect(after.lastLoginAt).toBe(before.lastLoginAt);
  });
});
