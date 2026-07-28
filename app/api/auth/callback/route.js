import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { exchangeCodeForToken, fetchMe } from "@/lib/chzzk";
import { setSession } from "@/lib/session";

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const store = await cookies();
  const savedState = store.get("chzzk_oauth_state")?.value;
  store.delete("chzzk_oauth_state");

  if (!code || !state || state !== savedState) {
    return NextResponse.redirect(`${url.origin}/?authError=1`);
  }

  try {
    const token = await exchangeCodeForToken({ code, state });
    const me = await fetchMe(token.accessToken);
    await setSession({
      channelId: me.channelId,
      channelName: me.channelName,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
    });
    return NextResponse.redirect(`${url.origin}/`);
  } catch (err) {
    console.error("chzzk oauth callback failed:", err);
    return NextResponse.redirect(`${url.origin}/?authError=1`);
  }
}
