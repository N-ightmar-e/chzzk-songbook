import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  refreshAccessToken, revokeToken, fetchChannels, fetchStreamingRoles,
} from "@/lib/chzzk";

function jsonRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("치지직 API 확장", () => {
  beforeEach(() => {
    process.env.CHZZK_CLIENT_ID = "cid";
    process.env.CHZZK_CLIENT_SECRET = "csecret";
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("refreshAccessToken은 grantType refresh_token으로 보낸다", async () => {
    const f = vi.fn().mockResolvedValue(jsonRes(200, {
      code: 200,
      content: { accessToken: "AT2", refreshToken: "RT2", tokenType: "Bearer", expiresIn: "86400" },
    }));
    vi.stubGlobal("fetch", f);
    const token = await refreshAccessToken("RT1");
    expect(JSON.parse(f.mock.calls[0][1].body).grantType).toBe("refresh_token");
    expect(JSON.parse(f.mock.calls[0][1].body).refreshToken).toBe("RT1");
    // 리프레시 토큰은 일회용이므로 새 값이 반드시 나와야 한다.
    expect(token.refreshToken).toBe("RT2");
  });

  it("refreshAccessToken 응답에 새 refreshToken이 없으면 실패한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(200, {
      code: 200, content: { accessToken: "AT2", tokenType: "Bearer", expiresIn: "86400" },
    })));
    await expect(refreshAccessToken("RT1")).rejects.toThrow(/refreshToken/);
  });

  it("revokeToken은 clientId/secret/token을 보낸다", async () => {
    const f = vi.fn().mockResolvedValue(jsonRes(200, { code: 200, content: null }));
    vi.stubGlobal("fetch", f);
    await revokeToken({ token: "AT", tokenTypeHint: "access_token" });
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body).toMatchObject({ clientId: "cid", clientSecret: "csecret", token: "AT", tokenTypeHint: "access_token" });
  });

  it("fetchChannels는 Client 인증 헤더를 쓴다 (Authorization 아님)", async () => {
    const f = vi.fn().mockResolvedValue(jsonRes(200, {
      code: 200, content: { data: [{ channelId: "a", channelName: "가", channelImageUrl: "u", verifiedMark: true, followerCount: 1 }] },
    }));
    vi.stubGlobal("fetch", f);
    await fetchChannels(["a"]);
    const headers = f.mock.calls[0][1].headers;
    expect(headers["Client-Id"]).toBe("cid");
    expect(headers["Client-Secret"]).toBe("csecret");
    expect(headers.Authorization).toBeUndefined();
  });

  it("fetchChannels는 20개를 넘으면 나눠서 호출한다", async () => {
    const f = vi.fn().mockResolvedValue(jsonRes(200, { code: 200, content: { data: [] } }));
    vi.stubGlobal("fetch", f);
    await fetchChannels(Array.from({ length: 45 }, (_, i) => `c${i}`));
    expect(f).toHaveBeenCalledTimes(3); // 20 + 20 + 5
  });

  it("fetchChannels는 빈 배열이면 호출하지 않는다", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await fetchChannels([])).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it("fetchChannels는 여러 호출 결과를 합쳐 준다", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(jsonRes(200, { code: 200, content: { data: [{ channelId: "a", channelName: "가" }] } }))
      .mockResolvedValueOnce(jsonRes(200, { code: 200, content: { data: [{ channelId: "b", channelName: "나" }] } }));
    vi.stubGlobal("fetch", f);
    const rows = await fetchChannels(Array.from({ length: 21 }, (_, i) => `c${i}`));
    expect(rows.map((r) => r.channelId)).toEqual(["a", "b"]);
  });

  it("fetchStreamingRoles는 Access Token 인증을 쓰고 목록을 준다", async () => {
    const f = vi.fn().mockResolvedValue(jsonRes(200, {
      code: 200,
      content: { data: [
        { managerChannelId: "m1", managerChannelName: "매니저", userRole: "STREAMING_CHANNEL_MANAGER" },
        { managerChannelId: "o1", managerChannelName: "주인", userRole: "STREAMING_CHANNEL_OWNER" },
      ] },
    }));
    vi.stubGlobal("fetch", f);
    const roles = await fetchStreamingRoles("AT");
    expect(f.mock.calls[0][1].headers.Authorization).toBe("Bearer AT");
    expect(roles).toHaveLength(2); // 필터링은 호출자(계획 3)의 책임
  });

  it("fetchStreamingRoles는 401을 status 401로 전달한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(401, { code: 401, message: "INVALID_TOKEN" })));
    await expect(fetchStreamingRoles("AT")).rejects.toMatchObject({ status: 401 });
  });

  it("data가 없으면 빈 배열을 준다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes(200, { code: 200, content: {} })));
    expect(await fetchStreamingRoles("AT")).toEqual([]);
  });
});
