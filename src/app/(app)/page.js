import Link from "next/link";
import { requireUser, logAccess, CAN_EDIT } from "@/lib/auth";
import { listWorklist, getDepartmentsAndWards } from "@/lib/audit";
import { thDate, STATUS_TH } from "@/lib/format";
import AddCaseForm from "./add-case-form";
import SearchSelect from "@/components/search-select";

export const metadata = { title: "เคสรอตรวจ · MRA IPD" };

const MTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

// เดือนที่ Audit: เดือนหน้า + เดือนนี้ + 11 เดือนย้อนหลัง · ค่าเริ่มต้นคือเดือนนี้
function monthOptions() {
  const now = new Date();
  return Array.from({ length: 13 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + 1 - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return { value, label: `${MTH[d.getMonth()]} ${d.getFullYear() + 543}` };
  });
}

export default async function WorklistPage({ searchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const months = monthOptions();
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month : months[1].value; // months[1] = เดือนนี้
  const f = { month, deptId: Number(sp.dept) || null, wardId: Number(sp.ward) || null, status: sp.status || "", q: (sp.q ?? "").trim() };

  const [{ departments, wards }, all] = await Promise.all([
    getDepartmentsAndWards(),
    listWorklist({ month, deptId: f.deptId, wardId: f.wardId, q: f.q }),
  ]);
  const rows = f.status ? all.filter((r) => r.Status === f.status) : all;
  await logAccess(user.UserId, "WORKLIST_VIEW", null, `month ${month}, ${rows.length} rows${f.q ? ", search" : ""}`);
  const count = (s) => all.filter((r) => r.Status === s).length;
  const canEdit = CAN_EDIT.includes(user.RoleCode);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>เคสรอตรวจ</h1>
          <p>รายชื่อผู้ป่วยที่สุ่มไว้สำหรับ audit ในเดือนที่เลือก (ปกติเป็นผู้ป่วยที่จำหน่ายเมื่อ 2 เดือนก่อน) · เลือกเคสเพื่อเริ่มตรวจหรือทำต่อจากร่าง</p>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><span className="v">{all.length}</span><span className="l">เคสที่ต้อง audit เดือนนี้</span></div>
        <div className="kpi todo"><span className="v">{count("PENDING")}</span><span className="l">รอตรวจ</span></div>
        <div className="kpi draft"><span className="v">{count("IN_PROGRESS")}</span><span className="l">ร่าง (ยังไม่เสร็จ)</span></div>
        <div className="kpi done"><span className="v">{count("COMPLETED") + count("LEGACY")}</span><span className="l">ตรวจเสร็จ</span></div>
      </div>

      <div className="panel">
        <form className="filters" method="get">
          <div className="field">
            <label htmlFor="month">เดือนที่ Audit</label>
            <SearchSelect id="month" name="month" defaultValue={month} options={months} submitOnChange />
          </div>
          <div className="field">
            <label htmlFor="dept">แผนก</label>
            <SearchSelect id="dept" name="dept" defaultValue={f.deptId ?? ""} emptyLabel="ทุกแผนก" submitOnChange
              options={departments.map((d) => ({ value: d.DepartmentId, label: d.DepartmentName }))} />
          </div>
          <div className="field">
            <label htmlFor="ward">Ward</label>
            <SearchSelect id="ward" name="ward" defaultValue={f.wardId ?? ""} emptyLabel="ทุก ward" submitOnChange
              options={wards.map((w) => ({ value: w.WardId, label: `${w.HisWardCode} · ${w.WardName}` }))} />
          </div>
          <div className="field">
            <label htmlFor="status">สถานะ</label>
            <SearchSelect id="status" name="status" defaultValue={f.status} emptyLabel="ทุกสถานะ" submitOnChange
              options={["PENDING", "IN_PROGRESS", "COMPLETED", "LEGACY"].map((s) => ({ value: s, label: STATUS_TH[s] }))} />
          </div>
          <div className="field">
            <label htmlFor="q">ค้นหา</label>
            <input id="q" name="q" type="search" placeholder="AN / HN" defaultValue={f.q} />
          </div>
          <button type="submit" className="primary">กรอง</button>
        </form>

        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>#</th><th>AN</th><th>HN</th><th>แผนก</th><th>Ward</th><th>Admit</th><th>Discharge</th>
                <th className="r">LOS</th><th>สถานะ</th><th className="r">คะแนน</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={11} className="muted" style={{ textAlign: "center", padding: 22 }}>
                  {all.length ? "ไม่พบเคสตามตัวกรอง" : <>ยังไม่มีรายชื่อในเดือนนี้ · <Link href="/sampling">สุ่มรายชื่อ</Link> หรือเพิ่มเคสด้วย AN ด้านล่าง</>}
                </td></tr>
              )}
              {rows.map((r, i) => (
                <tr key={r.WorklistId}>
                  <td className="num muted">{i + 1}</td>
                  <td className="num"><b>{r.AN}</b></td>
                  <td className="num">{r.HN}</td>
                  <td>{r.DepartmentName}</td>
                  <td>{r.WardName ?? "–"}</td>
                  <td>{thDate(r.AdmitDate)}</td>
                  <td>{thDate(r.DischargeDate)}</td>
                  <td className="r num">{los(r.AdmitDate, r.DischargeDate)}</td>
                  <td><span className={`st ${r.Status}`}>{STATUS_TH[r.Status]}</span></td>
                  <td className="r num">{r.RecordStatus ? `${r.SumScore}/${r.FullScore}` : "–"}</td>
                  <td className="r">
                    {r.Status === "LEGACY" ? (
                      <span className="hint">แก้ในระบบเดิม</span>
                    ) : (
                      <Link href={`/audit/${r.AN}`}>
                        <span className={`btn ${r.Status === "PENDING" ? "primary" : ""}`}>
                          {r.Status === "PENDING" ? "เริ่มตรวจ" : r.Status === "IN_PROGRESS" ? "ทำต่อ" : "เปิดดู"}
                        </span>
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && <AddCaseForm />}
      </div>
    </section>
  );
}

function los(a, b) {
  const n = Math.round((new Date(b) - new Date(a)) / 86400000);
  return n === 0 ? 1 : n;
}
