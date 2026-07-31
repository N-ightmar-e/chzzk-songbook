import { NextResponse } from "next/server";
import { currentUser } from "@/lib/authz";
import { errorResponse, requireSameOrigin } from "@/lib/http";
import { acceptInvite } from "@/lib/db/members";

export async function POST(request, { params }) {
  try {
    requireSameOrigin(request);
    const { token } = await params;

    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
    }

    const result = await acceptInvite(token, user.id);

    // 없는 토큰·만료·재사용을 전부 410으로 뭉뚱그린다 — 토큰 존재 여부를 누설하지 않는다.
    if (result.status === "invalid") {
      return NextResponse.json({ error: "초대가 만료되었거나 이미 사용됐어요." }, { status: 410 });
    }
    if (result.status === "owner") {
      return NextResponse.json(
        { error: "이미 이 노래책의 소유자예요." },
        { status: 400 },
      );
    }

    return NextResponse.json({ status: result.status, songbookId: result.songbookId });
  } catch (err) {
    return errorResponse(err);
  }
}
