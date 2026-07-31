// 개발 전용 데모 로그인. 프로덕션에서는 404를 낸다.
import { NextResponse } from "next/server";
import { isProduction } from "@/lib/env";
import { upsertUserFromLogin } from "@/lib/db/users";
import { createSession } from "@/lib/db/sessions";
import { setSessionCookie } from "@/lib/session";
import { errorResponse } from "@/lib/http";

export async function GET(request) {
  if (isProduction()) {
    return NextResponse.json({ error: "찾을 수 없어요." }, { status: 404 });
  }
  try {
    const origin = new URL(request.url).origin;
    const user = await upsertUserFromLogin({
      chzzkChannelId: "demo-channel",
      chzzkChannelName: "새벽감자",
    });
    const session = await createSession({
      userId: user.id,
      userAgent: request.headers.get("user-agent"),
    });
    await setSessionCookie(session.id);
    return NextResponse.redirect(`${origin}/`);
  } catch (err) {
    return errorResponse(err);
  }
}
