import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { requireEnv, optionalEnv, assertProductionEnv } from "@/lib/env";

describe("lib/env", () => {
  const saved = { ...process.env };
  beforeEach(() => { process.env = { ...saved }; });
  afterEach(() => { process.env = { ...saved }; });

  it("requireEnv는 값이 있으면 그 값을 준다", () => {
    process.env.SOME_KEY = "hello";
    expect(requireEnv("SOME_KEY")).toBe("hello");
  });

  it("requireEnv는 값이 없으면 변수 이름을 담아 throw한다", () => {
    delete process.env.SOME_KEY;
    expect(() => requireEnv("SOME_KEY")).toThrow(/SOME_KEY/);
  });

  it("requireEnv는 빈 문자열을 없는 것으로 취급한다", () => {
    process.env.SOME_KEY = "   ";
    expect(() => requireEnv("SOME_KEY")).toThrow(/SOME_KEY/);
  });

  it("optionalEnv는 없으면 undefined를 준다", () => {
    delete process.env.SOME_KEY;
    expect(optionalEnv("SOME_KEY")).toBeUndefined();
  });

  it("프로덕션에서 SESSION_SECRET이 없으면 throw한다", () => {
    process.env.NODE_ENV = "production";
    process.env.TOKEN_ENCRYPTION_KEY = "x";
    process.env.SUPABASE_URL = "x";
    process.env.SUPABASE_SECRET_KEY = "x";
    delete process.env.SESSION_SECRET;
    expect(() => assertProductionEnv()).toThrow(/SESSION_SECRET/);
  });

  it("프로덕션에서 TOKEN_ENCRYPTION_KEY가 없으면 throw한다", () => {
    process.env.NODE_ENV = "production";
    process.env.SESSION_SECRET = "x";
    process.env.SUPABASE_URL = "x";
    process.env.SUPABASE_SECRET_KEY = "x";
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => assertProductionEnv()).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it("개발 환경에서는 assertProductionEnv가 통과한다", () => {
    process.env.NODE_ENV = "development";
    delete process.env.SESSION_SECRET;
    expect(() => assertProductionEnv()).not.toThrow();
  });
});
