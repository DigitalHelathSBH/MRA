"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { monLabel } from "@/lib/format";
import { drawAction, saveSampleAction } from "./actions";

// เดือนที่จำหน่ายเริ่มต้น = ย้อนหลัง 2 เดือนจากเดือนที่ audit
const LAG_MONTHS = 2;
function monthBefore(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 7);
}

export default function SamplingClient({ today }) {
  const thisMonth = today.slice(0, 7);
  const [auditMonth, setAuditMonth] = useState(thisMonth);
  const [month, setMonth] = useState(monthBefore(thisMonth, LAG_MONTHS));
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState(null);
  const [saved, setSaved] = useState(null);
  const [pending, start] = useTransition();

  const usable = rows?.filter((r) => r.dept && !r.inWorklist) ?? [];
  const label = month ? monLabel(month).full : "";
  // เดือนที่ audit ต้องอยู่หลังเดือนที่จำหน่าย และเลือกเดือนจำหน่ายที่ยังไม่จบไม่ได้
  const invalid = !auditMonth || !month ? "กรุณาเลือกเดือนที่ Audit และเดือนที่จำหน่าย"
    : month >= auditMonth ? "เดือนที่จำหน่ายต้องอยู่ก่อนเดือนที่ Audit"
    : month >= thisMonth ? "เดือนที่จำหน่ายต้องเป็นเดือนที่จบไปแล้ว" : null;

  function reset() { setRows(null); setMsg(null); setSaved(null); }

  function draw() {
    setMsg(null);
    setSaved(null);
    start(async () => {
      const r = await drawAction(month);
      if (r.error) { setRows(null); return setMsg({ kind: "err", text: r.error }); }
      setRows(r.rows);
      if (!r.rows.length) setMsg({ kind: "warn", text: "ไม่พบผู้ป่วยตามเงื่อนไขในเดือนนี้" });
    });
  }

  function save() {
    start(async () => {
      const r = await saveSampleAction(month, usable.map((x) => ({ an: x.an, seqNo: x.seqNo })), auditMonth);
      if (r.error) return setMsg({ kind: "err", text: r.error });
      setSaved(r);
      setRows(null);
      setMsg({ kind: "ok", text: `บันทึกรายชื่อผู้ป่วยจำหน่ายเดือน${label} แล้ว ${r.inserted} ราย กำหนด Audit เดือน${monLabel(auditMonth).full}${r.skipped ? ` (ข้าม ${r.skipped} ราย)` : ""}` });
    });
  }

  const byDept = rows ? Object.entries(rows.reduce((a, r) => ((a[r.dept ?? "ยังไม่จับคู่"] = (a[r.dept ?? "ยังไม่จับคู่"] ?? 0) + 1), a), {})) : [];

  return (
    <>
      <div className="panel">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ minWidth: 200 }}>
            <label htmlFor="auditMonth">เดือนที่ Audit</label>
            <input id="auditMonth" type="month" value={auditMonth}
              onChange={(e) => { const v = e.target.value; setAuditMonth(v); if (v) setMonth(monthBefore(v, LAG_MONTHS)); reset(); }} />
            <span className="hint">{auditMonth ? monLabel(auditMonth).full : "–"}</span>
          </div>
          <div className="field" style={{ minWidth: 200 }}>
            <label htmlFor="month">เดือนที่จำหน่าย</label>
            <input id="month" type="month" value={month} max={monthBefore(today, 1)}
              onChange={(e) => { setMonth(e.target.value); reset(); }} />
            <span className="hint">{month ? `${label}${auditMonth && month === monthBefore(auditMonth, LAG_MONTHS) ? ` (ย้อนหลัง ${LAG_MONTHS} เดือนจากเดือนที่ Audit)` : ""}` : "–"}</span>
          </div>
          <button type="button" className="primary" onClick={draw} disabled={pending || !!invalid} style={{ marginBottom: 30 }}>
            {pending && !rows ? "กำลังสุ่ม…" : rows ? "สุ่มใหม่" : "สุ่มรายชื่อ"}
          </button>
          <span className="spacer" />
          {rows?.length > 0 && (
            <button type="button" className="primary" onClick={save} disabled={pending || !usable.length || !!invalid} style={{ marginBottom: 30 }}>
              {pending ? "กำลังบันทึก…" : `บันทึกเข้ารายการตรวจ ${usable.length} ราย`}
            </button>
          )}
        </div>
        {invalid && <div className="msg err" style={{ marginTop: 8 }}>{invalid}</div>}
        <p className="hint" style={{ marginTop: 8 }}>ผลการสุ่มจะยังไม่ถูกบันทึกจนกว่าจะกดบันทึก กดสุ่มใหม่ได้ · เดือนที่จำหน่ายหนึ่งเดือนบันทึกได้ครั้งเดียว · รายชื่อจะไปอยู่ในหน้าเคสรอตรวจของเดือนที่ Audit</p>
      </div>

      {msg && (
        <div className={`msg ${msg.kind}`} role="status">
          {msg.text}
          {saved && <Link href={`/?month=${auditMonth}`}>ไปที่เคสรอตรวจ →</Link>}
        </div>
      )}

      {rows?.length > 0 && (
        <div className="panel">
          <div className="row" style={{ marginBottom: 10 }}>
            <b>ได้ {rows.length} ราย</b>
            {byDept.map(([d, n]) => <span key={d} className="st PENDING" style={{ fontWeight: 500 }}>{d} {n}</span>)}
          </div>
          <div className="tbl">
            <table>
              <thead>
                <tr><th>#</th><th>AN</th><th>HN</th><th>แผนก</th><th>Ward</th><th>Admit</th><th>Discharge</th><th className="r">LOS</th><th>หมายเหตุ</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.an} style={!r.dept || r.inWorklist ? { opacity: 0.55 } : undefined}>
                    <td className="num muted">{r.seqNo}</td>
                    <td className="num"><b>{r.an}</b></td>
                    <td className="num">{r.hn}</td>
                    <td>{r.dept ?? <span style={{ color: "var(--fail)" }}>Specialty {r.specialty} ยังไม่จับคู่</span>}</td>
                    <td>{r.ward} · {r.wardName}</td>
                    <td>{thDate(r.admit)}</td>
                    <td>{thDate(r.discharge)}</td>
                    <td className="r num">{r.los}</td>
                    <td className="hint">
                      {r.inWorklist ? "มีในรายการแล้ว (ข้าม)" : r.inLegacy ? "ตรวจในระบบเดิมแล้ว" : !r.wardMapped ? "ward ยังไม่จับคู่" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
