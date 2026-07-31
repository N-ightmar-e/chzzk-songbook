import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { exchangeCodeForToken, fetchMe } from "@/lib/chzzk";
import { upsertUserFromLogin } from "@/lib/db/users";
import { createSession } from "@/lib/db/sessions";
import { saveTokens } from "@/lib/db/tokens";
import { setSessionCookie } from "@/lib/session";
import { getDb } from "@/lib/db/client";

// 이 유저가 노래책 소유자인지. 소유자의 토큰만 저장한다 —
// 시청자 토큰은 쓸 데가 없고, 저장하지 않은 데이터는 유출되지 않는다.
async function ownsSongbook(userId) {
  const { data } = await getDb()
    .from("songbooks").select("id").eq("owner_id", userId).limit(1);
  return Boolean(data?.length);
}

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const store = await cookies();
  const savedState = store.get("chzzk_oauth_state")?.value;
  store.delete("chzzk_oauth_state");

  if (!code || !state || !savedState || state !== savedState) {
    return NextResponse.redirect(`${url.origin}/?authError=state`);
  }

  try {
    const token = await exchangeCodeForToken({ code, state });
    const me = await fetchMe(token.accessToken);

    const user = await upsertUserFromLogin({
      chzzkChannelId: me.channelId,
      chzzkChannelName: me.channelName,
    });

    if (await ownsSongbook(user.id)) {
      await saveTokens(user.id, token);
    }

    const session = await createSession({
      userId: user.id,
      userAgent: request.headers.get("user-agent"),
    });
    await setSessionCookie(session.id);

    return NextResponse.redirect(`${url.origin}/`);
  } catch (err) {
    console.error("치지직 OAuth 콜백 실패:", err);
    return NextResponse.redirect(`${url.origin}/?authError=1`);
  }
}
