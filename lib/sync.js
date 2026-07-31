// 치지직 채널 관리자를 노래책 매니저로 동기화한다.
//
// 스트리머가 치지직에서 이미 관리하는 스태프를 다시 입력시키지 않는 것이 목적이다.
// 동기화 실패는 절대 로그인을 막지 않는다 — 상태를 돌려주고 호출자가 판단한다.
import { fetchStreamingRoles } from "@/lib/chzzk";
import { getValidAccessToken, TokenRefreshBusyError } from "@/lib/db/tokens";
import { findSongbookById } from "@/lib/db/songbooks";
import { refreshChannelInfo } from "@/lib/db/channels";
import { findUserByChannelId } from "@/lib/db/users";
import { replaceSyncedManagers } from "@/lib/db/members";

const COOLDOWN_MS = 60 * 1000; // 치지직 429 방지

export async function syncChzzkManagers(songbookId, ownerId) {
  const songbook = await findSongbookById(songbookId);
  if (!songbook) return { status: "failed", reason: "not-found", added: 0, removed: 0 };
  if (!songbook.chzzkSyncEnabled) {
    return { status: "skipped", reason: "disabled", added: 0, removed: 0 };
  }
  if (
    songbook.membersSyncedAt &&
    Date.now() - new Date(songbook.membersSyncedAt).getTime() < COOLDOWN_MS
  ) {
    return { status: "skipped", reason: "cooldown", added: 0, removed: 0 };
  }

  let accessToken;
  try {
    accessToken = await getValidAccessToken(ownerId);
  } catch (err) {
    if (err instanceof TokenRefreshBusyError) {
      return { status: "busy", reason: "refreshing", added: 0, removed: 0 };
    }
    console.error("매니저 동기화 — 토큰 조회 실패:", err.message);
    return { status: "failed", reason: "token", added: 0, removed: 0 };
  }
  // 소유자가 다시 로그인하면 토큰이 복구된다. 그때까지 조용히 건너뛴다.
  if (!accessToken) return { status: "skipped", reason: "no-token", added: 0, removed: 0 };

  let roles;
  try {
    roles = await fetchStreamingRoles(accessToken);
  } catch (err) {
    console.error("매니저 동기화 — 관리자 조회 실패:", err.message);
    return { status: "failed", reason: "chzzk", added: 0, removed: 0 };
  }

  // 소유자는 songbooks.owner_id 로 이미 표현된다. 매니저로 중복 등록하지 않는다.
  const channelIds = [
    ...new Set(
      roles
        .filter((r) => r.userRole !== "STREAMING_CHANNEL_OWNER")
        .map((r) => r.managerChannelId)
        .filter(Boolean),
    ),
  ];

  try {
    // 로그인한 적 없는 채널도 users 행을 갖게 한다. Client 인증이라 그 사람 토큰이 필요 없다.
    await refreshChannelInfo(channelIds);

    const userIds = [];
    for (const channelId of channelIds) {
      const user = await findUserByChannelId(channelId);
      if (user) userIds.push(user.id);
    }

    const result = await replaceSyncedManagers(songbookId, userIds, { invitedBy: ownerId });
    return { status: "synced", reason: null, ...result };
  } catch (err) {
    console.error("매니저 동기화 — 반영 실패:", err.message);
    return { status: "failed", reason: "db", added: 0, removed: 0 };
  }
}
