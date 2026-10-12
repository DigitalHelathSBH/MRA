import "server-only";
import { query, transaction, sql, HIS, valuesList } from "./db";
import { upsertDoctor } from "./audit";

// เงื่อนไขและโควตาตาม "คิวรี่สุ่ม MRA IPD.sql" ของงานเวชระเบียน (ไม่ดึงชื่อผู้ป่วย)
const RANDOM_SQL = `
WITH RandomCase AS (
    SELECT
        RTRIM(a.SPECIALTY) AS Specialty, RTRIM(c.ClinicName) AS ClinicName,
        RTRIM(a.ADMWARD) AS Ward, RTRIM(w.WardName) AS WardName,
        RTRIM(a.HN) AS HN, RTRIM(a.AN) AS AN,
        CONVERT(date, a.ADMDATETIME) AS AdmitDate, CONVERT(date, a.DISCHARGEDATETIME) AS DischargeDate,
        DATEDIFF(DAY, a.ADMDATETIME, a.DISCHARGEDATETIME) AS LOS,
        s.DIAGNOSES AS Dx,
        ROW_NUMBER() OVER (PARTITION BY a.SPECIALTY, a.ADMWARD ORDER BY NEWID()) AS RN,
        ROW_NUMBER() OVER (PARTITION BY a.SPECIALTY ORDER BY NEWID()) AS SpecialtyRN
    FROM ${HIS}.dbo.ADMMASTER a
    LEFT JOIN ${HIS}.dbo.WardCode w   ON a.ADMWARD = w.CODE
    LEFT JOIN ${HIS}.dbo.IPDSUMMARY s ON a.AN = s.AN AND s.SUFFIX = 1
    LEFT JOIN ${HIS}.dbo.ClinicName c ON a.SPECIALTY = c.CODE
    WHERE a.DISCHARGEDATETIME >= @from AND a.DISCHARGEDATETIME < @to
      AND a.DISCHARGETYPE IS NOT NULL AND a.DISCHARGETYPE <> '0'
      AND DATEDIFF(DAY, a.ADMDATETIME, a.DISCHARGEDATETIME) >= 3
      AND (
            (a.ADMWARD IN ('06','31','34') AND s.DIAGNOSES LIKE 'O%')
         OR (a.ADMWARD = '07' AND a.SPECIALTY = '03')
         OR (a.SPECIALTY = '02' AND a.ADMWARD IN ('13','14','15','18','22','46'))
         OR (a.ADMWARD IN ('29','30') AND a.SPECIALTY = '08')
         OR (a.ADMWARD IN ('19','23') AND a.SPECIALTY = '07')
         OR (a.SPECIALTY = '06')
         OR (a.SPECIALTY = '05' AND a.ADMWARD IN ('16','17','20','21','40'))
         OR (a.SPECIALTY = '01' AND a.ADMWARD IN ('01','02','03','04','25','33','41','42','44','69'))
      )
)
SELECT ROW_NUMBER() OVER (ORDER BY Specialty, Ward, AN) AS SeqNo,
       Specialty, ClinicName, Ward, WardName, HN, AN, AdmitDate, DischargeDate, LOS, Dx
FROM RandomCase
WHERE (Specialty = '06' AND SpecialtyRN = 1)
   OR (Specialty <> '06' AND (
          (Ward IN ('13','17','21','25','33','34','44','69') AND RN <= 1)
       OR (Ward IN ('18','19','29','30','31','41','42') AND RN <= 2)
       OR (Ward IN ('01','02','03','04','06','07','14','15','22','40','46') AND RN <= 3)
       OR (Ward IN ('16','23') AND RN <= 4)
       OR (Ward IN ('20') AND RN <= 6)))
ORDER BY Specialty, Ward, AN`;

function monthRange(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw userError("เดือนไม่ถูกต้อง");
  const [y, m] = month.split("-").map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
}
const batchName = (month) => `RANDOM-${month}`;
// ข้อผิดพลาดที่แสดงให้ผู้ใช้เห็นได้
const userError = (msg) => Object.assign(new Error(msg), { userMessage: true });

export async function getSampleBatch(month) {
  const r = await query(
    `SELECT b.ImportBatchId, b.ImportedAt, b.InsertedRows, u.FullName
       FROM mra.ImportBatch b JOIN mra.AppUser u ON u.UserId = b.ImportedBy WHERE b.SourceFileName = @n`,
    { n: [sql.NVarChar(260), batchName(month)] }
  );
  return r.recordset[0] ?? null;
}

// สุ่มรายชื่อ (ยังไม่บันทึก) พร้อมบอกว่าแผนก/ward จับคู่ได้หรือไม่ และ AN ไหนมีในระบบแล้ว
export async function drawSample(month) {
  const { from, to } = monthRange(month);
  const r = await query(RANDOM_SQL, { from: [sql.DateTime, from], to: [sql.DateTime, to] });
  const rows = r.recordset;
  if (!rows.length) return [];
  const ans = valuesList("an", rows.map((x) => [x.AN]), [sql.VarChar(20)]);
  const m = await query(
    `SELECT j.value AS AN,
            InWorklist = CASE WHEN EXISTS (SELECT 1 FROM mra.AuditWorklist w WHERE w.AN = j.value AND w.WorklistStatus <> 'CANCELLED') THEN 1 ELSE 0 END,
            InLegacy   = CASE WHEN EXISTS (SELECT 1 FROM dbo.mra_ipd_main l WHERE l.an = j.value) THEN 1 ELSE 0 END
       FROM (VALUES ${ans.text}) j(value);
     SELECT HisSpecialtyCode, HisDxPrefix, DepartmentName FROM mra.Department WHERE IsActive = 1 AND HisSpecialtyCode IS NOT NULL;
     SELECT HisWardCode FROM mra.Ward WHERE HisWardCode IS NOT NULL;`,
    ans.params
  );
  const flags = new Map(m.recordsets[0].map((x) => [x.AN, x]));
  const depts = m.recordsets[1];
  const wards = new Set(m.recordsets[2].map((x) => x.HisWardCode));
  return rows.map((x) => {
    const dept = depts
      .filter((d) => d.HisSpecialtyCode === x.Specialty && (!d.HisDxPrefix || String(x.Dx ?? "").startsWith(d.HisDxPrefix)))
      .sort((a, b) => (b.HisDxPrefix ? 1 : 0) - (a.HisDxPrefix ? 1 : 0))[0];
    const f = flags.get(x.AN) ?? {};
    return {
      seqNo: Number(x.SeqNo), an: x.AN, hn: x.HN, specialty: x.Specialty, clinic: x.ClinicName,
      ward: x.Ward, wardName: x.WardName, admit: x.AdmitDate, discharge: x.DischargeDate, los: x.LOS,
      dept: dept?.DepartmentName ?? null, wardMapped: wards.has(x.Ward),
      inWorklist: !!f.InWorklist, inLegacy: !!f.InLegacy,
    };
  });
}

// บันทึกรายชื่อที่สุ่มแล้วเข้า worklist (ตรวจกับ HIS ซ้ำทุกราย ไม่เชื่อข้อมูลจาก client)
// auditMonth = เดือนที่จะ audit (YYYY-MM) เก็บเป็นวันที่ 1 ของเดือนใน PlannedAuditDate ต้องอยู่หลังเดือนที่จำหน่าย
export async function saveSample(month, items, user, auditMonth = null) {
  const { from, to } = monthRange(month);
  if (!Array.isArray(items) || !items.length || items.length > 500) throw userError("รายชื่อไม่ถูกต้อง");
  const list = items.map((x) => ({ an: String(x.an), seqNo: Number(x.seqNo) || null }));
  if (list.some((x) => !/^\d{6,12}$/.test(x.an))) throw userError("AN ไม่ถูกต้อง");
  if (to > new Date()) throw userError("เดือนที่จำหน่ายต้องเป็นเดือนที่จบไปแล้ว");
  let auditDate = null;
  if (auditMonth != null) {
    if (!/^\d{4}-\d{2}$/.test(auditMonth)) throw userError("เดือนที่ Audit ไม่ถูกต้อง");
    if (auditMonth <= month) throw userError("เดือนที่ Audit ต้องอยู่หลังเดือนที่จำหน่าย");
    auditDate = `${auditMonth}-01`;
  }

  return transaction(async (q) => {
    const exists = await q(`SELECT 1 FROM mra.ImportBatch WITH (UPDLOCK, HOLDLOCK) WHERE SourceFileName = @n`, {
      n: [sql.NVarChar(260), batchName(month)],
    });
    if (exists.recordset.length) throw userError("เดือนนี้สุ่มและบันทึกรายชื่อไปแล้ว");

    const vl = valuesList("l", list.map((x) => [x.an, x.seqNo]), [sql.VarChar(20), sql.Int]);
    const his = await q(
      `SELECT j.SeqNo, RTRIM(a.AN) AS AN, RTRIM(a.HN) AS HN, a.ADMDATETIME, a.DISCHARGEDATETIME,
              RTRIM(a.ADMWARD) AS Ward, RTRIM(a.SPECIALTY) AS Specialty, s.DIAGNOSES AS Dx,
              Doctor = RTRIM(COALESCE(NULLIF(s.DOCTOR, ''),
                         (SELECT TOP 1 d.DOCTOR FROM ${HIS}.dbo.IPDDOCTOR d WHERE d.AN = a.AN ORDER BY d.VALIDTOPOSTFROMDATETIME DESC)))
         FROM (VALUES ${vl.text}) j(AN, SeqNo)
         JOIN ${HIS}.dbo.ADMMASTER a ON a.AN = j.AN
         LEFT JOIN ${HIS}.dbo.IPDSUMMARY s ON s.AN = a.AN AND s.SUFFIX = 1
        WHERE a.DISCHARGEDATETIME >= @from AND a.DISCHARGEDATETIME < @to`,
      { ...vl.params, from: [sql.DateTime, from], to: [sql.DateTime, to] }
    );

    const batchId = (
      await q(
        `INSERT INTO mra.ImportBatch (SourceFileName, ImportedBy, TotalRows, InsertedRows, SkippedRows)
         OUTPUT inserted.ImportBatchId VALUES (@n, @u, @t, 0, 0)`,
        { n: [sql.NVarChar(260), batchName(month)], u: [sql.Int, user.UserId], t: [sql.Int, list.length] }
      )
    ).recordset[0].ImportBatchId;

    let inserted = 0;
    const skipped = [];
    for (const a of his.recordset) {
      const map = await q(
        `SELECT TOP 1 DepartmentId FROM mra.Department
          WHERE IsActive = 1 AND HisSpecialtyCode = @spec AND (HisDxPrefix IS NULL OR @dx LIKE HisDxPrefix + '%')
          ORDER BY CASE WHEN HisDxPrefix IS NULL THEN 1 ELSE 0 END;
         SELECT WardId FROM mra.Ward WHERE HisWardCode = @ward;
         SELECT 1 AS x FROM mra.AuditWorklist WHERE AN = @an AND WorklistStatus <> 'CANCELLED';`,
        { spec: [sql.VarChar(10), a.Specialty ?? ""], dx: [sql.VarChar(sql.MAX), a.Dx ?? ""], ward: [sql.VarChar(10), a.Ward ?? ""], an: [sql.VarChar(20), a.AN] }
      );
      const dept = map.recordsets[0][0];
      if (!dept || map.recordsets[2].length) { skipped.push(a.AN); continue; }
      const doctorId = await upsertDoctor(q, a.Doctor);
      await q(
        `INSERT INTO mra.AuditWorklist (SeqNo, AN, HN, DepartmentId, WardId, DoctorId, AdmitDate, DischargeDate, PlannedAuditDate, ImportBatchId, CreatedBy)
         VALUES (@seq, @an, @hn, @dept, @ward, @doc, @admit, @dc, @plan, @batch, @by)`,
        {
          seq: [sql.Int, a.SeqNo], an: [sql.VarChar(20), a.AN], hn: [sql.VarChar(20), a.HN],
          dept: [sql.Int, dept.DepartmentId], ward: [sql.Int, map.recordsets[1][0]?.WardId ?? null], doc: [sql.Int, doctorId],
          admit: [sql.Date, a.ADMDATETIME], dc: [sql.Date, a.DISCHARGEDATETIME], plan: [sql.Date, auditDate], batch: [sql.Int, batchId], by: [sql.Int, user.UserId],
        }
      );
      inserted++;
    }
    const notFound = list.length - his.recordset.length;
    await q(`UPDATE mra.ImportBatch SET InsertedRows = @i, SkippedRows = @s WHERE ImportBatchId = @b`, {
      i: [sql.Int, inserted], s: [sql.Int, list.length - inserted], b: [sql.Int, batchId],
    });
    return { batchId, inserted, skipped: skipped.length + notFound };
  });
}
