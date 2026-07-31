// 인가 판정 단일 창구.
// 이 프로젝트는 RLS를 심층방어로만 쓰므로(스펙 "왜 RLS가 주 방어선이 아닌가" 참조)
// 인가 로직이 이 파일 밖에 존재하면 그게 곧 취약점이다.
// 모든 쓰기 라우트 핸들러는 첫 줄에서 requireSongbookAccess를 호출한다.
import { getSessionCookie } from "@/lib/session";
import { resolveSession } from "@/lib/db/sessions";
import { getDb } from "@/lib/db/client";
import { isProduction } from "@/lib/env";
import { UUID_RE } from "@/lib/uuid";
import { failed } from "@/lib/db/errors";

export class AuthzError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "AuthzError";
    this.status = status;
  }
}

export async function currentUser() {
  const sessionId = await getSessionCookie();
  if (!sessionId) return null;
  const resolved = await resolveSession(sessionId);
  return resolved?.user ?? null;
}

// 'owner' | 'manager' | 'operator' | null
// 소유자가 운영자를 겸하면 owner를 우선한다 — 자기 노래책에서는 소유자 권한이 더 넓다.
export async function accessLevel(user, songbookId) {
  if (!user || !songbookId || !UUID_RE.test(songbookId)) return null;

  const db = getDb();
  const { data: songbook, error } = await db
    .from("songbooks").select("id, owner_id").eq("id", songbookId).maybeSingle();
  if (error) failed(error, "노래책 조회");
  if (!songbook) return null;

  if (songbook.owner_id === user.id) return "owner";

  const { data: member, error: memberError } = await db
    .from("songbook_members").select("role")
    .eq("songbook_id", songbookId).eq("user_id", user.id).maybeSingle();
  if (memberError) failed(memberError, "멤버 조회");
  if (member) return "manager";

  if (user.role === "operator") return "operator";
  return null;
}

// min별 통과 집합. 서열로 유도하지 않고 명시한다 —
// ownerOnly는 operator를 배제해야 해서 서열로 표현할 수 없다.
const ALLOWED = {
  manager: new Set(["manager", "owner", "operator"]),
  owner: new Set(["owner", "operator"]),
  ownerOnly: new Set(["owner"]),
};

// 권한이 없으면 403이 아니라 404를 던진다.
// 403은 "그 노래책이 존재한다"를 누설해 비공개 노래책을 탐지당한다.
export async function requireSongbookAccess(songbookId, { min, user } = {}) {
  const allowed = ALLOWED[min];
  if (!allowed) throw new Error(`알 수 없는 권한 기준: ${min}`);

  // user 주입은 테스트 전용 시임이다. 프로덕션에서 허용하면 라우트가 요청 유래 값을
  // 넘기는 순간 인가가 통째로 우회된다(accessLevel은 user.role을 DB 재조회 없이 신뢰한다).
  if (user !== undefined && isProduction()) {
    throw new Error("requireSongbookAccess의 user 주입은 테스트 전용입니다.");
  }
  const actor = user !== undefined ? user : await currentUser();
  if (!actor) throw new AuthzError(401, "로그인이 필요해요.");

  const level = await accessLevel(actor, songbookId);
  if (!level || !allowed.has(level)) {
    throw new AuthzError(404, "찾을 수 없어요.");
  }
  return { user: actor, level };
}
