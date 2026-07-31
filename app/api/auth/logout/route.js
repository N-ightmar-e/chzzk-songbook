import { NextResponse } from "next/server";
import { getSessionCookie, clearSessionCookie } from "@/lib/session";
import { revokeSession } from "@/lib/db/sessions";
import { errorResponse } from "@/lib/http";

export async function POST() {
  try {
    // 쿠키 삭제만으로는 부족하다. 복사된 쿠키가 있으면 계속 유효하다.
    const sessionId = await getSessionCookie();
    if (sessionId) await revokeSession(sessionId);
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
