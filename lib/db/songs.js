// songs 저장소.
//
// ⚠️ 이 모듈은 인가를 하지 않는다. 스코프도 함수마다 다르다:
//   - listSongs / countSongs / createSong / createSongs — songbook_id 로 스코프된다
//   - findSongById / updateSong / deleteSong — id 만으로 동작하며 **스코프 검사를 하지 않는다**
//
// 뒤의 셋은 호출자(라우트)가 곡 → 노래책을 찾아 requireSongbookAccess 로 인가한 뒤에
// 불러야 한다. 이 서비스는 sb_secret_ 키가 RLS를 전부 우회하므로 라우트의 인가가
// 유일한 방어선이다. "저장소가 알아서 격리해준다"고 오해하면 그 자리가 곧 데이터 노출이다.
import { getDb } from "@/lib/db/client";
import { failed } from "@/lib/db/errors";
import { isUuid } from "@/lib/uuid";

function toSong(row) {
  if (!row) return null;
  return {
    id: row.id,
    songbookId: row.songbook_id,
    jacketPath: row.jacket_path,
    title: row.title,
    titleAliases: row.title_aliases ?? [],
    artist: row.artist,
    artistAliases: row.artist_aliases ?? [],
    mrUrl: row.mr_url,
    mrVideoId: row.mr_video_id,
    mrTitle: row.mr_title,
    mrChannel: row.mr_channel,
    key: row.key,
    keyLinks: row.key_links ?? {},
    genre: row.genre,
    price: row.price,
    popular: row.popular,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// 앱 입력(camelCase) → DB 행(snake_case). undefined 인 필드는 넣지 않아
// 부분 수정 시 기존 값이 유지되게 한다.
function toRow(input) {
  const row = {};
  const map = {
    jacketPath: "jacket_path", title: "title", titleAliases: "title_aliases",
    artist: "artist", artistAliases: "artist_aliases", mrUrl: "mr_url",
    mrVideoId: "mr_video_id", mrTitle: "mr_title", mrChannel: "mr_channel",
    key: "key", keyLinks: "key_links", genre: "genre", price: "price", popular: "popular",
  };
  for (const [appKey, dbKey] of Object.entries(map)) {
    if (input[appKey] !== undefined) row[dbKey] = input[appKey];
  }
  return row;
}

export async function listSongs(songbookId) {
  if (!isUuid(songbookId)) return [];
  const { data, error } = await getDb()
    .from("songs").select().eq("songbook_id", songbookId)
    .order("created_at", { ascending: false });
  if (error) failed(error, "곡 목록 조회");
  return (data ?? []).map(toSong);
}

export async function findSongById(id) {
  if (!isUuid(id)) return null;
  const { data, error } = await getDb()
    .from("songs").select().eq("id", id).maybeSingle();
  if (error) failed(error, "곡 조회");
  return toSong(data);
}

export async function createSong(songbookId, input) {
  const { data, error } = await getDb()
    .from("songs").insert({ songbook_id: songbookId, ...toRow(input) }).select().single();
  if (error) failed(error, "곡 등록");
  return toSong(data);
}

export async function createSongs(songbookId, inputs) {
  if (!inputs || inputs.length === 0) return [];
  const rows = inputs.map((input) => ({ songbook_id: songbookId, ...toRow(input) }));
  const { data, error } = await getDb().from("songs").insert(rows).select();
  if (error) failed(error, "곡 일괄 등록");
  return (data ?? []).map(toSong);
}

export async function updateSong(id, input) {
  const { data, error } = await getDb()
    .from("songs")
    .update({ ...toRow(input), updated_at: new Date().toISOString() })
    .eq("id", id).select().single();
  if (error) failed(error, "곡 수정");
  return toSong(data);
}

// 지운 곡의 자켓 경로를 돌려준다. 호출자가 Storage 객체도 지워야 고아 파일이 안 쌓인다.
export async function deleteSong(id) {
  const { data, error } = await getDb()
    .from("songs").delete().eq("id", id).select("jacket_path").maybeSingle();
  if (error) failed(error, "곡 삭제");
  return { jacketPath: data?.jacket_path ?? null };
}

export async function countSongs(songbookId) {
  if (!isUuid(songbookId)) return 0;
  const { count, error } = await getDb()
    .from("songs").select("id", { count: "exact", head: true })
    .eq("songbook_id", songbookId);
  if (error) failed(error, "곡 수 조회");
  return count ?? 0;
}
