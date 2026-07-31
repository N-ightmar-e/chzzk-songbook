// 초대 토큰. 원문은 DB에 넣지 않고 해시만 저장한다 —
// DB가 유출돼도 초대 링크를 재사용할 수 없게 하기 위해서다.
import crypto from "node:crypto";

export function hashInviteToken(token) {
  return crypto.createHash("sha256").update(String(token ?? "")).digest("hex");
}

export function createInviteToken() {
  const token = crypto.randomBytes(32).toString("hex");
  return { token, tokenHash: hashInviteToken(token) };
}
