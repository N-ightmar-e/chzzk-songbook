import { describe, it, expect } from "vitest";
import { createInviteToken, hashInviteToken } from "@/lib/invite";

describe("lib/invite", () => {
  it("토큰과 해시를 만든다", () => {
    const { token, tokenHash } = createInviteToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("토큰과 해시가 다르다", () => {
    // 해시가 토큰과 같으면 DB 유출 시 초대 링크를 그대로 재사용할 수 있다.
    const { token, tokenHash } = createInviteToken();
    expect(tokenHash).not.toBe(token);
  });

  it("같은 토큰은 같은 해시를 준다", () => {
    const { token, tokenHash } = createInviteToken();
    expect(hashInviteToken(token)).toBe(tokenHash);
  });

  it("매번 다른 토큰을 만든다", () => {
    expect(createInviteToken().token).not.toBe(createInviteToken().token);
  });

  it("빈 값·null도 던지지 않고 해시한다", () => {
    expect(hashInviteToken("")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(null)).toMatch(/^[0-9a-f]{64}$/);
  });
});
