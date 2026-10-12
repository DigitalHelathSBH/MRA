"use client";

import { useEffect, useState } from "react";

// แบ่งจอ: ซ้าย = เวชระเบียนสแกน (PDF ผ่าน /api/chart/[an]) · ขวา = แบบบันทึกผล
// จำการเปิด/ปิดไว้ในเบราว์เซอร์ (ค่าเริ่มต้น: เปิดบนจอกว้าง)
const KEY = "mra.chartPanel";

export default function ChartSplit({ an, children }) {
  const [open, setOpen] = useState(true);
  // URL แบบ relative จากหน้า /audit/[an] → ใช้ได้ทั้งมีและไม่มี basePath (/mra)
  const src = `../api/chart/${an}`;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      const wide = window.matchMedia("(min-width: 1100px)").matches;
      setOpen(saved ? saved === "1" : wide); // eslint-disable-line react-hooks/set-state-in-effect
    } catch {}
  }, []);

  function toggle() {
    setOpen((v) => {
      try { localStorage.setItem(KEY, v ? "0" : "1"); } catch {}
      return !v;
    });
  }

  return (
    <div className={`chart-split${open ? " open" : ""}`}>
      <div className="chart-bar">
        <button type="button" className={open ? "" : "primary"} onClick={toggle}>
          {open ? "ซ่อนเวชระเบียนสแกน" : "แสดงเวชระเบียนสแกน"}
        </button>
        {open && <a href={src} target="_blank" rel="noopener" className="hint">เปิด PDF ในแท็บใหม่</a>}
      </div>
      {open && (
        <aside className="chart-pane" aria-label={`เวชระเบียนสแกน AN ${an}`}>
          <iframe src={src} title={`เวชระเบียนสแกน AN ${an}`} />
        </aside>
      )}
      <div className="chart-main">{children}</div>
    </div>
  );
}
