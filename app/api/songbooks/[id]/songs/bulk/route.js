import { NextResponse } from "next/server";
import { requireSongbookAccess } from "@/lib/authz";
import { errorResponse, requireSameOrigin } from "@/lib/http";
import { createSongs, countSongs, validateSongInput } from "@/lib/db/songs";

const MAX_PER_REQUEST = 1000;
const MAX_SONGS_PER_SONGBOOK = 5000;

export async function POST(request, { params }) {
  try {
    requireSameOrigin(request);
    const { id } = await params;
    await requireSongbookAccess(id, { min: "manager" });

    const input = await request.json();
    const songs = Array.isArray(input?.songs) ? input.songs : [];

    if (songs.length === 0) {
      return NextResponse.json({ error: "등록할 곡이 없어요." }, { status: 400 });
    }
    if (songs.length > MAX_PER_REQUEST) {
      return NextResponse.json(
        { error: `한 번에 ${MAX_PER_REQUEST}곡까지 등록할 수 있어요.` },
        { status: 400 },
      );
    }

    for (const [index, song] of songs.entries()) {
      const errors = validateSongInput(song);
      if (Object.keys(errors).length > 0) {
        return NextResponse.json(
          { error: `${index + 1}번째 곡에 문제가 있어요.`, index, errors },
          { status: 400 },
        );
      }
    }

    // 상한을 넘기면 부분 등록하지 않고 전체를 거부한다 —
    // 어디까지 들어갔는지 사용자가 알 수 없는 상태가 더 나쁘다.
    const current = await countSongs(id);
    if (current + songs.length > MAX_SONGS_PER_SONGBOOK) {
      const over = current + songs.length - MAX_SONGS_PER_SONGBOOK;
      return NextResponse.json(
        {
          error: `${over}곡이 상한을 넘어요. 노래책 하나에 ${MAX_SONGS_PER_SONGBOOK}곡까지 등록할 수 있어요.`,
        },
        { status: 409 },
      );
    }

    const created = await createSongs(id, songs);
    return NextResponse.json({ created: created.length, songs: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
