import { describe } from "vitest";

// .env.test 가 없으면 DB 통합 테스트를 통째로 건너뛴다.
// 이렇게 해야 DB 없이도 pnpm test 가 항상 통과한다.
export const describeDb =
  process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY ? describe : describe.skip;

// FK 역순으로 지운다. PostgREST는 조건 없는 delete를 거부하므로
// 각 테이블의 timestamp 컬럼에 "항상 참"인 조건을 건다.
const TRUNCATE_ORDER = [
  ["sessions", "created_at"],
  ["songbook_slug_history", "released_at"],
  ["songs", "created_at"],
  ["songbook_invites", "created_at"],
  ["songbook_members", "created_at"],
  ["songbooks", "created_at"],
  ["user_tokens", "updated_at"],
  ["users", "created_at"],
];

export async function truncateAll(db) {
  for (const [table, column] of TRUNCATE_ORDER) {
    const { error } = await db.from(table).delete().gt(column, "1970-01-01");
    if (error) throw new Error(`${table} 비우기 실패: ${error.message}`);
  }
}
