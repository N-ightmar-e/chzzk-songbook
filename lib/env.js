// 환경변수 검증. 프로덕션에서 필수 변수가 비면 부팅을 막는다.
// 기본값으로 조용히 넘어가면 운영에서 위조 가능한 세션이 발급된다.

const PRODUCTION_REQUIRED = [
  "SESSION_SECRET",
  "TOKEN_ENCRYPTION_KEY",
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
];

export function isProduction() {
  return process.env.NODE_ENV === "production";
}

export function optionalEnv(name) {
  const value = process.env[name];
  if (value == null || value.trim() === "") return undefined;
  return value;
}

export function requireEnv(name) {
  const value = optionalEnv(name);
  if (value === undefined) {
    throw new Error(`환경변수 ${name}가 설정되지 않았습니다.`);
  }
  return value;
}

export function assertProductionEnv() {
  if (!isProduction()) return;
  const missing = PRODUCTION_REQUIRED.filter((name) => optionalEnv(name) === undefined);
  if (missing.length > 0) {
    throw new Error(`프로덕션 필수 환경변수가 없습니다: ${missing.join(", ")}`);
  }
}
