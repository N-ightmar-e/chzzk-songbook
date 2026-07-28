import crypto from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "songbook_session";
const SECRET = process.env.SESSION_SECRET || "dev-only-secret-change-me";

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verify(value) {
  if (!value) return null;
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
}

export async function getSession() {
  const store = await cookies();
  return verify(store.get(COOKIE_NAME)?.value);
}

export async function setSession(payload) {
  const store = await cookies();
  store.set(COOKIE_NAME, sign(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24, // 액세스 토큰 만료(1일)와 동일
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
