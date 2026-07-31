// 자켓 이미지 저장소. 업로드는 반드시 서버를 거친다 —
// 클라이언트 직접 업로드나 서명 URL을 쓰면 아래 검증을 건너뛰게 된다.
import crypto from "node:crypto";
import { getDb } from "@/lib/db/client";
import { detectImageType } from "@/lib/image";

export const JACKETS_BUCKET = "jackets";

const MAX_BYTES = 2 * 1024 * 1024;
const EXTENSION = { jpeg: "jpg", png: "png", webp: "webp" };
const CONTENT_TYPE = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

export class UploadError extends Error {
  constructor(message) {
    super(message);
    this.name = "UploadError";
    this.status = 400;
  }
}

export async function uploadJacket(songbookId, file) {
  if (!file || typeof file === "string") {
    throw new UploadError("파일이 없어요.");
  }
  if (file.size > MAX_BYTES) {
    throw new UploadError("2MB 이하 이미지만 올릴 수 있어요.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const type = detectImageType(buffer);
  if (!type) {
    // 확장자·Content-Type 이 아니라 실제 바이트로 판정한다.
    throw new UploadError("JPG·PNG·WEBP 이미지만 올릴 수 있어요.");
  }

  // 확장자는 서버가 만든다. 클라이언트가 준 파일명은 쓰지 않는다.
  const path = `${songbookId}/${crypto.randomUUID()}.${EXTENSION[type]}`;

  const { error } = await getDb().storage
    .from(JACKETS_BUCKET)
    .upload(path, buffer, { contentType: CONTENT_TYPE[type], upsert: false });
  if (error) throw new Error(`자켓 업로드 실패: ${error.message}`);

  return { path, publicUrl: jacketPublicUrl(path) };
}

export async function deleteJacket(path) {
  if (!path) return;
  const { error } = await getDb().storage.from(JACKETS_BUCKET).remove([path]);
  // 이미 없는 파일이어도 곡 삭제를 막지 않는다. 고아 파일보다 나쁜 건
  // 지워진 곡이 목록에 남는 것이다.
  if (error) console.error("자켓 삭제 실패:", error.message);
}

export function jacketPublicUrl(path) {
  if (!path) return null;
  const { data } = getDb().storage.from(JACKETS_BUCKET).getPublicUrl(path);
  return data?.publicUrl ?? null;
}
