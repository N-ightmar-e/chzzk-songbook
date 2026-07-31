// uuid 형식 판별. DB에 넘기기 전에 거른다 —
// uuid가 아닌 값을 조회하면 Postgres가 22P02 invalid input syntax 를 던진다.
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}
