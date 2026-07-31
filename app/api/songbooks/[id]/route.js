import { NextResponse } from "next/server";
import { requireSongbookAccess } from "@/lib/authz";
import { errorResponse, requireSameOrigin } from "@/lib/http";
import { normalizeSlug, validateSlug } from "@/lib/slug";
import { updateSongbook, changeSlug, isSlugAvailableFor } from "@/lib/db/songbooks";

export async function PATCH(request, { params }) {
  try {
    requireSameOrigin(request);
    const { id } = await params;

    // 인가가 먼저다. 존재 여부·권한 판정을 여기서 끝낸다.
    await requireSongbookAccess(id, { min: "owner" });

    const input = await request.json();

    // 검증을 전부 끝낸 뒤에 쓴다. 검증 사이에 쓰기가 끼면, 400/409 를 받은 클라이언트는
    // "요청이 실패했다"고 믿는데 실제로는 일부 필드가 이미 바뀐 상태가 된다.
    const patch = {};
    if (input?.title !== undefined) {
      const title = String(input.title).trim();
      if (!title) {
        return NextResponse.json({ error: "노래책 이름을 입력해 주세요." }, { status: 400 });
      }
      patch.title = title;
    }
    if (input?.intro !== undefined) patch.intro = String(input.intro).trim() || null;
    if (input?.isPublic !== undefined) patch.isPublic = Boolean(input.isPublic);
    if (input?.chzzkSyncEnabled !== undefined) {
      patch.chzzkSyncEnabled = Boolean(input.chzzkSyncEnabled);
    }

    let slug = null;
    if (input?.slug !== undefined) {
      slug = normalizeSlug(input.slug);
      const slugError = validateSlug(slug);
      if (slugError) return NextResponse.json({ error: slugError }, { status: 400 });
      // isSlugAvailableFor 는 자기 현재 slug 와 자기 이력을 허용한다.
      // changeSlug 도 같은 함수를 쓰므로 판정이 갈리지 않는다.
      if (!(await isSlugAvailableFor(id, slug))) {
        return NextResponse.json({ error: "이미 쓰이는 주소예요." }, { status: 409 });
      }
    }

    if (Object.keys(patch).length === 0 && slug === null) {
      return NextResponse.json({ error: "바꿀 내용이 없어요." }, { status: 400 });
    }

    // 여기부터 쓰기. 위에서 모든 검증이 끝났다.
    let songbook = Object.keys(patch).length > 0 ? await updateSongbook(id, patch) : null;
    if (slug !== null) songbook = await changeSlug(id, slug);

    return NextResponse.json({ songbook });
  } catch (err) {
    return errorResponse(err);
  }
}
