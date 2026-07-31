// 통합 테스트용 개발 서버. vitest globalSetup 으로 실행 전체에서 딱 한 번 띄운다.
//
// describe 블록마다 띄우면 같은 포트에 여러 개가 겹치고, 한 블록의 afterAll 이
// 다른 블록의 서버를 죽인다. 파일별로는 통과하는데 함께 돌리면 깨지는 형태로 나타난다.
import { spawn, spawnSync } from "node:child_process";
import { loadEnvTest } from "./env-test.js";

const PORT = 3100; // 개발 서버(3001)와 겹치지 않게
const BASE_URL = `http://localhost:${PORT}`;
const READY_TIMEOUT_MS = 120_000;

// 이번 실행에 통합 테스트가 포함되는지 판정한다. 두 방향 모두 아프다 —
// 안 띄우면 e2e 가 skip 이 아니라 서버 부재로 실패하고, 헛되이 띄우면 모든
// 실행이 5초씩 느려진다. 실제로 둘 다 겪었다.
//
// 실측한 argv:
//   pnpm test       ["run","--exclude","'tests/db/**'","--exclude","'tests/integration/**'"]
//   pnpm test:db    ["run","tests/db"]
//   pnpm test:e2e   ["run","tests/integration"]
//   pnpm test:watch []
//
// 단순 문자열 매칭이면 pnpm test 의 --exclude 값에 걸려 서버를 헛되이 띄우고,
// 경로 인자가 없는 pnpm test:watch 는 서버 없이 통합 테스트를 돌려 실패한다.
export function includesIntegrationTests(argv) {
  const clean = (value) => value.replace(/\\/g, "/").replace(/^['"]|['"]$/g, "");
  const args = argv.slice(2);
  const positional = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("-")) {
      positional.push(clean(arg));
      continue;
    }
    const [name, inline] = arg.split("=");
    const value = inline ?? args[i + 1];
    // 값을 따로 받는 플래그면 그 값도 건너뛴다. 안 그러면 경로로 오인한다.
    if (inline === undefined && value !== undefined && !value.startsWith("-")) i += 1;
    // 통합 테스트가 명시적으로 제외됐다면 이번 실행엔 없다.
    if (name === "--exclude" && value && clean(value).includes("tests/integration")) {
      return false;
    }
  }

  const paths = positional.filter((arg) => arg.includes("tests"));
  // 경로 필터가 없으면(watch 모드) 통합 테스트가 돌 수 있다고 본다.
  if (paths.length === 0) return true;
  return paths.some((arg) => arg.includes("tests/integration"));
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
  // globalSetup 은 vitest.config.js 를 공유하는 모든 실행에 걸리므로 가드가 필요하다.
  if (!includesIntegrationTests(process.argv)) return () => {};

  // globalSetup 은 워커가 아니라 메인 프로세스에서 돈다. setupFiles 는 워커에서만
  // 실행되므로 여기서 직접 읽어야 아래 검사가 값을 본다.
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
