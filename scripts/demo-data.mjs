// ข้อมูลผลตรวจสมมติสำหรับดู dashboard บน MRA_TEST เท่านั้น
// สร้าง: node --import tsx --conditions=react-server scripts/demo-data.mjs seed [YYYY-MM ...]
// ลบ:   node --import tsx --conditions=react-server scripts/demo-data.mjs clear
// ทุกอย่างผูกกับผู้ใช้ DEMO01 ("ข้อมูลตัวอย่าง") จึงลบออกได้ครบ · ผลการประเมินสุ่มขึ้น ไม่ใช่ผลตรวจจริง
import { loadEnv } from "./env.mjs";
loadEnv();
if (process.env.DB_NAME !== "MRA_TEST") throw new Error("demo-data รันได้เฉพาะ DB_NAME=MRA_TEST");

const { query, getPool } = await import("../src/lib/db.js");
const { getCriteria, saveAudit } = await import("../src/lib/audit.js");
const { drawSample, saveSample, getSampleBatch } = await import("../src/lib/sampling.js");

const [cmd, ...args] = process.argv.slice(2);
const pool = await getPool();

async function demoUser() {
  return (await query(`
    MERGE mra.AppUser t USING (SELECT 'DEMO01' u) s ON t.Username = s.u
    WHEN NOT MATCHED THEN INSERT (Username, FullName, RoleCode) VALUES ('DEMO01', N'ข้อมูลตัวอย่าง', 'AUDITOR')
    WHEN MATCHED THEN UPDATE SET IsActive = 1
    OUTPUT inserted.UserId, inserted.Username;`)).recordset[0];
}

if (cmd === "clear") {
  const r = await query(`
    DECLARE @u INT = (SELECT UserId FROM mra.AppUser WHERE Username = 'DEMO01');
    DECLARE @ans TABLE (AN VARCHAR(20) PRIMARY KEY);
    INSERT INTO @ans SELECT DISTINCT w.AN FROM mra.AuditWorklist w JOIN mra.ImportBatch b ON b.ImportBatchId = w.ImportBatchId WHERE b.ImportedBy = @u
    UNION SELECT AN FROM mra.AuditRecord WHERE CreatedBy = @u;
    DELETE FROM dbo.mra_ipd WHERE an IN (SELECT AN FROM @ans);
    DELETE FROM dbo.mra_ipd_main WHERE an IN (SELECT AN FROM @ans);
    DELETE h FROM mra.AuditHistory h JOIN mra.AuditRecord r ON r.AuditId = h.AuditId WHERE r.AN IN (SELECT AN FROM @ans);
    DELETE FROM mra.AuditRecord WHERE AN IN (SELECT AN FROM @ans);
    DELETE FROM mra.AuditWorklist WHERE AN IN (SELECT AN FROM @ans);
    DELETE FROM mra.ImportBatch WHERE ImportedBy = @u;
    DELETE FROM mra.AccessLog WHERE UserId = @u;
    DELETE FROM mra.AppUser WHERE UserId = @u;
    SELECT COUNT(*) AS cases FROM @ans;`);
  console.log(`ลบข้อมูลตัวอย่างแล้ว ${r.recordset[0].cases} เคส`);
} else if (cmd === "seed") {
  const user = await demoUser();
  const crit = await getCriteria();
  const months = args.length ? args : ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
  const rnd = mulberry(20261012);
  let done = 0, drafts = 0;

  for (const [mi, month] of months.entries()) {
    if (await getSampleBatch(month)) { console.log(`${month}: มีรอบสุ่มอยู่แล้ว ข้าม`); continue; }
    const rows = (await drawSample(month)).rows.filter((x) => x.dept && !x.inWorklist);
    const saved = await saveSample(month, rows.map((x) => ({ an: x.an, seqNo: x.seqNo })), user);
    const cases = (await query(
      `SELECT w.AN, w.DepartmentId, w.WardId, d.DoctorCode, CONVERT(CHAR(10), w.DischargeDate, 126) AS Dc, dep.DepartmentName
         FROM mra.AuditWorklist w JOIN mra.Department dep ON dep.DepartmentId = w.DepartmentId
         LEFT JOIN mra.Doctor d ON d.DoctorId = w.DoctorId WHERE w.ImportBatchId = @b`, { b: saved.batchId })).recordset;

    // เดือนหลังๆ คุณภาพดีขึ้นเล็กน้อย ให้เห็นแนวโน้ม · เดือนล่าสุดตรวจไม่ครบ
    const trend = 0.70 + mi * 0.012;
    for (const c of cases) {
      const roll = rnd();
      const completeShare = mi === months.length - 1 ? 0.55 : 0.92;
      if (roll > completeShare + 0.04) continue;           // ยังไม่ตรวจ
      const mode = roll > completeShare ? "draft" : "complete";
      const deptBias = { "ศัลยกรรม": -0.04, "กุมารเวชกรรม": 0.05, "สูติกรรม": 0.03, "จักษุ": 0.06, "อายุรกรรม": -0.02 }[c.DepartmentName] ?? 0;
      const items = crit.contents.map((ct) => {
        const naP = { 7: 0.55, 8: c.DepartmentName.includes("ศัลย") || c.DepartmentName === "จักษุ" ? 0.15 : 0.8, 9: c.DepartmentName.includes("ศัลย") || c.DepartmentName === "จักษุ" ? 0.1 : 0.7,
          10: c.DepartmentName === "สูติกรรม" ? 0.05 : 1, 11: 0.85 }[ct.no] ?? 0;
        if (ct.allowContentNA && rnd() < naP) return { contentId: ct.contentId, status: "NA", ded: false, remark: "", crit: {} };
        const r = rnd();
        if (r < 0.025) return { contentId: ct.contentId, status: "MISSING", ded: false, remark: "", crit: {} };
        if (r < 0.04) return { contentId: ct.contentId, status: "NO", ded: false, remark: "", crit: {} };
        const contentBias = { 3: -0.08, 6: -0.1, 7: -0.05, 4: 0.03, 12: 0.04 }[ct.no] ?? 0;
        const crits = {};
        for (const cr of ct.criteria) {
          if (mode === "draft" && rnd() < 0.5) continue;
          const critBias = cr.no === 9 || cr.no === 8 ? -0.07 : 0; // ลายมือชื่อ/ระบุตัวผู้บันทึก มักตก
          crits[cr.criterionId] = cr.allowNA && rnd() < 0.3 ? "NA" : rnd() < trend + deptBias + contentBias + critBias + 0.1 ? "PASS" : "FAIL";
        }
        return { contentId: ct.contentId, status: "ASSESS", ded: ct.allowDeduction && rnd() < 0.15, remark: "", crit: crits };
      });
      const auditDate = addDays(c.Dc, 7 + Math.floor(rnd() * 30));
      const overall = mode === "draft" ? "" : rnd() < 0.04 ? "1" : rnd() < 0.8 ? "2" : "3";
      try {
        await saveAudit({
          an: c.AN, rowVer: null, departmentId: c.DepartmentId, wardId: c.WardId, doctorCode: c.DoctorCode ?? "",
          auditDate: auditDate > today() ? today() : auditDate, overall, spec: overall === "3" ? "ข้อมูลตัวอย่าง" : "", items,
        }, mode, user);
        mode === "complete" ? done++ : drafts++;
      } catch (e) {
        console.log(`  ข้ามเคส: ${e.number ? `SQL error ${e.number}` : "บันทึกไม่ผ่านการตรวจสอบ"}`); // ไม่พิมพ์ข้อความเต็ม อาจมี AN
      }
    }
    console.log(`${month}: สุ่ม ${saved.inserted} ราย`);
  }
  console.log(`สร้างผลตรวจตัวอย่าง: เสร็จ ${done} · ร่าง ${drafts}`);
} else {
  console.log("ใช้: demo-data.mjs seed [YYYY-MM ...] | clear");
}
await pool.close();

function addDays(iso, n) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function today() { const t = new Date(); t.setMinutes(t.getMinutes() - t.getTimezoneOffset()); return t.toISOString().slice(0, 10); }
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
