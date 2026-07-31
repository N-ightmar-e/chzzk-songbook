import { NextResponse } from "next/server";
import { currentUser } from "@/lib/authz";
import { isConfigured } from "@/lib/chzzk";
import { errorResponse } from "@/lib/http";

export async function GET() {
  try {
    const user = await currentUser();
    return NextResponse.json({
      user: user
        ? {
            id: user.id,
            channelName: user.chzzkChannelName,
            channelImage: user.chzzkChannelImage,
            verified: user.chzzkVerified,
          }
        : null,
      oauthConfigured: isConfigured(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
