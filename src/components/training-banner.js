import { connection } from "next/server";

// แถบเตือนเมื่อเว็บต่อฐานข้อมูลทดสอบ (เช่น ใช้สอนผู้ใช้) — แสดงทุกครั้งที่ DB_NAME ไม่ใช่ MRA
// connection(): อ่านค่า env ตอน request ไม่ใช่ตอน build (หน้า login จะไม่ถูก prerender)
export default async function TrainingBanner() {
  await connection();
  if ((process.env.DB_NAME || "MRA").toUpperCase() === "MRA") return null;
  return (
    <div className="training-banner" role="status">
      โหมดฝึกใช้งาน · ข้อมูลที่บันทึกเป็นข้อมูลทดสอบ ไม่ถูกส่งเข้าระบบรายงานจริง
    </div>
  );
}
