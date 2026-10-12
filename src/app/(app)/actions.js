"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireUser, logAccess, CAN_EDIT } from "@/lib/auth";
import { addWorklistByAN, saveAudit, SaveError } from "@/lib/audit";

export async function addCase(_prev, formData) {
  const user = await requireUser(CAN_EDIT);
  const an = String(formData.get("an") ?? "").trim();
  if (!/^\d{6,12}$/.test(an)) return { error: "AN ต้องเป็นตัวเลขเท่านั้น", an };
  const r = await addWorklistByAN(an, user);
  if (r.error) return { error: r.error, an };
  await logAccess(user.UserId, "WORKLIST_ADD", r.an);
  redirect(`/audit/${r.an}`);
}

// mode: 'draft' | 'complete'
export async function saveAuditAction(payload, mode) {
  const user = await requireUser(CAN_EDIT);
  try {
    const r = await saveAudit(payload, mode, user);
    await logAccess(user.UserId, mode === "complete" ? "AUDIT_COMPLETE" : "AUDIT_SAVE", payload.an);
    refresh();
    return { ok: true, ...r };
  } catch (err) {
    if (err instanceof SaveError) return { error: err.message };
    // error จาก THROW ใน stored procedure (50000+) เป็นข้อความสำหรับผู้ใช้
    if (err.number >= 50000) return { error: err.message };
    console.error(`saveAudit failed (user ${user.UserId}):`, err.message);
    return { error: "บันทึกไม่สำเร็จ เกิดข้อผิดพลาดที่ฐานข้อมูล กรุณาลองใหม่หรือแจ้งผู้ดูแล" };
  }
}
