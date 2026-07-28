import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isConfigured, buildAuthorizeUrl } from "@/lib/chzzk";
import { setSession } from "@/lib/session";

export async function GET(request) {
  const origin = new URL(request.url).origin;

  if (!isConfigured()) {
    // 데모 모드: credential이 없을 때 UI 확인용 가짜 세션
    await setSession({ channelId: "demo-viewer", channelName: "새벽감자", demo: true });
    return NextResponse.redirect(`${origin}/`);
  }

  const state = crypto.randomBytes(16).toString("hex");
  const store = await cookies();
  store.set("chzzk_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  const redirectUri = process.env.CHZZK_REDIRECT_URI || `${origin}/api/auth/callback`;
  return NextResponse.redirect(buildAuthorizeUrl({ redirectUri, state }));
}
