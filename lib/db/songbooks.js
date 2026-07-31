// songbooks + songbook_slug_history 저장소. DB는 snake_case, 앱은 camelCase.
import { getDb } from "@/lib/db/client";
import { failed } from "@/lib/db/errors";
import { isUuid } from "@/lib/uuid";
import { normalizeSlug } from "@/lib/slug";

function toSongbook(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    slug: row.slug,
    title: row.title,
    intro: row.intro,
    isPublic: row.is_public,
    chzzkSyncEnabled: row.chzzk_sync_enabled,
    membersSyncedAt: row.members_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createSongbook({ ownerId, slug, title, intro = null }) {
  const value = normalizeSlug(slug);
  // songbooks.slug의 DB unique 제약은 "현재" slug 충돌만 막는다.
  // 이력(slug_history)에 있는 옛 slug는 이 제약을 통과하므로 여기서 별도 검사한다 —
  // 빠뜨리면 스트리머가 주소를 바꾼 직후 제3자가 옛 주소를 가로채 사칭할 수 있다.
  if (await isSlugTaken(value)) failed({ message: "이미 사용 중인 주소" }, "노래책 생성");

  const { data, error } = await getDb()
    .from("songbooks")
    .insert({ owner_id: ownerId, slug: value, title, intro })
    .select()
    .single();
  if (error) failed(error, "노래책 생성");
  return toSongbook(data);
}

export async function findSongbookBySlug(slug) {
  const { data, error } = await getDb()
    .from("songbooks").select().eq("slug", normalizeSlug(slug)).maybeSingle();
  if (error) failed(error, "노래책 조회");
  return toSongbook(data);
}

export async function findSongbookById(id) {
  if (!isUuid(id)) return null;
  const { data, error } = await getDb()
    .from("songbooks").select().eq("id", id).maybeSingle();
  if (error) failed(error, "노래책 조회");
  return toSongbook(data);
}

// 옛 slug로 들어온 요청을 현재 slug로 안내하기 위한 조회.
export async function findSongbookByHistoricalSlug(slug) {
  const { data, error } = await getDb()
    .from("songbook_slug_history")
    .select("songbook_id, songbooks(slug)")
    .eq("slug", normalizeSlug(slug))
    .maybeSingle();
  if (error) failed(error, "옛 주소 조회");
  if (!data) return null;
  return { songbookId: data.songbook_id, currentSlug: data.songbooks?.slug ?? null };
}

// 현재 slug와 이력을 모두 검사한다. 이력을 빼면 옛 주소를 제3자가 선점해 사칭할 수 있다.
export async function isSlugTaken(slug) {
  const value = normalizeSlug(slug);
  const db = getDb();

  const { data: current, error: currentError } = await db
    .from("songbooks").select("id").eq("slug", value).maybeSingle();
  if (currentError) failed(currentError, "주소 중복 확인");
  if (current) return true;

  const { data: past, error: pastError } = await db
    .from("songbook_slug_history").select("slug").eq("slug", value).maybeSingle();
  if (pastError) failed(pastError, "주소 중복 확인");
  return Boolean(past);
}

export async function updateSongbook(id, { title, intro, isPublic, chzzkSyncEnabled }) {
  const patch = { updated_at: new Date().toISOString() };
  if (title !== undefined) patch.title = title;
  if (intro !== undefined) patch.intro = intro;
  if (isPublic !== undefined) patch.is_public = isPublic;
  if (chzzkSyncEnabled !== undefined) patch.chzzk_sync_enabled = chzzkSyncEnabled;

  const { data, error } = await getDb()
    .from("songbooks").update(patch).eq("id", id).select().single();
  if (error) failed(error, "노래책 설정 변경");
  return toSongbook(data);
}

// slug 교체. 옛 값을 이력에 남겨 링크를 살리고 재선점을 막는다.
export async function changeSlug(id, newSlug) {
  const db = getDb();
  const value = normalizeSlug(newSlug);

  const current = await findSongbookById(id);
  if (!current) failed({ message: "노래책을 찾을 수 없음" }, "주소 변경");
  if (current.slug === value) return current;

  // createSongbook 과 같은 이유로 여기서도 검사한다. songbooks.slug 의 unique 제약은
  // "현재" slug 충돌만 막으므로, 남의 이력에만 남은 옛 주소는 아무 제약에도 안 걸린다.
  // 빠뜨리면 남이 주소를 바꾼 직후 그 주소를 가로채 사칭할 수 있다.
  if (await findSongbookBySlug(value)) {
    failed({ message: "이미 사용 중인 주소" }, "주소 변경");
  }
  const history = await findSongbookByHistoricalSlug(value);
  if (history && history.songbookId !== id) {
    failed({ message: "이미 사용 중인 주소" }, "주소 변경");
  }

  // 이력을 먼저 남기고 나서 현재 slug 를 바꾼다. 순서가 반대면 update 커밋 직후
  // insert 커밋 직전에 옛 주소가 songbooks 에도 이력에도 없는 창이 생기고,
  // 그 찰나에 들어온 createSongbook 이 isSlugTaken 을 통과해 옛 주소를 가져간다.
  // 이 순서면 그 창 동안 옛 주소가 이미 이력에 있어 항상 점유된 것으로 보인다.
  // update 가 실패해도 "이력에도 있고 현재도 그대로"라 노래책은 정상 동작하며,
  // 재시도 시 upsert 가 중복을 무시하므로 자가 치유된다.
  const { error: historyError } = await db
    .from("songbook_slug_history")
    .upsert(
      { slug: current.slug, songbook_id: id },
      { onConflict: "slug", ignoreDuplicates: true },
    );
  if (historyError) failed(historyError, "옛 주소 보존");

  const { data, error } = await db
    .from("songbooks")
    .update({ slug: value, updated_at: new Date().toISOString() })
    .eq("id", id).select().single();
  if (error) failed(error, "주소 변경");

  // 자기 옛 주소로 되돌아온 경우 그 이력 행을 지운다 — 같은 주소가 현재와 이력에
  // 동시에 있으면 isSlugTaken 이 영원히 참이 되어 스스로도 다시 쓸 수 없게 된다.
  if (history) {
    const { error: cleanupError } = await db
      .from("songbook_slug_history").delete().eq("slug", value);
    if (cleanupError) failed(cleanupError, "옛 주소 정리");
  }

  return toSongbook(data);
}

export async function countSongbooksOwnedBy(userId) {
  const { count, error } = await getDb()
    .from("songbooks").select("id", { count: "exact", head: true }).eq("owner_id", userId);
  if (error) failed(error, "노래책 수 조회");
  return count ?? 0;
}

export async function ownsAnySongbook(userId) {
  return (await countSongbooksOwnedBy(userId)) > 0;
}

// 소유한 것 + 매니저로 참여중인 것. 각 항목에 role 을 붙여준다.
export async function listSongbooksForUser(userId) {
  const db = getDb();

  const { data: owned, error: ownedError } = await db
    .from("songbooks").select().eq("owner_id", userId);
  if (ownedError) failed(ownedError, "노래책 목록 조회");

  const { data: memberRows, error: memberError } = await db
    .from("songbook_members").select("songbook_id").eq("user_id", userId);
  if (memberError) failed(memberError, "참여 노래책 조회");

  const ownedIds = new Set((owned ?? []).map((r) => r.id));
  const managedIds = (memberRows ?? [])
    .map((r) => r.songbook_id)
    .filter((id) => !ownedIds.has(id));

  let managed = [];
  if (managedIds.length > 0) {
    const { data, error } = await db.from("songbooks").select().in("id", managedIds);
    if (error) failed(error, "참여 노래책 조회");
    managed = data ?? [];
  }

  return [
    ...(owned ?? []).map((r) => ({ ...toSongbook(r), role: "owner" })),
    ...managed.map((r) => ({ ...toSongbook(r), role: "manager" })),
  ];
}
