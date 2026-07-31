import { NextResponse } from "next/server";
import { requireSongbookAccess } from "@/lib/authz";
import { errorResponse, requireSameOrigin } from "@/lib/http";
import { removeManager } from "@/lib/db/members";

export async function DELETE(request, { params }) {
  try {
    requireSameOrigin(request);
    const { id, userId } = await params;
    await requireSongbookAccess(id, { min: "ownerOnly" });

    await removeManager(id, userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
