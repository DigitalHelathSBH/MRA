// รันคำสั่ง SELECT แล้วแสดงผลเป็นตาราง (ใช้ดูตารางอ้างอิง ห้ามใช้ดูข้อมูลผู้ป่วย)
// ใช้: node scripts/query.mjs "SELECT ..." [ชื่อ DB]
import sql from "mssql";
import { loadEnv, dbConfig } from "./env.mjs";

loadEnv();
const [text, database] = process.argv.slice(2);
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
