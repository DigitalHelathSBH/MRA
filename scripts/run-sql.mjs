// รันไฟล์ .sql ที่แบ่งด้วย GO (แทน sqlcmd)
// ใช้: node scripts/run-sql.mjs db/01_mra_ipd_schema.sql [ชื่อ DB]
import { readFileSync } from "node:fs";
import sql from "mssql";
import { loadEnv, dbConfig } from "./env.mjs";

loadEnv();
const [file, database] = process.argv.slice(2);
if (!file) {
  console.error("ใช้: node scripts/run-sql.mjs <file.sql> [database]");
  process.exit(1);
}

const batches = readFileSync(file, "utf8")
  .replace(/^\s+/, "") // ตัด BOM และช่องว่างต้นไฟล์ (\s ใน JS รวม U+FEFF)
  .split(/^\s*GO\s*$/gim)
  .map((b) => b.trim())
  .filter(Boolean);

// ใช้ connection เดียว เพื่อให้คำสั่ง USE มีผลกับ batch ถัดไป
const pool = await new sql.ConnectionPool({ ...dbConfig(database), pool: { max: 1, min: 1 } }).connect();
try {
  for (const [i, batch] of batches.entries()) {
    try {
      await pool.request().batch(batch);
    } catch (err) {
      console.error(`batch ${i + 1}/${batches.length} ล้มเหลว: ${err.message}`);
      process.exitCode = 1;
      break;
    }
  }
  if (!process.exitCode) console.log(`${file}: รันครบ ${batches.length} batch`);
} finally {
  await pool.close();
}
