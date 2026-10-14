import { notFound } from "next/navigation";
import { requireUser, logAccess } from "@/lib/auth";
import { getCriteria, getAuditByAN } from "@/lib/audit";
import { contentScore } from "@/lib/scoring";
import { thDate, thDateTime } from "@/lib/format";
import PrintButton from "./print-button";

export const metadata = { title: "พิมพ์แบบตรวจ · MRA IPD" };

const OVERALL = {
  1: "Documentation inadequate for meaningful review (ข้อมูลไม่เพียงพอสำหรับการทบทวน)",
  2: "No significant medical record issue identified (ไม่มีปัญหาสำคัญจากการทบทวน)",
  3: "Certain issues in question specify (มีปัญหาจากการทบทวนที่ต้องค้นต่อ)",
};
const COLS = 9;
// thDateTime อ่านค่าแบบ UTC → บวก 7 ชม. ให้เป็นเวลาไทย
const printedAt = () => thDateTime(new Date(Date.now() + 7 * 3600000));

// แบบตรวจรายคนสำหรับพิมพ์ (A4 แนวนอน) · ใช้ผลที่บันทึกแล้วและคะแนนที่เซิร์ฟเวอร์คำนวณ
export default async function PrintAuditPage({ params }) {
  const user = await requireUser();
  const { an } = await params;
  if (!/^\d{6,12}$/.test(an)) notFound();
  const [criteria, data] = await Promise.all([getCriteria(), getAuditByAN(an)]);
  if (!data) notFound();
  const { head } = data;
  if (!head.AuditId || head.IsLegacy) {
    const why = head.IsLegacy ? "บันทึกผลตรวจในระบบเดิม (IPDForm) ให้พิมพ์จากระบบเดิม" : "ยังไม่มีผลตรวจที่บันทึกไว้";
    return <div className="print-page"><p className="print-empty">AN {an} {why}</p></div>;
  }
  const training = (process.env.DB_NAME ?? "") !== "MRA"; // เหมือน components/training-banner.js
  await logAccess(user.UserId, "PRINT", an);

  const saved = new Map(data.contents.map((c) => [c.ContentId, c]));
  const result = new Map(data.criteria.map((r) => [r.CriterionId, r.Result]));
  const draft = head.RecordStatus !== "COMPLETED";

  const rows = criteria.contents.map((c) => {
    const s = saved.get(c.contentId);
    const status = s?.ContentStatus ?? "ASSESS";
    const crit = Object.fromEntries(c.criteria.filter((x) => result.has(x.criterionId)).map((x) => [x.criterionId, result.get(x.criterionId)]));
    const { gatedNos } = contentScore(c, { status, ded: !!s?.DeductionFlag, crit });
    const cells = Array.from({ length: COLS }, (_, i) => {
      const cr = c.criteria.find((x) => x.no === i + 1);
      if (!cr) return "-";
      if (status !== "ASSESS") return "";
      const v = crit[cr.criterionId];
      return v === "PASS" ? (gatedNos.has(cr.no) ? "0*" : "1") : v === "FAIL" ? "0" : v === "NA" ? "NA" : "";
    });
    return {
      no: c.no, title: c.titleEn, status, cells,
      ded: s?.DeductionFlag && c.allowDeduction ? `-${c.maxDeduction}` : "",
      sum: s?.SumScore ?? 0, full: s?.FullScore ?? 0, remark: s?.Remark ?? "",
    };
  });
  const hasGate = rows.some((r) => r.cells.includes("0*"));

  return (
    <div className="print-page">
      <div className="print-tools">
        <PrintButton />
        <span>ตั้งค่าเครื่องพิมพ์: A4 แนวนอน (Landscape) · ปิด &quot;Headers and footers&quot; (ไม่ให้พิมพ์ URL ที่มี AN)</span>
      </div>

      <article className="print-sheet">
        <header>
          <h1>แบบตรวจประเมินคุณภาพการบันทึกเวชระเบียนผู้ป่วยใน Medical Record Audit Form (IPD)</h1>
          {draft && <span className="print-draft">ฉบับร่าง (ยังบันทึกไม่เสร็จ)</span>}
          {training && <span className="print-draft">ข้อมูลฝึกใช้งาน ไม่ใช่ผลตรวจจริง</span>}
        </header>
        <p className="print-meta">
          <span>Hcode: <b>{head.Hcode}</b></span>
          <span>Hname: <b>{head.HospitalName}</b></span>
          <span>HN: <b>{head.HN}</b></span>
          <span>AN: <b>{head.AN}</b></span>
          <span>Date admitted: <b>{thDate(head.AdmitDate)}</b></span>
          <span>Date discharged: <b>{thDate(head.DischargeDate)}</b></span>
        </p>

        <table>
          <colgroup>
            <col className="w-no" /><col className="w-title" /><col className="w-s" /><col className="w-m" /><col className="w-s" />
            {Array.from({ length: COLS }, (_, i) => <col key={i} className="w-n" />)}
            <col className="w-s" /><col className="w-score" /><col className="w-score" /><col />
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2}>No</th>
              <th rowSpan={2}>Content</th>
              <th rowSpan={2}>NA</th>
              <th rowSpan={2}>Missing</th>
              <th rowSpan={2}>No</th>
              <th colSpan={COLS}>เกณฑ์ข้อ</th>
              <th rowSpan={2}>หัก</th>
              <th rowSpan={2}>รวมคะแนน</th>
              <th rowSpan={2}>คะแนนเต็ม</th>
              <th rowSpan={2}>หมายเหตุ</th>
            </tr>
            <tr>{Array.from({ length: COLS }, (_, i) => <th key={i}>{i + 1}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.no}>
                <td className="c">{r.no}</td>
                <td>{r.title}</td>
                <td className="c">{r.status === "NA" ? "✓" : ""}</td>
                <td className="c">{r.status === "MISSING" ? "✓" : ""}</td>
                <td className="c">{r.status === "NO" ? "✓" : ""}</td>
                {r.cells.map((v, i) => <td key={i} className="c">{v}</td>)}
                <td className="c">{r.ded}</td>
                <td className="c">{r.sum}</td>
                <td className="c">{r.full}</td>
                <td className="remark">{r.remark}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="print-legend">
          1 = ผ่าน · 0 = ไม่ผ่าน · NA = ไม่ประเมินข้อนี้ · - = ไม่มีเกณฑ์ข้อนี้{hasGate && " · 0* = ผ่านแต่ไม่ได้คะแนน (เกณฑ์ลงลายมือชื่อไม่ผ่าน)"}
        </p>
        <p>
          คะแนนเต็ม (Full score) รวม <b>{head.FullScore}</b> คะแนน (ต้องไม่น้อยกว่า 56 คะแนน)
          <span className="gap" />คะแนนที่ได้ (Sum score) <b>{head.SumScore}</b> คะแนน
          <span className="gap" />ร้อยละ <b>{head.ScorePct == null ? "–" : Number(head.ScorePct).toFixed(2)}</b>
        </p>
        <p>
          ประเมินคุณภาพการบันทึกเวชระเบียนในภาพรวม (Overall finding):{" "}
          {head.OverallFinding ? `${head.OverallFinding}. ${OVERALL[head.OverallFinding]}` : "(ยังไม่ได้เลือก)"}
          {head.OverallSpecify && <><br />รายละเอียด: {head.OverallSpecify}</>}
        </p>

        <footer>
          <span>Audit by <b>{head.AuditorName}</b></span>
          <span>Audit Date <b>{thDate(head.AuditDate)}</b></span>
        </footer>
        <p className="print-foot">
          พิมพ์จากระบบ MRA IPD เมื่อ {printedAt()} · เอกสารมีข้อมูลผู้ป่วย โปรดเก็บรักษาตามนโยบาย PDPA
        </p>
      </article>
    </div>
  );
}
