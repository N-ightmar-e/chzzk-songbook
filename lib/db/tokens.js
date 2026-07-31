// 치지직 토큰 저장소. 평문은 절대 DB에 넣지 않는다.
// 키는 환경변수, 암호문은 DB — 둘이 분리되어야 DB 유출이 곧 토큰 유출이 되지 않는다.
import { getDb } from "@/lib/db/client";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { refreshAccessToken } from "@/lib/chzzk";
import { failed } from "@/lib/db/errors";

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 문서상 30일
const LOCK_TTL_MS = 30 * 1000;   // 갱신 락 유효시간
const SKEW_MS = 60 * 1000;       // 만료 임박 여유

export class TokenRefreshBusyError extends Error {
  constructor() {
    super("다른 요청이 토큰을 갱신하는 중입니다.");
    this.name = "TokenRefreshBusyError";
  }
}

export async function saveTokens(userId, { accessToken, refreshToken, expiresIn }) {
  const now = Date.now();
  const { error } = await getDb().from("user_tokens").upsert(
    {
      user_id: userId,
      access_token_enc: encryptSecret(accessToken),
      refresh_token_enc: encryptSecret(refreshToken),
      access_token_expires_at: new Date(now + Number(expiresIn) * 1000).toISOString(),
      refresh_token_expires_at: new Date(now + REFRESH_TOKEN_TTL_MS).toISOString(),
      refresh_lock_until: new Date(0).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) failed(error, "토큰 저장");
}

export async function deleteTokens(userId) {
  const { error } = await getDb().from("user_tokens").delete().eq("user_id", userId);
  if (error) failed(error, "토큰 삭제");
}

async function loadRow(userId) {
  const { data, error } = await getDb()
    .from("user_tokens").select().eq("user_id", userId).maybeSingle();
  if (error) failed(error, "토큰 조회");
  return data;
}

// 조건부 UPDATE로 락을 선점한다. PostgREST는 SELECT ... FOR UPDATE를 못 쓴다.
// 갱신된 행이 없으면 다른 요청이 이미 갱신 중이다.
async function acquireRefreshLock(userId) {
  const nowIso = new Date().toISOString();
  const { data, error } = await getDb()
    .from("user_tokens")
    .update({ refresh_lock_until: new Date(Date.now() + LOCK_TTL_MS).toISOString() })
    .eq("user_id", userId)
    .lt("refresh_lock_until", nowIso)
    .select();
  if (error) failed(error, "토큰 갱신 락");
  return data?.length === 1;
}

// 락 해제는 best-effort다. 이미 실패 경로에서 호출되므로 여기서 또 throw하면
// 원래 오류를 덮어쓴다. 해제에 실패해도 refresh_lock_until 이 30초 뒤 만료되어
// 자가 치유된다. 그래서 error를 검사하지 않는다.
async function releaseRefreshLock(userId) {
  await getDb().from("user_tokens")
    .update({ refresh_lock_until: new Date(0).toISOString() })
    .eq("user_id", userId);
}

// 유효한 액세스 토큰을 준다. 만료됐으면 갱신한다.
// 갱신 불가(리프레시 만료 등)면 행을 지우고 null을 준다 — 호출자는
// 동기화를 조용히 중단하고, 소유자가 다시 로그인하면 자동 복구된다.
export async function getValidAccessToken(userId) {
  const row = await loadRow(userId);
  if (!row) return null;

  const accessAlive = new Date(row.access_token_expires_at).getTime() - SKEW_MS > Date.now();
  if (accessAlive) return decryptSecret(row.access_token_enc);

  if (new Date(row.refresh_token_expires_at).getTime() <= Date.now()) {
    await deleteTokens(userId);
    return null;
  }

  if (!(await acquireRefreshLock(userId))) {
    throw new TokenRefreshBusyError();
  }

  try {
    const refreshed = await refreshAccessToken(decryptSecret(row.refresh_token_enc));
    // 리프레시 토큰은 일회용이다. 새 값을 반드시 덮어써야 다음 갱신이 산다.
    await saveTokens(userId, refreshed);
    return refreshed.accessToken;
  } catch (err) {
    // 치지직은 실패를 HTTP 상태로도, 공통 봉투의 code로도 전달할 수 있다.
    // status만 보면 "HTTP 200 + 봉투 code 401" 응답을 놓쳐 죽은 토큰이 영원히 남는다.
    if (err?.status === 401 || err?.code === 401) {
      // 리프레시 토큰이 이미 죽었다. 재로그인으로만 복구된다.
      await deleteTokens(userId);
      return null;
    }
    await releaseRefreshLock(userId);
    throw err;
  }
}
