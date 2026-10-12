/* =====================================================================
   MRA IPD — ข้อมูลจับคู่กับ HIS และระบบเดิม (รันหลัง 03) รันซ้ำได้
   - แผนก: ADMMASTER.SPECIALTY (+ อักษรนำหน้า Dx หลัก) → mra.Department → dbo.departments เดิม
   - ward: WardCode.CODE → mra.Ward (DepartmentId ของ ward = แผนกหลักของ ward ใช้แสดงผลเท่านั้น
           แผนกของแต่ละเคสคิดจาก SPECIALTY ของ AN)
   - หัวข้อ: mra.AuditContent.ContentNo 1..12 = dbo.ipd_items.ipd_items_id 1..12
   รายการ ward สร้างจาก node scripts/gen-ward-mapping.mjs
   ===================================================================== */
SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

/* ---- แผนก ---- */
MERGE mra.Department AS t
USING (VALUES
    (N'อายุรกรรม',      1,  '01', NULL),
    (N'ศัลยกรรม',       2,  '02', NULL),
    (N'สูติกรรม',        3,  '03', 'O'),    -- Specialty 03 และ Dx หลักขึ้นต้น O (เหมือนเงื่อนไขในคิวรี่สุ่ม)
    (N'นรีเวชกรรม',     4,  '03', NULL),   -- Specialty 03 อื่นๆ
    (N'โสต ศอ นาสิก',   5,  '06', NULL),
    (N'จักษุ',          6,  '07', NULL),
    (N'ศัลยกรรมกระดูก', 7,  '08', NULL),
    (N'จิตเวช',         8,  '09', NULL),
    (N'เวชกรรมฟื้นฟู',   9,  '10', NULL),
    (N'กุมารเวชกรรม',   10, '05', NULL),
    (N'ฉุกเฉิน',         11, '04', NULL)
) AS s (DepartmentName, LegacyDepartmentId, HisSpecialtyCode, HisDxPrefix)
ON t.DepartmentName = s.DepartmentName
WHEN MATCHED THEN UPDATE SET LegacyDepartmentId = s.LegacyDepartmentId, HisSpecialtyCode = s.HisSpecialtyCode,
                             HisDxPrefix = s.HisDxPrefix, IsActive = 1
WHEN NOT MATCHED THEN INSERT (DepartmentName, LegacyDepartmentId, HisSpecialtyCode, HisDxPrefix)
                      VALUES (s.DepartmentName, s.LegacyDepartmentId, s.HisSpecialtyCode, s.HisDxPrefix);

/* ---- ward ---- */
DECLARE @w TABLE (Code VARCHAR(10), WardName NVARCHAR(100), DeptName NVARCHAR(100), IsActive BIT);
INSERT INTO @w VALUES
 ('01', N'หอผู้ป่วย 210เตียง ชั้น1(อช.1)', N'อายุรกรรม', 1),
 ('02', N'หอผู้ป่วย 210 เตียงชั้น2(อช.2)', N'อายุรกรรม', 1),
 ('03', N'ตึกอายุรกรรมหญิงบน', N'อายุรกรรม', 1),
 ('04', N'ตึกอายุรกรรมหญิงล่าง', N'อายุรกรรม', 1),
 ('06', N'เฉลิมพระเกียรติ ชั้น4(สูติหลังคลอด)', N'สูติกรรม', 1),
 ('07', N'นรีเวช+สูติแทรกซ้อน(สูติแทรกซ้อน)', N'นรีเวชกรรม', 1),
 ('12', N'หอผู้ป่วยหนักICUศัลย์1', N'ศัลยกรรม', 1),
 ('13', N'ตึกอุบัติเหตุชั้น2 (อ.2)', N'ศัลยกรรม', 1),
 ('14', N'ตึกอุบัติเหตุชั้น3 (อ.3)', N'ศัลยกรรม', 1),
 ('15', N'ตึกอุบัติเหตุชั้น4 (อ.4)', N'ศัลยกรรม', 1),
 ('16', N'เด็ก 3', N'กุมารเวชกรรม', 1),
 ('17', N'NICU (อาคาร 100 ปี ชั้น 7)', N'กุมารเวชกรรม', 1),
 ('18', N'ศัลยกรรม (สม2)', N'ศัลยกรรม', 1),
 ('19', N'พิเศษ 210 เตียง ชั้น 2', N'จักษุ', 1),
 ('20', N'ตึก210ชั้น5(เด็ก 2)', N'กุมารเวชกรรม', 1),
 ('21', N'PICUเด็กป่วย', N'กุมารเวชกรรม', 1),
 ('22', N'เด็ก1 (ศัลย์เด็ก)', N'กุมารเวชกรรม', 1),
 ('23', N'จักษุ', N'จักษุ', 1),
 ('24', N'ผู้ป่วยหนักอายุรกรรม', N'อายุรกรรม', 1),
 ('25', N'หอบำบัดผู้ป่วยวิกฤตโรคหัวใจ', N'อายุรกรรม', 1),
 ('26', N'ห้องปฏิบัติการสวนหัวใจ', N'อายุรกรรม', 1),
 ('27', N'ผู้ป่วยหนักศัลยกรรม 2', N'ศัลยกรรม', 1),
 ('28', N'ห้องคลอด', N'สูติกรรม', 1),
 ('29', N'ศัลยกรรมกระดูกชาย', N'ศัลยกรรมกระดูก', 1),
 ('30', N'ศัลยกรรมกระดูกหญิง', N'ศัลยกรรมกระดูก', 1),
 ('31', N'พิเศษ 210 เตียง ชั้น4', N'ศัลยกรรม', 1),
 ('33', N'ตึกสงฆ์อาพาธชั้น 4', N'อายุรกรรม', 1),
 ('34', N'พิเศษ 210 เตียง ชั้น1', N'ศัลยกรรม', 1),
 ('35', N'หอผู้ป่วยวิกฤตประคับประคอง', N'อายุรกรรม', 1),
 ('38', N'(ยกเลิก)พิเศษ 210 เตียง ชั้น 5', N'อายุรกรรม', 0),
 ('39', N'ผู้ป่วยประกันสังคม', N'ศัลยกรรม', 1),
 ('40', N'พิเศษ สม.3', N'กุมารเวชกรรม', 1),
 ('41', N'เคมีบำบัด', N'อายุรกรรม', 1),
 ('42', N'พิเศษ 60 เตียง ชั้น 2', N'สูติกรรม', 1),
 ('44', N'หอผู้ป่วยแยกโรคติดเชื้อ(60/4)', N'อายุรกรรม', 1),
 ('45', N'หอผู้ป่วยหนักแยกโรคติดเชื้อ(ชั้น5)', N'อายุรกรรม', 1),
 ('46', N'ศัลยกรรมหญิง(สม.4)', N'ศัลยกรรม', 1),
 ('47', N'หอผู้ป่วยส่องอวัยวะด้วยกล้อง-IPD', N'อายุรกรรม', 0),
 ('64', N'หอผู้ป่วยล้างไต-IPD', N'อายุรกรรม', 1),
 ('66', N'ผู้ป่วยหนักอายุรกรรม 2 (M2)', N'อายุรกรรม', 1),
 ('67', N'Home Ward', N'อายุรกรรม', 1),
 ('68', N'ICU CVT', N'ศัลยกรรม', 1),
 ('69', N'Stroke unit', N'อายุรกรรม', 1),
 ('70', N'หน่วยให้เลือด.(ICU ศัล2 เก่า)', N'อายุรกรรม', 1),
 ('72', N'หอผู้ป่วยพิเศษและปลูกถ่ายอวัยวะ', N'ศัลยกรรม', 1),
 ('73', N'Home Isolation-แยกตัวที่บ้าน(73)', N'อายุรกรรม', 0),
 ('992', N'EDOU/IPD', N'อายุรกรรม', 1),
 ('H5', N'HI_รพสต.ดาวเรือง', N'อายุรกรรม', 0),
 ('J1', N'HI_รพสต.หนองปลาไหล', N'อายุรกรรม', 0),
 ('L8', N'CCC_ อำเภอเฉลิมพระเกียรติ', N'อายุรกรรม', 0),
 ('M9', N'(ยกเลิก) Home Isolation-แยกตัวที่บ้าน(M9)', N'อายุรกรรม', 0),
 ('TEST', N'Test By Computer', N'อายุรกรรม', 0)
;

MERGE mra.Ward AS t
USING (SELECT w.Code, w.WardName, d.DepartmentId, w.IsActive FROM @w w JOIN mra.Department d ON d.DepartmentName = w.DeptName) AS s
ON t.HisWardCode = s.Code
WHEN MATCHED THEN UPDATE SET WardName = s.WardName, DepartmentId = s.DepartmentId, IsActive = s.IsActive
WHEN NOT MATCHED THEN INSERT (DepartmentId, WardName, IsActive, HisWardCode) VALUES (s.DepartmentId, s.WardName, s.IsActive, s.Code);

/* ---- หัวข้อ → ipd_items เดิม ---- */
UPDATE ac SET LegacyItemId = ac.ContentNo
FROM mra.AuditContent ac JOIN mra.CriteriaSet cs ON cs.CriteriaSetId = ac.CriteriaSetId
WHERE cs.SetCode = 'MRA-IPD-2563';

COMMIT TRANSACTION;
