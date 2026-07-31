// 자켓 이미지 저장소. 업로드는 반드시 서버를 거친다 —
// 클라이언트 직접 업로드나 서명 URL을 쓰면 아래 검증을 건너뛰게 된다.
import crypto from "node:crypto";
import { getDb } from "@/lib/db/client";
import { failed } from "@/lib/db/errors";
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
  if (error) failed(error, "자켓 업로드");

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

// 자켓 경로는 uploadJacket / uploadJacketFromYoutube 가 만든 것만 유효하다.
// 임의 문자열을 허용하면 매직바이트 검증을 우회하고, 더 나쁘게는 남의 노래책
// 자켓 경로를 가리켜 곡 삭제 시 그 파일이 지워진다.
export function isJacketPathOf(songbookId, path) {
  const value = String(path ?? "");
  const prefix = `${songbookId}/`;
  if (!value.startsWith(prefix)) return false;
  return /^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(value.slice(prefix.length));
}

// 유튜브 videoId 형식. 서버가 주소를 조립하므로 여기서 걸러야 경로 주입이 막힌다.
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

// 화질 좋은 것부터 시도한다. maxres 는 없는 영상이 많아 hqdefault 로 물러난다.
const THUMBNAIL_NAMES = ["maxresdefault.jpg", "hqdefault.jpg"];

// 유튜브 썸네일을 받아 Storage에 올린다.
//
// 사용자에게서 URL을 받지 않는다 — videoId 만 받아 서버가 주소를 조립하므로
// SSRF 경로가 없다. 받은 바이트도 업로드와 똑같이 매직바이트로 검증한다.
export async function uploadJacketFromYoutube(songbookId, videoId) {
  if (!YOUTUBE_ID_RE.test(String(videoId ?? ""))) {
    throw new UploadError("유튜브 영상 주소를 확인해 주세요.");
  }

  let buffer = null;
  for (const name of THUMBNAIL_NAMES) {
    const res = await fetch(`https://i.ytimg.com/vi/${videoId}/${name}`);
    if (!res.ok) continue;
    const candidate = Buffer.from(await res.arrayBuffer());
    if (candidate.length > 0) {
      buffer = candidate;
      break;
    }
  }
  if (!buffer) throw new UploadError("썸네일을 가져오지 못했어요.");

  if (buffer.length > MAX_BYTES) {
    throw new UploadError("2MB 이하 이미지만 자켓으로 쓸 수 있어요.");
  }

  // 유튜브가 오류 페이지를 200으로 주는 경우가 있어 바이트로 다시 확인한다.
  const type = detectImageType(buffer);
  if (!type) throw new UploadError("썸네일이 이미지가 아니에요.");

  const path = `${songbookId}/${crypto.randomUUID()}.${EXTENSION[type]}`;
  const { error } = await getDb().storage
    .from(JACKETS_BUCKET)
    .upload(path, buffer, { contentType: CONTENT_TYPE[type], upsert: false });
  if (error) failed(error, "썸네일 저장");

  return { path, publicUrl: jacketPublicUrl(path) };
}
