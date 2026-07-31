import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { exchangeCodeForToken, fetchMe, ChzzkApiError } from "@/lib/chzzk";

function mockFetch(status, body) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe("치지직 공통 응답 봉투", () => {
  beforeEach(() => {
    process.env.CHZZK_CLIENT_ID = "cid";
    process.env.CHZZK_CLIENT_SECRET = "csecret";
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("content 봉투를 벗겨 토큰을 준다", async () => {
    vi.stubGlobal("fetch", mockFetch(200, {
      code: 200, message: null,
      content: { accessToken: "AT", refreshToken: "RT", tokenType: "Bearer", expiresIn: "86400" },
    }));
    const token = await exchangeCodeForToken({ code: "c", state: "s" });
    expect(token.accessToken).toBe("AT");
    expect(token.refreshToken).toBe("RT");
    expect(token.expiresIn).toBe(86400); // 숫자로 정규화
  });

  it("봉투 없이 평평하게 와도 수용한다", async () => {
    vi.stubGlobal("fetch", mockFetch(200, {
      accessToken: "AT", refreshToken: "RT", tokenType: "Bearer", expiresIn: "86400",
    }));
    const token = await exchangeCodeForToken({ code: "c", state: "s" });
    expect(token.accessToken).toBe("AT");
  });

  it("code가 200이 아니면 ChzzkApiError를 던진다", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { code: 401, message: "INVALID_CLIENT" }));
    await expect(exchangeCodeForToken({ code: "c", state: "s" }))
      .rejects.toThrow(ChzzkApiError);
  });

  it("기대 필드가 없으면 undefined를 흘리지 않고 실패한다", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { code: 200, message: null, content: {} }));
    await expect(exchangeCodeForToken({ code: "c", state: "s" }))
      .rejects.toThrow(/accessToken/);
  });

  it("HTTP 오류는 상태코드를 담아 던진다", async () => {
    vi.stubGlobal("fetch", mockFetch(500, { code: 500, message: "INTERNAL_SERVER_ERROR" }));
    await expect(exchangeCodeForToken({ code: "c", state: "s" }))
      .rejects.toMatchObject({ status: 500 });
  });

  it("fetchMe는 channelId와 channelName을 준다", async () => {
    vi.stubGlobal("fetch", mockFetch(200, {
      code: 200, message: null,
      content: { channelId: "abc123", channelName: "새벽감자" },
    }));
    const me = await fetchMe("AT");
    expect(me).toEqual({ channelId: "abc123", channelName: "새벽감자" });
  });

  it("fetchMe에 channelId가 없으면 실패한다", async () => {
    vi.stubGlobal("fetch", mockFetch(200, {
      code: 200, message: null, content: { channelName: "새벽감자" },
    }));
    await expect(fetchMe("AT")).rejects.toThrow(/channelId/);
  });

  it("fetchMe는 Bearer 접두사와 공백을 정확히 붙인다", async () => {
    const f = mockFetch(200, { code: 200, content: { channelId: "a", channelName: "b" } });
    vi.stubGlobal("fetch", f);
    await fetchMe("AT");
    expect(f.mock.calls[0][1].headers.Authorization).toBe("Bearer AT");
  });
});
