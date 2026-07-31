// Supabase는 { data, error } 를 반환하고 예외를 던지지 않는다.
// error 를 확인하지 않고 data 를 쓰면 실패가 조용히 null 로 흘러간다.
export function failed(error, what) {
  throw new Error(`${what} 실패: ${error.message}`);
}
