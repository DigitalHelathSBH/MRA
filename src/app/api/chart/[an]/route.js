import { getCurrentUser, logAccess } from "@/lib/auth";
import { query, sql } from "@/lib/db";

// เวชระเบียนสแกน (PDF) ของ AN — ส่งต่อจากเครื่องเก็บไฟล์ของ รพ. ผ่านเว็บนี้ เพื่อให้
// ต้อง login, ดูได้เฉพาะ AN ที่อยู่ในรายการตรวจ และบันทึก AccessLog ทุกครั้ง
// CHART_PDF_URL ใน .env เช่น http://<host>/chart/{an}.pdf
export async function GET(_req, { params }) {
  const { an } = await params;
  const user = await getCurrentUser();
  if (!user) return message(401, "กรุณาเข้าสู่ระบบ");
  if (!/^\d{6,12}$/.test(an)) return message(400, "AN ไม่ถูกต้อง");

  const tpl = process.env.CHART_PDF_URL;
  if (!tpl || !tpl.includes("{an}")) return message(503, "ยังไม่ได้ตั้งค่าแหล่งเวชระเบียนสแกน (CHART_PDF_URL)");

  const inList = await query(`SELECT 1 FROM mra.AuditWorklist WHERE AN = @an AND WorklistStatus <> 'CANCELLED'`, {
    an: [sql.VarChar(20), an],
  });
  if (!inList.recordset.length) return message(403, "ดูเวชระเบียนสแกนได้เฉพาะเคสที่อยู่ในรายการตรวจ");

  let res;
  try {
    res = await fetch(tpl.replace("{an}", encodeURIComponent(an)), { signal: AbortSignal.timeout(30000), cache: "no-store" });
  } catch {
    return message(502, "เชื่อมต่อเครื่องเก็บเวชระเบียนสแกนไม่ได้");
  }
  if (res.status === 404) return message(404, `ไม่พบเวชระเบียนสแกนของ AN ${an}`);
  if (!res.ok || !res.body) return message(502, "เครื่องเก็บเวชระเบียนสแกนตอบกลับผิดปกติ");

  await logAccess(user.UserId, "CHART_VIEW", an);
  return new Response(res.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${an}.pdf"`,
      "Cache-Control": "no-store",
      "X-Frame-Options": "SAMEORIGIN", // แสดงใน iframe ของหน้าแบบตรวจได้ (เว็บอื่นฝังไม่ได้)
      ...(res.headers.get("content-length") ? { "Content-Length": res.headers.get("content-length") } : {}),
    },
  });
}

// ข้อความแสดงใน iframe แทน PDF
function message(status, text) {
  const html = `<!doctype html><meta charset="utf-8"><body style="font:15px 'Leelawadee UI',Tahoma,sans-serif;color:#555;display:grid;place-items:center;height:90vh;margin:0;background:#f8f7fa"><p>${text}</p></body>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "SAMEORIGIN" } });
}
