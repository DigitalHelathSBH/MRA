// ทดสอบ flow บันทึกจริงบน MRA_TEST: เพิ่มเคส → บันทึกร่าง → บันทึกเสร็จ → ตรวจตารางเดิม → ลบข้อมูลทดสอบ
// ใช้: node --import tsx --conditions=react-server scripts/smoke-test.mjs
// ห้ามรันกับ DB จริง (MRA) · ผลลัพธ์ปิด AN/HN ทุกจุด
import { loadEnv } from "./env.mjs";
loadEnv();
if (process.env.DB_NAME !== "MRA_TEST") throw new Error("smoke-test รันได้เฉพาะ DB_NAME=MRA_TEST");

const { query, getPool } = await import("../src/lib/db.js");
const { getCriteria, addWorklistByAN, getAuditByAN, getDoctorOptions, saveAudit } = await import("../src/lib/audit.js");
const { totalScore } = await import("../src/lib/scoring.js");

const mask = (an) => `${String(an).slice(0, 2)}****${String(an).slice(-2)}`;
let pass = 0, fail = 0;
const check = (label, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "✔" : "✘"} ${label}${extra ? ` — ${extra}` : ""}`); };

const his = process.env.DB_HIS;
// เคสจำหน่าย ส.ค. 2569 LOS ≥ 3 Specialty 01 ที่ยังไม่มีในตารางเดิม (ใช้ทดสอบเท่านั้น)
const pick = await query(`
  SELECT TOP 2 a.AN FROM [${his}].dbo.ADMMASTER a
  WHERE a.DISCHARGEDATETIME >= '2026-08-01' AND a.DISCHARGEDATETIME < '2026-09-01'
    AND DATEDIFF(DAY, a.ADMDATETIME, a.DISCHARGEDATETIME) >= 3 AND a.SPECIALTY = '01'
    AND NOT EXISTS (SELECT 1 FROM MRA.dbo.mra_ipd_main m WHERE m.an = a.AN)
  ORDER BY a.AN DESC`);
const [an, an2] = pick.recordset.map((r) => r.AN.trim());
console.log(`ใช้ AN ทดสอบ ${mask(an)}, ${mask(an2)}`);

const user = (await query(`
  MERGE mra.AppUser t USING (SELECT 'TEST01' u) s ON t.Username = s.u
  WHEN NOT MATCHED THEN INSERT (Username, FullName, RoleCode) VALUES ('TEST01', N'ผู้ทดสอบ ระบบ', 'AUDITOR')
  WHEN MATCHED THEN UPDATE SET IsActive = 1
  OUTPUT inserted.UserId, inserted.Username;`)).recordset[0];

try {
  // 1) เพิ่มเคส
  const add = await addWorklistByAN(an, user);
  check("เพิ่มเคสด้วย AN", add.ok, add.error?.replace(an, mask(an)));
  const dup = await addWorklistByAN(an, user);
  check("เพิ่ม AN ซ้ำถูกปฏิเสธ", !!dup.error);
  const missing = await addWorklistByAN("99999999", user);
  check("AN ที่ไม่มีใน HIS ถูกปฏิเสธ", !!missing.error);

  const crit = await getCriteria();
  let data = await getAuditByAN(an);
  const doctors = await getDoctorOptions(an);
  check("ดึงรายชื่อแพทย์ของ AN", doctors.length > 0, `${doctors.length} คน, แพทย์ผู้สรุป ${doctors.some((d) => d.isSummary) ? "มี" : "ไม่มี"}`);
  check("worklist มีแผนก/ward/แพทย์", !!data.head.DepartmentId && !!data.head.WardId && !!data.head.DoctorCode,
    `แผนก ${data.head.DepartmentId ? "✓" : "✗"} ward ${data.head.WardId ? "✓" : "✗"} แพทย์ ${data.head.DoctorCode ? "✓" : "✗"}`);

  const dc = data.head.DischargeDate.toISOString().slice(0, 10);
  const base = {
    an, rowVer: null, departmentId: data.head.DepartmentId, wardId: data.head.WardId,
    doctorCode: data.head.DoctorCode, auditDate: dc, overall: "", spec: "",
  };

  // 2) บันทึกร่าง (ประเมินแค่ content 1)
  const draftItems = crit.contents.map((c, i) => ({
    contentId: c.contentId, status: "ASSESS", ded: false, remark: "",
    crit: i === 0 ? Object.fromEntries(c.criteria.map((x) => [x.criterionId, "PASS"])) : {},
  }));
  const d1 = await saveAudit({ ...base, items: draftItems }, "draft", user);
  check("บันทึกร่าง", d1.RecordStatus === "DRAFT", `${d1.SumScore}/${d1.FullScore}`);
  const legacyAfterDraft = (await query(`SELECT COUNT(*) n FROM dbo.mra_ipd_main WHERE an = @an`, { an })).recordset[0].n;
  check("ร่างยังไม่ส่งเข้าตารางเดิม", legacyAfterDraft === 0);

  // 3) บันทึกเสร็จไม่ได้ถ้ายังประเมินไม่ครบ
  let err = null;
  try { await saveAudit({ ...base, rowVer: d1.RowVer, overall: "2", items: draftItems }, "complete", user); } catch (e) { err = e.message; }
  check("บันทึกเสร็จไม่ได้เมื่อยังประเมินไม่ครบ", !!err, err);

  // 4) rowVer เก่าถูกปฏิเสธ
  err = null;
  try { await saveAudit({ ...base, rowVer: "0x0000000000000001", items: draftItems }, "draft", user); } catch (e) { err = e.message; }
  check("กันบันทึกทับ (rowVer เก่า)", !!err);

  // 5) ประเมินครบ: content 7 ข้อ 4 FAIL (gate ข้อ 1-3 ไม่ได้คะแนน), 8-11 NA, content 12 หักคะแนน, content 3 MISSING
  const fullItems = crit.contents.map((c) => {
    if (c.no === 3) return { contentId: c.contentId, status: "MISSING", ded: false, remark: "", crit: {} };
    if (c.no >= 8 && c.no <= 11) return { contentId: c.contentId, status: "NA", ded: false, remark: "", crit: {} };
    const crit = Object.fromEntries(c.criteria.map((x) => [x.criterionId, x.allowNA && x.no === 2 ? "NA" : "PASS"]));
    if (c.no === 7) crit[c.criteria.find((x) => x.no === 4).criterionId] = "FAIL";
    return { contentId: c.contentId, status: "ASSESS", ded: c.no === 12, remark: c.no === 1 ? "ทดสอบหมายเหตุ" : "", crit };
  });
  const expected = totalScore(crit.contents, fullItems);
  const c1 = await saveAudit({ ...base, rowVer: d1.RowVer, overall: "2", items: fullItems }, "complete", user);
  check("บันทึกเสร็จ", c1.RecordStatus === "COMPLETED", `${c1.SumScore}/${c1.FullScore} (${c1.ScorePct}%)`);
  check("คะแนนเซิร์ฟเวอร์ตรงกับหน้าจอ", c1.SumScore === expected.sum && c1.FullScore === expected.full,
    `server ${c1.SumScore}/${c1.FullScore} · client ${expected.sum}/${expected.full}`);

  // 6) ตรวจตารางเดิม
  const lm = (await query(`SELECT audit_time, audit_year, auditor, department_id, overall, overall_ipd1, overall_ipd2, entry_by FROM dbo.mra_ipd_main WHERE an = @an`, { an })).recordset;
  const li = (await query(`SELECT i.*, ac.ContentNo FROM dbo.mra_ipd i JOIN mra.AuditContent ac ON ac.LegacyItemId = i.ipd_items_id WHERE i.an = @an ORDER BY i.ipd_items_id`, { an })).recordset;
  check("mra_ipd_main 1 แถว", lm.length === 1,
    lm[0] ? `audit_time ${lm[0].audit_time}, audit_year ${lm[0].audit_year}, dept ${lm[0].department_id}, overall ${lm[0].overall}` : "");
  check("mra_ipd 12 แถว", li.length === 12);
  check("ผลรวม get_score/full_score ตรงกับ AuditRecord",
    li.reduce((s, r) => s + r.get_score, 0) === c1.SumScore && li.reduce((s, r) => s + r.full_score, 0) === c1.FullScore);
  const r7 = li.find((r) => r.ContentNo === 7);
  check("gate content 7: ข้อ 1-3 เป็น '0' ข้อ 5-9 เป็น '1'",
    [r7.data1, r7.data2, r7.data3, r7.data4].every((v) => v === "0") && [r7.data5, r7.data6, r7.data7, r7.data8, r7.data9].every((v) => v === "1"),
    `${r7.data1}${r7.data2}${r7.data3}${r7.data4}|${r7.data5}${r7.data6}${r7.data7}${r7.data8}${r7.data9}`);
  const r2 = li.find((r) => r.ContentNo === 2);
  check("content 2 (7 เกณฑ์): data8/data9 = 'NA' แบบระบบเดิม", r2.data8 === "NA" && r2.data9 === "NA", `${r2.data8}/${r2.data9}`);
  const r3 = li.find((r) => r.ContentNo === 3), r8 = li.find((r) => r.ContentNo === 8), r12 = li.find((r) => r.ContentNo === 12), r1 = li.find((r) => r.ContentNo === 1);
  check("content 3 MISSING: missing=1 full=9 get=0", r3.missing === 1 && r3.full_score === 9 && r3.get_score === 0);
  check("content 8 NA: na=1 full=0 data='0'", r8.na === 1 && r8.full_score === 0 && r8.data1 === "0");
  check("content 12 หักคะแนน: cut_score=1 get=8", r12.cut_score === 1 && r12.get_score === 8, `cut ${r12.cut_score} get ${r12.get_score}`);
  check("content 1 NA ข้อ 2 → data2='NA' full=8", r1.data2 === "NA" && r1.full_score === 8 && r1.etc_note === "ทดสอบหมายเหตุ");

  // 7) แก้เคสที่เสร็จแล้ว: ต้องมีเหตุผล และส่งชุดใหม่แทน
  err = null;
  try { await saveAudit({ ...base, rowVer: c1.RowVer, overall: "2", items: fullItems }, "complete", user); } catch (e) { err = e.message; }
  check("แก้เคสเสร็จแล้วโดยไม่มีเหตุผลถูกปฏิเสธ", !!err);
  fullItems[11].ded = false;
  const e1 = await saveAudit({ ...base, rowVer: c1.RowVer, overall: "3", spec: "ทดสอบแก้ไข", reason: "ทดสอบระบบ", items: fullItems }, "complete", user);
  const after = (await query(`SELECT (SELECT COUNT(*) FROM dbo.mra_ipd_main WHERE an=@an) m, (SELECT COUNT(*) FROM dbo.mra_ipd WHERE an=@an) i, (SELECT overall FROM dbo.mra_ipd_main WHERE an=@an) ov, (SELECT cut_score FROM dbo.mra_ipd WHERE an=@an AND ipd_items_id=12) cut`, { an })).recordset[0];
  check("แก้ไขแล้วตารางเดิมเป็นชุดใหม่ (ไม่ซ้ำ)", after.m === 1 && after.i === 12 && after.ov === 3 && after.cut === 0, `${e1.SumScore}/${e1.FullScore}`);

  // 8) AN ที่บันทึกจากระบบเดิมต้องไม่ถูกเขียนทับ
  await addWorklistByAN(an2, user);
  await query(`INSERT INTO dbo.mra_ipd_main (an, audit_date, department_id) VALUES (@an, '2026-09-01', 1)`, { an: an2 });
  const d2 = await getAuditByAN(an2);
  check("AN จากระบบเดิมแสดงเป็น LEGACY", d2.head.IsLegacy === 1);
  err = null;
  try {
    await saveAudit({ ...base, an: an2, departmentId: d2.head.DepartmentId, wardId: d2.head.WardId, doctorCode: d2.head.DoctorCode,
      auditDate: d2.head.DischargeDate.toISOString().slice(0, 10), overall: "2", items: fullItems }, "complete", user);
  } catch (e) { err = e.message; }
  check("ไม่เขียนทับ AN จากระบบเดิม และย้อนกลับทั้ง transaction", !!err && !(await getAuditByAN(an2)).head.AuditId, err);
} finally {
  // ลบข้อมูลทดสอบทั้งหมด
  await query(`
    DELETE FROM dbo.mra_ipd WHERE an IN (@a, @b);
    DELETE FROM dbo.mra_ipd_main WHERE an IN (@a, @b);
    DELETE h FROM mra.AuditHistory h JOIN mra.AuditRecord r ON r.AuditId = h.AuditId WHERE r.AN IN (@a, @b);
    DELETE FROM mra.AuditRecord WHERE AN IN (@a, @b);
    DELETE FROM mra.AuditWorklist WHERE AN IN (@a, @b);
    DELETE FROM mra.AccessLog WHERE UserId = @u;
    DELETE FROM mra.AppUser WHERE UserId = @u;`, { a: an, b: an2, u: user.UserId });
  console.log(`\nผล: ผ่าน ${pass} · ไม่ผ่าน ${fail} (ลบข้อมูลทดสอบแล้ว)`);
  await (await getPool()).close();
  process.exitCode = fail ? 1 : 0;
}
