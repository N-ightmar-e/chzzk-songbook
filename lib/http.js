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
