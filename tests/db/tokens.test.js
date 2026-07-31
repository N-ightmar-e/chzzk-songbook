import { it, expect, beforeEach, vi, afterEach } from "vitest";
import crypto from "node:crypto";
import { describeDb, truncateAll } from "../helpers/db.js";
import { getDb } from "@/lib/db/client";
import { upsertUserFromLogin } from "@/lib/db/users";
import { saveTokens, deleteTokens, getValidAccessToken } from "@/lib/db/tokens";

const DAY = 24 * 60 * 60 * 1000;

describeDb("lib/db/tokens", () => {
  let userId;

  beforeEach(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    await truncateAll(getDb());
    const user = await upsertUserFromLogin({ chzzkChannelId: "owner1", chzzkChannelName: "주인" });
    userId = user.id;
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("저장한 토큰을 그대로 돌려준다", async () => {
    await saveTokens(userId, { accessToken: "AT", refreshToken: "RT", expiresIn: 86400 });
    expect(await getValidAccessToken(userId)).toBe("AT");
  });

  it("DB에는 평문이 저장되지 않는다", async () => {
    await saveTokens(userId, { accessToken: "AT-비밀", refreshToken: "RT-비밀", expiresIn: 86400 });
    const { data } = await getDb().from("user_tokens").select().eq("user_id", userId).single();
    expect(data.access_token_enc).not.toContain("AT-비밀");
    expect(data.refresh_token_enc).not.toContain("RT-비밀");
    expect(data.access_token_enc.startsWith("v1:")).toBe(true);
  });

  it("토큰이 없으면 null을 준다", async () => {
    expect(await getValidAccessToken(userId)).toBeNull();
  });

  it("액세스 토큰이 만료되면 갱신하고 새 값을 준다", async () => {
    await saveTokens(userId, { accessToken: "AT1", refreshToken: "RT1", expiresIn: 86400 });
    // 만료 시각을 과거로 되돌린다
    await getDb().from("user_tokens")
      .update({ access_token_expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("user_id", userId);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ code: 200, content: { accessToken: "AT2", refreshToken: "RT2", tokenType: "Bearer", expiresIn: "86400" } }),
    }));

    expect(await getValidAccessToken(userId)).toBe("AT2");
  });

  it("갱신하면 새 리프레시 토큰이 저장된다 (일회용 함정)", async () => {
    await saveTokens(userId, { accessToken: "AT1", refreshToken: "RT1", expiresIn: 86400 });
    await getDb().from("user_tokens")
      .update({ access_token_expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("user_id", userId);

    const f = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ code: 200, content: { accessToken: "AT2", refreshToken: "RT2", tokenType: "Bearer", expiresIn: "86400" } }),
    });
    vi.stubGlobal("fetch", f);
    await getValidAccessToken(userId);

    // 다시 만료시키고 두 번째 갱신을 시도하면 RT2가 쓰여야 한다.
    await getDb().from("user_tokens")
      .update({ access_token_expires_at: new Date(Date.now() - 1000).toISOString(),
                refresh_lock_until: "1970-01-01T00:00:00Z" })
      .eq("user_id", userId);
    f.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ code: 200, content: { accessToken: "AT3", refreshToken: "RT3", tokenType: "Bearer", expiresIn: "86400" } }),
    });
    await getValidAccessToken(userId);
    expect(JSON.parse(f.mock.calls[1][1].body).refreshToken).toBe("RT2");
  });

  it("리프레시 토큰이 만료되면 행을 지우고 null을 준다", async () => {
    await saveTokens(userId, { accessToken: "AT1", refreshToken: "RT1", expiresIn: 86400 });
    await getDb().from("user_tokens").update({
      access_token_expires_at: new Date(Date.now() - 1000).toISOString(),
      refresh_token_expires_at: new Date(Date.now() - 1000).toISOString(),
    }).eq("user_id", userId);

    expect(await getValidAccessToken(userId)).toBeNull();
    const { data } = await getDb().from("user_tokens").select().eq("user_id", userId).maybeSingle();
    expect(data).toBeNull();
  });

  it("동시 갱신 2건이 토큰을 잃지 않는다", async () => {
    await saveTokens(userId, { accessToken: "AT1", refreshToken: "RT1", expiresIn: 86400 });
    await getDb().from("user_tokens")
      .update({ access_token_expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("user_id", userId);

    let calls = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 50));
      return { ok: true, status: 200,
        json: async () => ({ code: 200, content: { accessToken: `AT${calls + 1}`, refreshToken: `RT${calls + 1}`, tokenType: "Bearer", expiresIn: "86400" } }) };
    }));

    const results = await Promise.allSettled([
      getValidAccessToken(userId),
      getValidAccessToken(userId),
    ]);
    // 치지직 갱신 호출은 정확히 한 번만 나가야 한다.
    expect(calls).toBe(1);
    // 최소 한쪽은 성공하고, 저장된 토큰은 유효해야 한다.
    expect(results.some((r) => r.status === "fulfilled" && r.value)).toBe(true);
    const { data } = await getDb().from("user_tokens").select().eq("user_id", userId).single();
    expect(data.refresh_token_enc).toBeTruthy();
  });

  it("HTTP 200 + 봉투 code 401 이어도 죽은 토큰으로 보고 행을 지운다", async () => {
    await saveTokens(userId, { accessToken: "AT1", refreshToken: "RT1", expiresIn: 86400 });
    await getDb().from("user_tokens")
      .update({ access_token_expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("user_id", userId);

    // 치지직이 HTTP는 200으로 주고 봉투 안에만 401을 담는 경우.
    // err.status는 200이므로 status만 검사하면 이 케이스를 놓친다.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ code: 401, message: "INVALID_TOKEN" }),
    }));

    expect(await getValidAccessToken(userId)).toBeNull();
    const { data } = await getDb().from("user_tokens").select().eq("user_id", userId).maybeSingle();
    expect(data).toBeNull();
  });

  it("deleteTokens는 행을 지운다", async () => {
    await saveTokens(userId, { accessToken: "AT", refreshToken: "RT", expiresIn: 86400 });
    await deleteTokens(userId);
    expect(await getValidAccessToken(userId)).toBeNull();
  });

  it("리프레시 토큰 만료는 30일로 잡는다", async () => {
    await saveTokens(userId, { accessToken: "AT", refreshToken: "RT", expiresIn: 86400 });
    const { data } = await getDb().from("user_tokens").select().eq("user_id", userId).single();
    const diff = new Date(data.refresh_token_expires_at).getTime() - Date.now();
    expect(diff).toBeGreaterThan(29 * DAY);
    expect(diff).toBeLessThan(31 * DAY);
  });
});
