// Next.js가 서버 시작 시 1회 호출한다.
// 프로덕션 필수 환경변수가 비면 여기서 부팅을 막는다 — 요청 시점에 산발적으로
// 터지면 반쯤 설정된 서버가 정상처럼 보이다가 나중에 깨진다.
import { assertProductionEnv } from "@/lib/env";

export function register() {
  assertProductionEnv();
}
