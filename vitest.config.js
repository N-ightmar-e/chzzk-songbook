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
    setupFiles: ["tests/helpers/setup.js"],
  },
});
