// sessions 테이블 저장소. 로그아웃은 쿠키 삭제만으로 부족하므로
// revoked_at을 남겨 서버에서 확실히 끊는다.
import { getDb } from "@/lib/db/client";
import { findUserById } from "@/lib/db/users";
import { UUID_RE } from "@/lib/uuid";
import { failed } from "@/lib/db/errors";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30일
const RENEW_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7일 미만 남으면 연장

export async function createSession({ userId, userAgent = null, ip = null }) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const { data, error } = await getDb()
    .from("sessions")
    .insert({ user_id: userId, expires_at: expiresAt, user_agent: userAgent, ip })
    .select()
    .single();
  if (error) failed(error, "세션 생성");
  return { id: data.id, expiresAt: data.expires_at };
}

export async function resolveSession(sessionId) {
  // uuid가 아니면 DB에 물어볼 것도 없다. 물어보면 22P02 에러가 난다.
  if (!sessionId || !UUID_RE.test(sessionId)) return null;

  const { data, error } = await getDb()
    .from("sessions").select().eq("id", sessionId).maybeSingle();
  if (error) failed(error, "세션 조회");
  if (!data) return null;
  if (data.revoked_at) return null;

  const expiresAtMs = new Date(data.expires_at).getTime();
  if (expiresAtMs <= Date.now()) return null;

  const user = await findUserById(data.user_id);
  if (!user) return null;

  // 만료가 임박하면 슬라이딩 연장한다. 매 요청마다 쓰지 않기 위해 임계값을 둔다.
  let expiresAt = data.expires_at;
  if (expiresAtMs - Date.now() < RENEW_THRESHOLD_MS) {
    const renewed = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    const { error: renewError } = await getDb()
      .from("sessions").update({ expires_at: renewed }).eq("id", sessionId);
    // 연장은 부가 작업이다. 실패해도 세션 자체는 여전히 유효하므로 throw하지 않는다
    // (연장 실패로 조회를 실패시키면 멀쩡한 세션이 로그아웃처럼 보인다).
    // 다만 DB에 반영되지 않은 값을 반영된 척 돌려주면 안 되므로 기존 값을 유지한다.
    if (renewError) {
      console.error("세션 연장 실패:", renewError.message);
    } else {
      expiresAt = renewed;
    }
  }

  return { session: { id: data.id, expiresAt }, user };
}

export async function revokeSession(sessionId) {
  if (!sessionId || !UUID_RE.test(sessionId)) return;
  const { error } = await getDb()
    .from("sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) failed(error, "세션 폐기");
}
