import "server-only";
import { query, transaction, sql, HIS, valuesList } from "./db";
import { upsertDoctor } from "./audit";

// เกณฑ์สุ่มของงานเวชระเบียน (ฉบับ 16 ต.ค. 2569) · ไม่ดึงชื่อผู้ป่วย
// เกณฑ์ร่วม: จำหน่ายในเดือนที่เลือก, มีประเภทการจำหน่าย (ไม่ว่าง/ไม่ใช่ 0), นอน 3–90 วัน (นับวันปฏิทิน)
//   ถ้าวอร์ดไหนเคส 3–90 วันไม่ครบโควตา เติมด้วยเคสที่นอนไม่ถึง 3 วัน เลือกวันนอนมากที่สุดก่อน
// ผู้ป่วยฝากวอร์ดแผนกอื่นไม่ถูกคัด ยกเว้น โสต ศอ นาสิก (ทุกวอร์ด) และวอร์ด 06/31/34 (ทุกแผนกที่ Dx หลักขึ้นต้น O)
// [specialty (null = ทุกแผนก), ward (null = ทุกวอร์ด), โควตา, ต้องเป็น Dx O, อายุสูงสุด (ปีเต็ม ณ วันที่ admit), ชื่อ]
export const QUOTAS = [
  ["01", "01", 3, 0, null, "อายุรกรรม · 01"], ["01", "02", 3, 0, null, "อายุรกรรม · 02"],
  ["01", "03", 3, 0, null, "อายุรกรรม · 03"], ["01", "04", 3, 0, null, "อายุรกรรม · 04"],
  ["01", "41", 2, 0, null, "อายุรกรรม · 41"], ["01", "42", 2, 0, null, "อายุรกรรม · 42"],
  ["01", "25", 1, 0, null, "อายุรกรรม · 25"], ["01", "33", 1, 0, null, "อายุรกรรม · 33"],
  ["01", "44", 1, 0, null, "อายุรกรรม · 44"], ["01", "69", 1, 0, null, "อายุรกรรม · 69"],
  ["02", "14", 3, 0, null, "ศัลยกรรม · 14"], ["02", "15", 3, 0, null, "ศัลยกรรม · 15"],
  ["02", "22", 3, 0, null, "ศัลยกรรม · 22"], ["02", "46", 3, 0, null, "ศัลยกรรม · 46"],
  ["02", "18", 2, 0, null, "ศัลยกรรม · 18"], ["02", "13", 1, 0, null, "ศัลยกรรม · 13"],
  ["03", "07", 3, 0, null, "สูตินรีเวชกรรม · 07"],
  [null, "06", 3, 1, null, "สูติกรรม (Dx O) · 06"], [null, "31", 2, 1, null, "สูติกรรม (Dx O) · 31"],
  [null, "34", 1, 1, null, "สูติกรรม (Dx O) · 34"],
  ["05", "20", 6, 0, 14, "กุมารเวชกรรม · 20"], ["05", "16", 4, 0, 14, "กุมารเวชกรรม · 16"],
  ["05", "40", 3, 0, 14, "กุมารเวชกรรม · 40"], ["05", "17", 1, 0, 14, "กุมารเวชกรรม · 17"],
  ["05", "21", 1, 0, 14, "กุมารเวชกรรม · 21"],
  ["06", null, 1, 0, null, "โสต ศอ นาสิก · ทุกวอร์ด"],
  ["07", "23", 4, 0, null, "จักษุ · 23"], ["07", "19", 2, 0, null, "จักษุ · 19"],
  ["08", "29", 2, 0, null, "ศัลยกรรมกระดูก · 29"], ["08", "30", 2, 0, null, "ศัลยกรรมกระดูก · 30"],
];

// วอร์ด 06/31/34 (Dx O จากทุกแผนก) นับเป็นสูติกรรม (specialty 03 + Dx O) ตามตารางเกณฑ์ ไม่ใช่แผนกที่ admit
const OB_WARDS = new Set(QUOTAS.filter((q) => q[0] === null && q[3]).map((q) => q[1]));
const isDxO = (dx) => /^\s*O/i.test(String(dx ?? ""));
export const deptSpecialty = (ward, specialty, dx) => (OB_WARDS.has(ward) && isDxO(dx) ? "03" : specialty);

const RANDOM_SQL = (quotaValues) => `
WITH Q AS (SELECT * FROM (VALUES ${quotaValues}) v(QId, Spec, Ward, Quota, DxO, MaxAge)),
Pool AS (
    SELECT q.QId, q.Quota,
        RTRIM(a.SPECIALTY) AS Specialty, RTRIM(c.ClinicName) AS ClinicName,
        RTRIM(a.ADMWARD) AS Ward, RTRIM(w.WardName) AS WardName,
        RTRIM(a.HN) AS HN, RTRIM(a.AN) AS AN,
        CONVERT(date, a.ADMDATETIME) AS AdmitDate, CONVERT(date, a.DISCHARGEDATETIME) AS DischargeDate,
        DATEDIFF(DAY, a.ADMDATETIME, a.DISCHARGEDATETIME) AS LOS,
        DATEDIFF(MINUTE, a.ADMDATETIME, a.DISCHARGEDATETIME) AS LosMin,
        s.DIAGNOSES AS Dx,
        -- AN เดียวเข้าได้หลายโควตา (โสตฯ ที่ Dx O และนอนวอร์ด 06/31/34) -> ใช้โควตาที่ระบุวอร์ดก่อน
        ROW_NUMBER() OVER (PARTITION BY a.AN ORDER BY CASE WHEN q.Ward IS NULL THEN 1 ELSE 0 END, q.QId) AS Dup
    FROM ${HIS}.dbo.ADMMASTER a
    JOIN Q q ON (q.Ward IS NULL OR q.Ward = a.ADMWARD) AND (q.Spec IS NULL OR q.Spec = a.SPECIALTY)
    LEFT JOIN ${HIS}.dbo.WardCode w   ON a.ADMWARD = w.CODE
    LEFT JOIN ${HIS}.dbo.IPDSUMMARY s ON a.AN = s.AN AND s.SUFFIX = 1
    LEFT JOIN ${HIS}.dbo.ClinicName c ON a.SPECIALTY = c.CODE
    LEFT JOIN ${HIS}.dbo.PATIENT_INFO p ON q.MaxAge IS NOT NULL AND p.HN = a.HN  -- ใช้วันเกิดกรองอายุเท่านั้น ห้าม SELECT
    WHERE a.DISCHARGEDATETIME >= @from AND a.DISCHARGEDATETIME < @to
      AND a.DISCHARGETYPE NOT IN ('', '0')
      AND a.DISCHARGEDATETIME >= a.ADMDATETIME
      AND DATEDIFF(DAY, a.ADMDATETIME, a.DISCHARGEDATETIME) <= 90
      AND (q.DxO = 0 OR LTRIM(s.DIAGNOSES) LIKE 'O%')
      -- ไม่สุ่มเคสที่อยู่ในรายการตรวจแล้ว หรือตรวจในระบบเดิมแล้ว (โควตาจะได้ครบตอนบันทึก)
      AND NOT EXISTS (SELECT 1 FROM mra.AuditWorklist x WHERE x.AN = RTRIM(a.AN) COLLATE DATABASE_DEFAULT AND x.WorklistStatus <> 'CANCELLED')
      AND NOT EXISTS (SELECT 1 FROM dbo.mra_ipd_main l WHERE l.an = RTRIM(a.AN) COLLATE DATABASE_DEFAULT)
      AND (q.MaxAge IS NULL OR (p.BIRTHDATETIME IS NOT NULL AND
           DATEDIFF(YEAR, p.BIRTHDATETIME, a.ADMDATETIME)
             - CASE WHEN DATEADD(YEAR, DATEDIFF(YEAR, p.BIRTHDATETIME, a.ADMDATETIME), p.BIRTHDATETIME) > a.ADMDATETIME THEN 1 ELSE 0 END
           <= q.MaxAge))
),
Ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY QId
               ORDER BY CASE WHEN LOS >= 3 THEN 0 ELSE 1 END,       -- นอน 3–90 วันก่อน (สุ่ม)
                        CASE WHEN LOS >= 3 THEN 0 ELSE LosMin END DESC, -- ไม่พอ -> นอนไม่ถึง 3 วัน นอนนานสุดก่อน
                        NEWID()) AS RN
    FROM Pool WHERE Dup = 1
)
SELECT ROW_NUMBER() OVER (ORDER BY QId, AN) AS SeqNo,  -- เรียงตามลำดับในตารางเกณฑ์
       QId, Specialty, ClinicName, Ward, WardName, HN, AN, AdmitDate, DischargeDate, LOS, Dx
FROM Ranked WHERE RN <= Quota
ORDER BY QId, AN`;

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
  const qv = valuesList("q", QUOTAS.map((x, i) => [i, x[0], x[1], x[2], x[3], x[4]]),
    [sql.Int, sql.VarChar(10), sql.VarChar(10), sql.Int, sql.Bit, sql.Int]);
  const r = await query(RANDOM_SQL(qv.text), { ...qv.params, from: [sql.DateTime, from], to: [sql.DateTime, to] });
  const rows = r.recordset;
  // โควตาที่สุ่มได้ไม่ครบ (แม้เติมเคสนอนไม่ถึง 3 วันแล้ว)
  const got = new Map();
  for (const x of rows) got.set(x.QId, (got.get(x.QId) ?? 0) + 1);
  const shortfalls = QUOTAS.map((x, i) => ({ label: x[5], quota: x[2], got: got.get(i) ?? 0 })).filter((x) => x.got < x.quota);
  if (!rows.length) return { rows: [], shortfalls };
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
  return { shortfalls, rows: rows.map((x) => {
    const spec = deptSpecialty(x.Ward, x.Specialty, x.Dx);
    const dept = depts
      .filter((d) => d.HisSpecialtyCode === spec && (!d.HisDxPrefix || String(x.Dx ?? "").trimStart().startsWith(d.HisDxPrefix)))
      .sort((a, b) => (b.HisDxPrefix ? 1 : 0) - (a.HisDxPrefix ? 1 : 0))[0];
    const f = flags.get(x.AN) ?? {};
    return {
      seqNo: Number(x.SeqNo), an: x.AN, hn: x.HN, specialty: x.Specialty, clinic: x.ClinicName,
      ward: x.Ward, wardName: x.WardName, admit: x.AdmitDate, discharge: x.DischargeDate, los: x.LOS,
      dept: dept?.DepartmentName ?? null, wardMapped: wards.has(x.Ward),
      inWorklist: !!f.InWorklist, inLegacy: !!f.InLegacy, shortStay: x.LOS < 3,
    };
  }) };
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
        { spec: [sql.VarChar(10), deptSpecialty(a.Ward, a.Specialty ?? "", a.Dx)], dx: [sql.VarChar(sql.MAX), String(a.Dx ?? "").trimStart()], ward: [sql.VarChar(10), a.Ward ?? ""], an: [sql.VarChar(20), a.AN] }
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
