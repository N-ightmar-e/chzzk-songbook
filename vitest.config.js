import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(process.cwd()) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    // DB 통합 테스트는 .env.test 가 있을 때만 돈다 (tests/helpers/db.js 에서 skip 처리)
    // DB 테스트가 같은 실 DB를 truncate하므로 파일 병렬 실행을 끈다.
    // 단위 테스트는 수백 ms라 직렬화 비용이 무시할 수준이다.
    fileParallelism: false,
    setupFiles: ["tests/helpers/setup.js"],
    // 통합 테스트는 개발 서버 기동을 기다린다.
    testTimeout: 30_000,
    hookTimeout: 150_000,
  },
});
