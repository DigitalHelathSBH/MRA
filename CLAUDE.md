@AGENTS.md

# MRA IPD — ระบบตรวจประเมินคุณภาพการบันทึกเวชระเบียนผู้ป่วยใน

## ภาพรวม
- ระบบบันทึกผลตรวจเวชระเบียนผู้ป่วยใน (Medical Record Audit Guideline 2563, 12 content / 106 เกณฑ์) ของ รพ.สระบุรี (Hcode 10661)
- แทนหน้า `Z:\NewIntranet\MRA\IPDForm.aspx` / `IPDEditForm.aspx` เดิม แต่ **ต้องเขียนผลกลับตารางเดิม** `dbo.mra_ipd_main` / `dbo.mra_ipd` ให้ `ReportIPD.aspx` เดิมยังใช้ได้
- ผู้ใช้: งานเวชระเบียน/ผู้ตรวจ ภายใน รพ. · ผู้ดูแล: กลุ่มงานสุขภาพดิจิทัล
- สถานะ: ระยะที่ 1 (login, รายการเคส, แบบตรวจ, บันทึก + เขียนกลับตารางเดิม) กำลังพัฒนา
- แบบหน้าจอที่ยืนยันแล้ว: https://claude.ai/artifact/K3d5Y6AhQyVupgmgbSQq6T · แผนสถาปัตยกรรม: https://claude.ai/artifact/VNpfYWRittEyMyawicmUrf

## UI
- ห้ามใช้ `<select>` ให้ใช้ `components/search-select.js` · radio/checkbox ใช้ `components/fancy-check.js`
- กราฟตามหลัก dataviz: แกนเดียว, มี tooltip และ "ดูเป็นตาราง" ทุกกราฟ · dashboard ใช้สีตามเกณฑ์คะแนน 4 ระดับใน `src/lib/bands.js` (ดีมาก ≥90, ดี 80–89, พอใช้ 70–79, ต้องปรับปรุง <70) พร้อมไอคอน+ป้ายเสมอ · ดูรายปีงบหรือรายเดือนได้
- ตรวจหน้าจอจริงด้วย screenshot (playwright-core + Edge ในเครื่อง) ทั้ง 1600px / 400px / dark

## Stack
- Next.js 16 (App Router, JavaScript) — **อ่าน `node_modules/next/dist/docs/` ก่อนใช้ API** (middleware = `proxy.js`, `params`/`searchParams` เป็น Promise)
- ไม่เปิด `cacheComponents`: ทุกหน้าอ่านข้อมูลผู้ป่วยตาม request ห้าม cache ฝั่งเซิร์ฟเวอร์
- Tailwind 4 + CSS ของแบบที่ยืนยัน (`src/app/globals.css`) · ฟอนต์ Anuphan / IBM Plex Sans Thai / IBM Plex Mono
- `mssql` (SQL Server), `iron-session` (cookie session เข้ารหัส)

## คำสั่ง
```
npm install
npm run dev            # http://localhost:3000
npm run build && npm start
npx eslint src
node scripts/run-sql.mjs db/<file>.sql [DB]     # รันไฟล์ SQL ที่แบ่งด้วย GO (ไม่มี sqlcmd ในเครื่อง)
node scripts/query.mjs "SELECT ..." [DB]         # ดูตารางอ้างอิงเท่านั้น ห้ามดึงข้อมูลผู้ป่วยมาแสดง
node --import tsx --conditions=react-server scripts/smoke-test.mjs   # ทดสอบ flow บันทึก+เขียนกลับบน MRA_TEST (ปิด AN, ลบข้อมูลทดสอบเอง)
node scripts/gen-ward-mapping.mjs                # สร้างรายการ ward จาก WardCode สำหรับ db/04_mapping.sql
node --import tsx --conditions=react-server scripts/demo-data.mjs seed|clear   # ผลตรวจสมมติ (ผู้ใช้ DEMO01) สำหรับดู dashboard บน MRA_TEST · ต้อง clear ก่อนใช้จริง
```

## โครงสร้าง
```
db/                 SQL ตามลำดับเลข (00 สร้าง MRA_TEST, 01 schema, 02 seed เกณฑ์, 03 ส่วนเพิ่ม + usp_SyncLegacy, 04 ข้อมูลจับคู่)
scripts/            สคริปต์ Node สำหรับรัน SQL
src/proxy.js        ไม่มี cookie session → /login (ตรวจจริงใน requireUser)
src/lib/db.js       connection pool, query/transaction แบบ parameterized
src/lib/auth.js     login จาก saraburi.dbo.emp + PYREXT, requireUser, AccessLog
src/lib/audit.js    เกณฑ์, worklist, เปิด/บันทึกแบบตรวจ
src/lib/scoring.js  คิดคะแนนฝั่งหน้าจอ (ต้องตรงกับ mra.vw_AuditContentScore)
src/lib/dashboard.js ข้อมูล dashboard (ปีงบประมาณ ต.ค.–ก.ย., จัดตามเดือนที่จำหน่าย, เฉพาะเคส COMPLETED)
src/components/     search-select (dropdown ค้นหาได้ ใช้แทน <select> ทุกที่), fancy-check (radio/checkbox), charts (SVG วัดความกว้างจริง), table-view
src/lib/reports.js  รายงาน % ผ่านรายเกณฑ์ (หัวข้อ × เกณฑ์) + รายละเอียดเกณฑ์/หัวข้อ · % ผ่าน = ผ่านจริง (ไม่โดน gate) ÷ (ผ่าน+ไม่ผ่าน+หัวข้อ Missing/No) ไม่นับ NA
src/lib/sampling.js สุ่มรายชื่อตามคิวรี่สุ่มของงานเวชระเบียน → mra.AuditWorklist (ImportBatch 'RANDOM-YYYY-MM' เดือนละครั้ง) · รอบ audit ตรวจเคสที่จำหน่ายย้อนหลัง 2 เดือน · เลือก "เดือนที่ Audit" ตอนสุ่ม เก็บเป็นวันที่ 1 ของเดือนใน PlannedAuditDate · หน้าเคสรอตรวจกรองตามเดือนที่ Audit (ไม่มีค่า = เดือนจำหน่าย + 2) · เพิ่มด้วย AN = เดือนปัจจุบัน · dashboard/รายงานเลือกได้ว่าจัดตามเดือนที่จำหน่าย (ค่าเริ่มต้น) หรือเดือนที่ Audit (`?by=audit`) นิยามอยู่ที่ `src/lib/basis.js` ใช้ร่วมกับหน้าเคสรอตรวจ
src/app/login       หน้า login
src/app/(app)       หน้าที่ต้อง login: / (เคสรอตรวจ), /audit/[an] (แบบตรวจ), /sampling (สุ่มรายชื่อ), /dashboard, /reports (+ /reports/criterion, /reports/content)
```

## ฐานข้อมูล (SQL Server 10.0.1.1 ทุก DB อยู่ server เดียวกัน)
| ตาราง | ใช้ทำอะไร | ข้อมูลผู้ป่วย | แก้ได้ไหม |
|---|---|---|---|
| `mra.*` (DB_NAME) | ระบบใหม่: worklist, ผลตรวจ, เกณฑ์, ผู้ใช้, log | มี (AN, HN) | ได้ (ผ่านไฟล์ใน db/) |
| `dbo.mra_ipd_main`, `dbo.mra_ipd` | ตารางเดิม เขียนผ่าน `mra.usp_SyncLegacy` เท่านั้น | มี (AN) | ห้ามแก้โครงสร้าง |
| `dbo.ipd_items`, `departments`, `overall`, `overall_ipd`, `audit_time` | ข้อมูลอ้างอิงของระบบเดิม | ไม่มี | ห้ามแก้ |
| `SSBDatabase.dbo.ADMMASTER`, `PYREXT`, `WardCode`, `ClinicName` | HIS | มี | **อ่านอย่างเดียว** |
| `SSBDatabase.dbo.GetUserFullName(code)` | ชื่อพนักงาน/แพทย์จากรหัส | – | อ่านอย่างเดียว |
| `saraburi.dbo.emp` | รหัสผ่าน intranet (ใช้ตรวจ login) | – | **อ่านอย่างเดียว** |

การจับคู่กับ HIS (db/04_mapping.sql):
- แผนกของเคส = `ADMMASTER.SPECIALTY` → `mra.Department.HisSpecialtyCode` (Specialty 03: Dx หลักขึ้นต้น O = สูติกรรม, อื่นๆ = นรีเวชกรรม) → `LegacyDepartmentId` = `dbo.departments` เดิม
- ward = `ADMMASTER.ADMWARD` → `mra.Ward.HisWardCode` (ward พิเศษรับหลายแผนก จึงไม่ใช้ ward หาแผนก)
- แพทย์เจ้าของไข้ = `IPDSUMMARY.DOCTOR` (SUFFIX=1) ถ้าไม่มีใช้ `IPDDOCTOR` ล่าสุด · ชื่อจาก `GetUserFullName` · เก็บใน `mra.Doctor.DoctorCode`
- content 1–12 = `ipd_items_id` 1–12 · OverallFinding 1/2/3 = `overall.overall_id` · `overall_ipd1/2` ยังใส่ 0 (แบบใหม่ไม่มีช่องนี้)

กติกาสำคัญ:
- คะแนนจริงคำนวณที่เซิร์ฟเวอร์ (`mra.usp_RecalculateAuditScore`) ห้ามรับคะแนนจาก client
- บันทึกเสร็จ = transaction เดียว: บันทึก `mra.*` → recalc → COMPLETED → `usp_SyncLegacy`
- เขียนกลับตารางเดิม: `audit_time` = 1 เสมอ, `audit_year` = ปีงบ พ.ศ., data1–9 = '1'/'0'/'NA' (ข้อที่โดน gate = '0')
- หน้าเดิมยังเปิดใช้คู่กัน: AN ที่มีในตารางเดิมแต่ `LegacySyncedAt` ว่าง = บันทึกจากระบบเดิม → ห้ามเขียนทับ (แสดงสถานะ LEGACY)
- รายชื่อเคส (AN) ในรายงานรายละเอียดเกณฑ์ (/reports/criterion) เห็นได้เฉพาะ `PYREXT.DIVISION` 802 (ฝ่ายสุขภาพดิจิทัล) และ 803 (ฝ่ายเวชระเบียน) — `CASE_LIST_DIVISIONS` ใน auth.js ตรวจทุก request และผู้ไม่มีสิทธิ์จะไม่ถูกดึงรายชื่อเลย
- ผู้ใช้ login ครั้งแรกถูกเพิ่มเป็น AUDITOR อัตโนมัติ เปลี่ยนบทบาทที่ `mra.AppUser.RoleCode`

## ตัวแปรใน .env (ดู .env.example)
`DB_SERVER`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` (MRA_TEST ตอนทดสอบ / MRA ใช้งานจริง), `DB_HIS`, `DB_INTRANET`, `SESSION_PASSWORD`

## กฎของโปรเจค
- ถามและอธิบายเป็นภาษาไทย โค้ดกระชับ คำอธิบายแยกจากโค้ด
- ยืนยันกับผู้ใช้ก่อนแก้ตาราง, stored procedure หรือ logic คิดคะแนน/เขียนกลับ
- query ต้อง parameterized ทุกครั้ง
- หลังแก้ db/ เรียก agent `sqlserver-dba` · ก่อน push เรียก `code-reviewer` + `pdpa-auditor` · ก่อน deploy เรียก `deploy-checker`

## PDPA
- ข้อมูลผู้ป่วยอยู่ใน SQL Server ของ รพ. เท่านั้น (แบบตัวอย่างเดิมใช้ Google Drive — ตัดออกแล้ว)
- ทุกหน้า/ทุก action ตรวจ session กับ `mra.AppUser` ฝั่งเซิร์ฟเวอร์
- `mra.AccessLog` บันทึก LOGIN / VIEW / AUDIT_SAVE / AUDIT_COMPLETE / WORKLIST_ADD (Detail ห้ามมีชื่อผู้ป่วย)
- log/error ฝั่งเซิร์ฟเวอร์ใช้ UserId/AuditId ห้ามมี HN หรือชื่อผู้ป่วย
- ไม่เก็บชื่อผู้ป่วยใน worklist (ค้นด้วย AN/HN)
- ตาราง `emp` เก็บรหัสผ่านแบบไม่เข้ารหัส (ความเสี่ยงเดิมของ intranet) ระบบนี้แค่ตรวจเทียบ ไม่เก็บและไม่ log
- ข้อมูลทดสอบต้องเป็นข้อมูลปลอม ห้ามส่งข้อมูลผู้ป่วยจริงให้ Claude

## Backup / Deploy / Rollback
- Server: `10.0.120.17` (ชื่อเครื่อง Receipt1, Ubuntu 22.04, Docker + Nginx 1.18, HTTP ภายใน, มีระบบอื่นอยู่ร่วม) โค้ดที่ `/opt/mra-ipd` แอปรันที่ `127.0.0.1:3310` (3000/3001 ระบบอื่นใช้) · Nginx เพิ่ม `location ^~ /mra` ใน `/etc/nginx/conf.d/sbh.conf` · ต้องใช้ sudo (มีรหัสผ่าน) เว็บ http://10.0.120.17/mra (`BASE_PATH=/mra` ตอน build, `COOKIE_SECURE=false`)
- GitHub (private): https://github.com/digitalhealthsbh-mdi/MRA
- DB จริง: ติดตั้ง `mra.*` ใน `MRA` แล้วเมื่อ 12 ต.ค. 2569 · ก่อนติดตั้งสำรองตารางเดิมไว้ที่ `MRA_TEST.bak.<ตาราง>_20261012` (db/backup_legacy_to_mra_test.sql) · ยังไม่มี job backup DB ประจำ (ควรให้ DBA กำหนด)
- **โหมดฝึกใช้งาน (ตั้งแต่ 12 ต.ค. 2569):** เว็บจริงบน server ตั้ง `DB_NAME=MRA_TEST` ชั่วคราวเพื่อสอนผู้ใช้ มีแถบเตือนทุกหน้า (components/training-banner.js แสดงเมื่อ DB_NAME ≠ MRA) · ข้อมูลตัวอย่าง DEMO01 เดือนจำหน่าย ต.ค. 68–ก.ค. 69 · **เปิดใช้จริง:** แก้ `/opt/mra-ipd/.env` เป็น `DB_NAME=MRA` แล้ว `docker compose up -d --force-recreate`
- `.env` เครื่องพัฒนาใช้ `DB_NAME=MRA_TEST` เสมอ อย่าเปลี่ยนเป็น MRA ตอนทดสอบ
- Docker (Next standalone, image tag = git commit) + Nginx HTTPS บน Linux ของ รพ. ดูขั้นตอนใน README · rollback = `TAG=<tag เดิม> docker compose up -d --no-build` (ตารางเดิมไม่เปลี่ยนโครงสร้าง จึงไม่ต้อง rollback DB)
- Nginx ส่ง X-Forwarded-For เป็น $remote_addr ค่าเดียว (กันปลอม IP ใน AccessLog) และไม่ log query string

## บันทึกปัญหาที่เคยเจอ
- ไฟล์ระบบเดิมใน Z:\NewIntranet\MRA เข้ารหัส TIS-620 (อ่านด้วย `iconv -f TIS-620 -t UTF-8`) ยกเว้น Login.aspx เป็น UTF-8
- `create-next-app` ไม่ยอมชื่อโฟลเดอร์ตัวใหญ่ (MRA) → ชื่อแพ็กเกจคือ `mra-ipd`
- ตารางเดิม: `etc_note` varchar(300) (ตัดหมายเหตุที่ส่งกลับเหลือ 300), `auditor`/`entry_by` varchar(6), ไม่มี FK ระหว่าง mra_ipd_main กับ mra_ipd
- `package-lock.json` ที่สร้างบน Windows ขาด `@emnapi/*` (บั๊ก npm กับ package wasm) ทำให้ `npm ci` ใน Docker พัง → ถ้าแก้ dependency ให้สร้าง lockfile ใหม่ใน Linux: `docker run --rm -v "$PWD":/app -w /app node:24-alpine npm install --package-lock-only` (Dockerfile ใช้ Node 24 ให้ตรงกับเครื่องพัฒนา)
- DB `MRA` (และ SSBDatabase, saraburi) ใช้ compatibility level 120 → ห้ามใช้ OPENJSON, STRING_SPLIT, STRING_AGG ฯลฯ ใช้ `valuesList()` ใน db.js แทน · MRA_TEST ตั้งเป็น 120 ให้เหมือนกันแล้ว
- ข้อความใน SQL ที่มีอักขระนอก Thai_CI_AS (เช่น ·) ต้องใช้ N'...' ไม่งั้นกลายเป็น ?
- query ใหญ่บน SSBDatabase อาจเกิน timeout 15 วินาที (สคริปต์ตั้ง requestTimeout 300 วินาที)
- `.env` ตอนนี้ใช้ DB login ของ HIS ที่มีสิทธิ์กว้าง (ผู้ใช้ตัดสินใจใช้ไปก่อน) ควรเปลี่ยนเป็น DB user เฉพาะโปรเจคเมื่อพร้อม
- mssql อ่าน DATE/DATETIME2 เป็น UTC: ใช้ `isoDate`/`thDateTime` ใน `src/lib/format.js` (getter แบบ UTC) ไม่ให้วันเลื่อน
