import { describe, it, expect } from "vitest";
import { normalizeSlug, validateSlug, RESERVED_SLUGS } from "@/lib/slug";
import { isUuid } from "@/lib/uuid";

describe("lib/slug", () => {
  it("대문자를 소문자로 정규화한다", () => {
    expect(normalizeSlug("Dutto")).toBe("dutto");
  });

  it("앞뒤 공백을 제거한다", () => {
    expect(normalizeSlug("  dutto  ")).toBe("dutto");
  });

  it("null·undefined를 빈 문자열로 다룬다", () => {
    expect(normalizeSlug(null)).toBe("");
    expect(normalizeSlug(undefined)).toBe("");
  });

  it("올바른 slug는 null을 준다", () => {
    expect(validateSlug("dutto")).toBeNull();
    expect(validateSlug("a1")).toBeNull();
    expect(validateSlug("new-jeans_2")).toBeNull();
  });

  it("2자 미만은 거부한다", () => {
    expect(validateSlug("a")).toMatch(/2/);
  });

  it("30자 초과는 거부한다", () => {
    expect(validateSlug("a".repeat(31))).toMatch(/30/);
  });

  it("숫자·영문이 아닌 첫 글자를 거부한다", () => {
    expect(validateSlug("-abc")).toBeTruthy();
    expect(validateSlug("_abc")).toBeTruthy();
  });

  it("대문자를 거부한다 (정규화 전 값이 들어온 경우)", () => {
    expect(validateSlug("Dutto")).toBeTruthy();
  });

  it("한글·유니코드를 거부한다", () => {
    // 셀프서비스 선착순이라 시각적으로 동일한 문자로 사칭이 가능하다.
    expect(validateSlug("새벽감자")).toBeTruthy();
    expect(validateSlug("duttо")).toBeTruthy(); // 키릴 о
  });

  it("공백·특수문자를 거부한다", () => {
    expect(validateSlug("my book")).toBeTruthy();
    expect(validateSlug("my.book")).toBeTruthy();
    expect(validateSlug("my/book")).toBeTruthy();
  });

  it("예약어를 거부한다", () => {
    for (const reserved of ["admin", "official", "chzzk", "naver", "api"]) {
      expect(validateSlug(reserved)).toMatch(/사용할 수 없/);
    }
  });

  it("예약어 목록이 사칭 방지 대상을 담는다", () => {
    expect(RESERVED_SLUGS.has("chzzk")).toBe(true);
    expect(RESERVED_SLUGS.has("staff")).toBe(true);
  });
});

describe("lib/uuid", () => {
  it("uuid를 판별한다", () => {
    expect(isUuid("11111111-2222-3333-4444-555555555555")).toBe(true);
  });
  it("uuid가 아닌 값을 거부한다", () => {
    expect(isUuid("아님")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
