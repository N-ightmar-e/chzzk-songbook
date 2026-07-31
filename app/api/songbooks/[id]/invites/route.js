import { NextResponse } from "next/server";
import { requireSongbookAccess } from "@/lib/authz";
import { errorResponse, requireSameOrigin } from "@/lib/http";
import { createInvite } from "@/lib/db/members";

export async function POST(request, { params }) {
  try {
    requireSameOrigin(request);
    const { id } = await params;
    // 인사권은 소유자만. 운영자도 배제된다.
    const { user } = await requireSongbookAccess(id, { min: "ownerOnly" });

    const { token, expiresAt } = await createInvite(id, user.id);
    const url = new URL(`/invite/${token}`, new URL(request.url).origin).toString();

    // 원문 토큰은 이 응답에만 존재한다. DB에는 해시만 남는다.
    return NextResponse.json({ token, url, expiresAt }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
