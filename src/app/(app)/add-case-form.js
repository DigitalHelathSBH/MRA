"use client";

import { useActionState, useState } from "react";
import { addCase } from "./actions";

export default function AddCaseForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addCase, null);

  if (!open)
    return (
      <div className="row" style={{ marginTop: 12 }}>
        <span className="spacer" />
        <button type="button" onClick={() => setOpen(true)}>+ เพิ่มเคสด้วย AN</button>
      </div>
    );

  return (
    <form action={action} className="addcase">
      <div className="field">
        <label htmlFor="addAn">AN</label>
        <input id="addAn" name="an" className="num" inputMode="numeric" defaultValue={state?.an ?? ""} autoFocus required />
      </div>
      <button type="submit" className="primary" disabled={pending}>{pending ? "กำลังค้น…" : "ค้นจาก HIS"}</button>
      <div className="hint" style={state?.error ? { color: "var(--fail)" } : undefined} role="status">
        {state?.error ?? "ระบบจะดึง HN วัน admit วัน discharge และ ward จาก ADMMASTER ให้"}
      </div>
    </form>
  );
}
