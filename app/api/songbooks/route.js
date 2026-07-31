import { NextResponse } from "next/server";
import { currentUser } from "@/lib/authz";
import { errorResponse, requireSameOrigin } from "@/lib/http";
import { normalizeSlug, validateSlug } from "@/lib/slug";
import { createSongbook, isSlugTaken, countSongbooksOwnedBy } from "@/lib/db/songbooks";

const MAX_SONGBOOKS_PER_USER = 1;

export async function POST(request) {
  try {
    requireSameOrigin(request);

    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
    }

    const input = await request.json();
    const slug = normalizeSlug(input?.slug);
    const title = String(input?.title ?? "").trim();

    const slugError = validateSlug(slug);
    if (slugError) return NextResponse.json({ error: slugError }, { status: 400 });
    if (!title) {
      return NextResponse.json({ error: "노래책 이름을 입력해 주세요." }, { status: 400 });
    }

    if ((await countSongbooksOwnedBy(user.id)) >= MAX_SONGBOOKS_PER_USER) {
      return NextResponse.json(
        { error: "노래책은 계정당 하나만 만들 수 있어요." },
        { status: 409 },
      );
    }

    // 현재 slug와 옛 slug를 모두 검사한다. 옛 주소를 제3자가 선점하면 사칭이 된다.
    if (await isSlugTaken(slug)) {
      return NextResponse.json({ error: "이미 쓰이는 주소예요." }, { status: 409 });
    }

    const songbook = await createSongbook({
      ownerId: user.id,
      slug,
      title,
      intro: String(input?.intro ?? "").trim() || null,
    });
    return NextResponse.json({ songbook }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
