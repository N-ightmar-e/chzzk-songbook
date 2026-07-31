// vitest setupFiles. 워커 프로세스마다 실행된다.
// 파싱은 tests/helpers/env-test.js 가 한다 — globalSetup 과 같은 파서를 쓴다.
// dotenv 의존성을 추가하지 않기 위해 직접 파싱한다.
import { loadEnvTest } from "./env-test.js";

loadEnvTest();
