"use server";

import { redirect } from "next/navigation";
import { verifyIntranetLogin, upsertAppUser, logAccess, getCurrentUser } from "@/lib/auth";
import { setSession, clearSession } from "@/lib/session";

// กันเดารหัสผ่าน: ผิดเกิน 5 ครั้งใน 10 นาทีต่อรหัสพนักงาน ให้รอ
const fails = (globalThis.__mraLoginFails ??= new Map());
const WINDOW = 10 * 60 * 1000;
const MAX_FAILS = 5;

export async function login(_prev, formData) {
  const payrollNo = String(formData.get("payrollNo") ?? "").trim().toUpperCase();
  const password = String(formData.get("password") ?? "");
  if (!payrollNo || !password) return { error: "กรุณากรอกรหัสพนักงานและรหัสผ่าน", payrollNo };

  const f = fails.get(payrollNo);
  if (f && f.count >= MAX_FAILS && Date.now() - f.first < WINDOW) {
    return { error: "ใส่รหัสผ่านผิดหลายครั้ง กรุณารอ 10 นาทีแล้วลองใหม่", payrollNo };
  }

  let emp;
  try {
    emp = await verifyIntranetLogin(payrollNo, password);
  } catch (err) {
    console.error("login: DB error", err.message);
    return { error: "เชื่อมต่อฐานข้อมูลไม่ได้ กรุณาแจ้งกลุ่มงานสุขภาพดิจิทัล", payrollNo };
  }
  if (!emp) {
    const cur = f && Date.now() - f.first < WINDOW ? f : { count: 0, first: Date.now() };
    fails.set(payrollNo, { ...cur, count: cur.count + 1 });
    return { error: "รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง หรือบัญชีพ้นสภาพแล้ว", payrollNo };
  }
  fails.delete(payrollNo);
  if (fails.size > 5000) fails.clear(); // กัน Map โตไม่จำกัด

  const user = await upsertAppUser(payrollNo, emp.FullName);
  if (!user.IsActive) return { error: "บัญชีนี้ถูกปิดการใช้งานในระบบ MRA กรุณาติดต่อผู้ดูแล", payrollNo };

  await setSession({ userId: user.UserId });
  await logAccess(user.UserId, "LOGIN");
  redirect("/");
}

export async function logout() {
  const user = await getCurrentUser();
  if (user) await logAccess(user.UserId, "LOGOUT");
  await clearSession();
  redirect("/login");
}
