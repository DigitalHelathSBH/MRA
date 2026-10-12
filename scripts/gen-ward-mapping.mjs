// สร้างรายการ ward จาก SSBDatabase.dbo.WardCode สำหรับ db/04_mapping.sql (ข้อมูลอ้างอิง ไม่มีข้อมูลผู้ป่วย)
// ใช้: node scripts/gen-ward-mapping.mjs > tmp.sql
import sql from "mssql";
import { loadEnv, dbConfig } from "./env.mjs";

loadEnv();
const SPEC_DEPT = { "01": "อายุรกรรม", "02": "ศัลยกรรม", "03": "สูติกรรม", "04": "ฉุกเฉิน", "05": "กุมารเวชกรรม",
  "06": "โสต ศอ นาสิก", "07": "จักษุ", "08": "ศัลยกรรมกระดูก", "09": "จิตเวช", "10": "เวชกรรมฟื้นฟู" };
const WARD_DEPT_OVERRIDE = { "07": "นรีเวชกรรม" }; // นรีเวช+สูติแทรกซ้อน
const INACTIVE = /ยกเลิก|^HI_|^CCC|Home Isolation|^Test/i;

const pool = await sql.connect(dbConfig(process.env.DB_HIS));
const r = await pool.request().query(`
  WITH x AS (SELECT ADMWARD, SPECIALTY, COUNT(*) n FROM ADMMASTER
             WHERE DISCHARGEDATETIME >= DATEADD(MONTH, -6, GETDATE()) GROUP BY ADMWARD, SPECIALTY),
  r AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY ADMWARD ORDER BY n DESC) rn, SUM(n) OVER (PARTITION BY ADMWARD) total FROM x)
  SELECT w.CODE, RTRIM(w.WardName) AS WardName, r.SPECIALTY, r.total
  FROM WardCode w JOIN r ON r.ADMWARD = w.CODE AND r.rn = 1 ORDER BY w.CODE`);
await pool.close();

const q = (s) => `N'${String(s).replace(/'/g, "''")}'`;
const lines = r.recordset.map((w) => {
  const name = w.WardName.replace(/\.+$/, "").trim();
  const dept = WARD_DEPT_OVERRIDE[w.CODE] ?? SPEC_DEPT[w.SPECIALTY] ?? "อายุรกรรม";
  const active = INACTIVE.test(name) || w.total < 5 ? 0 : 1;
  return ` ('${w.CODE}', ${q(name)}, ${q(dept)}, ${active})`;
});
console.log(lines.join(",\n"));
