/* =====================================================================
   MRA IPD Audit — รพ.สระบุรี
   SQL Server schema (SQL Server 2016 SP1 ขึ้นไป: ใช้ ISJSON, CREATE OR ALTER)
   ลำดับการรัน: 1) mra_ipd_schema.sql  2) mra_ipd_seed.sql
   วันที่ทุกช่องเก็บเป็น ค.ศ. แสดงผลเป็น พ.ศ. ที่ชั้นแอป
   ===================================================================== */

IF SCHEMA_ID(N'mra') IS NULL EXEC (N'CREATE SCHEMA mra');
GO

/* ---------- 1. ตั้งค่าระบบ ---------- */
CREATE TABLE mra.SystemSetting (
    SettingKey    VARCHAR(50)    NOT NULL CONSTRAINT PK_SystemSetting PRIMARY KEY,
    SettingValue  NVARCHAR(200)  NOT NULL,
    Description   NVARCHAR(300)  NULL
);
GO

/* ---------- 2. ข้อมูลหลัก ---------- */
CREATE TABLE mra.Department (
    DepartmentId    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Department PRIMARY KEY,
    DepartmentName  NVARCHAR(100) NOT NULL CONSTRAINT UQ_Department_Name UNIQUE,
    IsActive        BIT NOT NULL CONSTRAINT DF_Department_IsActive DEFAULT (1)
);

CREATE TABLE mra.Ward (
    WardId        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Ward PRIMARY KEY,
    DepartmentId  INT NOT NULL CONSTRAINT FK_Ward_Department REFERENCES mra.Department (DepartmentId),
    WardName      NVARCHAR(100) NOT NULL,
    IsActive      BIT NOT NULL CONSTRAINT DF_Ward_IsActive DEFAULT (1),
    CONSTRAINT UQ_Ward_Dept_Name UNIQUE (DepartmentId, WardName)
);

CREATE TABLE mra.Doctor (
    DoctorId      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_Doctor PRIMARY KEY,
    DoctorName    NVARCHAR(200) NOT NULL,
    LicenseNo     VARCHAR(20)   NULL,          -- เลขที่ใบประกอบวิชาชีพเวชกรรม
    DepartmentId  INT NULL CONSTRAINT FK_Doctor_Department REFERENCES mra.Department (DepartmentId),
    IsActive      BIT NOT NULL CONSTRAINT DF_Doctor_IsActive DEFAULT (1)
);

CREATE TABLE mra.AppUser (
    UserId        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AppUser PRIMARY KEY,
    Username      VARCHAR(50)   NOT NULL CONSTRAINT UQ_AppUser_Username UNIQUE,  -- ใช้บัญชี AD/ระบบกลางของ รพ.
    FullName      NVARCHAR(200) NOT NULL,
    Position      NVARCHAR(100) NULL,
    RoleCode      VARCHAR(20)   NOT NULL
        CONSTRAINT CK_AppUser_Role CHECK (RoleCode IN ('ADMIN','COORDINATOR','AUDITOR','VIEWER')),
    DepartmentId  INT NULL CONSTRAINT FK_AppUser_Department REFERENCES mra.Department (DepartmentId), -- VIEWER ระดับแผนก
    IsActive      BIT NOT NULL CONSTRAINT DF_AppUser_IsActive DEFAULT (1),
    CreatedAt     DATETIME2(0) NOT NULL CONSTRAINT DF_AppUser_CreatedAt DEFAULT (SYSDATETIME())
);
GO

/* ---------- 3. เกณฑ์การประเมิน (เก็บเป็นข้อมูล มีเวอร์ชัน) ---------- */
CREATE TABLE mra.CriteriaSet (
    CriteriaSetId  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CriteriaSet PRIMARY KEY,
    SetCode        VARCHAR(30)   NOT NULL CONSTRAINT UQ_CriteriaSet_Code UNIQUE,  -- 'MRA-IPD-2563'
    SetName        NVARCHAR(200) NOT NULL,
    EffectiveFrom  DATE NOT NULL,
    IsActive       BIT NOT NULL CONSTRAINT DF_CriteriaSet_IsActive DEFAULT (1)
);

CREATE TABLE mra.AuditContent (
    ContentId       INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AuditContent PRIMARY KEY,
    CriteriaSetId   INT NOT NULL CONSTRAINT FK_AuditContent_Set REFERENCES mra.CriteriaSet (CriteriaSetId),
    ContentNo       TINYINT NOT NULL,                    -- 1..12
    ContentCode     VARCHAR(20)   NOT NULL,
    TitleEn         NVARCHAR(100) NOT NULL,
    TitleTh         NVARCHAR(300) NOT NULL,
    AllowContentNA  BIT NOT NULL,                        -- content 7-11 = 1
    AllowDeduction  BIT NOT NULL CONSTRAINT DF_AuditContent_AllowDed DEFAULT (0),  -- content 12 = 1
    MaxDeduction    TINYINT NOT NULL CONSTRAINT DF_AuditContent_MaxDed DEFAULT (0),
    HintText        NVARCHAR(500) NULL,
    CONSTRAINT UQ_AuditContent_No   UNIQUE (CriteriaSetId, ContentNo),
    CONSTRAINT UQ_AuditContent_Code UNIQUE (CriteriaSetId, ContentCode)
);

CREATE TABLE mra.AuditCriterion (
    CriterionId    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AuditCriterion PRIMARY KEY,
    ContentId      INT NOT NULL CONSTRAINT FK_AuditCriterion_Content REFERENCES mra.AuditContent (ContentId),
    CriterionNo    TINYINT NOT NULL,                     -- 1..9
    CriterionText  NVARCHAR(1000) NOT NULL,
    AllowNA        BIT NOT NULL CONSTRAINT DF_AuditCriterion_AllowNA DEFAULT (0),
    NoteText       NVARCHAR(500) NULL,                   -- ข้อความช่วยผู้ตรวจ เช่น เงื่อนไข NA
    CONSTRAINT UQ_AuditCriterion_No UNIQUE (ContentId, CriterionNo)
);

/* gate: ถ้าเกณฑ์ SignatureCriterionNo = FAIL เกณฑ์ช่วง CoverFromNo..CoverToNo ได้ 0 */
CREATE TABLE mra.CriterionGate (
    GateId                INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CriterionGate PRIMARY KEY,
    ContentId             INT NOT NULL CONSTRAINT FK_CriterionGate_Content REFERENCES mra.AuditContent (ContentId),
    SignatureCriterionNo  TINYINT NOT NULL,
    CoverFromNo           TINYINT NOT NULL,
    CoverToNo             TINYINT NOT NULL,
    Description           NVARCHAR(300) NOT NULL,
    CONSTRAINT CK_CriterionGate_Range CHECK (CoverFromNo <= CoverToNo
        AND SignatureCriterionNo BETWEEN CoverFromNo AND CoverToNo)
);
GO

/* ---------- 4. รายชื่อผู้ป่วยที่ต้องตรวจ ---------- */
CREATE TABLE mra.ImportBatch (
    ImportBatchId   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ImportBatch PRIMARY KEY,
    SourceFileName  NVARCHAR(260) NOT NULL,
    ImportedBy      INT NOT NULL CONSTRAINT FK_ImportBatch_User REFERENCES mra.AppUser (UserId),
    ImportedAt      DATETIME2(0) NOT NULL CONSTRAINT DF_ImportBatch_At DEFAULT (SYSDATETIME()),
    TotalRows       INT NOT NULL,
    InsertedRows    INT NOT NULL,
    SkippedRows     INT NOT NULL
);

CREATE TABLE mra.AuditWorklist (
    WorklistId         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AuditWorklist PRIMARY KEY,
    SeqNo              INT NULL,                          -- ลำดับที่ ตามไฟล์ต้นทาง
    AN                 VARCHAR(20)   NOT NULL,
    HN                 VARCHAR(20)   NOT NULL,
    PatientName        NVARCHAR(200) NULL,                -- ใช้ค้นหาเท่านั้น ไม่พิมพ์บนใบสรุป
    DepartmentId       INT NOT NULL CONSTRAINT FK_Worklist_Department REFERENCES mra.Department (DepartmentId),
    WardId             INT NULL     CONSTRAINT FK_Worklist_Ward REFERENCES mra.Ward (WardId),
    DoctorId           INT NULL     CONSTRAINT FK_Worklist_Doctor REFERENCES mra.Doctor (DoctorId),
    AdmitDate          DATE NOT NULL,
    DischargeDate      DATE NOT NULL,
    PlannedAuditDate   DATE NULL,                         -- วันที่กำหนดตรวจ
    AssignedAuditorId  INT NULL     CONSTRAINT FK_Worklist_Auditor REFERENCES mra.AppUser (UserId),
    WorklistStatus     VARCHAR(15)  NOT NULL CONSTRAINT DF_Worklist_Status DEFAULT ('PENDING')
        CONSTRAINT CK_Worklist_Status CHECK (WorklistStatus IN ('PENDING','IN_PROGRESS','COMPLETED','CANCELLED')),
    ImportBatchId      INT NULL     CONSTRAINT FK_Worklist_Batch REFERENCES mra.ImportBatch (ImportBatchId),
    CreatedAt          DATETIME2(0) NOT NULL CONSTRAINT DF_Worklist_CreatedAt DEFAULT (SYSDATETIME()),
    CreatedBy          INT NOT NULL CONSTRAINT FK_Worklist_CreatedBy REFERENCES mra.AppUser (UserId),
    CONSTRAINT CK_Worklist_Dates CHECK (DischargeDate >= AdmitDate)
);
-- AN ซ้ำไม่ได้ ยกเว้นรายการที่ยกเลิกแล้ว
CREATE UNIQUE INDEX UX_Worklist_AN_Active ON mra.AuditWorklist (AN) WHERE WorklistStatus <> 'CANCELLED';
CREATE INDEX IX_Worklist_Filter ON mra.AuditWorklist (PlannedAuditDate, DepartmentId, WardId, WorklistStatus);
GO

/* ---------- 5. ผลการตรวจ ---------- */
CREATE TABLE mra.AuditRecord (
    AuditId              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AuditRecord PRIMARY KEY,
    WorklistId           INT NOT NULL CONSTRAINT FK_AuditRecord_Worklist REFERENCES mra.AuditWorklist (WorklistId),
    CriteriaSetId        INT NOT NULL CONSTRAINT FK_AuditRecord_Set REFERENCES mra.CriteriaSet (CriteriaSetId),
    -- ส่วนหัว (คัดลอกจาก worklist ตอนเริ่มตรวจ แก้ไขได้)
    Hcode                VARCHAR(10)   NOT NULL,
    HospitalName         NVARCHAR(200) NOT NULL,
    AN                   VARCHAR(20)   NOT NULL,
    HN                   VARCHAR(20)   NOT NULL,
    DepartmentId         INT NOT NULL CONSTRAINT FK_AuditRecord_Department REFERENCES mra.Department (DepartmentId),
    WardId               INT NULL     CONSTRAINT FK_AuditRecord_Ward REFERENCES mra.Ward (WardId),
    DoctorId             INT NULL     CONSTRAINT FK_AuditRecord_Doctor REFERENCES mra.Doctor (DoctorId),
    AdmitDate            DATE NOT NULL,
    DischargeDate        DATE NOT NULL,
    LOS AS (CASE WHEN DATEDIFF(DAY, AdmitDate, DischargeDate) = 0 THEN 1
                 ELSE DATEDIFF(DAY, AdmitDate, DischargeDate) END) PERSISTED,
    AuditorId            INT NOT NULL CONSTRAINT FK_AuditRecord_Auditor REFERENCES mra.AppUser (UserId),
    AuditDate            DATE NOT NULL,
    -- ส่วนท้าย
    OverallFinding       TINYINT NULL CONSTRAINT CK_AuditRecord_Overall CHECK (OverallFinding IN (1,2,3)),
                         -- 1 = Documentation inadequate for meaningful review
                         -- 2 = No significant medical record issue identified
                         -- 3 = Certain issues in question specify
    OverallSpecify       NVARCHAR(1000) NULL,
    -- คะแนน (ฝั่งเซิร์ฟเวอร์คำนวณ ห้ามรับจาก client)
    FullScore            SMALLINT NOT NULL CONSTRAINT DF_AuditRecord_Full DEFAULT (0),
    SumScore             SMALLINT NOT NULL CONSTRAINT DF_AuditRecord_Sum DEFAULT (0),
    ScorePct             DECIMAL(5,2) NULL,
    PendingCount         SMALLINT NOT NULL CONSTRAINT DF_AuditRecord_Pending DEFAULT (0),
    IsFullScoreAdequate  BIT NOT NULL CONSTRAINT DF_AuditRecord_Adequate DEFAULT (0),  -- FullScore >= 56
    -- สถานะ
    RecordStatus         VARCHAR(10) NOT NULL CONSTRAINT DF_AuditRecord_Status DEFAULT ('DRAFT')
        CONSTRAINT CK_AuditRecord_Status CHECK (RecordStatus IN ('DRAFT','COMPLETED')),
    CompletedAt          DATETIME2(0) NULL,
    CreatedAt            DATETIME2(0) NOT NULL CONSTRAINT DF_AuditRecord_CreatedAt DEFAULT (SYSDATETIME()),
    CreatedBy            INT NOT NULL CONSTRAINT FK_AuditRecord_CreatedBy REFERENCES mra.AppUser (UserId),
    UpdatedAt            DATETIME2(0) NOT NULL CONSTRAINT DF_AuditRecord_UpdatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy            INT NOT NULL CONSTRAINT FK_AuditRecord_UpdatedBy REFERENCES mra.AppUser (UserId),
    RowVer               ROWVERSION NOT NULL,             -- กันบันทึกทับกัน (optimistic concurrency)
    CONSTRAINT UQ_AuditRecord_Worklist UNIQUE (WorklistId),   -- 1 รายชื่อ = 1 ผลการตรวจ
    CONSTRAINT CK_AuditRecord_Dates CHECK (DischargeDate >= AdmitDate AND AuditDate >= DischargeDate),
    CONSTRAINT CK_AuditRecord_Completed CHECK (RecordStatus = 'DRAFT'
        OR (OverallFinding IS NOT NULL AND PendingCount = 0 AND CompletedAt IS NOT NULL)),
    CONSTRAINT CK_AuditRecord_Specify CHECK (OverallFinding IS NULL OR OverallFinding <> 3
        OR RecordStatus = 'DRAFT' OR ISNULL(LEN(OverallSpecify), 0) > 0)
);
CREATE INDEX IX_AuditRecord_Report ON mra.AuditRecord (AuditDate, DepartmentId, WardId, DoctorId, AuditorId)
    INCLUDE (FullScore, SumScore, ScorePct, RecordStatus);
CREATE INDEX IX_AuditRecord_AN ON mra.AuditRecord (AN);

CREATE TABLE mra.AuditContentResult (
    AuditId        INT NOT NULL CONSTRAINT FK_ContentResult_Audit REFERENCES mra.AuditRecord (AuditId) ON DELETE CASCADE,
    ContentId      INT NOT NULL CONSTRAINT FK_ContentResult_Content REFERENCES mra.AuditContent (ContentId),
    ContentStatus  VARCHAR(10) NOT NULL CONSTRAINT DF_ContentResult_Status DEFAULT ('ASSESS')
        CONSTRAINT CK_ContentResult_Status CHECK (ContentStatus IN ('ASSESS','NA','MISSING','NO')),
    DeductionFlag  BIT NOT NULL CONSTRAINT DF_ContentResult_Ded DEFAULT (0),
    Remark         NVARCHAR(500) NULL,
    FullScore      TINYINT NOT NULL CONSTRAINT DF_ContentResult_Full DEFAULT (0),   -- สำเนาผลคำนวณ
    SumScore       TINYINT NOT NULL CONSTRAINT DF_ContentResult_Sum DEFAULT (0),
    PendingCount   TINYINT NOT NULL CONSTRAINT DF_ContentResult_Pending DEFAULT (0),
    CONSTRAINT PK_AuditContentResult PRIMARY KEY (AuditId, ContentId)
);

/* ไม่มีแถว = ยังไม่ประเมิน; content ที่สถานะไม่ใช่ ASSESS ต้องไม่มีแถวในตารางนี้ */
CREATE TABLE mra.AuditCriterionResult (
    AuditId      INT NOT NULL CONSTRAINT FK_CriterionResult_Audit REFERENCES mra.AuditRecord (AuditId) ON DELETE CASCADE,
    CriterionId  INT NOT NULL CONSTRAINT FK_CriterionResult_Criterion REFERENCES mra.AuditCriterion (CriterionId),
    Result       VARCHAR(4) NOT NULL CONSTRAINT CK_CriterionResult_Result CHECK (Result IN ('PASS','FAIL','NA')),
    CONSTRAINT PK_AuditCriterionResult PRIMARY KEY (AuditId, CriterionId)
);
GO

/* ---------- 6. ประวัติและบันทึกการเข้าถึง ---------- */
CREATE TABLE mra.AuditHistory (
    HistoryId     BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AuditHistory PRIMARY KEY,
    AuditId       INT NOT NULL CONSTRAINT FK_AuditHistory_Audit REFERENCES mra.AuditRecord (AuditId),
    ActionCode    VARCHAR(15) NOT NULL
        CONSTRAINT CK_AuditHistory_Action CHECK (ActionCode IN ('CREATE','SAVE_DRAFT','COMPLETE','EDIT','REOPEN')),
    ChangedBy     INT NOT NULL CONSTRAINT FK_AuditHistory_User REFERENCES mra.AppUser (UserId),
    ChangedAt     DATETIME2(0) NOT NULL CONSTRAINT DF_AuditHistory_At DEFAULT (SYSDATETIME()),
    FullScore     SMALLINT NOT NULL,
    SumScore      SMALLINT NOT NULL,
    SnapshotJson  NVARCHAR(MAX) NOT NULL CONSTRAINT CK_AuditHistory_Json CHECK (ISJSON(SnapshotJson) = 1),
    Reason        NVARCHAR(300) NULL                    -- บังคับเมื่อแก้ไขเคสที่ COMPLETED แล้ว
);
CREATE INDEX IX_AuditHistory_Audit ON mra.AuditHistory (AuditId, ChangedAt);

CREATE TABLE mra.AccessLog (
    AccessLogId  BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AccessLog PRIMARY KEY,
    UserId       INT NOT NULL CONSTRAINT FK_AccessLog_User REFERENCES mra.AppUser (UserId),
    ActionCode   VARCHAR(20) NOT NULL,                  -- VIEW, PRINT, EXPORT, IMPORT, LOGIN
    AN           VARCHAR(20) NULL,
    Detail       NVARCHAR(300) NULL,
    IpAddress    VARCHAR(45) NULL,
    AccessedAt   DATETIME2(0) NOT NULL CONSTRAINT DF_AccessLog_At DEFAULT (SYSDATETIME())
);
GO

/* ---------- 7. View คำนวณคะแนน (อ้างอิง / ตรวจทาน / รายงาน) ---------- */
CREATE OR ALTER VIEW mra.vw_AuditContentScore
AS
WITH crit AS (
    SELECT
        acr.AuditId,
        acr.ContentId,
        acr.ContentStatus,
        acr.DeductionFlag,
        c.CriterionNo,
        r.Result,
        IsGated = CASE WHEN EXISTS (
            SELECT 1
            FROM mra.CriterionGate g
            JOIN mra.AuditCriterion sc
                 ON sc.ContentId = g.ContentId AND sc.CriterionNo = g.SignatureCriterionNo
            JOIN mra.AuditCriterionResult sr
                 ON sr.AuditId = acr.AuditId AND sr.CriterionId = sc.CriterionId AND sr.Result = 'FAIL'
            WHERE g.ContentId = acr.ContentId
              AND c.CriterionNo BETWEEN g.CoverFromNo AND g.CoverToNo) THEN 1 ELSE 0 END
    FROM mra.AuditContentResult acr
    JOIN mra.AuditCriterion c ON c.ContentId = acr.ContentId
    LEFT JOIN mra.AuditCriterionResult r ON r.AuditId = acr.AuditId AND r.CriterionId = c.CriterionId
),
agg AS (
    SELECT
        AuditId, ContentId, ContentStatus, DeductionFlag,
        CriteriaCount = COUNT(*),
        NotNaCount    = SUM(CASE WHEN Result = 'NA' THEN 0 ELSE 1 END),
        PassCount     = SUM(CASE WHEN Result = 'PASS' AND IsGated = 0 THEN 1 ELSE 0 END),
        BlankCount    = SUM(CASE WHEN Result IS NULL THEN 1 ELSE 0 END)
    FROM crit
    GROUP BY AuditId, ContentId, ContentStatus, DeductionFlag
)
SELECT
    a.AuditId,
    a.ContentId,
    ac.ContentNo,
    a.ContentStatus,
    FullScore = CASE a.ContentStatus
                    WHEN 'NA'     THEN 0
                    WHEN 'ASSESS' THEN a.NotNaCount
                    ELSE a.CriteriaCount              -- MISSING, NO
                END,
    Deduction = CASE WHEN a.ContentStatus = 'ASSESS' AND ac.AllowDeduction = 1 AND a.DeductionFlag = 1
                     THEN ac.MaxDeduction ELSE 0 END,
    SumScore  = CASE WHEN a.ContentStatus <> 'ASSESS' THEN 0
                     WHEN a.PassCount - CASE WHEN ac.AllowDeduction = 1 AND a.DeductionFlag = 1
                                             THEN ac.MaxDeduction ELSE 0 END < 0 THEN 0
                     ELSE a.PassCount - CASE WHEN ac.AllowDeduction = 1 AND a.DeductionFlag = 1
                                             THEN ac.MaxDeduction ELSE 0 END
                END,
    PendingCount = CASE WHEN a.ContentStatus = 'ASSESS' THEN a.BlankCount ELSE 0 END
FROM agg a
JOIN mra.AuditContent ac ON ac.ContentId = a.ContentId;
GO

CREATE OR ALTER VIEW mra.vw_AuditScore
AS
SELECT
    s.AuditId,
    FullScore    = SUM(s.FullScore),
    SumScore     = SUM(s.SumScore),
    PendingCount = SUM(s.PendingCount),
    ScorePct     = CAST(CASE WHEN SUM(s.FullScore) = 0 THEN NULL
                             ELSE 100.0 * SUM(s.SumScore) / SUM(s.FullScore) END AS DECIMAL(5,2))
FROM mra.vw_AuditContentScore s
GROUP BY s.AuditId;
GO

/* ---------- 8. คำนวณและบันทึกคะแนน (เรียกทุกครั้งหลังบันทึก ใน transaction เดียวกัน) ---------- */
CREATE OR ALTER PROCEDURE mra.usp_RecalculateAuditScore
    @AuditId INT
AS
BEGIN
    SET NOCOUNT ON;

    -- content ที่ไม่ใช่ ASSESS ต้องไม่มีผลรายเกณฑ์ค้าง
    DELETE r
    FROM mra.AuditCriterionResult r
    JOIN mra.AuditCriterion c ON c.CriterionId = r.CriterionId
    JOIN mra.AuditContentResult acr ON acr.AuditId = r.AuditId AND acr.ContentId = c.ContentId
    WHERE r.AuditId = @AuditId AND acr.ContentStatus <> 'ASSESS';

    UPDATE acr
    SET FullScore = s.FullScore, SumScore = s.SumScore, PendingCount = s.PendingCount
    FROM mra.AuditContentResult acr
    JOIN mra.vw_AuditContentScore s ON s.AuditId = acr.AuditId AND s.ContentId = acr.ContentId
    WHERE acr.AuditId = @AuditId;

    DECLARE @MinFull INT = TRY_CAST((SELECT SettingValue FROM mra.SystemSetting
                                     WHERE SettingKey = 'MIN_FULL_SCORE') AS INT);

    UPDATE ar
    SET FullScore           = t.FullScore,
        SumScore            = t.SumScore,
        PendingCount        = t.PendingCount,
        ScorePct            = t.ScorePct,
        IsFullScoreAdequate = CASE WHEN t.FullScore >= ISNULL(@MinFull, 56) THEN 1 ELSE 0 END
    FROM mra.AuditRecord ar
    JOIN mra.vw_AuditScore t ON t.AuditId = ar.AuditId
    WHERE ar.AuditId = @AuditId;
END;
GO

/* ---------- 9. View รายงานหลัก ---------- */
CREATE OR ALTER VIEW mra.vw_AuditReport
AS
SELECT
    ar.AuditId, ar.AN, ar.HN, ar.AuditDate, ar.AdmitDate, ar.DischargeDate, ar.LOS,
    d.DepartmentName, w.WardName, doc.DoctorName, u.FullName AS AuditorName,
    ar.FullScore, ar.SumScore, ar.ScorePct, ar.IsFullScoreAdequate,
    ar.OverallFinding, ar.OverallSpecify, ar.RecordStatus
FROM mra.AuditRecord ar
JOIN mra.Department d   ON d.DepartmentId = ar.DepartmentId
LEFT JOIN mra.Ward w    ON w.WardId = ar.WardId
LEFT JOIN mra.Doctor doc ON doc.DoctorId = ar.DoctorId
JOIN mra.AppUser u      ON u.UserId = ar.AuditorId;
GO
