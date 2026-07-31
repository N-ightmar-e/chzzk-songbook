// 치지직 채널 정보를 users 에 반영한다.
// fetchChannels 는 Client 인증이라 사용자 토큰이 필요 없다 —
// 한 번도 로그인한 적 없는 채널의 이름·이미지도 가져올 수 있다.
import { fetchChannels } from "@/lib/chzzk";
import { ensurePlaceholderUsers } from "@/lib/db/users";

export async function refreshChannelInfo(channelIds) {
  const ids = [...new Set((channelIds ?? []).filter(Boolean))];
  if (ids.length === 0) return 0;

  const channels = await fetchChannels(ids);
  if (channels.length === 0) return 0;

  // ensurePlaceholderUsers 는 last_login_at 을 건드리지 않는다.
  // 이미 로그인한 유저의 기록을 지우면 안 되기 때문이다.
  const users = await ensurePlaceholderUsers(channels);
  return users.length;
}
