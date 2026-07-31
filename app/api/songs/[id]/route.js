import { NextResponse } from "next/server";
import { requireSongbookAccess, AuthzError } from "@/lib/authz";
import { errorResponse, requireSameOrigin } from "@/lib/http";
import { findSongById, updateSong, deleteSong, validateSongInput } from "@/lib/db/songs";
import { deleteJacket, jacketPublicUrl } from "@/lib/storage";

// 곡 → 노래책을 먼저 찾고, 그 노래책에 대한 권한을 본다.
// 곡이 없을 때와 권한이 없을 때가 모두 404여야 존재가 누설되지 않는다.
async function requireSongAccess(songId) {
  const song = await findSongById(songId);
  if (!song) throw new AuthzError(404, "찾을 수 없어요.");
  await requireSongbookAccess(song.songbookId, { min: "manager" });
  return song;
}

export async function PATCH(request, { params }) {
  try {
    requireSameOrigin(request);
    const { id } = await params;
    // requireSongAccess 가 이미 조회한 곡을 재사용한다 — 같은 행을 두 번 읽지 않는다.
    const existing = await requireSongAccess(id);

    const input = await request.json();
    // 부분 수정이므로 기존 값과 합쳐서 검증한다.
    const errors = validateSongInput({ ...existing, ...input });
    if (Object.keys(errors).length > 0) {
      return NextResponse.json({ errors }, { status: 400 });
    }

    // jacketPath 는 uploadJacket 이 돌려준 경로여야 한다.
    // 임의 문자열을 허용하면 매직바이트 검증을 우회해 남의 자켓을 가리킬 수 있다.
    if (input?.jacketPath !== undefined && input.jacketPath !== null) {
      const expected = new RegExp(
        `^${existing.songbookId}/[0-9a-f-]{36}\\.(jpg|png|webp)$`,
      );
      if (!expected.test(String(input.jacketPath))) {
        return NextResponse.json({ error: "자켓 경로가 올바르지 않아요." }, { status: 400 });
      }
    }

    const song = await updateSong(id, input);
    return NextResponse.json({ song: { ...song, jacketUrl: jacketPublicUrl(song.jacketPath) } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request, { params }) {
  try {
    requireSameOrigin(request);
    const { id } = await params;
    await requireSongAccess(id);

    const { jacketPath } = await deleteSong(id);
    // DB만 지우면 Storage에 고아 파일이 쌓인다.
    await deleteJacket(jacketPath);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
