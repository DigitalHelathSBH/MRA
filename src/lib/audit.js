import "server-only";
import { query, transaction, sql, HIS, valuesList } from "./db";
import { auditMonthSql } from "./basis";

/* ---------------- เกณฑ์การประเมิน (ข้อมูลอ้างอิง ไม่มีข้อมูลผู้ป่วย) ---------------- */
let criteriaCache = null;

export async function getCriteria() {
  if (criteriaCache) return criteriaCache;
  const r = await query(`
    DECLARE @Set INT = (SELECT TOP 1 CriteriaSetId FROM mra.CriteriaSet
                        WHERE IsActive = 1 AND EffectiveFrom <= CAST(GETDATE() AS DATE) ORDER BY EffectiveFrom DESC);
    SELECT CriteriaSetId, SetCode, SetName FROM mra.CriteriaSet WHERE CriteriaSetId = @Set;
    SELECT ContentId, ContentNo, ContentCode, TitleEn, TitleTh, AllowContentNA, AllowDeduction, MaxDeduction, HintText
      FROM mra.AuditContent WHERE CriteriaSetId = @Set ORDER BY ContentNo;
    SELECT c.CriterionId, c.ContentId, c.CriterionNo, c.CriterionText, c.AllowNA, c.NoteText
      FROM mra.AuditCriterion c JOIN mra.AuditContent a ON a.ContentId = c.ContentId
     WHERE a.CriteriaSetId = @Set ORDER BY c.ContentId, c.CriterionNo;
    SELECT g.ContentId, g.SignatureCriterionNo, g.CoverFromNo, g.CoverToNo, g.Description
      FROM mra.CriterionGate g JOIN mra.AuditContent a ON a.ContentId = g.ContentId WHERE a.CriteriaSetId = @Set;`);
  const [[set], contents, criteria, gates] = r.recordsets;
  if (!set) throw new Error("ไม่พบชุดเกณฑ์ที่ใช้งานอยู่ (mra.CriteriaSet)");
  criteriaCache = {
    setId: set.CriteriaSetId,
    setName: set.SetName,
    contents: contents.map((c) => ({
      contentId: c.ContentId,
      no: c.ContentNo,
      titleEn: c.TitleEn,
      titleTh: c.TitleTh,
      allowContentNA: c.AllowContentNA,
      allowDeduction: c.AllowDeduction,
      maxDeduction: c.MaxDeduction,
      hint: c.HintText,
      criteria: criteria
        .filter((x) => x.ContentId === c.ContentId)
        .map((x) => ({ criterionId: x.CriterionId, no: x.CriterionNo, text: x.CriterionText, allowNA: x.AllowNA, note: x.NoteText })),
      gates: gates
        .filter((g) => g.ContentId === c.ContentId)
        .map((g) => ({ sig: g.SignatureCriterionNo, from: g.CoverFromNo, to: g.CoverToNo, description: g.Description })),
    })),
  };
  return criteriaCache;
}

/* ---------------- ข้อมูลหลัก ---------------- */
export async function getDepartmentsAndWards() {
  const r = await query(`
    SELECT DepartmentId, DepartmentName FROM mra.Department WHERE IsActive = 1 ORDER BY DepartmentName;
    SELECT WardId, DepartmentId, WardName, HisWardCode FROM mra.Ward WHERE IsActive = 1 ORDER BY HisWardCode;`);
  const [departments, wards] = r.recordsets;
  return { departments, wards };
}

/* ---------------- แพทย์ (รหัสจาก HIS ชื่อจาก GetUserFullName) ---------------- */
const cleanName = (name, code) => String(name ?? "").replace(/\s+/g, " ").replace(/\.+$/, "").trim() || code;

// แพทย์ที่เกี่ยวข้องกับ AN: แพทย์ผู้สรุป (IPDSUMMARY ลำดับ 1) เป็นค่าเริ่มต้น + แพทย์ใน IPDDOCTOR
export async function getDoctorOptions(an) {
  const r = await query(
    `SELECT d.Code, ${HIS}.dbo.GetUserFullName(d.Code) AS Name, MAX(d.IsSummary) AS IsSummary
       FROM (SELECT DOCTOR AS Code, 1 AS IsSummary FROM ${HIS}.dbo.IPDSUMMARY WHERE AN = @an AND SUFFIX = 1 AND DOCTOR IS NOT NULL
             UNION ALL
             SELECT DOCTOR, 0 FROM ${HIS}.dbo.IPDDOCTOR WHERE AN = @an AND DOCTOR IS NOT NULL) d
      GROUP BY d.Code
      ORDER BY MAX(d.IsSummary) DESC, d.Code`,
    { an: [sql.VarChar(20), an] }
  );
  return r.recordset.map((x) => ({ code: x.Code.trim(), name: cleanName(x.Name, x.Code.trim()), isSummary: !!x.IsSummary }));
}

// หา/เพิ่มแพทย์ใน mra.Doctor ด้วยรหัส HIS แล้วคืน DoctorId (q = query หรือ query ใน transaction)
export async function upsertDoctor(q, code) {
  if (!code) return null;
  const name = (await q(`SELECT ${HIS}.dbo.GetUserFullName(@c) AS Name`, { c: [sql.VarChar(20), code] })).recordset[0]?.Name;
  const r = await q(
    `MERGE mra.Doctor WITH (HOLDLOCK) AS t USING (SELECT @c AS DoctorCode, @n AS DoctorName) AS s ON t.DoctorCode = s.DoctorCode
     WHEN MATCHED THEN UPDATE SET DoctorName = s.DoctorName
     WHEN NOT MATCHED THEN INSERT (DoctorCode, DoctorName) VALUES (s.DoctorCode, s.DoctorName)
     OUTPUT inserted.DoctorId;`,
    { c: [sql.VarChar(20), code], n: [sql.NVarChar(200), cleanName(name, code)] }
  );
  return r.recordset[0].DoctorId;
}

/* ---------------- รายการเคสรอตรวจ ---------------- */
// month = 'YYYY-MM' เดือนที่ Audit (PlannedAuditDate · ถ้าไม่มีใช้เดือนจำหน่าย + 2 เดือน)
export async function listWorklist({ month, deptId, wardId, status, q }) {
  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  const r = await query(
    `SELECT w.WorklistId, w.SeqNo, w.AN, w.HN, d.DepartmentName, wd.WardName, w.AdmitDate, w.DischargeDate, w.PlannedAuditDate,
            w.WorklistStatus, ar.SumScore, ar.FullScore, ar.RecordStatus,
            IsLegacy = CASE WHEN ar.LegacySyncedAt IS NULL AND EXISTS (SELECT 1 FROM dbo.mra_ipd_main m WHERE m.an = w.AN)
                            THEN 1 ELSE 0 END
       FROM mra.AuditWorklist w
       JOIN mra.Department d ON d.DepartmentId = w.DepartmentId
       LEFT JOIN mra.Ward wd ON wd.WardId = w.WardId
       LEFT JOIN mra.AuditRecord ar ON ar.WorklistId = w.WorklistId
      WHERE w.WorklistStatus <> 'CANCELLED'
        AND ${auditMonthSql("w")} >= @from AND ${auditMonthSql("w")} < @to
        AND (@dept IS NULL OR w.DepartmentId = @dept)
        AND (@ward IS NULL OR w.WardId = @ward)
        AND (@q IS NULL OR w.AN LIKE @q + '%' OR w.HN LIKE @q + '%')
      ORDER BY w.DischargeDate, d.DepartmentName, wd.WardName, w.AN`,
    {
      from: [sql.Date, from],
      to: [sql.Date, to],
      dept: [sql.Int, deptId || null],
      ward: [sql.Int, wardId || null],
      q: [sql.VarChar(20), q || null],
    }
  );
  const rows = r.recordset.map((x) => ({ ...x, Status: x.IsLegacy ? "LEGACY" : x.WorklistStatus }));
  return status ? rows.filter((x) => x.Status === status) : rows;
}

// เพิ่มเคสเองด้วย AN: ดึงข้อมูลจาก HIS
// แผนก = SPECIALTY ของ AN (+ Dx หลักสำหรับสูติ/นรีเวช), ward = ADMWARD, แพทย์ = แพทย์ผู้สรุปใน IPDSUMMARY
export async function addWorklistByAN(an, user) {
  const exists = await query(
    `SELECT 1 FROM mra.AuditWorklist WHERE AN = @an AND WorklistStatus <> 'CANCELLED'`,
    { an: [sql.VarChar(20), an] }
  );
  if (exists.recordset.length) return { error: `AN ${an} อยู่ในรายการแล้ว` };

  const his = await query(
    `SELECT TOP 1 a.AN, a.HN, a.ADMDATETIME, a.DISCHARGEDATETIME, RTRIM(a.ADMWARD) AS ADMWARD, RTRIM(a.SPECIALTY) AS SPECIALTY,
            s.DIAGNOSES,
            -- แพทย์ผู้สรุป ถ้าไม่มีใช้แพทย์ล่าสุดใน IPDDOCTOR
            DOCTOR = RTRIM(COALESCE(NULLIF(s.DOCTOR, ''),
                       (SELECT TOP 1 d.DOCTOR FROM ${HIS}.dbo.IPDDOCTOR d WHERE d.AN = a.AN ORDER BY d.VALIDTOPOSTFROMDATETIME DESC)))
       FROM ${HIS}.dbo.ADMMASTER a
       LEFT JOIN ${HIS}.dbo.IPDSUMMARY s ON s.AN = a.AN AND s.SUFFIX = 1
      WHERE a.AN = @an`,
    { an: [sql.VarChar(20), an] }
  );
  const a = his.recordset[0];
  if (!a) return { error: `ไม่พบ AN ${an} ใน HIS กรุณาตรวจสอบ` };
  if (!a.DISCHARGEDATETIME) return { error: `AN ${an} ยังไม่ได้จำหน่าย` };

  const map = await query(
    `SELECT TOP 1 DepartmentId FROM mra.Department
      WHERE IsActive = 1 AND HisSpecialtyCode = @spec AND (HisDxPrefix IS NULL OR @dx LIKE HisDxPrefix + '%')
      ORDER BY CASE WHEN HisDxPrefix IS NULL THEN 1 ELSE 0 END;
     SELECT WardId FROM mra.Ward WHERE HisWardCode = @ward;`,
    { spec: [sql.VarChar(10), a.SPECIALTY ?? ""], dx: [sql.VarChar(sql.MAX), a.DIAGNOSES ?? ""], ward: [sql.VarChar(10), a.ADMWARD ?? ""] }
  );
  const dept = map.recordsets[0][0];
  if (!dept) return { error: `แผนก (Specialty ${a.SPECIALTY ?? "-"}) ของ AN นี้ยังไม่ได้จับคู่ในระบบ กรุณาแจ้งผู้ดูแล` };
  const ward = map.recordsets[1][0];

  const anTrim = a.AN.trim();
  await transaction(async (q) => {
    const doctorId = await upsertDoctor(q, a.DOCTOR);
    await q(
      `INSERT INTO mra.AuditWorklist (AN, HN, DepartmentId, WardId, DoctorId, AdmitDate, DischargeDate, PlannedAuditDate, CreatedBy)
       VALUES (@an, @hn, @dept, @ward, @doc, @admit, @dc, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1), @by)`,
      {
        an: [sql.VarChar(20), anTrim],
        hn: [sql.VarChar(20), String(a.HN).trim()],
        dept: [sql.Int, dept.DepartmentId],
        ward: [sql.Int, ward?.WardId ?? null],
        doc: [sql.Int, doctorId],
        admit: [sql.Date, a.ADMDATETIME],
        dc: [sql.Date, a.DISCHARGEDATETIME],
        by: [sql.Int, user.UserId],
      }
    );
  });
  return { ok: true, an: anTrim };
}

/* ---------------- เปิดแบบตรวจ ---------------- */
export async function getAuditByAN(an) {
  const r = await query(
    `SELECT w.WorklistId, w.AN, w.HN, w.DepartmentId, w.WardId, w.DoctorId, w.AdmitDate, w.DischargeDate, w.WorklistStatus, w.PlannedAuditDate,
            ar.AuditId, ar.DepartmentId AS ArDepartmentId, ar.WardId AS ArWardId, ar.DoctorId AS ArDoctorId,
            ar.AuditDate, ar.OverallFinding, ar.OverallSpecify, ar.RecordStatus, ar.UpdatedAt, ar.CompletedAt,
            ar.LegacySyncedAt, CONVERT(VARCHAR(20), CONVERT(BINARY(8), ar.RowVer), 1) AS RowVer,
            au.Username AS AuditorCode, au.FullName AS AuditorName,
            DoctorCode = (SELECT DoctorCode FROM mra.Doctor WHERE DoctorId = ISNULL(ar.DoctorId, w.DoctorId)),
            IsLegacy = CASE WHEN ar.LegacySyncedAt IS NULL AND EXISTS (SELECT 1 FROM dbo.mra_ipd_main m WHERE m.an = w.AN)
                            THEN 1 ELSE 0 END
       FROM mra.AuditWorklist w
       LEFT JOIN mra.AuditRecord ar ON ar.WorklistId = w.WorklistId
       LEFT JOIN mra.AppUser au ON au.UserId = ar.AuditorId
      WHERE w.AN = @an AND w.WorklistStatus <> 'CANCELLED';
     SELECT acr.ContentId, acr.ContentStatus, acr.DeductionFlag, acr.Remark
       FROM mra.AuditContentResult acr JOIN mra.AuditRecord ar ON ar.AuditId = acr.AuditId
       JOIN mra.AuditWorklist w ON w.WorklistId = ar.WorklistId
      WHERE w.AN = @an AND w.WorklistStatus <> 'CANCELLED';
     SELECT r.CriterionId, r.Result
       FROM mra.AuditCriterionResult r JOIN mra.AuditRecord ar ON ar.AuditId = r.AuditId
       JOIN mra.AuditWorklist w ON w.WorklistId = ar.WorklistId
      WHERE w.AN = @an AND w.WorklistStatus <> 'CANCELLED';`,
    { an: [sql.VarChar(20), an] }
  );
  const [[head], contents, criteria] = r.recordsets;
  if (!head) return null;
  return { head, contents, criteria };
}

/* ---------------- บันทึก ---------------- */
export class SaveError extends Error {}

// payload: { an, rowVer, departmentId, wardId, doctorCode, auditDate, overall, spec, reason,
//            items: [{ contentId, status, ded, remark, crit: { [criterionId]: 'PASS'|'FAIL'|'NA' } }] }
// mode: 'draft' | 'complete'
export async function saveAudit(payload, mode, user) {
  const criteria = await getCriteria();
  const items = validateItems(payload.items, criteria);
  const auditDate = parseDate(payload.auditDate, "วันที่ตรวจประเมิน");
  if (auditDate > todayISO()) throw new SaveError("วันที่ตรวจประเมินต้องไม่เกินวันนี้");
  const departmentId = Number(payload.departmentId);
  if (!Number.isInteger(departmentId) || departmentId <= 0) throw new SaveError("กรุณาเลือกแผนก");
  const overall = payload.overall ? Number(payload.overall) : null;
  if (overall !== null && ![1, 2, 3].includes(overall)) throw new SaveError("Overall finding ไม่ถูกต้อง");
  const spec = String(payload.spec ?? "").trim().slice(0, 1000) || null;

  return transaction(async (q) => {
    const w = (
      await q(
        `SELECT w.WorklistId, w.AN, w.HN, w.AdmitDate, w.DischargeDate, ar.AuditId, ar.RecordStatus, ar.CreatedBy,
                CONVERT(VARCHAR(20), CONVERT(BINARY(8), ar.RowVer), 1) AS RowVer,
                IsLegacy = CASE WHEN ar.LegacySyncedAt IS NULL AND EXISTS (SELECT 1 FROM dbo.mra_ipd_main m WHERE m.an = w.AN)
                                THEN 1 ELSE 0 END
           FROM mra.AuditWorklist w WITH (UPDLOCK)
           LEFT JOIN mra.AuditRecord ar ON ar.WorklistId = w.WorklistId
          WHERE w.AN = @an AND w.WorklistStatus <> 'CANCELLED'`,
        { an: [sql.VarChar(20), payload.an] }
      )
    ).recordset[0];
    if (!w) throw new SaveError("ไม่พบเคสนี้ในรายการ");
    if (w.IsLegacy) throw new SaveError("AN นี้บันทึกผลตรวจจากระบบเดิมแล้ว ระบบใหม่จะไม่บันทึกทับ");
    if (w.RowVer && w.RowVer !== payload.rowVer)
      throw new SaveError("เคสนี้ถูกแก้ไขจากเครื่องอื่นหลังจากที่คุณเปิด กรุณาโหลดหน้าใหม่ก่อนบันทึก");
    const wasCompleted = w.RecordStatus === "COMPLETED";
    if (wasCompleted && mode === "draft") throw new SaveError("เคสที่บันทึกเสร็จแล้วต้องบันทึกการแก้ไขพร้อมเหตุผล");
    const reason = String(payload.reason ?? "").trim().slice(0, 300);
    if (wasCompleted && !reason) throw new SaveError("กรุณาระบุเหตุผลการแก้ไข");
    if (auditDate < isoOf(w.DischargeDate)) throw new SaveError("วันที่ตรวจประเมินต้องไม่ก่อนวันที่ discharge");

    const doctorCode = String(payload.doctorCode ?? "").trim();
    if (doctorCode && !/^[A-Za-z0-9]{1,14}$/.test(doctorCode)) throw new SaveError("รหัสแพทย์ไม่ถูกต้อง");
    const header = {
      dept: [sql.Int, departmentId],
      ward: [sql.Int, payload.wardId ? Number(payload.wardId) : null],
      doc: [sql.Int, await upsertDoctor(q, doctorCode)],
      adate: [sql.Date, auditDate],
      ov: [sql.TinyInt, overall],
      spec: [sql.NVarChar(1000), spec],
      uid: [sql.Int, user.UserId],
    };

    let auditId = w.AuditId;
    if (!auditId) {
      auditId = (
        await q(
          `INSERT INTO mra.AuditRecord (WorklistId, CriteriaSetId, Hcode, HospitalName, AN, HN, DepartmentId, WardId, DoctorId,
                                        AdmitDate, DischargeDate, AuditorId, AuditDate, OverallFinding, OverallSpecify, CreatedBy, UpdatedBy)
           OUTPUT inserted.AuditId
           SELECT @wl, @set, ISNULL((SELECT SettingValue FROM mra.SystemSetting WHERE SettingKey = 'HCODE'), ''),
                  ISNULL((SELECT SettingValue FROM mra.SystemSetting WHERE SettingKey = 'HOSPITAL_NAME'), N''),
                  w.AN, w.HN, @dept, @ward, @doc, w.AdmitDate, w.DischargeDate, @uid, @adate, @ov, @spec, @uid, @uid
             FROM mra.AuditWorklist w WHERE w.WorklistId = @wl`,
          { ...header, wl: [sql.Int, w.WorklistId], set: [sql.Int, criteria.setId] }
        )
      ).recordset[0].AuditId;
      for (const c of criteria.contents) {
        await q(`INSERT INTO mra.AuditContentResult (AuditId, ContentId) VALUES (@a, @c)`, {
          a: [sql.Int, auditId],
          c: [sql.Int, c.contentId],
        });
      }
    } else {
      // แก้เคสที่เสร็จแล้ว: ย้อนเป็น DRAFT ชั่วคราวใน transaction นี้ แล้ว COMPLETE ใหม่ด้านล่าง
      await q(
        `UPDATE mra.AuditRecord
            SET DepartmentId = @dept, WardId = @ward, DoctorId = @doc, AuditDate = @adate, OverallFinding = @ov,
                OverallSpecify = @spec, RecordStatus = 'DRAFT', CompletedAt = NULL, UpdatedAt = SYSDATETIME(), UpdatedBy = @uid
          WHERE AuditId = @a`,
        { ...header, a: [sql.Int, auditId] }
      );
    }

    for (const it of items) {
      await q(
        `UPDATE mra.AuditContentResult SET ContentStatus = @s, DeductionFlag = @d, Remark = @r WHERE AuditId = @a AND ContentId = @c`,
        {
          a: [sql.Int, auditId],
          c: [sql.Int, it.contentId],
          s: [sql.VarChar(10), it.status],
          d: [sql.Bit, it.ded],
          r: [sql.NVarChar(500), it.remark],
        }
      );
    }
    await q(`DELETE FROM mra.AuditCriterionResult WHERE AuditId = @a`, { a: [sql.Int, auditId] });
    const rows = items.flatMap((it) => (it.status === "ASSESS" ? Object.entries(it.crit) : []));
    if (rows.length) {
      // insert ครั้งเดียวด้วย VALUES (เกณฑ์สูงสุด 106 ข้อ = 212 parameter)
      const v = valuesList("r", rows.map(([c, res]) => [Number(c), res]), [sql.Int, sql.VarChar(4)]);
      await q(
        `INSERT INTO mra.AuditCriterionResult (AuditId, CriterionId, Result)
         SELECT @a, v.CriterionId, v.Result FROM (VALUES ${v.text}) v(CriterionId, Result)`,
        { a: [sql.Int, auditId], ...v.params }
      );
    }
    await q(`EXEC mra.usp_RecalculateAuditScore @AuditId = @a`, { a: [sql.Int, auditId] });

    let action = w.AuditId ? "SAVE_DRAFT" : "CREATE";
    if (mode === "complete") {
      const s = (
        await q(`SELECT PendingCount, FullScore, SumScore FROM mra.AuditRecord WHERE AuditId = @a`, { a: [sql.Int, auditId] })
      ).recordset[0];
      const errs = [];
      if (s.PendingCount) errs.push(`ยังไม่ได้ประเมินอีก ${s.PendingCount} ข้อ`);
      if (!overall) errs.push("ยังไม่ได้เลือก Overall finding");
      if (overall === 3 && !spec) errs.push("Overall finding ข้อ 3 ต้องระบุรายละเอียด");
      if (errs.length) throw new SaveError("บันทึกเสร็จไม่ได้: " + errs.join(" · "));
      await q(
        `UPDATE mra.AuditRecord SET RecordStatus = 'COMPLETED', CompletedAt = SYSDATETIME(), UpdatedAt = SYSDATETIME(), UpdatedBy = @u
          WHERE AuditId = @a`,
        { a: [sql.Int, auditId], u: [sql.Int, user.UserId] }
      );
      await q(`EXEC mra.usp_SyncLegacy @AuditId = @a, @UserCode = @code`, {
        a: [sql.Int, auditId],
        code: [sql.VarChar(20), user.Username],
      });
      action = wasCompleted ? "EDIT" : "COMPLETE";
    }

    await q(
      `UPDATE mra.AuditWorklist SET WorklistStatus = @st WHERE WorklistId = @wl`,
      { wl: [sql.Int, w.WorklistId], st: [sql.VarChar(15), mode === "complete" ? "COMPLETED" : "IN_PROGRESS"] }
    );
    await q(
      `INSERT INTO mra.AuditHistory (AuditId, ActionCode, ChangedBy, FullScore, SumScore, SnapshotJson, Reason)
       SELECT AuditId, @act, @u, FullScore, SumScore, @snap, @reason FROM mra.AuditRecord WHERE AuditId = @a`,
      {
        a: [sql.Int, auditId],
        act: [sql.VarChar(15), action],
        u: [sql.Int, user.UserId],
        snap: [sql.NVarChar(sql.MAX), JSON.stringify({ overall, items: items.map(({ remark, ...x }) => x) })],
        reason: [sql.NVarChar(300), reason || null],
      }
    );
    const done = (
      await q(`SELECT FullScore, SumScore, ScorePct, RecordStatus,
                     CONVERT(VARCHAR(20), CONVERT(BINARY(8), RowVer), 1) AS RowVer
                FROM mra.AuditRecord WHERE AuditId = @a`, {
        a: [sql.Int, auditId],
      })
    ).recordset[0];
    return { auditId, ...done };
  });
}

function validateItems(items, criteria) {
  if (!Array.isArray(items) || items.length !== criteria.contents.length) throw new SaveError("ข้อมูลหัวข้อไม่ครบ");
  return criteria.contents.map((c, i) => {
    const it = items[i] ?? {};
    if (Number(it.contentId) !== c.contentId) throw new SaveError("ลำดับหัวข้อไม่ตรงกับชุดเกณฑ์");
    const status = String(it.status);
    if (!["ASSESS", "NA", "MISSING", "NO"].includes(status)) throw new SaveError(`สถานะหัวข้อ ${c.no} ไม่ถูกต้อง`);
    if (status === "NA" && !c.allowContentNA) throw new SaveError(`หัวข้อ ${c.no} เลือก NA ไม่ได้`);
    const crit = {};
    for (const cr of c.criteria) {
      const v = it.crit?.[cr.criterionId];
      if (v == null) continue;
      if (!["PASS", "FAIL", "NA"].includes(v) || (v === "NA" && !cr.allowNA))
        throw new SaveError(`ผลเกณฑ์ข้อ ${c.no}.${cr.no} ไม่ถูกต้อง`);
      crit[cr.criterionId] = v;
    }
    return {
      contentId: c.contentId,
      status,
      ded: Boolean(c.allowDeduction && status === "ASSESS" && it.ded),
      remark: String(it.remark ?? "").trim().slice(0, 500) || null,
      crit,
    };
  });
}

// รับเฉพาะวันที่ที่มีจริง (กัน 2026-02-30)
function parseDate(v, label) {
  const s = String(v ?? "");
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
  if (!ok) throw new SaveError(`${label} ไม่ถูกต้อง`);
  return s;
}
function todayISO() {
  const t = new Date();
  t.setMinutes(t.getMinutes() - t.getTimezoneOffset());
  return t.toISOString().slice(0, 10);
}
function isoOf(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}
