import { requireUser, CAN_EDIT } from "@/lib/auth";
import SamplingClient from "./sampling-client";
import { todayISO } from "@/lib/format";

export const metadata = { title: "สุ่มรายชื่อ · MRA IPD" };

export default async function SamplingPage() {
  await requireUser(CAN_EDIT);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>สุ่มรายชื่อผู้ป่วยเพื่อตรวจ</h1>
          <p>เลือกเดือนที่ Audit แล้วระบบตั้งเดือนที่จำหน่ายย้อนหลัง 2 เดือนให้ · สุ่มตามเกณฑ์ของงานเวชระเบียน: นอน 3–90 วัน (วอร์ดที่ไม่พอเติมด้วยเคสนอนไม่ถึง 3 วันที่นอนนานที่สุด), ตามแผนก/วอร์ดและโควตารวม 70 ราย, กุมารเวชกรรมอายุ 0–14 ปี · ไม่สุ่มเคสที่อยู่ในรายการหรือตรวจในระบบเดิมแล้ว</p>
        </div>
      </div>
      <SamplingClient today={todayISO()} />
    </section>
  );
}
