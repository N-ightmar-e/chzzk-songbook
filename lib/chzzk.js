// 치지직 OpenAPI 클라이언트
// 문서: https://chzzk.gitbook.io/chzzk
//
// 공통 응답 봉투 (chzzk-api/tips 문서 기준)
//   성공: { "code": 200, "message": null, "content": {responseBody} }
//   실패: { "code": integer, "message": string }
import { optionalEnv } from "@/lib/env";

const AUTHORIZE_URL = "https://chzzk.naver.com/account-interlock"; // Open API와 다른 도메인
const API_BASE = "https://openapi.chzzk.naver.com";

export class ChzzkApiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "ChzzkApiError";
    this.status = status;
    this.code = code;
  }
}

export function isConfigured() {
  return Boolean(optionalEnv("CHZZK_CLIENT_ID") && optionalEnv("CHZZK_CLIENT_SECRET"));
}

export function buildAuthorizeUrl({ redirectUri, state }) {
  const params = new URLSearchParams({
    clientId: process.env.CHZZK_CLIENT_ID,
    redirectUri,
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

// 공통 봉투를 벗긴다. 인증 엔드포인트의 raw JSON 예시가 문서에 없어
// 봉투가 없는 형태도 함께 수용하되, 기대 필드는 반드시 검증한다.
async function unwrap(res, { context }) {
  let json;
  try {
    json = await res.json();
  } catch {
    throw new ChzzkApiError(`${context}: 응답을 JSON으로 읽지 못했습니다.`, { status: res.status });
  }

  if (!res.ok) {
    throw new ChzzkApiError(`${context}: ${json?.message ?? "요청 실패"}`, {
      status: res.status,
      code: json?.code,
    });
  }
  if (json?.code != null && Number(json.code) !== 200) {
    throw new ChzzkApiError(`${context}: ${json?.message ?? "요청 실패"}`, {
      status: res.status,
      code: Number(json.code),
    });
  }
  return json?.content ?? json;
}

function requireFields(obj, fields, context) {
  for (const field of fields) {
    if (obj?.[field] == null || obj[field] === "") {
      throw new ChzzkApiError(`${context}: 응답에 ${field}가 없습니다.`);
    }
  }
  return obj;
}

function toToken(content, context) {
  requireFields(content, ["accessToken", "refreshToken"], context);
  return {
    accessToken: content.accessToken,
    refreshToken: content.refreshToken,
    tokenType: content.tokenType ?? "Bearer",
    // 문서상 String("86400")으로 오므로 숫자로 정규화한다.
    expiresIn: Number(content.expiresIn ?? 86400),
  };
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
  const content = await unwrap(res, { context: "토큰 발급" });
  return toToken(content, "토큰 발급");
}

export async function fetchMe(accessToken) {
  const res = await fetch(`${API_BASE}/open/v1/users/me`, {
    // Bearer와 토큰 사이 공백이 빠지면 인증이 실패한다 (문서 주의사항).
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const content = await unwrap(res, { context: "유저 정보 조회" });
  requireFields(content, ["channelId", "channelName"], "유저 정보 조회");
  return { channelId: content.channelId, channelName: content.channelName };
}

const CHANNELS_BATCH = 20; // 문서상 최대 20개

function clientAuthHeaders() {
  return {
    "Client-Id": process.env.CHZZK_CLIENT_ID,
    "Client-Secret": process.env.CHZZK_CLIENT_SECRET,
    "Content-Type": "application/json",
  };
}

// 액세스 토큰 갱신. 리프레시 토큰은 일회용이므로 응답의 새 refreshToken을
// 반드시 저장해야 한다. 저장하지 않으면 다음 갱신이 영구히 실패한다.
export async function refreshAccessToken(refreshToken) {
  const res = await fetch(`${API_BASE}/auth/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grantType: "refresh_token",
      refreshToken,
      clientId: process.env.CHZZK_CLIENT_ID,
      clientSecret: process.env.CHZZK_CLIENT_SECRET,
    }),
  });
  const content = await unwrap(res, { context: "토큰 갱신" });
  return toToken(content, "토큰 갱신");
}

// 토큰 폐기. clientId와 user가 같은 모든 토큰이 제거되므로
// 일반 로그아웃이 아니라 연동 해제에서만 호출한다.
export async function revokeToken({ token, tokenTypeHint = "access_token" }) {
  const res = await fetch(`${API_BASE}/auth/v1/token/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: process.env.CHZZK_CLIENT_ID,
      clientSecret: process.env.CHZZK_CLIENT_SECRET,
      token,
      tokenTypeHint,
    }),
  });
  await unwrap(res, { context: "토큰 폐기" });
}

// 채널 정보 조회. Client 인증이라 사용자 토큰이 필요 없다.
// 한 번도 로그인한 적 없는 채널의 이름·이미지·인증마크도 가져올 수 있다.
export async function fetchChannels(channelIds) {
  const ids = [...new Set(channelIds.filter(Boolean))];
  if (ids.length === 0) return [];

  const rows = [];
  for (let i = 0; i < ids.length; i += CHANNELS_BATCH) {
    const batch = ids.slice(i, i + CHANNELS_BATCH);
    const params = new URLSearchParams({ channelIds: batch.join(",") });
    const res = await fetch(`${API_BASE}/open/v1/channels?${params}`, {
      headers: clientAuthHeaders(),
    });
    const content = await unwrap(res, { context: "채널 정보 조회" });
    rows.push(...(content?.data ?? []));
  }
  return rows;
}

// 채널 관리자 조회. Access Token 주인의 채널 관리자 목록을 반환한다.
// STREAMING_CHANNEL_OWNER 필터링은 호출자가 한다.
export async function fetchStreamingRoles(accessToken) {
  const res = await fetch(`${API_BASE}/open/v1/channels/streaming-roles`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const content = await unwrap(res, { context: "채널 관리자 조회" });
  return content?.data ?? [];
}
