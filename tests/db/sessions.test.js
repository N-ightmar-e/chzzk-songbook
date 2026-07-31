import { it, expect, beforeEach } from "vitest";
import { describeDb, truncateAll } from "../helpers/db.js";
import { getDb } from "@/lib/db/client";
import { upsertUserFromLogin } from "@/lib/db/users";
import { createSession, resolveSession, revokeSession } from "@/lib/db/sessions";

const DAY = 24 * 60 * 60 * 1000;

describeDb("lib/db/sessions", () => {
  let userId;
  beforeEach(async () => {
    await truncateAll(getDb());
    const user = await upsertUserFromLogin({ chzzkChannelId: "u1", chzzkChannelName: "유저" });
    userId = user.id;
  });

  it("세션을 만들고 유저와 함께 되찾는다", async () => {
    const { id } = await createSession({ userId, userAgent: "vitest", ip: null });
    const resolved = await resolveSession(id);
    expect(resolved.user.id).toBe(userId);
    expect(resolved.user.chzzkChannelName).toBe("유저");
  });

  it("세션 수명은 30일이다", async () => {
    const { expiresAt } = await createSession({ userId });
    const diff = new Date(expiresAt).getTime() - Date.now();
    expect(diff).toBeGreaterThan(29 * DAY);
    expect(diff).toBeLessThan(31 * DAY);
  });

  it("폐기된 세션은 되찾을 수 없다", async () => {
    const { id } = await createSession({ userId });
    await revokeSession(id);
    expect(await resolveSession(id)).toBeNull();
  });

  it("만료된 세션은 되찾을 수 없다", async () => {
    const { id } = await createSession({ userId });
    await getDb().from("sessions")
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", id);
    expect(await resolveSession(id)).toBeNull();
  });

  it("없는 세션 ID는 null을 준다", async () => {
    expect(await resolveSession("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("uuid 형식이 아닌 값도 던지지 않고 null을 준다", async () => {
    expect(await resolveSession("이건-uuid가-아님")).toBeNull();
  });

  it("만료가 7일 미만으로 남으면 30일로 연장한다", async () => {
    const { id } = await createSession({ userId });
    const soon = new Date(Date.now() + 3 * DAY).toISOString();
    await getDb().from("sessions").update({ expires_at: soon }).eq("id", id);

    await resolveSession(id);

    const { data } = await getDb().from("sessions").select().eq("id", id).single();
    const diff = new Date(data.expires_at).getTime() - Date.now();
    expect(diff).toBeGreaterThan(29 * DAY);
  });

  it("만료가 7일 이상 남으면 연장하지 않는다", async () => {
    const { id } = await createSession({ userId });
    const { data: before } = await getDb().from("sessions").select().eq("id", id).single();
    await resolveSession(id);
    const { data: after } = await getDb().from("sessions").select().eq("id", id).single();
    expect(after.expires_at).toBe(before.expires_at);
  });
});
