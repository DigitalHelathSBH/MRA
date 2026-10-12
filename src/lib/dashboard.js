import "server-only";
import { query, sql } from "./db";

// ปีงบประมาณ พ.ศ. → ช่วงวันที่จำหน่าย (1 ต.ค. ปีก่อน ถึง 30 ก.ย.)
export function fiscalRange(fyBE) {
  const y = fyBE - 543;
  return { from: new Date(Date.UTC(y - 1, 9, 1)), to: new Date(Date.UTC(y, 9, 1)) };
}

export function currentFiscalYear(d = new Date()) {
  return d.getFullYear() + 543 + (d.getMonth() >= 9 ? 1 : 0);
}

// 12 เดือนของปีงบ (ต.ค.–ก.ย.) เป็น 'YYYY-MM'
export function fiscalMonths(fyBE) {
  const y = fyBE - 543;
  return Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(y - 1, 9 + i, 1)).toISOString().slice(0, 7));
}

// ข้อมูล dashboard (เฉพาะผลที่บันทึกเสร็จ, จัดกลุ่มตามเดือนที่จำหน่าย) — ไม่มีข้อมูลระบุตัวผู้ป่วย
// - แนวโน้มรายเดือน / รายแผนก: ทั้งปีงบ
// - สรุป, รายแผนก, ราย content: ทั้งปี หรือเฉพาะเดือน month ('YYYY-MM') ถ้าระบุ (เกณฑ์ที่ไม่ผ่านบ่อย: reports.getTopFailedCriteria)
export async function getDashboard({ fy, month, deptId }) {
  const { from, to } = fiscalRange(fy);
  const mon = month && fiscalMonths(fy).includes(month) ? month : null;
  const r = await query(
    `DECLARE @fy TABLE (AuditId INT PRIMARY KEY, DepartmentId INT, Mon CHAR(7), FullScore INT, SumScore INT, Adequate BIT, Overall TINYINT);
     INSERT INTO @fy
     SELECT ar.AuditId, ar.DepartmentId, CONVERT(CHAR(7), ar.DischargeDate, 126), ar.FullScore, ar.SumScore, ar.IsFullScoreAdequate, ar.OverallFinding
       FROM mra.AuditRecord ar
      WHERE ar.RecordStatus = 'COMPLETED' AND ar.DischargeDate >= @from AND ar.DischargeDate < @to
        AND (@dept IS NULL OR ar.DepartmentId = @dept);
     DECLARE @done TABLE (AuditId INT PRIMARY KEY, DepartmentId INT, FullScore INT, SumScore INT, Adequate BIT, Overall TINYINT);
     INSERT INTO @done SELECT AuditId, DepartmentId, FullScore, SumScore, Adequate, Overall FROM @fy WHERE @mon IS NULL OR Mon = @mon;
     DECLARE @wl TABLE (Mon CHAR(7), Status VARCHAR(15));
     INSERT INTO @wl SELECT CONVERT(CHAR(7), DischargeDate, 126), WorklistStatus FROM mra.AuditWorklist
      WHERE WorklistStatus <> 'CANCELLED' AND DischargeDate >= @from AND DischargeDate < @to AND (@dept IS NULL OR DepartmentId = @dept);

     -- 0) สรุป (ช่วงที่เลือก)
     SELECT Completed = COUNT(*), FullSum = ISNULL(SUM(FullScore), 0), ScoreSum = ISNULL(SUM(SumScore), 0),
            Adequate = ISNULL(SUM(CAST(Adequate AS INT)), 0),
            Ov1 = ISNULL(SUM(CASE WHEN Overall = 1 THEN 1 ELSE 0 END), 0), Ov2 = ISNULL(SUM(CASE WHEN Overall = 2 THEN 1 ELSE 0 END), 0),
            Ov3 = ISNULL(SUM(CASE WHEN Overall = 3 THEN 1 ELSE 0 END), 0),
            Sampled = (SELECT COUNT(*) FROM @wl WHERE @mon IS NULL OR Mon = @mon),
            Drafts = (SELECT COUNT(*) FROM @wl WHERE Status = 'IN_PROGRESS' AND (@mon IS NULL OR Mon = @mon))
       FROM @done;

     -- 1) รายเดือน (ทั้งปีงบ)
     SELECT Mon, Sampled = COUNT(*),
            Completed = (SELECT COUNT(*) FROM @fy f WHERE f.Mon = w.Mon),
            FullSum = (SELECT SUM(FullScore) FROM @fy f WHERE f.Mon = w.Mon),
            ScoreSum = (SELECT SUM(SumScore) FROM @fy f WHERE f.Mon = w.Mon)
       FROM @wl w GROUP BY Mon;

     -- 2) รายแผนก (ช่วงที่เลือก)
     SELECT d.DepartmentId, d.DepartmentName, N = COUNT(*), FullSum = SUM(x.FullScore), ScoreSum = SUM(x.SumScore)
       FROM @done x JOIN mra.Department d ON d.DepartmentId = x.DepartmentId
      GROUP BY d.DepartmentId, d.DepartmentName;

     -- 3) รายแผนก × เดือน (ทั้งปีงบ)
     SELECT f.DepartmentId, d.DepartmentName, f.Mon, N = COUNT(*), FullSum = SUM(f.FullScore), ScoreSum = SUM(f.SumScore)
       FROM @fy f JOIN mra.Department d ON d.DepartmentId = f.DepartmentId
      GROUP BY f.DepartmentId, d.DepartmentName, f.Mon;

     -- 4) ราย content (ช่วงที่เลือก)
     SELECT ac.ContentNo, ac.TitleEn, ac.TitleTh,
            FullSum = SUM(acr.FullScore), ScoreSum = SUM(acr.SumScore),
            Assess = SUM(CASE WHEN acr.ContentStatus = 'ASSESS' THEN 1 ELSE 0 END),
            NA = SUM(CASE WHEN acr.ContentStatus = 'NA' THEN 1 ELSE 0 END),
            Missing = SUM(CASE WHEN acr.ContentStatus = 'MISSING' THEN 1 ELSE 0 END),
            NoRec = SUM(CASE WHEN acr.ContentStatus = 'NO' THEN 1 ELSE 0 END)
       FROM @done x JOIN mra.AuditContentResult acr ON acr.AuditId = x.AuditId
       JOIN mra.AuditContent ac ON ac.ContentId = acr.ContentId
      GROUP BY ac.ContentNo, ac.TitleEn, ac.TitleTh ORDER BY ac.ContentNo;


     -- 5) ปีงบประมาณที่มีข้อมูล (ตัวเลือก)
     SELECT DISTINCT FY = YEAR(DischargeDate) + 543 + CASE WHEN MONTH(DischargeDate) >= 10 THEN 1 ELSE 0 END
       FROM mra.AuditWorklist WHERE WorklistStatus <> 'CANCELLED';`,
    { from: [sql.Date, from], to: [sql.Date, to], dept: [sql.Int, deptId || null], mon: [sql.Char(7), mon] }
  );
  const [[sum], months, depts, deptMonths, contents, fys] = r.recordsets;
  const pct = (s, f) => (f ? (s * 100) / f : null);
  const byMon = (rows) => {
    const m = new Map(rows.map((x) => [x.Mon, x]));
    return fiscalMonths(fy).map((mon) => {
      const x = m.get(mon) ?? {};
      return { Mon: mon, Sampled: x.Sampled ?? 0, Completed: x.Completed ?? x.N ?? 0, pct: pct(x.ScoreSum ?? 0, x.FullSum ?? 0) };
    });
  };
  const deptIds = [...new Set(deptMonths.map((x) => x.DepartmentId))];
  return {
    month: mon,
    summary: { ...sum, pct: pct(sum.ScoreSum, sum.FullSum) },
    months: byMon(months),
    depts: depts.map((d) => ({ ...d, pct: pct(d.ScoreSum, d.FullSum) })).sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1)),
    // แนวโน้มรายแผนก เรียงตามจำนวนเคสทั้งปี (ไม่เปลี่ยนตามเดือนที่เลือก)
    deptTrends: deptIds
      .map((id) => {
        const rows = deptMonths.filter((x) => x.DepartmentId === id);
        return { DepartmentId: id, DepartmentName: rows[0].DepartmentName, N: rows.reduce((s, x) => s + x.N, 0), months: byMon(rows) };
      })
      .sort((a, b) => b.N - a.N),
    contents: contents.map((c) => ({ ...c, pct: pct(c.ScoreSum, c.FullSum) })),
    fiscalYears: fys.map((x) => x.FY),
  };
}
