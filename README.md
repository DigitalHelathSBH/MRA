# MRA IPD — รพ.สระบุรี

ระบบบันทึกผลตรวจประเมินคุณภาพการบันทึกเวชระเบียนผู้ป่วยใน (Next.js + SQL Server)
ผลที่บันทึกเสร็จจะถูกเขียนกลับตารางเดิม `mra_ipd_main` / `mra_ipd` เพื่อให้รายงานเดิม (ReportIPD.aspx) ใช้ได้ต่อ

## ติดตั้งเครื่องพัฒนา
1. `npm install`
2. คัดลอก `.env.example` เป็น `.env` แล้วกรอกค่า (ห้าม commit)
3. เตรียมฐานข้อมูลทดสอบ (รันครั้งแรกครั้งเดียว):
   ```
   node scripts/run-sql.mjs db/00_create_mra_test.sql master
   node scripts/run-sql.mjs db/01_mra_ipd_schema.sql
   node scripts/run-sql.mjs db/02_mra_ipd_seed.sql
   node scripts/run-sql.mjs db/03_mra_ipd_additions.sql
   node scripts/run-sql.mjs db/04_mapping.sql
   ```
4. `npm run dev` แล้วเปิด http://localhost:3000 (login ด้วยรหัสพนักงาน + รหัสผ่าน intranet)

## โครงสร้างและกติกา
ดู [CLAUDE.md](CLAUDE.md)

## Deploy ขึ้น Linux server (Docker + Nginx)
server ภายใน `10.0.120.17` (HTTP) · โค้ดอยู่ที่ `/opt/mra-ipd` · เว็บ **http://10.0.120.17/mra** (กำหนด path ด้วย `BASE_PATH` ตอน build ต้องตรงกับ location ใน Nginx)

ครั้งแรก:
1. ติดตั้ง Docker, Docker Compose plugin และ Nginx บน server
2. `git clone https://github.com/digitalhealthsbh-mdi/MRA.git /opt/mra-ipd && cd /opt/mra-ipd`
3. สร้าง `.env` จาก `.env.example`: `DB_NAME=MRA`, `COOKIE_SECURE=false` (ไม่มี HTTPS), สร้าง `SESSION_PASSWORD` ใหม่ด้วย `openssl rand -base64 32` (ห้ามใช้ค่าเดียวกับเครื่องพัฒนา) แล้ว `chmod 600 .env`
4. `TAG=$(git rev-parse --short HEAD) docker compose up -d --build` → เว็บรันที่ `127.0.0.1:3310` (ตรวจด้วย `docker ps` ว่า healthy)
   - ถ้า server ออก internet ไม่ได้: build บนเครื่องที่ออกได้ `docker build -t mra-ipd:<tag> .` → `docker save mra-ipd:<tag> | gzip > mra-ipd.tar.gz` → คัดลอกไป server → `docker load < mra-ipd.tar.gz` → `TAG=<tag> docker compose up -d --no-build`
5. Nginx (เครื่องนี้มีหลายระบบใช้ server block เดียวกันใน `/etc/nginx/conf.d/sbh.conf`):
   - `sudo cp deploy/nginx/mra-logformat.conf /etc/nginx/conf.d/`
   - เพิ่มเนื้อหา `deploy/nginx/mra-location.conf` ลงใน `server { server_name 10.0.120.17; }` ของ `sbh.conf` (backup ก่อน: `sudo cp sbh.conf sbh.conf.bak-mra`)
   - `sudo nginx -t && sudo systemctl reload nginx` (ถ้า `nginx -t` ไม่ผ่าน ห้าม reload ให้คืนไฟล์ .bak)
6. เปิด http://10.0.120.17/mra แล้ว login ด้วยรหัสพนักงาน

อัปเดตเวอร์ชัน:
```
cd /opt/mra-ipd && git pull && TAG=$(git rev-parse --short HEAD) docker compose up -d --build
```

ฐานข้อมูลจริง (ครั้งเดียว — **ติดตั้งแล้ว 12 ต.ค. 2569** สำรองตารางเดิมไว้ที่ `MRA_TEST.bak.*_20261012`): สำรองก่อนด้วย `db/backup_legacy_to_mra_test.sql` แล้วรัน
```
node scripts/run-sql.mjs db/01_mra_ipd_schema.sql MRA
node scripts/run-sql.mjs db/02_mra_ipd_seed.sql MRA
node scripts/run-sql.mjs db/03_mra_ipd_additions.sql MRA
node scripts/run-sql.mjs db/04_mapping.sql MRA
```
ห้ามรัน `db/00_create_mra_test.sql` กับ DB จริง

## Checklist ก่อน deploy
- [ ] `npx eslint src` และ `npm run build` ผ่าน
- [ ] agent `code-reviewer`, `pdpa-auditor`, `deploy-checker` ไม่มีข้อที่ต้องแก้
- [ ] รัน `db/01`–`db/04` บน DB `MRA` จริงแล้ว และ `.env` บน server ตั้ง `DB_NAME=MRA`
- [ ] backup DB `MRA` ก่อนรันสคริปต์
- [ ] ทดสอบบันทึกเสร็จ 1 เคสแล้วเปิด ReportIPD.aspx เดิมเห็นผล
- [ ] HTTPS ผ่าน Nginx

## Rollback
- แอป: `docker images mra-ipd` ดู tag เก่า แล้ว `TAG=<tag เดิม> docker compose up -d --no-build` (ไม่ต้อง build ใหม่) · เก็บ image เก่าไว้ 2–3 เวอร์ชัน
- ข้อมูล: ตารางเดิมไม่ถูกเปลี่ยนโครงสร้าง ถ้าต้องลบผลที่ระบบใหม่เขียนกลับ ให้ลบแถวของ AN ที่ `mra.AuditRecord.LegacySyncedAt` ไม่ว่าง
