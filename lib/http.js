// 라우트 핸들러의 공통 에러 변환.
import { NextResponse } from "next/server";
import { AuthzError } from "@/lib/authz";

export function errorResponse(err) {
  if (err instanceof AuthzError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("요청 처리 실패:", err);
  return NextResponse.json({ error: "요청을 처리하지 못했어요." }, { status: 500 });
}

// 쓰기 요청의 Origin 을 검증한다. SameSite=Lax 가 cross-site POST의 쿠키 전송을
// 이미 막지만, 이중 방어다. Origin 이 없는 요청(서버 간 호출, 일부 클라이언트)은
// 통과시킨다 — 브라우저는 쓰기 요청에 항상 Origin 을 붙인다.
export function requireSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const target = new URL(request.url).origin;
  if (origin !== target) {
    throw new AuthzError(403, "허용되지 않은 요청이에요.");
  }
}
