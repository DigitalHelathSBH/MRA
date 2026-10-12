// เดือนที่ใช้จัดกลุ่มรายงาน: "discharge" = เดือนที่จำหน่าย, "audit" = เดือนที่ Audit (รอบตรวจ)
// เดือนที่ Audit = PlannedAuditDate ที่เลือกตอนสุ่ม · ถ้าไม่มี (เพิ่มเองก่อนมีฟีเจอร์/รอบเก่า) = เดือนจำหน่าย + 2 เดือน
// คืนเป็นข้อความ SQL คงที่จาก whitelist (ไม่มีค่าจากผู้ใช้ปน)

export const BASIS = {
  discharge: { label: "เดือนที่จำหน่าย", short: "จำหน่าย" },
  audit: { label: "เดือนที่ Audit", short: "Audit" },
};

export const normBasis = (by) => (by === "audit" ? "audit" : "discharge");

// w = alias ของ mra.AuditWorklist
export const auditMonthSql = (w) =>
  `ISNULL(${w}.PlannedAuditDate, DATEADD(MONTH, 2, DATEFROMPARTS(YEAR(${w}.DischargeDate), MONTH(${w}.DischargeDate), 1)))`;

export const basisDateSql = (by, w) => (normBasis(by) === "audit" ? auditMonthSql(w) : `${w}.DischargeDate`);
