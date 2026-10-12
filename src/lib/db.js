import "server-only";
import sql from "mssql";

// ชื่อ DB ข้ามฐาน (HIS / intranet) ใช้เป็น identifier ใน query จึงต้องตรวจรูปแบบก่อน
function dbName(value, fallback) {
  const name = value || fallback;
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`ชื่อ DB ไม่ถูกต้อง: ${name}`);
  return `[${name}]`;
}
export const HIS = dbName(process.env.DB_HIS, "SSBDatabase");
export const INTRANET = dbName(process.env.DB_INTRANET, "saraburi");

const config = {
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT || 1433),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  options: { encrypt: false, trustServerCertificate: true, appName: "MRA-IPD-Web" },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  requestTimeout: 120000, // สุ่มรายชื่อ/บันทึกรอบสุ่ม query ข้าม SSBDatabase อาจเกินค่าเริ่มต้น 15 วินาที
};

// เก็บ pool ไว้ที่ globalThis เพื่อไม่ให้ dev hot-reload เปิด connection ซ้ำ
export function getPool() {
  globalThis.__mraPool ??= new sql.ConnectionPool(config).connect().catch((err) => {
    globalThis.__mraPool = undefined;
    throw err;
  });
  return globalThis.__mraPool;
}

// query แบบ parameterized: query("SELECT ... WHERE AN=@an", { an: [sql.VarChar(20), "6900..."] })
// ค่าที่ไม่ได้ระบุชนิดจะให้ mssql เดาเอง
export async function query(text, params = {}) {
  const req = (await getPool()).request();
  bind(req, params);
  return req.query(text);
}

export async function transaction(fn) {
  const tx = new sql.Transaction(await getPool());
  await tx.begin();
  try {
    const result = await fn((text, params = {}) => {
      const req = new sql.Request(tx);
      bind(req, params);
      return req.query(text);
    });
    await tx.commit();
    return result;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

function bind(req, params) {
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) req.input(k, v[0], v[1]);
    else req.input(k, v);
  }
}

// รายการค่าเป็น VALUES แบบ parameterized แทน OPENJSON (DB MRA ใช้ compatibility level 120 ไม่มี OPENJSON)
// valuesList("r", [[1, "PASS"], [2, "FAIL"]], [sql.Int, sql.VarChar(4)])
//   → { text: "(@r0_0, @r0_1), (@r1_0, @r1_1)", params: { r0_0: [sql.Int, 1], ... } }
// SQL Server รับ parameter ได้ไม่เกิน 2100 ต่อคำสั่ง
export function valuesList(prefix, rows, types) {
  if (!rows.length) throw new Error("valuesList: ไม่มีข้อมูล");
  if (rows.length * types.length > 2000) throw new Error("valuesList: ข้อมูลมากเกินไป");
  const params = {};
  const text = rows
    .map((row, i) => `(${types.map((t, j) => {
      const name = `${prefix}${i}_${j}`;
      params[name] = [t, row[j]];
      return `@${name}`;
    }).join(", ")})`)
    .join(", ");
  return { text, params };
}

export { sql };
