// songbook_members + songbook_invites 저장소.
//
// ⚠️ 이 모듈은 인가를 하지 않는다. 이 서비스는 sb_secret_ 키가 RLS를 전부
// 우회하므로, 호출자(라우트)가 requireSongbookAccess 등으로 인가한 뒤에 불러야
// 한다. "저장소가 알아서 격리해준다"고 오해하면 그 자리가 곧 데이터 노출이다.
//
// source 로 자동 동기화와 수동 초대를 구분하는 것이 핵심이다.
// 이 구분이 없으면 치지직 동기화가 수동으로 초대한 매니저를 지워버린다.
import { getDb } from "@/lib/db/client";
import { failed } from "@/lib/db/errors";
import { isUuid } from "@/lib/uuid";
import { createInviteToken, hashInviteToken } from "@/lib/invite";
import { findSongbookById } from "@/lib/db/songbooks";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// songbookId 로 스코프된다.
export async function listMembers(songbookId) {
  if (!isUuid(songbookId)) return [];
  // songbook_members → users 참조가 user_id·invited_by 둘이라 PostgREST가
  // 임베드 대상을 못 고른다. users!user_id 로 FK 컬럼을 명시해 지정한다.
  const { data, error } = await getDb()
    .from("songbook_members")
    .select("user_id, role, source, created_at, users!user_id(chzzk_channel_id, chzzk_channel_name, chzzk_channel_image, chzzk_verified)")
    .eq("songbook_id", songbookId)
    .order("created_at", { ascending: true });
  if (error) failed(error, "매니저 목록 조회");

  return (data ?? []).map((row) => ({
    userId: row.user_id,
    role: row.role,
    source: row.source,
    createdAt: row.created_at,
    user: {
      chzzkChannelId: row.users?.chzzk_channel_id ?? null,
      chzzkChannelName: row.users?.chzzk_channel_name ?? null,
      chzzkChannelImage: row.users?.chzzk_channel_image ?? null,
      chzzkVerified: row.users?.chzzk_verified ?? false,
    },
  }));
}

// songbookId + userId 로 스코프된다. 이미 있으면 아무것도 하지 않는다 —
// 먼저 들어온 source 를 유지한다.
export async function addManager(songbookId, userId, { source, invitedBy = null }) {
  if (!isUuid(songbookId) || !isUuid(userId)) return;
  const { error } = await getDb()
    .from("songbook_members")
    .upsert(
      { songbook_id: songbookId, user_id: userId, role: "manager", source, invited_by: invitedBy },
      { onConflict: "songbook_id,user_id", ignoreDuplicates: true },
    );
  if (error) failed(error, "매니저 추가");
}

// songbookId + userId 로 스코프된다.
export async function removeManager(songbookId, userId) {
  if (!isUuid(songbookId) || !isUuid(userId)) return;
  const { error } = await getDb()
    .from("songbook_members").delete()
    .eq("songbook_id", songbookId).eq("user_id", userId);
  if (error) failed(error, "매니저 해제");
}

// songbookId + userId 로 스코프된다.
export async function isManager(songbookId, userId) {
  if (!isUuid(songbookId) || !isUuid(userId)) return false;
  const { data, error } = await getDb()
    .from("songbook_members").select("user_id")
    .eq("songbook_id", songbookId).eq("user_id", userId).maybeSingle();
  if (error) failed(error, "매니저 확인");
  return Boolean(data);
}

// songbookId 로 스코프된다. 치지직 동기화 결과를 반영한다. source='chzzk_sync'
// 행만 추가·삭제하고 source='invite' 행은 절대 건드리지 않는다.
export async function replaceSyncedManagers(songbookId, userIds, { invitedBy = null } = {}) {
  const db = getDb();
  const songbook = await findSongbookById(songbookId);
  if (!songbook) failed({ message: "노래책 없음" }, "매니저 동기화");

  // 소유자는 songbooks.owner_id 로 이미 표현된다. 매니저로 중복 등록하지 않는다.
  const wanted = new Set([...new Set(userIds ?? [])].filter((id) => id && id !== songbook.ownerId));

  const { data: existing, error } = await db
    .from("songbook_members").select("user_id, source").eq("songbook_id", songbookId);
  if (error) failed(error, "매니저 동기화");

  const syncedIds = new Set(
    (existing ?? []).filter((r) => r.source === "chzzk_sync").map((r) => r.user_id),
  );
  const anyIds = new Set((existing ?? []).map((r) => r.user_id));

  const toRemove = [...syncedIds].filter((id) => !wanted.has(id));
  const toAdd = [...wanted].filter((id) => !anyIds.has(id));

  if (toRemove.length > 0) {
    const { error: removeError } = await db
      .from("songbook_members").delete()
      .eq("songbook_id", songbookId).eq("source", "chzzk_sync").in("user_id", toRemove);
    if (removeError) failed(removeError, "매니저 동기화");
  }

  if (toAdd.length > 0) {
    const rows = toAdd.map((userId) => ({
      songbook_id: songbookId, user_id: userId,
      role: "manager", source: "chzzk_sync", invited_by: invitedBy,
    }));
    const { error: addError } = await db.from("songbook_members").insert(rows);
    if (addError) failed(addError, "매니저 동기화");
  }

  const { error: syncError } = await db.from("songbooks")
    .update({ members_synced_at: new Date().toISOString() })
    .eq("id", songbookId);
  if (syncError) failed(syncError, "매니저 동기화");

  return { added: toAdd.length, removed: toRemove.length };
}

// songbookId 로 스코프된다.
export async function createInvite(songbookId, createdBy) {
  const { token, tokenHash } = createInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  const { error } = await getDb().from("songbook_invites").insert({
    songbook_id: songbookId, token_hash: tokenHash,
    created_by: createdBy, expires_at: expiresAt,
  });
  if (error) failed(error, "초대 생성");

  // 원문 토큰은 여기서만 존재한다. DB에는 해시만 남는다.
  return { token, expiresAt };
}

// token 으로 songbook_invites 전체를 조회한다(스코프 없음) — 초대 링크 자체가
// 노래책을 가리키므로 songbookId 를 미리 알 필요가 없다.
// status: 'accepted' | 'already' | 'owner' | 'invalid'
// 없는 토큰·만료된 토큰·이미 쓴 토큰을 전부 'invalid' 로 뭉뚱그린다 —
// 구분하면 토큰 존재 여부가 누설된다.
export async function acceptInvite(token, userId) {
  const db = getDb();
  const { data: invite, error } = await db
    .from("songbook_invites").select()
    .eq("token_hash", hashInviteToken(token)).maybeSingle();
  if (error) failed(error, "초대 조회");

  if (!invite) return { status: "invalid", songbookId: null };
  if (invite.accepted_at) return { status: "invalid", songbookId: null };
  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    return { status: "invalid", songbookId: null };
  }

  const songbook = await findSongbookById(invite.songbook_id);
  if (!songbook) return { status: "invalid", songbookId: null };

  // 소유자가 자기 초대를 수락해 매니저로 강등되면 안 된다.
  if (songbook.ownerId === userId) {
    return { status: "owner", songbookId: songbook.id };
  }

  // 토큰을 먼저 소모한다. accepted_at 이 아직 null 인 행만 갱신되므로
  // 동시에 두 명이 같은 링크를 눌러도 한 명만 통과한다.
  const { data: claimed, error: acceptError } = await db
    .from("songbook_invites")
    .update({ accepted_by: userId, accepted_at: new Date().toISOString() })
    .eq("id", invite.id)
    .is("accepted_at", null)
    .select("id")
    .maybeSingle();
  if (acceptError) failed(acceptError, "초대 수락");
  if (!claimed) return { status: "invalid", songbookId: null };

  // 토큰은 1회용이다. 이미 매니저였더라도 소모한다.
  const already = await isManager(songbook.id, userId);
  if (!already) {
    await addManager(songbook.id, userId, { source: "invite", invitedBy: invite.created_by });
  }

  return { status: already ? "already" : "accepted", songbookId: songbook.id };
}
