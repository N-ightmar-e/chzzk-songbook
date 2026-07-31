// 테스트용 세션 쿠키. 실제 세션 행을 만들고 실제 서명을 붙인다 —
// 이래야 서버가 쿠키 검증 → 세션 조회 → 유저 조인 전 경로를 실행한다.
import { createSession } from "@/lib/db/sessions";
import { signSessionId, SESSION_COOKIE_NAME } from "@/lib/session";

export async function cookieForUser(user) {
  const session = await createSession({ userId: user.id, userAgent: "vitest" });
  return `${SESSION_COOKIE_NAME}=${signSessionId(session.id)}`;
}

// 비로그인 요청용. 쿠키 헤더를 아예 안 붙인다.
export const NO_COOKIE = undefined;
