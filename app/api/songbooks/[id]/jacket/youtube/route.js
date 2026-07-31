import { NextResponse } from "next/server";
import { requireSongbookAccess } from "@/lib/authz";
import { errorResponse, requireSameOrigin } from "@/lib/http";
import { uploadJacketFromYoutube, UploadError } from "@/lib/storage";

export async function POST(request, { params }) {
  try {
    requireSameOrigin(request);
    const { id } = await params;
    await requireSongbookAccess(id, { min: "manager" });

    const input = await request.json();
    const result = await uploadJacketFromYoutube(id, input?.videoId);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof UploadError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return errorResponse(err);
  }
}
