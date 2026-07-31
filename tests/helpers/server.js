// 통합 테스트에서 서버 주소를 얻는 얇은 헬퍼.
// 실제 기동·종료는 globalSetup(tests/helpers/global-server.js)이 실행당 한 번만 한다.
import { describe, inject } from "vitest";

export const describeE2e =
  process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY ? describe : describe.skip;

// 시그니처는 유지한다 — 테스트 파일이 beforeAll/afterAll 에서 그대로 쓴다.
// 서버를 새로 띄우지 않고, 이미 떠 있는 주소를 돌려주기만 한다.
// process.env.E2E_BASE_URL 은 워커 프로세스로 전달되지 않아 provide/inject 를 쓴다.
export async function startServer() {
  const baseUrl = inject("e2eBaseUrl");
  if (!baseUrl) {
    throw new Error(
      "e2eBaseUrl 이 없습니다. vitest.config.js 의 globalSetup 설정을 확인하세요.",
    );
  }
  return {
    baseUrl,
    stop() {
      // 종료는 globalSetup 의 teardown 이 담당한다. 여기서 죽이면
      // 아직 실행 중인 다른 describe 블록이 서버를 잃는다.
    },
  };
}
