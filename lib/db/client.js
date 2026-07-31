// Supabase 서버 클라이언트. sb_secret_ 키를 쓰므로 RLS를 우회한다.
// 이 모듈은 절대 클라이언트 컴포넌트에서 import되면 안 된다.
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

// postgrest-js는 쿼리를 만들 때마다 그 시점의 전역 fetch를 참조한다.
// 테스트가 치지직 API를 스텁하려고 전역 fetch를 갈아끼우면 Supabase 쿼리까지
// 스텁을 타 버리므로, 모듈 로드 시점의 진짜 fetch를 붙잡아 명시적으로 넘긴다.
const boundFetch = globalThis.fetch.bind(globalThis);

let client = null;

export function getDb() {
  if (client) return client;
  client = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: boundFetch },
  });
  return client;
}

// 테스트에서 환경변수를 바꿔 끼울 때 쓴다.
export function resetDb() {
  client = null;
}
