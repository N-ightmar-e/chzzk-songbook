import { describe, it, expect } from "vitest";

describe("테스트 환경", () => {
  it("경로 별칭 @/ 가 동작한다", async () => {
    const mod = await import("@/data/genres");
    expect(mod).toBeTruthy();
  });
});
