// 치지직 OpenAPI 스펙: https://chzzk.gitbook.io/chzzk/chzzk-api/authorization
const AUTHORIZE_URL = "https://chzzk.naver.com/account-interlock";
const API_BASE = "https://openapi.chzzk.naver.com";

export function isConfigured() {
  return Boolean(process.env.CHZZK_CLIENT_ID && process.env.CHZZK_CLIENT_SECRET);
}

export function buildAuthorizeUrl({ redirectUri, state }) {
  const params = new URLSearchParams({
    clientId: process.env.CHZZK_CLIENT_ID,
    redirectUri,
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

export async function exchangeCodeForToken({ code, state }) {
  const res = await fetch(`${API_BASE}/auth/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grantType: "authorization_code",
      clientId: process.env.CHZZK_CLIENT_ID,
      clientSecret: process.env.CHZZK_CLIENT_SECRET,
      code,
      state,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const json = await res.json();
  // 응답은 { content: { accessToken, refreshToken, ... } } 래핑 여부가 문서에 명시돼
  // 있지 않아 두 형태 모두 수용한다. TODO(handoff): 실 credential로 응답 형태 확정
  return json.content ?? json;
}

export async function fetchMe(accessToken) {
  const res = await fetch(`${API_BASE}/open/v1/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`users/me failed: ${res.status}`);
  const json = await res.json();
  return json.content ?? json;
}
