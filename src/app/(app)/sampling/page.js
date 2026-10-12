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
          <p>เลือกเดือนที่ Audit แล้วระบบตั้งเดือนที่จำหน่ายย้อนหลัง 2 เดือนให้ · สุ่มตามเงื่อนไขของงานเวชระเบียน: LOS ≥ 3 วัน, ตามแผนก/ward และโควตาต่อ ward ที่กำหนด</p>
        </div>
      </div>
      <SamplingClient today={todayISO()} />
    </section>
  );
}
