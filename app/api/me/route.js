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

    // 설정 화면이 편집하는 필드는 전부 여기 있어야 한다. 빠지면 폼이 기본값을
    // 서버로 되돌려 보내 사용자가 끈 설정이 조용히 다시 켜진다.
    // 실제로 두 번 발생했다 — intro·isPublic, 그리고 chzzkSyncEnabled.
    const songbooks = (await listSongbooksForUser(user.id)).map((b) => ({
      id: b.id, slug: b.slug, title: b.title, role: b.role,
      intro: b.intro, isPublic: b.isPublic, chzzkSyncEnabled: b.chzzkSyncEnabled,
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
