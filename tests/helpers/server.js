// 통합 테스트용 개발 서버. 스위트 전체에서 한 번만 띄운다.
import { spawn, spawnSync } from "node:child_process";
import { describe } from "vitest";

const PORT = 3100; // 개발 서버(3001)와 겹치지 않게
const BASE_URL = `http://localhost:${PORT}`;
const READY_TIMEOUT_MS = 120_000;

export const describeE2e =
  process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY ? describe : describe.skip;

// Windows에서 shell:true 로 spawn하면 cmd.exe → pnpm.cmd → node 트리가 생긴다.
// child.kill() 은 최상위 cmd.exe 에만 신호를 보내므로 next dev 본체가 살아남아
// 포트를 계속 물고 있고, 다음 실행이 포트 충돌로 실패한다.
// /t 로 자식 프로세스까지, /f 로 강제 종료한다.
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

export async function startServer() {
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

  return {
    baseUrl: BASE_URL,
    stop() {
      killTree(child);
    },
  };
}
