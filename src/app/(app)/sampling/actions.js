"use server";

import { requireUser, logAccess, CAN_EDIT } from "@/lib/auth";
import { drawSample, saveSample, getSampleBatch } from "@/lib/sampling";

export async function drawAction(month) {
  const user = await requireUser(CAN_EDIT);
  try {
    const batch = await getSampleBatch(month);
    if (batch) return { error: `เดือนนี้สุ่มและบันทึกไปแล้ว ${batch.InsertedRows} ราย โดย ${batch.FullName}` };
    const rows = await drawSample(month);
    await logAccess(user.UserId, "SAMPLE_DRAW", null, `month ${month}, ${rows.length} rows`);
    return { rows };
  } catch (err) {
    console.error(`drawSample failed (user ${user.UserId}):`, err.message);
    return { error: "สุ่มรายชื่อไม่สำเร็จ กรุณาลองใหม่หรือแจ้งผู้ดูแล" };
  }
}

export async function saveSampleAction(month, items, auditMonth) {
  const user = await requireUser(CAN_EDIT);
  try {
    const r = await saveSample(month, items, user, auditMonth);
    await logAccess(user.UserId, "IMPORT", null, `RANDOM-${month}: inserted ${r.inserted}, skipped ${r.skipped}`);
    return { ok: true, ...r };
  } catch (err) {
    console.error(`saveSample failed (user ${user.UserId}):`, err.message);
    return { error: err.userMessage ? err.message : "บันทึกรายชื่อไม่สำเร็จ กรุณาลองใหม่" };
  }
}
