// 세션 쿠키. 담기는 값은 세션 ID 하나뿐이다.
// 치지직 토큰은 user_tokens 테이블로 갔다 — 쿠키에 두면 평문 노출이다.
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { isProduction, optionalEnv, requireEnv } from "@/lib/env";

export const SESSION_COOKIE_NAME = "songbook_session";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30일

function secret() {
  // 프로덕션에서는 반드시 설정돼야 한다. 기본값을 쓰면 세션 위조가 가능하다.
  if (isProduction()) return requireEnv("SESSION_SECRET");
  return optionalEnv("SESSION_SECRET") ?? "dev-only-secret-change-me";
}

export function signSessionId(id) {
  const body = Buffer.from(String(id)).toString("base64url");
  const mac = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifySessionCookie(value) {
  if (!value || typeof value !== "string") return null;
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return Buffer.from(body, "base64url").toString();
}

export async function getSessionCookie() {
  const store = await cookies();
  return verifySessionCookie(store.get(SESSION_COOKIE_NAME)?.value);
}

export async function setSessionCookie(sessionId) {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, signSessionId(sessionId), {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}
