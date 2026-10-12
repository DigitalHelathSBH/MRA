// โหลด .env สำหรับสคริปต์ที่รันนอก Next.js
import { readFileSync } from "node:fs";

export function loadEnv(path = ".env") {
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export function dbConfig(database = process.env.DB_NAME) {
  return {
    server: process.env.DB_SERVER,
    port: Number(process.env.DB_PORT || 1433),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database,
    options: { encrypt: false, trustServerCertificate: true },
    requestTimeout: 300000,
  };
}
