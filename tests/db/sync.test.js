import { it, expect, beforeEach, vi, afterEach } from "vitest";
import { describeDb, truncateAll } from "../helpers/db.js";
import { getDb } from "@/lib/db/client";
import { upsertUserFromLogin } from "@/lib/db/users";
import { createSongbook, updateSongbook } from "@/lib/db/songbooks";
import { addManager, listMembers } from "@/lib/db/members";
import { saveTokens } from "@/lib/db/tokens";
import { syncChzzkManagers } from "@/lib/sync";

function chzzkResponses({ roles = [], channels = [] }) {
  return vi.fn().mockImplementation(async (url) => {
    const body = String(url).includes("streaming-roles")
      ? { code: 200, content: { data: roles } }
      : { code: 200, content: { data: channels } };
    return { ok: true, status: 200, json: async () => body };
  });
}

describeDb("lib/sync", () => {
  let owner, book;

  beforeEach(async () => {
    await truncateAll(getDb());
    process.env.CHZZK_CLIENT_ID = "cid";
    process.env.CHZZK_CLIENT_SECRET = "csecret";
    owner = await upsertUserFromLogin({ chzzkChannelId: "owner-ch", chzzkChannelName: "주인" });
    book = await createSongbook({ ownerId: owner.id, slug: "book", title: "노래책" });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("토큰이 없으면 건너뛴다", async () => {
    const result = await syncChzzkManagers(book.id, owner.id);
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("no-token");
  });

  it("동기화가 꺼져 있으면 건너뛴다", async () => {
    await saveTokens(owner.id, { accessToken: "AT", refreshToken: "RT", expiresIn: 86400 });
    await updateSongbook(book.id, { chzzkSyncEnabled: false });
    const result = await syncChzzkManagers(book.id, owner.id);
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("disabled");
  });

  it("관리자를 매니저로 등록한다", async () => {
    await saveTokens(owner.id, { accessToken: "AT", refreshToken: "RT", expiresIn: 86400 });
    vi.stubGlobal("fetch", chzzkResponses({
      roles: [
        { managerChannelId: "m1", managerChannelName: "매니저1", userRole: "STREAMING_CHANNEL_MANAGER" },
        { managerChannelId: "owner-ch", managerChannelName: "주인", userRole: "STREAMING_CHANNEL_OWNER" },
      ],
      channels: [{ channelId: "m1", channelName: "매니저1", verifiedMark: false }],
    }));

    const result = await syncChzzkManagers(book.id, owner.id);
    expect(result.status).toBe("synced");
    expect(result.added).toBe(1);

    const members = await listMembers(book.id);
    // STREAMING_CHANNEL_OWNER 는 제외된다 — 소유자는 owner_id 로 표현된다.
    expect(members).toHaveLength(1);
    expect(members[0].user.chzzkChannelId).toBe("m1");
    expect(members[0].source).toBe("chzzk_sync");
  });

  it("수동 초대 매니저를 지우지 않는다", async () => {
    const invited = await upsertUserFromLogin({ chzzkChannelId: "inv", chzzkChannelName: "초대됨" });
    await addManager(book.id, invited.id, { source: "invite", invitedBy: owner.id });
    await saveTokens(owner.id, { accessToken: "AT", refreshToken: "RT", expiresIn: 86400 });

    vi.stubGlobal("fetch", chzzkResponses({ roles: [], channels: [] }));
    await syncChzzkManagers(book.id, owner.id);

    const members = await listMembers(book.id);
    expect(members).toHaveLength(1);
    expect(members[0].source).toBe("invite");
  });

  it("쿨다운 안에는 다시 부르지 않는다", async () => {
    await saveTokens(owner.id, { accessToken: "AT", refreshToken: "RT", expiresIn: 86400 });
    const f = chzzkResponses({ roles: [], channels: [] });
    vi.stubGlobal("fetch", f);

    await syncChzzkManagers(book.id, owner.id);
    const callsAfterFirst = f.mock.calls.length;
    const second = await syncChzzkManagers(book.id, owner.id);

    expect(second.status).toBe("skipped");
    expect(second.reason).toBe("cooldown");
    expect(f.mock.calls.length).toBe(callsAfterFirst);
  });

  it("치지직 오류는 failed로 돌려주고 던지지 않는다", async () => {
    await saveTokens(owner.id, { accessToken: "AT", refreshToken: "RT", expiresIn: 86400 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 500, json: async () => ({ code: 500, message: "INTERNAL_SERVER_ERROR" }),
    }));

    const result = await syncChzzkManagers(book.id, owner.id);
    expect(result.status).toBe("failed");
  });
});
