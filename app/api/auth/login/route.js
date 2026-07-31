import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isConfigured, buildAuthorizeUrl } from "@/lib/chzzk";
import { isProduction } from "@/lib/env";

export async function GET(request) {
  const origin = new URL(request.url).origin;

  if (!isConfigured()) {
    // 프로덕션에서 credential이 없으면 로그인을 비활성한다.
    // 데모 세션을 발급하면 아무나 임의 신원으로 노래책을 만들 수 있다.
    if (isProduction()) {
      return NextResponse.redirect(`${origin}/?authError=unconfigured`);
    }
    return NextResponse.redirect(`${origin}/api/auth/demo`);
  }

  const state = crypto.randomBytes(16).toString("hex");
  const store = await cookies();
  store.set("chzzk_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    maxAge: 600,
  });

  const redirectUri = process.env.CHZZK_REDIRECT_URI || `${origin}/api/auth/callback`;
  return NextResponse.redirect(buildAuthorizeUrl({ redirectUri, state }));
}
