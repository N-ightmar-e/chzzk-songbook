// 치지직 토큰 등 민감값의 대칭 암호화. AES-256-GCM.
// 키는 환경변수(TOKEN_ENCRYPTION_KEY)에, 암호문은 DB에 둔다.
// 둘이 분리되어 있으므로 DB가 통째로 유출되어도 복호화되지 않는다.
import crypto from "node:crypto";
import { requireEnv } from "@/lib/env";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM 권장값

function loadKey() {
  const key = Buffer.from(requireEnv("TOKEN_ENCRYPTION_KEY"), "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY는 base64로 인코딩된 32바이트여야 합니다.");
  }
  return key;
}

export function encryptSecret(plaintext) {
  const key = loadKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptSecret(stored) {
  const parts = String(stored ?? "").split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("암호문 형식이 올바르지 않습니다.");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    loadKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  // 변조·키불일치는 final()에서 인증 태그 검증 실패로 throw된다.
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
