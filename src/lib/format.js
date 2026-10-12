const MTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

// รับ Date หรือ 'YYYY-MM-DD' → '7 ส.ค. 2569'
export function thDate(v) {
  if (!v) return "";
  const iso = v instanceof Date ? isoDate(v) : String(v).slice(0, 10);
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MTH[m - 1]} ${y + 543}`;
}

// วันที่จาก SQL (DATE) มาเป็น Date เวลา 00:00 UTC → ใช้ส่วน UTC เพื่อไม่ให้วันเลื่อน
export function isoDate(v) {
  if (!v) return "";
  if (typeof v === "string") return v.slice(0, 10);
  return v.toISOString().slice(0, 10);
}

export function todayISO() {
  const t = new Date();
  t.setMinutes(t.getMinutes() - t.getTimezoneOffset());
  return t.toISOString().slice(0, 10);
}

// mssql อ่าน DATETIME2 (เวลาไทยที่ SQL Server บันทึก) เป็น UTC จึงต้องใช้ getter แบบ UTC
export function thDateTime(v) {
  if (!v) return "";
  const d = new Date(v);
  return `${thDate(d)} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export const STATUS_TH = {
  PENDING: "รอตรวจ",
  IN_PROGRESS: "ร่าง",
  COMPLETED: "ตรวจเสร็จ",
  CANCELLED: "ยกเลิก",
  LEGACY: "บันทึกจากระบบเดิม",
};

const MTH_FULL = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

// 'YYYY-MM' → { short: 'ก.ค.', label: 'ก.ค. 2569', full: 'กรกฎาคม 2569' }
export function monLabel(mon) {
  const [y, m] = mon.split("-").map(Number);
  return { short: MTH[m - 1], label: `${MTH[m - 1]} ${y + 543}`, full: `${MTH_FULL[m - 1]} ${y + 543}` };
}

export const pctText = (v) => (v == null ? "–" : `${v.toFixed(1)}%`);
