import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { exchangeCodeForToken, fetchMe } from "@/lib/chzzk";
import { upsertUserFromLogin } from "@/lib/db/users";
import { createSession } from "@/lib/db/sessions";
import { saveTokens } from "@/lib/db/tokens";
import { setSessionCookie } from "@/lib/session";
import { ownsAnySongbook, listSongbooksForUser } from "@/lib/db/songbooks";
import { syncChzzkManagers } from "@/lib/sync";

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

    if (await ownsAnySongbook(user.id)) {
      await saveTokens(user.id, token);

      // 소유한 노래책의 매니저를 갱신한다. 실패해도 로그인을 막지 않는다.
      try {
        const books = await listSongbooksForUser(user.id);
        for (const book of books.filter((b) => b.role === "owner")) {
          await syncChzzkManagers(book.id, user.id);
        }
      } catch (syncError) {
        console.error("로그인 후 매니저 동기화 실패:", syncError.message);
      }
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
