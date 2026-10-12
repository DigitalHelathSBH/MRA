// รันคำสั่ง SELECT แล้วแสดงผลเป็นตาราง (ใช้ดูตารางอ้างอิง ห้ามใช้ดูข้อมูลผู้ป่วย)
// ใช้: node scripts/query.mjs "SELECT ..." [ชื่อ DB]
import sql from "mssql";
import { loadEnv, dbConfig } from "./env.mjs";

loadEnv();
const [text, database] = process.argv.slice(2);
// กันดึงข้อมูลผู้ป่วยมาแสดงบนจอ: ตารางที่มี AN/HN ให้ใช้ได้เฉพาะ COUNT/SUM (ไม่มี SELECT คอลัมน์ตรงๆ)
const PATIENT = /\b(ADMMASTER|IPDSUMMARY|IPDDOCTOR|AuditWorklist|AuditRecord|mra_ipd_main|mra_ipd|AccessLog)\b/i;
if (PATIENT.test(text) && !/^\s*(SELECT\s+(COUNT|SUM|MIN|MAX)\b|DELETE|UPDATE|INSERT|SET|DECLARE)/i.test(text)) {
  console.error("query.mjs: ตารางนี้มีข้อมูลผู้ป่วย ใช้ได้เฉพาะ SELECT COUNT/SUM/MIN/MAX หรือคำสั่งแก้ข้อมูล");
  process.exit(1);
}
const pool = await sql.connect(dbConfig(database));
try {
  const r = await pool.request().query(text);
  for (const rs of r.recordsets) console.table(rs);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.close();
}
