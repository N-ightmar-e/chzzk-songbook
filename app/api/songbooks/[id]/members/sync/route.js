import { NextResponse } from "next/server";
import { requireSongbookAccess } from "@/lib/authz";
import { errorResponse, requireSameOrigin } from "@/lib/http";
import { syncChzzkManagers } from "@/lib/sync";

export async function POST(request, { params }) {
  try {
    requireSameOrigin(request);
    const { id } = await params;
    // 매니저 인사권은 소유자만 갖는다. 운영자도 배제된다.
    const { user } = await requireSongbookAccess(id, { min: "ownerOnly" });

    const result = await syncChzzkManagers(id, user.id);
    // 동기화 실패도 200으로 돌려주고 상태를 담는다 —
    // 화면이 "동기화 실패" 를 안내해야지 요청 자체가 실패하면 안 된다.
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
