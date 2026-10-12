import "server-only";
import { query, sql } from "./db";
import { fiscalRange, fiscalMonths } from "./dashboard";
import { basisDateSql, normBasis } from "./basis";

// ชุดเคสที่บันทึกเสร็จตามตัวกรอง (ปีงบ / เดือน / แผนก) → ตาราง @rec · Mon = เดือนตาม by (จำหน่าย/Audit)
const recSql = (by) => {
  const B = basisDateSql(normBasis(by), "w");
  return `
  DECLARE @rec TABLE (AuditId INT PRIMARY KEY, AN VARCHAR(20), DischargeDate DATE, Mon CHAR(7),
                      DepartmentId INT, WardId INT, DoctorId INT, AuditorId INT);
  INSERT INTO @rec
  SELECT ar.AuditId, ar.AN, ar.DischargeDate, CONVERT(CHAR(7), ${B}, 126),
         ar.DepartmentId, ar.WardId, ar.DoctorId, ar.AuditorId
    FROM mra.AuditRecord ar JOIN mra.AuditWorklist w ON w.WorklistId = ar.WorklistId
   WHERE ar.RecordStatus = 'COMPLETED' AND ${B} >= @from AND ${B} < @to
     AND (@dept IS NULL OR ar.DepartmentId = @dept)
     AND (@mon IS NULL OR CONVERT(CHAR(7), ${B}, 126) = @mon);`;
};

// ผลรายเกณฑ์ที่นำมาคิด % (ไม่รวมหัวข้อที่เป็น NA)
// Passed = ผ่านจริง (PASS และไม่โดน gate) · Rated = ผ่าน + ไม่ผ่าน + หัวข้อ Missing/No (นับเป็นไม่ผ่าน) · ไม่นับเกณฑ์ที่เป็น NA
const CRIT_CTE = `
  cr AS (
    SELECT x.*, ac.ContentId, ac.ContentNo, c.CriterionId, c.CriterionNo, acr.ContentStatus, acr.Remark, r.Result,
           Passed = CASE WHEN acr.ContentStatus = 'ASSESS' AND r.Result = 'PASS' AND NOT EXISTS (
                      SELECT 1 FROM mra.CriterionGate g
                      JOIN mra.AuditCriterion sc ON sc.ContentId = g.ContentId AND sc.CriterionNo = g.SignatureCriterionNo
                      JOIN mra.AuditCriterionResult sr ON sr.AuditId = x.AuditId AND sr.CriterionId = sc.CriterionId AND sr.Result = 'FAIL'
                      WHERE g.ContentId = ac.ContentId AND c.CriterionNo BETWEEN g.CoverFromNo AND g.CoverToNo) THEN 1 ELSE 0 END,
           Rated = CASE WHEN acr.ContentStatus IN ('MISSING','NO') OR r.Result IN ('PASS','FAIL') THEN 1 ELSE 0 END
      FROM @rec x
      JOIN mra.AuditContentResult acr ON acr.AuditId = x.AuditId AND acr.ContentStatus <> 'NA'
      JOIN mra.AuditContent ac ON ac.ContentId = acr.ContentId
      JOIN mra.AuditCriterion c ON c.ContentId = acr.ContentId
      LEFT JOIN mra.AuditCriterionResult r ON r.AuditId = x.AuditId AND r.CriterionId = c.CriterionId
  )`;

function params({ fy, month, deptId, by }) {
  const { from, to } = fiscalRange(fy);
  const mon = month && fiscalMonths(fy).includes(month) ? month : null;
  return { mon, rec: recSql(by), p: { from: [sql.Date, from], to: [sql.Date, to], dept: [sql.Int, deptId || null], mon: [sql.Char(7), mon] } };
}
const pct = (a, b) => (b ? (a * 100) / b : null);

/* ---------- ตาราง หัวข้อ × เกณฑ์ ---------- */
export async function getCriteriaMatrix(filter) {
  const { mon, rec, p } = params(filter);
  const r = await query(
    `${rec}
     WITH ${CRIT_CTE}
     SELECT ContentNo, CriterionNo, Passed = SUM(Passed), Rated = SUM(Rated) FROM cr GROUP BY ContentNo, CriterionNo;

     SELECT ac.ContentNo, ac.TitleEn, ac.TitleTh, Cases = COUNT(*),
            Assessed = SUM(CASE WHEN acr.ContentStatus <> 'NA' THEN 1 ELSE 0 END),
            FullSum = SUM(acr.FullScore), ScoreSum = SUM(acr.SumScore)
       FROM @rec x JOIN mra.AuditContentResult acr ON acr.AuditId = x.AuditId
       JOIN mra.AuditContent ac ON ac.ContentId = acr.ContentId
      GROUP BY ac.ContentNo, ac.TitleEn, ac.TitleTh ORDER BY ac.ContentNo;

     SELECT ac.ContentNo, c.CriterionNo, c.CriterionText FROM mra.AuditCriterion c JOIN mra.AuditContent ac ON ac.ContentId = c.ContentId
      JOIN mra.CriteriaSet cs ON cs.CriteriaSetId = ac.CriteriaSetId AND cs.IsActive = 1;

     SELECT COUNT(*) AS Cases FROM @rec;`,
    p
  );
  const [cells, contents, texts, [{ Cases }]] = r.recordsets;
  const cellMap = new Map(cells.map((c) => [`${c.ContentNo}-${c.CriterionNo}`, c]));
  const textMap = new Map(texts.map((t) => [`${t.ContentNo}-${t.CriterionNo}`, t.CriterionText]));
  return {
    month: mon,
    cases: Cases,
    rows: contents.map((c) => ({
      ...c,
      pct: pct(c.ScoreSum, c.FullSum),
      cells: Array.from({ length: 9 }, (_, i) => {
        const k = `${c.ContentNo}-${i + 1}`;
        const x = cellMap.get(k);
        return { no: i + 1, text: textMap.get(k), passed: x?.Passed ?? 0, rated: x?.Rated ?? 0, pct: x ? pct(x.Passed, x.Rated) : null };
      }),
    })),
  };
}

/* ---------- เกณฑ์ที่ไม่ผ่านบ่อยที่สุด (ใช้ใน dashboard, สูตรเดียวกับตารางรายเกณฑ์) ---------- */
export async function getTopFailedCriteria(filter, top = 10, minRated = 5) {
  const { rec, p } = params(filter);
  const r = await query(
    `${rec}
     WITH ${CRIT_CTE}
     SELECT TOP (@top) cr.ContentNo, MAX(ac.TitleEn) AS TitleEn, cr.CriterionNo, MAX(c.CriterionText) AS CriterionText,
            Fail = SUM(cr.Rated) - SUM(cr.Passed), Rated = SUM(cr.Rated)
       FROM cr JOIN mra.AuditCriterion c ON c.CriterionId = cr.CriterionId JOIN mra.AuditContent ac ON ac.ContentId = cr.ContentId
      GROUP BY cr.ContentNo, cr.CriterionNo
     HAVING SUM(cr.Rated) >= @min
      ORDER BY 1.0 * (SUM(cr.Rated) - SUM(cr.Passed)) / SUM(cr.Rated) DESC, cr.ContentNo, cr.CriterionNo;`,
    { ...p, top: [sql.Int, top], min: [sql.Int, minRated] }
  );
  return r.recordset.map((c) => ({ ...c, rate: (c.Fail * 100) / c.Rated }));
}

/* ---------- รายละเอียดเกณฑ์ข้อเดียว ---------- */
// includeCases = false → ไม่ดึงรายชื่อเคส (AN) เลย ใช้กับผู้ที่ไม่มีสิทธิ์ (canViewCaseList)
export async function getCriterionDetail(filter, contentNo, criterionNo, { includeCases = false } = {}) {
  const { mon, rec, p } = params(filter);
  const r = await query(
    `${rec}
     SELECT ac.TitleEn, ac.TitleTh, c.CriterionText, c.NoteText
       FROM mra.AuditCriterion c JOIN mra.AuditContent ac ON ac.ContentId = c.ContentId
       JOIN mra.CriteriaSet cs ON cs.CriteriaSetId = ac.CriteriaSetId AND cs.IsActive = 1
      WHERE ac.ContentNo = @cn AND c.CriterionNo = @no;

     WITH ${CRIT_CTE}, one AS (SELECT * FROM cr WHERE ContentNo = @cn AND CriterionNo = @no)
     SELECT Passed = ISNULL(SUM(Passed), 0), Rated = ISNULL(SUM(Rated), 0),
            NA = SUM(CASE WHEN Result = 'NA' THEN 1 ELSE 0 END),
            MissingNo = SUM(CASE WHEN ContentStatus IN ('MISSING','NO') THEN 1 ELSE 0 END),
            Gated = SUM(CASE WHEN Result = 'PASS' AND Passed = 0 AND ContentStatus = 'ASSESS' THEN 1 ELSE 0 END)
       FROM one;

     WITH ${CRIT_CTE}, one AS (SELECT * FROM cr WHERE ContentNo = @cn AND CriterionNo = @no AND Rated = 1)
     SELECT 'dept' AS Dim, CAST(o.DepartmentId AS VARCHAR(20)) AS K, d.DepartmentName AS Name, SUM(o.Passed) AS Passed, COUNT(*) AS Rated
       FROM one o JOIN mra.Department d ON d.DepartmentId = o.DepartmentId GROUP BY o.DepartmentId, d.DepartmentName
     UNION ALL
     SELECT 'ward', CAST(o.WardId AS VARCHAR(20)), ISNULL(w.HisWardCode + N' · ' + w.WardName, N'ไม่ระบุ'), SUM(o.Passed), COUNT(*)
       FROM one o LEFT JOIN mra.Ward w ON w.WardId = o.WardId GROUP BY o.WardId, w.HisWardCode, w.WardName
     UNION ALL
     SELECT 'doctor', CAST(o.DoctorId AS VARCHAR(20)), ISNULL(doc.DoctorName, N'ไม่ระบุ'), SUM(o.Passed), COUNT(*)
       FROM one o LEFT JOIN mra.Doctor doc ON doc.DoctorId = o.DoctorId GROUP BY o.DoctorId, doc.DoctorName
     UNION ALL
     SELECT 'month', o.Mon, o.Mon, SUM(o.Passed), COUNT(*) FROM one o GROUP BY o.Mon;
     ${includeCases ? `
     WITH ${CRIT_CTE}
     SELECT o.AN, o.DischargeDate, d.DepartmentName, w.HisWardCode, w.WardName, doc.DoctorName, u.FullName AS AuditorName,
            Reason = CASE WHEN o.ContentStatus = 'MISSING' THEN N'Missing (ไม่พบเอกสาร)'
                          WHEN o.ContentStatus = 'NO' THEN N'No (มีเอกสารแต่ไม่บันทึก)'
                          WHEN o.Result = 'PASS' THEN N'ไม่ได้คะแนนจาก gate (ไม่มีลายมือชื่อแพทย์)'
                          ELSE N'ไม่ผ่าน' END,
            o.Remark
       FROM cr o
       JOIN mra.Department d ON d.DepartmentId = o.DepartmentId
       LEFT JOIN mra.Ward w ON w.WardId = o.WardId
       LEFT JOIN mra.Doctor doc ON doc.DoctorId = o.DoctorId
       JOIN mra.AppUser u ON u.UserId = o.AuditorId
      WHERE o.ContentNo = @cn AND o.CriterionNo = @no AND o.Rated = 1 AND o.Passed = 0
      ORDER BY o.DischargeDate DESC, o.AN;` : ""}`,
    { ...p, cn: [sql.TinyInt, contentNo], no: [sql.TinyInt, criterionNo] }
  );
  const [[info], [tot], dims, failed = null] = r.recordsets;
  if (!info) return null;
  const by = (dim) => dims.filter((x) => x.Dim === dim).map((x) => ({ key: x.K ?? "-", name: x.Name, passed: x.Passed, rated: x.Rated, pct: pct(x.Passed, x.Rated) }))
    .sort((a, b) => a.pct - b.pct || b.rated - a.rated);
  const monthRows = new Map(dims.filter((x) => x.Dim === "month").map((x) => [x.K, x]));
  return {
    month: mon, info, total: { ...tot, pct: pct(tot.Passed, tot.Rated) },
    byDept: by("dept"), byWard: by("ward"), byDoctor: by("doctor"),
    months: fiscalMonths(filter.fy).map((m) => { const x = monthRows.get(m); return { Mon: m, rated: x?.Rated ?? 0, pct: x ? pct(x.Passed, x.Rated) : null }; }),
    failed,
  };
}

/* ---------- รายละเอียดหัวข้อ: เกณฑ์ทั้งหมด + คะแนนหัวข้อแยกแผนก ---------- */
export async function getContentDetail(filter, contentNo) {
  const { mon, rec, p } = params(filter);
  const r = await query(
    `${rec}
     SELECT ac.ContentNo, ac.TitleEn, ac.TitleTh, ac.HintText FROM mra.AuditContent ac
       JOIN mra.CriteriaSet cs ON cs.CriteriaSetId = ac.CriteriaSetId AND cs.IsActive = 1 WHERE ac.ContentNo = @cn;

     WITH ${CRIT_CTE}
     SELECT c.CriterionNo, c.CriterionText, Passed = ISNULL(SUM(cr.Passed), 0), Rated = ISNULL(SUM(cr.Rated), 0)
       FROM mra.AuditCriterion c JOIN mra.AuditContent ac ON ac.ContentId = c.ContentId
       JOIN mra.CriteriaSet cs ON cs.CriteriaSetId = ac.CriteriaSetId AND cs.IsActive = 1
       LEFT JOIN cr ON cr.CriterionId = c.CriterionId
      WHERE ac.ContentNo = @cn GROUP BY c.CriterionNo, c.CriterionText;

     SELECT d.DepartmentId, d.DepartmentName, N = COUNT(*), FullSum = SUM(acr.FullScore), ScoreSum = SUM(acr.SumScore),
            NA = SUM(CASE WHEN acr.ContentStatus = 'NA' THEN 1 ELSE 0 END),
            MissingNo = SUM(CASE WHEN acr.ContentStatus IN ('MISSING','NO') THEN 1 ELSE 0 END)
       FROM @rec x JOIN mra.AuditContentResult acr ON acr.AuditId = x.AuditId
       JOIN mra.AuditContent ac ON ac.ContentId = acr.ContentId AND ac.ContentNo = @cn
       JOIN mra.Department d ON d.DepartmentId = x.DepartmentId
      GROUP BY d.DepartmentId, d.DepartmentName;`,
    { ...p, cn: [sql.TinyInt, contentNo] }
  );
  const [[info], criteria, depts] = r.recordsets;
  if (!info) return null;
  return {
    month: mon, info,
    criteria: criteria.map((c) => ({ ...c, pct: pct(c.Passed, c.Rated) })).sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101)),
    depts: depts.map((d) => ({ ...d, pct: pct(d.ScoreSum, d.FullSum) })).sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101)),
  };
}
