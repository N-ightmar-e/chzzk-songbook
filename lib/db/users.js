// users 테이블 저장소. DB는 snake_case, 앱은 camelCase.
import { getDb } from "@/lib/db/client";
import { failed } from "@/lib/db/errors";

function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    chzzkChannelId: row.chzzk_channel_id,
    chzzkChannelName: row.chzzk_channel_name,
    chzzkChannelImage: row.chzzk_channel_image,
    chzzkVerified: row.chzzk_verified,
    role: row.role,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

// 로그인 시 호출. 닉네임 변경을 반영하고 lastLoginAt을 갱신한다.
export async function upsertUserFromLogin({ chzzkChannelId, chzzkChannelName }) {
  const { data, error } = await getDb()
    .from("users")
    .upsert(
      {
        chzzk_channel_id: chzzkChannelId,
        chzzk_channel_name: chzzkChannelName,
        last_login_at: new Date().toISOString(),
      },
      { onConflict: "chzzk_channel_id" },
    )
    .select()
    .single();
  if (error) failed(error, "유저 저장");
  return toUser(data);
}

// 치지직 관리자 동기화용. 아직 로그인한 적 없는 채널도 users 행을 갖게 한다.
// lastLoginAt은 건드리지 않는다 — 이미 로그인한 유저의 기록을 지우면 안 된다.
export async function ensurePlaceholderUsers(channels) {
  if (!channels || channels.length === 0) return [];
  const rows = channels.map((c) => ({
    chzzk_channel_id: c.channelId,
    chzzk_channel_name: c.channelName,
    chzzk_channel_image: c.channelImageUrl ?? null,
    chzzk_verified: Boolean(c.verifiedMark),
    channel_synced_at: new Date().toISOString(),
  }));
  const { data, error } = await getDb()
    .from("users")
    .upsert(rows, { onConflict: "chzzk_channel_id" })
    .select();
  if (error) failed(error, "채널 유저 저장");
  return data.map(toUser);
}

export async function findUserById(id) {
  const { data, error } = await getDb().from("users").select().eq("id", id).maybeSingle();
  if (error) failed(error, "유저 조회");
  return toUser(data);
}

export async function findUserByChannelId(chzzkChannelId) {
  const { data, error } = await getDb()
    .from("users").select().eq("chzzk_channel_id", chzzkChannelId).maybeSingle();
  if (error) failed(error, "유저 조회");
  return toUser(data);
}
