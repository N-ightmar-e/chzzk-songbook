import { NextResponse } from "next/server";
import { requireSongbookAccess, AuthzError } from "@/lib/authz";
import { errorResponse, requireSameOrigin } from "@/lib/http";
import { findSongById, updateSong, deleteSong, validateSongInput } from "@/lib/db/songs";
import { deleteJacket, jacketPublicUrl, isJacketPathOf } from "@/lib/storage";

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

    if (input?.jacketPath != null && !isJacketPathOf(existing.songbookId, input.jacketPath)) {
      return NextResponse.json({ error: "자켓 경로가 올바르지 않아요." }, { status: 400 });
    }

    const previous = existing.jacketPath;
    const song = await updateSong(id, input);
    // 자켓이 바뀌었으면 이전 파일을 지운다. 스코프 가드를 반드시 태운다 —
    // 정리 로직은 삭제 경로를 하나 더 늘리는 것이라, 가드 없이 넣으면
    // 계획 2에서 막은 크로스 테넌트 삭제가 이 자리로 되살아난다.
    if (previous && previous !== song.jacketPath && isJacketPathOf(existing.songbookId, previous)) {
      await deleteJacket(previous);
    }
    return NextResponse.json({ song: { ...song, jacketUrl: jacketPublicUrl(song.jacketPath) } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request, { params }) {
  try {
    requireSameOrigin(request);
    const { id } = await params;
    const existing = await requireSongAccess(id);

    const { jacketPath } = await deleteSong(id);
    // DB만 지우면 Storage에 고아 파일이 쌓인다. 다만 이 곡의 노래책에 속한
    // 경로만 지운다 — 남의 노래책 자켓을 가리키는 행이 있어도 그 파일은 건드리지 않는다.
    if (isJacketPathOf(existing.songbookId, jacketPath)) {
      await deleteJacket(jacketPath);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
