import { NextResponse } from "next/server";
import { listSongs, createSong, validateSong } from "@/lib/store";

export async function GET() {
  return NextResponse.json({ songs: await listSongs() });
}

export async function POST(request) {
  const input = await request.json();
  const errors = validateSong(input);
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ errors }, { status: 400 });
  }
  return NextResponse.json({ song: await createSong(input) }, { status: 201 });
}
