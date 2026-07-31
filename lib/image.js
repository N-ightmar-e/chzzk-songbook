// 매직바이트로 이미지 종류를 판별한다.
// 파일명과 Content-Type 은 클라이언트가 위조하므로 신뢰하지 않는다.
// SVG는 스크립트를 담을 수 있어 화이트리스트에서 제외한다.

function startsWith(buffer, bytes) {
  if (buffer.length < bytes.length) return false;
  return bytes.every((byte, i) => buffer[i] === byte);
}

export function detectImageType(buffer) {
  if (!buffer || buffer.length < 8) return null;

  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";

  // WebP: "RIFF" + 4바이트 크기 + "WEBP"
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
    buffer.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "webp";
  }

  return null;
}
