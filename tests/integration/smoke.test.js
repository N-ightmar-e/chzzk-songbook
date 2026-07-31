import { it, expect, beforeAll, afterAll } from "vitest";
import { describeE2e, startServer } from "../helpers/server.js";
import { cookieForUser } from "../helpers/session.js";
import { truncateAll } from "../helpers/db.js";
import { getDb } from "@/lib/db/client";
import { upsertUserFromLogin } from "@/lib/db/users";
import { SESSION_COOKIE_NAME } from "@/lib/session";

describeE2e("통합 테스트 하네스", () => {
  let server;

  beforeAll(async () => { server = await startServer(); });
  afterAll(() => { server?.stop(); });

  it("서버가 뜨고 /api/me 가 응답한다", async () => {
    const res = await fetch(`${server.baseUrl}/api/me`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toBeNull();
  });

  it("실제 세션 쿠키로 로그인 상태가 된다", async () => {
    await truncateAll(getDb());
    const user = await upsertUserFromLogin({
      chzzkChannelId: "e2e-user", chzzkChannelName: "통합테스트",
    });
    const cookie = await cookieForUser(user);

    const res = await fetch(`${server.baseUrl}/api/me`, { headers: { cookie } });
    const body = await res.json();
    expect(body.user?.channelName).toBe("통합테스트");
  });

  it("위조된 쿠키는 비로그인으로 처리된다", async () => {
    const res = await fetch(`${server.baseUrl}/api/me`, {
      // 헤더 값은 ByteString(코드포인트 <= 255)이어야 한다. 한글을 넣으면 fetch가
      // 요청을 보내기도 전에 TypeError를 던져 서버 동작을 검증하지 못한다.
      headers: { cookie: `${SESSION_COOKIE_NAME}=forged.value` },
    });
    const body = await res.json();
    expect(body.user).toBeNull();
  });
});
