import { NextResponse } from "next/server";
import { currentUser } from "@/lib/authz";
import { isConfigured } from "@/lib/chzzk";
import { listSongbooksForUser } from "@/lib/db/songbooks";
import { errorResponse } from "@/lib/http";

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ user: null, songbooks: [], oauthConfigured: isConfigured() });
    }

    const songbooks = (await listSongbooksForUser(user.id)).map((b) => ({
      id: b.id, slug: b.slug, title: b.title, role: b.role,
    }));

    return NextResponse.json({
      user: {
        id: user.id,
        channelName: user.chzzkChannelName,
        channelImage: user.chzzkChannelImage,
        verified: user.chzzkVerified,
      },
      songbooks,
      oauthConfigured: isConfigured(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
