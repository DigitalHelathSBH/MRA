import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { query, sql, HIS, INTRANET } from "./db";
import { getSession } from "./session";

// ตรวจรหัสพนักงาน + รหัสผ่านแบบเดียวกับ intranet (Login.aspx): emp.password และต้องยังไม่พ้นสภาพใน PYREXT
export async function verifyIntranetLogin(payrollNo, password) {
  const r = await query(
    `SELECT e.empid, ${HIS}.dbo.GetUserFullName(e.empid) AS FullName
       FROM ${INTRANET}.dbo.emp e
       JOIN ${HIS}.dbo.PYREXT p ON p.PAYROLLNO = e.empid AND p.TERMINATEDATE IS NULL
      WHERE e.empid = @u AND e.password = @p`,
    { u: [sql.VarChar(20), payrollNo], p: [sql.VarChar(100), password] }
  );
  return r.recordset[0] ?? null;
}

// ผู้ใช้ที่ login ครั้งแรกจะถูกเพิ่มเป็น AUDITOR อัตโนมัติ แอดมินเปลี่ยนบทบาทหรือปิดบัญชีได้ที่ mra.AppUser
export async function upsertAppUser(username, fullName) {
  const r = await query(
    `MERGE mra.AppUser AS t
     USING (SELECT @u AS Username, @n AS FullName) AS s ON t.Username = s.Username
     WHEN MATCHED THEN UPDATE SET FullName = s.FullName
     WHEN NOT MATCHED THEN INSERT (Username, FullName, RoleCode) VALUES (s.Username, s.FullName, 'AUDITOR')
     OUTPUT inserted.UserId, inserted.Username, inserted.FullName, inserted.RoleCode, inserted.IsActive;`,
    { u: [sql.VarChar(50), username], n: [sql.NVarChar(200), fullName || username] }
  );
  return r.recordset[0];
}

// อ่านผู้ใช้จาก session แล้วตรวจกับ DB ทุก request (ปิดบัญชีแล้วใช้ไม่ได้ทันที)
export const getCurrentUser = cache(async () => {
  const { userId } = await getSession();
  if (!userId) return null;
  const r = await query(
    `SELECT UserId, Username, FullName, RoleCode FROM mra.AppUser WHERE UserId = @id AND IsActive = 1`,
    { id: [sql.Int, userId] }
  );
  return r.recordset[0] ?? null;
});

export async function requireUser(roles) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (roles && !roles.includes(user.RoleCode)) redirect("/?denied=1");
  return user;
}

export const CAN_EDIT = ["ADMIN", "COORDINATOR", "AUDITOR"];

// บันทึกการเข้าถึง (PDPA) — เก็บ AN ได้ แต่ห้ามใส่ชื่อผู้ป่วยใน Detail
export async function logAccess(userId, actionCode, an = null, detail = null) {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await query(
    `INSERT INTO mra.AccessLog (UserId, ActionCode, AN, Detail, IpAddress) VALUES (@u, @a, @an, @d, @ip)`,
    {
      u: [sql.Int, userId],
      a: [sql.VarChar(20), actionCode],
      an: [sql.VarChar(20), an],
      d: [sql.NVarChar(300), detail],
      ip: [sql.VarChar(45), ip],
    }
  ).catch((err) => console.error("AccessLog insert failed:", err.message));
}
