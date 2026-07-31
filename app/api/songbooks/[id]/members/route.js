import { NextResponse } from "next/server";
import { requireSongbookAccess } from "@/lib/authz";
import { errorResponse } from "@/lib/http";
import { listMembers } from "@/lib/db/members";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    await requireSongbookAccess(id, { min: "manager" });
    return NextResponse.json({ members: await listMembers(id) });
  } catch (err) {
    return errorResponse(err);
  }
}
