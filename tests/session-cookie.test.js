import { describe, it, expect, beforeEach } from "vitest";
import { signSessionId, verifySessionCookie } from "@/lib/session";

describe("세션 쿠키 서명", () => {
  beforeEach(() => { process.env.SESSION_SECRET = "test-secret-value"; });

  it("서명한 값을 검증하면 원래 id가 나온다", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    expect(verifySessionCookie(signSessionId(id))).toBe(id);
  });

  it("서명이 위조되면 null을 준다", () => {
    const signed = signSessionId("abc");
    const [body] = signed.split(".");
    expect(verifySessionCookie(`${body}.forgedmac`)).toBeNull();
  });

  it("본문이 바뀌면 null을 준다", () => {
    const signed = signSessionId("abc");
    const [, mac] = signed.split(".");
    expect(verifySessionCookie(`${Buffer.from("evil").toString("base64url")}.${mac}`)).toBeNull();
  });

  it("다른 키로 서명한 값은 거부한다", () => {
    const signed = signSessionId("abc");
    process.env.SESSION_SECRET = "another-secret";
    expect(verifySessionCookie(signed)).toBeNull();
  });

  it("형식이 깨진 값은 null을 준다", () => {
    expect(verifySessionCookie("")).toBeNull();
    expect(verifySessionCookie(null)).toBeNull();
    expect(verifySessionCookie("점이없음")).toBeNull();
  });

  it("프로덕션에서 SESSION_SECRET이 없으면 throw한다", () => {
    process.env.NODE_ENV = "production";
    delete process.env.SESSION_SECRET;
    expect(() => signSessionId("abc")).toThrow(/SESSION_SECRET/);
    process.env.NODE_ENV = "test";
  });
});
