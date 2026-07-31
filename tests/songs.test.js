import { it, expect } from "vitest";
import { validateSongInput } from "@/lib/db/songs";

const VALID = { title: "곡", artist: "가수", genre: "발라드" };

it("javascript: 스킴의 mrUrl 을 거부한다", () => {
  const errors = validateSongInput({ ...VALID, mrUrl: "javascript:alert(1)" });
  expect(errors.mrUrl).toBeTruthy();
});

it("http/https mrUrl 과 빈 값은 통과한다", () => {
  expect(validateSongInput({ ...VALID, mrUrl: "https://youtu.be/abc" }).mrUrl).toBeUndefined();
  expect(validateSongInput({ ...VALID, mrUrl: "" }).mrUrl).toBeUndefined();
});

it("keyLinks 값의 스킴도 검사한다", () => {
  const errors = validateSongInput({ ...VALID, keyLinks: { "2": "javascript:alert(1)" } });
  expect(errors.keyLinks).toBeTruthy();
});
