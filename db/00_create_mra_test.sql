/* =====================================================================
   สร้าง DB ทดสอบ MRA_TEST (รันกับ master): node scripts/run-sql.mjs db/00_create_mra_test.sql master
   - ตารางผลตรวจเดิม (mra_ipd_main, mra_ipd) คัดลอกเฉพาะโครงสร้าง ไม่คัดลอกข้อมูลผู้ป่วย
   - ตารางอ้างอิงเดิมคัดลอกทั้งข้อมูล (ไม่มีข้อมูลผู้ป่วย)
   ห้ามรันกับ DB จริง: บน MRA จริงตารางเหล่านี้มีอยู่แล้ว
   ===================================================================== */
IF DB_ID('MRA_TEST') IS NULL CREATE DATABASE MRA_TEST;
GO
USE MRA_TEST;
GO
IF OBJECT_ID('dbo.mra_ipd_main') IS NULL SELECT TOP 0 * INTO dbo.mra_ipd_main FROM MRA.dbo.mra_ipd_main;
IF OBJECT_ID('dbo.mra_ipd')      IS NULL SELECT TOP 0 * INTO dbo.mra_ipd      FROM MRA.dbo.mra_ipd;
IF OBJECT_ID('dbo.ipd_items')    IS NULL SELECT * INTO dbo.ipd_items    FROM MRA.dbo.ipd_items;
IF OBJECT_ID('dbo.departments')  IS NULL SELECT * INTO dbo.departments  FROM MRA.dbo.departments;
IF OBJECT_ID('dbo.overall')      IS NULL SELECT * INTO dbo.overall      FROM MRA.dbo.overall;
IF OBJECT_ID('dbo.overall_ipd')  IS NULL SELECT * INTO dbo.overall_ipd  FROM MRA.dbo.overall_ipd;
IF OBJECT_ID('dbo.audit_time')   IS NULL SELECT * INTO dbo.audit_time   FROM MRA.dbo.audit_time;
GO
