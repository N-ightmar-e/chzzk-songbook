import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

const KEY = crypto.randomBytes(32).toString("base64");

describe("lib/crypto", () => {
  beforeEach(() => { process.env.TOKEN_ENCRYPTION_KEY = KEY; });

  it("암호화한 값을 그대로 복호화한다", () => {
    const secret = "FFok65zQFQVcFvH2eJ7SS7SBFlTXt0EZ10L5abcdefgh";
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("한글과 긴 문자열도 왕복한다", () => {
    const secret = "리프레시토큰-".repeat(50);
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("v1: 접두사와 4개 구획으로 저장된다", () => {
    const parts = encryptSecret("hello").split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
  });

  it("같은 평문도 매번 다른 암호문이 된다 (IV 랜덤)", () => {
    expect(encryptSecret("hello")).not.toBe(encryptSecret("hello"));
  });

  it("ciphertext가 변조되면 복호화가 실패한다", () => {
    const [v, iv, tag, ct] = encryptSecret("hello").split(":");
    const broken = Buffer.from(ct, "base64");
    broken[0] = broken[0] ^ 0xff;
    expect(() => decryptSecret(`${v}:${iv}:${tag}:${broken.toString("base64")}`)).toThrow();
  });

  it("인증 태그가 변조되면 복호화가 실패한다", () => {
    const [v, iv, tag, ct] = encryptSecret("hello").split(":");
    const broken = Buffer.from(tag, "base64");
    broken[0] = broken[0] ^ 0xff;
    expect(() => decryptSecret(`${v}:${iv}:${broken.toString("base64")}:${ct}`)).toThrow();
  });

  it("다른 키로는 복호화되지 않는다", () => {
    const stored = encryptSecret("hello");
    process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    expect(() => decryptSecret(stored)).toThrow();
  });

  it("알 수 없는 버전 접두사는 거부한다", () => {
    const stored = encryptSecret("hello").replace(/^v1:/, "v9:");
    expect(() => decryptSecret(stored)).toThrow(/형식/);
  });

  it("형식이 깨진 값은 거부한다", () => {
    expect(() => decryptSecret("아무거나")).toThrow(/형식/);
  });

  it("키가 32바이트가 아니면 거부한다", () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(16).toString("base64");
    expect(() => encryptSecret("hello")).toThrow(/32바이트/);
  });
});
