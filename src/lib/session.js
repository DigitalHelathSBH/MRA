import "server-only";
import { cookies } from "next/headers";
import { sealData, unsealData } from "iron-session";

const COOKIE = "mra_session";
const TTL = 60 * 60 * 8; // 8 ชั่วโมง (1 เวร)

function password() {
  const p = process.env.SESSION_PASSWORD;
  if (!p || p.length < 32) throw new Error("SESSION_PASSWORD ต้องยาวอย่างน้อย 32 ตัวอักษร");
  return p;
}

export async function getSession() {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return {};
  try {
    return await unsealData(raw, { password: password(), ttl: TTL });
  } catch {
    return {};
  }
}

export async function setSession(data) {
  const sealed = await sealData(data, { password: password(), ttl: TTL });
  (await cookies()).set(COOKIE, sealed, {
    httpOnly: true,
    sameSite: "lax",
    // production ใช้ HTTPS ผ่าน Nginx · ตั้ง COOKIE_SECURE=false ได้ชั่วคราวถ้ายังไม่มี HTTPS
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false",
    path: "/",
    maxAge: TTL,
  });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

export const SESSION_COOKIE = COOKIE;
