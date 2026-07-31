// 통합 테스트용 개발 서버. vitest globalSetup 으로 실행 전체에서 딱 한 번 띄운다.
//
// describe 블록마다 띄우면 같은 포트에 여러 개가 겹치고, 한 블록의 afterAll 이
// 다른 블록의 서버를 죽인다. 파일별로는 통과하는데 함께 돌리면 깨지는 형태로 나타난다.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const PORT = 3100; // 개발 서버(3001)와 겹치지 않게
const BASE_URL = `http://localhost:${PORT}`;
const READY_TIMEOUT_MS = 120_000;

// globalSetup은 워커가 아니라 vitest 메인 프로세스에서 돈다. tests/helpers/setup.js는
// setupFiles라 워커별로만 실행되므로, 메인 프로세스의 process.env에는 .env.test 값이
// 없다. 그래서 여기서도 같은 방식으로 직접 읽어 둔다 — 안 그러면 아래 가드가 항상
// "없음"으로 판단해 서버를 못 띄우고, e2e 워커는 provide 된 주소를 영영 못 받는다.
function loadEnvTest() {
  const file = path.join(process.cwd(), ".env.test");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

// Windows에서 shell:true 로 spawn하면 cmd.exe → pnpm.cmd → node 트리가 생긴다.
// child.kill() 은 최상위 cmd.exe 에만 신호를 보내 next dev 본체가 포트를 계속 문다.
function killTree(child) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  child.kill();
}

async function waitForReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/me`);
      if (res.ok) return;
    } catch {
      // 아직 안 떴다
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`개발 서버가 ${READY_TIMEOUT_MS}ms 안에 뜨지 않았습니다.`);
}

// process.env 로 넘긴 값은 워커 프로세스에 전달되지 않는다(globalSetup은 메인
// 프로세스에서, 테스트는 별도 워커에서 돈다). vitest의 provide/inject로 넘긴다.
export async function setup({ provide }) {
  // 통합 테스트가 이번 실행에 포함될 때만 서버를 띄운다.
  // globalSetup 은 test:db 실행에도 걸리므로 이 가드가 없으면 매번 헛돈다.
  const runningIntegration = process.argv.some((arg) => arg.includes("tests/integration"));
  if (!runningIntegration) return () => {};

  loadEnvTest();

  // .env.test 가 없으면 통합 테스트가 전부 skip되므로 서버도 띄우지 않는다.
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) return () => {};

  const child = spawn("pnpm", ["exec", "next", "dev", "--port", String(PORT)], {
    stdio: "ignore",
    shell: process.platform === "win32",
    env: { ...process.env },
  });

  try {
    await waitForReady();
  } catch (err) {
    killTree(child);
    throw err;
  }

  provide("e2eBaseUrl", BASE_URL);

  return () => killTree(child);
}
