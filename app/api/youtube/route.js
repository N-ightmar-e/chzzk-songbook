import { NextResponse } from "next/server";
import { extractVideoId } from "@/lib/youtube";

// oEmbed는 API 키·쿼터가 필요 없다. 브라우저에서 직접 부르면 CORS에 막혀 서버를 거친다.
export async function GET(request) {
  const url = new URL(request.url).searchParams.get("url");
  const videoId = extractVideoId(url);
  if (!videoId) {
    return NextResponse.json({ error: "유튜브 영상 주소를 인식할 수 없어요." }, { status: 400 });
  }

  const target = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId}`
  )}&format=json`;

  try {
    const res = await fetch(target, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { error: "영상을 찾을 수 없어요. 비공개이거나 삭제된 영상일 수 있습니다." },
        { status: 404 }
      );
    }
    const data = await res.json();
    return NextResponse.json({
      videoId,
      title: data.title,
      channel: data.author_name,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
      thumbnailFallback: data.thumbnail_url,
    });
  } catch {
    return NextResponse.json({ error: "영상 정보를 불러오지 못했어요." }, { status: 502 });
  }
}
