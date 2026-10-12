import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, logAccess, CAN_EDIT } from "@/lib/auth";
import { getCriteria, getAuditByAN, getDepartmentsAndWards, getDoctorOptions } from "@/lib/audit";
import { isoDate, todayISO, thDate, thDateTime } from "@/lib/format";
import AuditSheet from "./audit-sheet";

export const metadata = { title: "แบบตรวจ · MRA IPD" };

export default async function AuditPage({ params }) {
  const user = await requireUser();
  const { an } = await params;
  if (!/^\d{6,12}$/.test(an)) notFound();

  const [criteria, data, refs, doctors] = await Promise.all([getCriteria(), getAuditByAN(an), getDepartmentsAndWards(), getDoctorOptions(an)]);
  if (!data) notFound();
  await logAccess(user.UserId, "VIEW", an);

  const { head, contents, criteria: critRows } = data;
  const byContent = new Map(contents.map((c) => [c.ContentId, c]));
  const resultById = new Map(critRows.map((r) => [r.CriterionId, r.Result]));

  const initial = {
    an: head.AN,
    rowVer: head.RowVer ?? null,
    departmentId: head.ArDepartmentId ?? head.DepartmentId,
    wardId: head.ArWardId ?? head.WardId ?? "",
    doctorCode: head.DoctorCode ?? doctors[0]?.code ?? "",
    // วันที่ตรวจ: ที่บันทึกไว้ > วันนี้ (ถ้าถึงเดือนที่กำหนด audit แล้ว) > วันที่ 1 ของเดือนที่กำหนด audit
    auditDate: head.AuditDate ? isoDate(head.AuditDate)
      : head.PlannedAuditDate && isoDate(head.PlannedAuditDate) > todayISO() ? isoDate(head.PlannedAuditDate) : todayISO(),
    overall: head.OverallFinding ? String(head.OverallFinding) : "",
    spec: head.OverallSpecify ?? "",
    items: criteria.contents.map((c) => {
      const saved = byContent.get(c.contentId);
      const crit = {};
      for (const cr of c.criteria) if (resultById.has(cr.criterionId)) crit[cr.criterionId] = resultById.get(cr.criterionId);
      return { contentId: c.contentId, status: saved?.ContentStatus ?? "ASSESS", ded: !!saved?.DeductionFlag, remark: saved?.Remark ?? "", crit };
    }),
  };

  const status = head.IsLegacy ? "LEGACY" : head.RecordStatus === "COMPLETED" ? "COMPLETED" : head.AuditId ? "IN_PROGRESS" : "PENDING";
  const patient = {
    an: head.AN,
    hn: head.HN,
    admit: thDate(head.AdmitDate),
    discharge: thDate(head.DischargeDate),
    dischargeIso: isoDate(head.DischargeDate),
    los: Math.max(1, Math.round((new Date(head.DischargeDate) - new Date(head.AdmitDate)) / 86400000)),
  };
  const meta = {
    status,
    savedAt: head.UpdatedAt ? thDateTime(head.UpdatedAt) : null,
    auditor: head.AuditorName ? `${head.AuditorName} (${head.AuditorCode})` : `${user.FullName} (${user.Username})`,
    readOnly: status === "LEGACY" || !CAN_EDIT.includes(user.RoleCode),
  };

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="crumb">
        <Link href="/" className="btn" style={{ border: "none", background: "transparent" }}>← เคสรอตรวจ</Link>
        <span className="muted">/</span>
        <span>AN <b>{head.AN}</b></span>
      </div>
      <AuditSheet criteria={criteria.contents} initial={initial} patient={patient} refs={{ ...refs, doctors }} meta={meta} />
    </section>
  );
}
