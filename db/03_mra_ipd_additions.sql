/* =====================================================================
   MRA IPD — ส่วนเพิ่มจาก schema หลัก (รันหลัง 01 และ 02)
   - คอลัมน์จับคู่กับ HIS และระบบเดิม
   - mra.usp_SyncLegacy: เขียนผลตรวจกลับ dbo.mra_ipd_main / dbo.mra_ipd ให้ ReportIPD.aspx เดิมใช้ได้
   รันซ้ำได้ (ตรวจก่อนเพิ่มทุกครั้ง)
   ===================================================================== */

IF COL_LENGTH('mra.Department', 'LegacyDepartmentId') IS NULL
    ALTER TABLE mra.Department ADD LegacyDepartmentId INT NULL;      -- dbo.departments.department_id เดิม
IF COL_LENGTH('mra.Department', 'HisSpecialtyCode') IS NULL
    ALTER TABLE mra.Department ADD HisSpecialtyCode VARCHAR(10) NULL; -- ADMMASTER.Specialty / ClinicName.CODE
IF COL_LENGTH('mra.Department', 'HisDxPrefix') IS NULL
    ALTER TABLE mra.Department ADD HisDxPrefix VARCHAR(5) NULL;       -- ใช้แยกแผนกที่ Specialty เดียวกัน เช่น 03: 'O' = สูติกรรม
IF COL_LENGTH('mra.Ward', 'HisWardCode') IS NULL
    ALTER TABLE mra.Ward ADD HisWardCode VARCHAR(10) NULL;            -- ADMMASTER.ADMWARD / WardCode.CODE
IF COL_LENGTH('mra.Doctor', 'DoctorCode') IS NULL
    ALTER TABLE mra.Doctor ADD DoctorCode VARCHAR(20) NULL;           -- รหัสแพทย์ใน HIS (ชื่อจาก GetUserFullName)
IF COL_LENGTH('mra.AuditContent', 'LegacyItemId') IS NULL
    ALTER TABLE mra.AuditContent ADD LegacyItemId INT NULL;           -- dbo.ipd_items.ipd_items_id เดิม
IF COL_LENGTH('mra.AuditRecord', 'LegacySyncedAt') IS NULL
    ALTER TABLE mra.AuditRecord ADD LegacySyncedAt DATETIME2(0) NULL; -- มีค่า = แถวในตารางเดิมเป็นของระบบนี้
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Ward_HisWardCode')
    CREATE UNIQUE INDEX UX_Ward_HisWardCode ON mra.Ward (HisWardCode) WHERE HisWardCode IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_ImportBatch_Source')
    CREATE UNIQUE INDEX UX_ImportBatch_Source ON mra.ImportBatch (SourceFileName);   -- รอบสุ่มเดือนละครั้ง
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_Doctor_Code')
    CREATE UNIQUE INDEX UX_Doctor_Code ON mra.Doctor (DoctorCode) WHERE DoctorCode IS NOT NULL;
GO

/* Overall finding ใหม่ 1/2/3 ตรงกับ dbo.overall.overall_id เดิม จึงใช้ค่าเดียวกันได้เลย
   overall_ipd1/overall_ipd2 (ปัญหาการจัดเรียง / เอกสารไม่ระบุตัวผู้ป่วย) ยังไม่มีในแบบใหม่ ใส่ 0 */
IF OBJECT_ID('mra.LegacyOverallMap') IS NOT NULL DROP TABLE mra.LegacyOverallMap;
GO

UPDATE mra.SystemSetting SET SettingValue = N'10661' WHERE SettingKey = 'HCODE';
GO

/* ---------- เขียนกลับตารางเดิม (เรียกใน transaction เดียวกับการบันทึกเสร็จ) ---------- */
CREATE OR ALTER PROCEDURE mra.usp_SyncLegacy
    @AuditId  INT,
    @UserCode VARCHAR(20)          -- รหัสพนักงานผู้บันทึก (= Session["UserID"] ของ intranet)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @AN VARCHAR(20), @Status VARCHAR(10), @Synced DATETIME2(0), @AuditDate DATE,
            @Auditor VARCHAR(50), @LegacyDept INT, @Overall TINYINT;

    SELECT @AN = ar.AN, @Status = ar.RecordStatus, @Synced = ar.LegacySyncedAt, @AuditDate = ar.AuditDate,
           @Auditor = u.Username, @LegacyDept = d.LegacyDepartmentId, @Overall = ar.OverallFinding
    FROM mra.AuditRecord ar
    JOIN mra.AppUser u    ON u.UserId = ar.AuditorId
    JOIN mra.Department d ON d.DepartmentId = ar.DepartmentId
    WHERE ar.AuditId = @AuditId;

    IF @AN IS NULL            THROW 50020, N'ไม่พบผลการตรวจ', 1;
    IF LEN(@Auditor) > 6 OR LEN(@UserCode) > 6
                              THROW 50026, N'รหัสพนักงานยาวเกิน 6 ตัวอักษร บันทึกลงตารางเดิม (auditor/entry_by) ไม่ได้', 1;
    IF @Status <> 'COMPLETED' THROW 50021, N'ส่งเข้าระบบเดิมได้เฉพาะเคสที่บันทึกเสร็จแล้ว', 1;
    IF @LegacyDept IS NULL    THROW 50022, N'แผนกนี้ยังไม่ได้จับคู่กับแผนกในระบบเดิม (LegacyDepartmentId)', 1;
    IF @Overall IS NULL       THROW 50023, N'ยังไม่ได้เลือก Overall finding', 1;
    IF EXISTS (SELECT 1 FROM mra.AuditContentResult acr JOIN mra.AuditContent ac ON ac.ContentId = acr.ContentId
               WHERE acr.AuditId = @AuditId AND ac.LegacyItemId IS NULL)
                              THROW 50024, N'มีหัวข้อที่ยังไม่ได้จับคู่กับ ipd_items ของระบบเดิม', 1;

    -- AN ที่บันทึกจากหน้าเดิม (IPDForm) ต้องไม่ถูกเขียนทับ
    IF @Synced IS NULL AND EXISTS (SELECT 1 FROM dbo.mra_ipd_main WHERE an = @AN)
        THROW 50025, N'AN นี้มีผลตรวจที่บันทึกจากระบบเดิมแล้ว ระบบใหม่จะไม่เขียนทับ', 1;

    DELETE FROM dbo.mra_ipd      WHERE an = @AN;
    DELETE FROM dbo.mra_ipd_main WHERE an = @AN;

    INSERT INTO dbo.mra_ipd_main
        (an, audit_time, audit_year, auditor, audit_date, department_id, overall_ipd1, overall_ipd2, overall, entry_by, d_entry)
    VALUES (@AN, 1,
            CAST(YEAR(@AuditDate) + 543 + CASE WHEN MONTH(@AuditDate) >= 10 THEN 1 ELSE 0 END AS VARCHAR(4)),  -- ปีงบประมาณ พ.ศ.
            @Auditor, @AuditDate, @LegacyDept, 0, 0, @Overall, @UserCode, GETDATE());

    -- ค่ารายเกณฑ์: PASS = '1' (ข้อที่โดน gate = '0'), FAIL = '0', NA = 'NA'; content ที่ไม่ใช่ ASSESS = '0' ทั้งหมด
    WITH crit AS (
        SELECT acr.ContentId, c.CriterionNo,
               Val = CASE
                        WHEN acr.ContentStatus <> 'ASSESS' THEN '0'
                        WHEN r.Result = 'NA' THEN 'NA'
                        WHEN r.Result = 'PASS' AND NOT EXISTS (
                             SELECT 1 FROM mra.CriterionGate g
                             JOIN mra.AuditCriterion sc ON sc.ContentId = g.ContentId AND sc.CriterionNo = g.SignatureCriterionNo
                             JOIN mra.AuditCriterionResult sr ON sr.AuditId = acr.AuditId AND sr.CriterionId = sc.CriterionId AND sr.Result = 'FAIL'
                             WHERE g.ContentId = acr.ContentId AND c.CriterionNo BETWEEN g.CoverFromNo AND g.CoverToNo) THEN '1'
                        ELSE '0' END
        FROM mra.AuditContentResult acr
        JOIN mra.AuditCriterion c ON c.ContentId = acr.ContentId
        LEFT JOIN mra.AuditCriterionResult r ON r.AuditId = acr.AuditId AND r.CriterionId = c.CriterionId
        WHERE acr.AuditId = @AuditId
    ),
    pv AS (
        SELECT ContentId,
               d1 = MAX(CASE WHEN CriterionNo = 1 THEN Val END), d2 = MAX(CASE WHEN CriterionNo = 2 THEN Val END),
               d3 = MAX(CASE WHEN CriterionNo = 3 THEN Val END), d4 = MAX(CASE WHEN CriterionNo = 4 THEN Val END),
               d5 = MAX(CASE WHEN CriterionNo = 5 THEN Val END), d6 = MAX(CASE WHEN CriterionNo = 6 THEN Val END),
               d7 = MAX(CASE WHEN CriterionNo = 7 THEN Val END), d8 = MAX(CASE WHEN CriterionNo = 8 THEN Val END),
               d9 = MAX(CASE WHEN CriterionNo = 9 THEN Val END)
        FROM crit GROUP BY ContentId
    )
    -- ช่องเกณฑ์ที่หัวข้อนั้นไม่มี (เช่น content 2 มี 7 ข้อ → data8, data9) ใช้ 'NA' แบบระบบเดิม
    -- ยกเว้นหัวข้อที่เป็น NA ทั้งหัวข้อใช้ '0' (ReportIPD เดิมหัก sum(na) อยู่แล้ว)
    INSERT INTO dbo.mra_ipd
        (an, ipd_items_id, na, missing, no, data1, data2, data3, data4, data5, data6, data7, data8, data9,
         cut_score, get_score, full_score, etc_note, audit_time)
    SELECT @AN, ac.LegacyItemId,
           CASE WHEN acr.ContentStatus = 'NA' THEN 1 ELSE 0 END,
           CASE WHEN acr.ContentStatus = 'MISSING' THEN 1 ELSE 0 END,
           CASE WHEN acr.ContentStatus = 'NO' THEN 1 ELSE 0 END,
           ISNULL(pv.d1, e.empty), ISNULL(pv.d2, e.empty), ISNULL(pv.d3, e.empty), ISNULL(pv.d4, e.empty), ISNULL(pv.d5, e.empty),
           ISNULL(pv.d6, e.empty), ISNULL(pv.d7, e.empty), ISNULL(pv.d8, e.empty), ISNULL(pv.d9, e.empty),
           CASE WHEN acr.ContentStatus = 'ASSESS' AND ac.AllowDeduction = 1 AND acr.DeductionFlag = 1 THEN ac.MaxDeduction ELSE 0 END,
           acr.SumScore, acr.FullScore, LEFT(ISNULL(acr.Remark, N''), 300), 1   -- etc_note เดิมยาว 300
    FROM mra.AuditContentResult acr
    JOIN mra.AuditContent ac ON ac.ContentId = acr.ContentId
    LEFT JOIN pv ON pv.ContentId = acr.ContentId
    CROSS APPLY (SELECT CASE WHEN acr.ContentStatus = 'NA' THEN '0' ELSE 'NA' END) e(empty)
    WHERE acr.AuditId = @AuditId;

    UPDATE mra.AuditRecord SET LegacySyncedAt = SYSDATETIME() WHERE AuditId = @AuditId;
END;
GO
