import { it, expect } from "vitest";
import { includesIntegrationTests } from "./helpers/global-server.js";

// argv 는 실측값이다. 판정을 틀리면 두 방향 모두 아프다 —
// 안 띄우면 e2e 가 skip 이 아니라 서버 부재로 실패하고,
// 헛되이 띄우면 모든 실행이 5초씩 느려진다.
function argv(...args) {
  return ["node", "vitest", ...args];
}

it("pnpm test:e2e 는 서버가 필요하다", () => {
  expect(includesIntegrationTests(argv("run", "tests/integration"))).toBe(true);
});

it("pnpm test:db 는 서버가 필요 없다", () => {
  expect(includesIntegrationTests(argv("run", "tests/db"))).toBe(false);
});

it("pnpm test 는 서버가 필요 없다 — --exclude 값을 경로로 오인하면 안 된다", () => {
  expect(
    includesIntegrationTests(
      argv("run", "--exclude", "'tests/db/**'", "--exclude", "'tests/integration/**'"),
    ),
  ).toBe(false);
});

it("pnpm test:watch 는 서버가 필요하다 — 경로 인자가 없어도 통합 테스트가 돈다", () => {
  expect(includesIntegrationTests(argv())).toBe(true);
});

it("Windows 역슬래시 경로도 통합 테스트로 인식한다", () => {
  expect(includesIntegrationTests(argv("run", "tests\\integration\\songs.test.js"))).toBe(true);
});

it("--exclude=값 형태도 처리한다", () => {
  expect(
    includesIntegrationTests(argv("run", "--exclude='tests/integration/**'")),
  ).toBe(false);
});
