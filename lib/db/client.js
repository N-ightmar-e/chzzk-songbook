// Supabase 서버 클라이언트. sb_secret_ 키를 쓰므로 RLS를 우회한다.
// 이 모듈은 절대 클라이언트 컴포넌트에서 import되면 안 된다.
import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

let client = null;

export function getDb() {
  if (client) return client;
  client = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

// 테스트에서 환경변수를 바꿔 끼울 때 쓴다.
export function resetDb() {
  client = null;
}
