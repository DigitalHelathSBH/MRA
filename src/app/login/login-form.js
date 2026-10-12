"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState(login, null);

  return (
    <form action={action} className="panel login" autoComplete="off">
      <div className="hero">
        <span className="eyebrow">Medical Record Audit · IPD</span>
        <h1 style={{ marginTop: 4 }}>ระบบตรวจประเมินเวชระเบียนผู้ป่วยใน</h1>
        <p className="muted" style={{ fontSize: 14.5 }}>โรงพยาบาลสระบุรี</p>
      </div>
      <div className="field">
        <label htmlFor="payrollNo">รหัสพนักงาน</label>
        <input id="payrollNo" name="payrollNo" defaultValue={state?.payrollNo ?? ""} autoCapitalize="characters" autoFocus required />
      </div>
      <div className="field">
        <label htmlFor="password">รหัสผ่าน (เดียวกับ intranet)</label>
        <input id="password" name="password" type="password" required />
      </div>
      {state?.error && <div className="msg err" role="alert">{state.error}</div>}
      <button className="primary" type="submit" disabled={pending}>
        {pending ? "กำลังตรวจสอบ…" : "เข้าสู่ระบบ"}
      </button>
    </form>
  );
}
