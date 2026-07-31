import { NextResponse } from "next/server";
import { requireSongbookAccess } from "@/lib/authz";
import { errorResponse, requireSameOrigin } from "@/lib/http";
import { uploadJacket, UploadError } from "@/lib/storage";

export async function POST(request, { params }) {
  try {
    requireSameOrigin(request);
    const { id } = await params;
    await requireSongbookAccess(id, { min: "manager" });

    const form = await request.formData();
    const result = await uploadJacket(id, form.get("file"));
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof UploadError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return errorResponse(err);
  }
}
