import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { isConfigured } from "@/lib/chzzk";

export async function GET() {
  const session = await getSession();
  return NextResponse.json({
    user: session
      ? { channelName: session.channelName, demo: Boolean(session.demo) }
      : null,
    oauthConfigured: isConfigured(),
  });
}
