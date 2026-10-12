import { getCurrentUser, logAccess } from "@/lib/auth";
import { query, sql } from "@/lib/db";

// เวชระเบียนสแกน (PDF) ของ AN — ส่งต่อจากเครื่องเก็บไฟล์ของ รพ. ผ่านเว็บนี้ เพื่อให้
// ต้อง login, ดูได้เฉพาะ AN ที่อยู่ในรายการตรวจ และบันทึก AccessLog ทุกครั้ง
// CHART_PDF_URL ใน .env เช่น http://<host>/chart/{an}.pdf
export async function GET(req, { params }) {
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

  // ไฟล์ใหญ่ได้ถึงหลักร้อย MB: timeout เฉพาะช่วงรอ header (ไม่ตัดระหว่างส่งไฟล์)
  // และส่ง Range ต่อ เพื่อให้ตัวแสดง PDF ของเบราว์เซอร์โหลดทีละส่วนได้
  const range = req.headers.get("range");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  req.signal?.addEventListener("abort", () => ctrl.abort()); // ผู้ใช้ปิดหน้า → หยุดดึงไฟล์
  let res;
  try {
    res = await fetch(tpl.replace("{an}", encodeURIComponent(an)), {
      signal: ctrl.signal, cache: "no-store", headers: range ? { Range: range } : {},
    });
  } catch {
    return message(502, "เชื่อมต่อเครื่องเก็บเวชระเบียนสแกนไม่ได้");
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) return message(404, `ไม่พบเวชระเบียนสแกนของ AN ${an}`);
  if (res.status === 416) return new Response(null, { status: 416, headers: pass(res, ["content-range"]) });
  if (!res.ok || !res.body) return message(502, "เครื่องเก็บเวชระเบียนสแกนตอบกลับผิดปกติ");

  // log ครั้งเดียวต่อการเปิด (คำขอแรกไม่มี Range หรือเริ่มที่ byte 0) ไม่ใช่ทุกชิ้นที่โหลด
  if (!range || /^bytes=0-/.test(range)) await logAccess(user.UserId, "CHART_VIEW", an);
  return new Response(res.body, {
    status: res.status, // 200 หรือ 206
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${an}.pdf"`,
      "Cache-Control": "no-store",
      "X-Frame-Options": "SAMEORIGIN", // แสดงใน iframe ของหน้าแบบตรวจได้ (เว็บอื่นฝังไม่ได้)
      ...pass(res, ["content-length", "content-range", "accept-ranges"]),
    },
  });
}

function pass(res, names) {
  const h = {};
  for (const n of names) if (res.headers.get(n)) h[n] = res.headers.get(n);
  return h;
}

// ข้อความแสดงใน iframe แทน PDF
function message(status, text) {
  const html = `<!doctype html><meta charset="utf-8"><body style="font:15px 'Leelawadee UI',Tahoma,sans-serif;color:#555;display:grid;place-items:center;height:90vh;margin:0;background:#f8f7fa"><p>${text}</p></body>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "SAMEORIGIN" } });
}
