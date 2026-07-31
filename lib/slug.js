// slug 규칙. 노래책 주소 /@slug 에 쓰인다.
//
// 유니코드를 불허하는 이유: 셀프서비스 선착순이라, 시각적으로 동일한 유니코드 문자
// (homograph)로 유명 스트리머를 사칭할 수 있다. 예약어 차단도 라우팅 충돌이 아니라
// 사칭 방지가 목적이다(@ 접두사라 시스템 경로와는 애초에 충돌하지 않는다).
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{1,29}$/;

export const RESERVED_SLUGS = new Set([
  "admin", "official", "staff", "support", "help",
  "chzzk", "naver", "songbook", "api", "system",
]);

export function normalizeSlug(raw) {
  return String(raw ?? "").trim().toLowerCase();
}

// 문제가 없으면 null, 있으면 사용자에게 보여줄 한국어 메시지를 반환한다.
export function validateSlug(slug) {
  const value = String(slug ?? "");
  if (value.length < 2) return "주소는 2자 이상이어야 해요.";
  if (value.length > 30) return "주소는 30자 이하여야 해요.";
  if (!SLUG_RE.test(value)) {
    return "주소는 영문 소문자·숫자로 시작하고, 영문 소문자·숫자·- _ 만 쓸 수 있어요.";
  }
  if (RESERVED_SLUGS.has(value)) return "이 주소는 사용할 수 없어요.";
  return null;
}
