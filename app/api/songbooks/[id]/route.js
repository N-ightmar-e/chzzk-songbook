import { NextResponse } from "next/server";
import { requireSongbookAccess } from "@/lib/authz";
import { errorResponse, requireSameOrigin } from "@/lib/http";
import { normalizeSlug, validateSlug } from "@/lib/slug";
import { updateSongbook, changeSlug, isSlugTaken } from "@/lib/db/songbooks";

export async function PATCH(request, { params }) {
  try {
    requireSameOrigin(request);
    const { id } = await params;

    // 인가가 먼저다. 존재 여부·권한 판정을 여기서 끝낸다.
    await requireSongbookAccess(id, { min: "owner" });

    const input = await request.json();
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

    let songbook = Object.keys(patch).length > 0
      ? await updateSongbook(id, patch)
      : null;

    if (input?.slug !== undefined) {
      const slug = normalizeSlug(input.slug);
      const slugError = validateSlug(slug);
      if (slugError) return NextResponse.json({ error: slugError }, { status: 400 });
      if (await isSlugTaken(slug)) {
        return NextResponse.json({ error: "이미 쓰이는 주소예요." }, { status: 409 });
      }
      songbook = await changeSlug(id, slug);
    }

    if (!songbook) {
      return NextResponse.json({ error: "바꿀 내용이 없어요." }, { status: 400 });
    }
    return NextResponse.json({ songbook });
  } catch (err) {
    return errorResponse(err);
  }
}
