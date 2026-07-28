import { NextResponse } from "next/server";
import { createSongs, validateSong } from "@/lib/store";

const MAX_ROWS = 1000;

export async function POST(request) {
  const { songs } = await request.json();

  if (!Array.isArray(songs) || songs.length === 0) {
    return NextResponse.json({ error: "등록할 곡이 없어요." }, { status: 400 });
  }
  if (songs.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `한 번에 ${MAX_ROWS}곡까지만 등록할 수 있어요.` },
      { status: 400 }
    );
  }

  const invalid = songs
    .map((song, index) => ({ index, errors: validateSong(song) }))
    .filter(({ errors }) => Object.keys(errors).length > 0);

  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `${invalid.length}곡의 값이 올바르지 않아요.`, invalid },
      { status: 400 }
    );
  }

  const created = await createSongs(songs);
  return NextResponse.json({ created: created.length }, { status: 201 });
}
