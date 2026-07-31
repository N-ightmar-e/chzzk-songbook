import { NextResponse } from "next/server";
import { requireSongbookAccess, currentUser, accessLevel, AuthzError } from "@/lib/authz";
import { errorResponse, requireSameOrigin } from "@/lib/http";
import { findSongbookById } from "@/lib/db/songbooks";
import { listSongs, createSong, countSongs, validateSongInput } from "@/lib/db/songs";
import { jacketPublicUrl } from "@/lib/storage";

const MAX_SONGS_PER_SONGBOOK = 5000;

function withJacketUrl(song) {
  return { ...song, jacketUrl: jacketPublicUrl(song.jacketPath) };
}

// 공개 노래책은 비로그인도 본다. 비공개는 참여자만 — 없는 것과 구분되지 않게 404.
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const songbook = await findSongbookById(id);
    if (!songbook) throw new AuthzError(404, "찾을 수 없어요.");

    if (!songbook.isPublic) {
      const user = await currentUser();
      const level = await accessLevel(user, id);
      if (!level) throw new AuthzError(404, "찾을 수 없어요.");
    }

    const songs = await listSongs(id);
    return NextResponse.json({ songbook, songs: songs.map(withJacketUrl) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request, { params }) {
  try {
    requireSameOrigin(request);
    const { id } = await params;
    await requireSongbookAccess(id, { min: "manager" });

    const input = await request.json();
    const errors = validateSongInput(input);
    if (Object.keys(errors).length > 0) {
      return NextResponse.json({ errors }, { status: 400 });
    }

    if ((await countSongs(id)) >= MAX_SONGS_PER_SONGBOOK) {
      return NextResponse.json(
        { error: `노래책 하나에 ${MAX_SONGS_PER_SONGBOOK}곡까지 등록할 수 있어요.` },
        { status: 409 },
      );
    }

    const song = await createSong(id, input);
    return NextResponse.json({ song: withJacketUrl(song) }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
