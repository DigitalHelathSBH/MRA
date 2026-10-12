/* สำรองตารางเดิมของ DB MRA ไว้ใน MRA_TEST.bak ก่อนติดตั้ง schema mra.* บน MRA จริง
   รัน: node scripts/run-sql.mjs db/backup_legacy_to_mra_test.sql MRA_TEST
   ชื่อตารางมีวันที่ (YYYYMMDD) รันซ้ำวันเดียวกันจะข้ามตารางที่มีแล้ว · มี AN (ข้อมูลผู้ป่วย) อยู่ใน server เดียวกันเท่านั้น */
IF SCHEMA_ID('bak') IS NULL EXEC ('CREATE SCHEMA bak');
GO
DECLARE @d CHAR(8) = CONVERT(CHAR(8), GETDATE(), 112), @t SYSNAME, @sql NVARCHAR(MAX);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR
  SELECT name FROM (VALUES ('mra_ipd_main'), ('mra_ipd'), ('ipd_items'), ('departments'), ('overall'), ('overall_ipd'), ('audit_time')) v(name);
OPEN c; FETCH NEXT FROM c INTO @t;
WHILE @@FETCH_STATUS = 0
BEGIN
  IF OBJECT_ID(N'bak.' + @t + N'_' + @d) IS NULL
  BEGIN
    SET @sql = N'SELECT * INTO bak.' + QUOTENAME(@t + N'_' + @d) + N' FROM MRA.dbo.' + QUOTENAME(@t) + N';';
    EXEC sp_executesql @sql;
  END
  FETCH NEXT FROM c INTO @t;
END
CLOSE c; DEALLOCATE c;
GO
