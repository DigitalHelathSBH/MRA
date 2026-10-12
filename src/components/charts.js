"use client";

import { useEffect, useRef, useState } from "react";
import { bandOf, BANDS } from "@/lib/bands";

// วัดความกว้างจริงของกล่อง ให้ข้อความใน SVG เป็นขนาดจริง (ไม่ย่อ/ขยายตามกล่อง)
function useWidth(initial = 720) {
  const ref = useRef(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [w, ref];
}

const fmtPct = (v) => (v == null ? "–" : `${v.toFixed(1)}%`);
const bandKey = (v) => bandOf(v)?.key ?? "none";

/* ---------- เส้นแนวโน้ม % (แกนเดียว 0–100) จุดแต่ละเดือนสีตามระดับคะแนน ---------- */
// points: [{ label, short, value|null, n }] · active = index เดือนที่เลือก
export function TrendLine({ points, height = 240, ariaLabel, compact, active }) {
  const [W, wrap] = useWidth();
  const H = height, L = compact ? 30 : 44, R = compact ? 44 : 64, T = 12, B = 26;
  const iw = W - L - R, ih = H - T - B;
  const x = (i) => L + (points.length === 1 ? iw / 2 : (i * iw) / (points.length - 1));
  const y = (v) => T + ih - (v / 100) * ih;
  const [hover, setHover] = useState(null);
  const svg = useRef(null);

  // เส้นขาดช่วงตรงเดือนที่ยังไม่มีข้อมูล
  const segs = [];
  let cur = [];
  points.forEach((p, i) => {
    if (p.value == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([x(i), y(p.value)]);
  });
  if (cur.length) segs.push(cur);
  const labelIdx = active != null && points[active]?.value != null ? active : points.findLastIndex((p) => p.value != null);

  function onMove(e) {
    const box = svg.current.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    points.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
    setHover(best);
  }

  const hp = hover != null ? points[hover] : null;
  const step = labelStep(points.length, iw);
  return (
    <div className="viz-wrap" ref={wrap}>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="viz-svg" role="img" aria-label={ariaLabel}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {active != null && (
          <rect x={x(active) - Math.max(10, iw / points.length / 2)} y={T} width={Math.max(20, iw / points.length)} height={ih} className="viz-active" />
        )}
        {(compact ? [0, 50, 100] : [0, 25, 50, 75, 100]).map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={v === 0 ? "viz-axis" : "viz-grid"} />
            <text x={L - 8} y={y(v)} dy="0.32em" textAnchor="end" className="viz-tick">{v}</text>
          </g>
        ))}
        {!compact && BANDS.slice(0, 2).map((b) => (
          <g key={b.key}>
            <line x1={L} x2={W - R} y1={y(b.min)} y2={y(b.min)} className="viz-target" />
            <text x={W - R + 6} y={y(b.min)} dy="0.32em" className="viz-tick">{b.label} {b.min}%</text>
          </g>
        ))}
        {points.map((p, i) => (i % step === 0 || i === active) && (
          <text key={p.label} x={x(i)} y={H - 8} textAnchor="middle" className={`viz-tick${i === active ? " on" : ""}`}>{p.short}</text>
        ))}
        {segs.map((s, i) => (
          <polyline key={i} points={s.map((pt) => pt.join(",")).join(" ")} className="viz-line" />
        ))}
        {points.map((p, i) => p.value != null && (
          <circle key={`b${i}`} cx={x(i)} cy={y(p.value)} r={i === active ? 7 : compact ? 4 : 5} className={`viz-dot band-${bandKey(p.value)}`} />
        ))}
        {labelIdx >= 0 && (
          <text x={x(labelIdx) + 10} y={y(points[labelIdx].value) - 10} className="viz-label">{fmtPct(points[labelIdx].value)}</text>
        )}
        {hp && (
          <line x1={x(hover)} x2={x(hover)} y1={T} y2={T + ih} className="viz-cross" pointerEvents="none" />
        )}
      </svg>
      {hp && (
        <div className="viz-tip" style={{ left: `${(x(hover) / W) * 100}%` }} role="status">
          <b>{fmtPct(hp.value)} <BandChip pct={hp.value} /></b>
          <span>{hp.label}{hp.n ? ` · ${hp.n} เคส` : ""}</span>
        </div>
      )}
    </div>
  );
}

/* ---------- คอลัมน์ตรวจแล้ว / สุ่มทั้งหมด รายเดือน ---------- */
// items: [{ label, short, done, total }] · active = index เดือนที่เลือก
export function ProgressColumns({ items, height = 240, ariaLabel, active }) {
  const [W, wrap] = useWidth();
  const H = height, L = 44, R = 16, T = 18, B = 30;
  const iw = W - L - R, ih = H - T - B;
  const nice = niceMax(Math.max(1, ...items.map((d) => d.total)));
  const band = iw / items.length, bw = Math.min(24, band * 0.5);
  const y = (v) => T + ih - (v / nice) * ih;
  const [hover, setHover] = useState(null);
  const hp = hover != null ? items[hover] : null;
  const step = labelStep(items.length, iw);

  return (
    <div className="viz-wrap" ref={wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="viz-svg" role="img" aria-label={ariaLabel} onPointerLeave={() => setHover(null)}>
        {[0, nice / 2, nice].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={v === 0 ? "viz-axis" : "viz-grid"} />
            <text x={L - 8} y={y(v)} dy="0.32em" textAnchor="end" className="viz-tick">{Math.round(v)}</text>
          </g>
        ))}
        {items.map((d, i) => {
          const cx = L + band * i + band / 2;
          const cls = [hover === i && "viz-hot", active != null && i !== active && "viz-dim"].filter(Boolean).join(" ");
          return (
            <g key={d.label} onPointerEnter={() => setHover(i)} className={cls || undefined}>
              <rect x={L + band * i} y={T} width={band} height={ih} fill="transparent" />
              {d.total > 0 && <path d={colPath(cx - bw / 2, y(d.total), bw, y(0) - y(d.total))} className="viz-track" />}
              {d.done > 0 && <path d={colPath(cx - bw / 2, y(d.done), bw, y(0) - y(d.done))} className="viz-bar" />}
              {(i % step === 0 || i === active) && (
                <text x={cx} y={H - 8} textAnchor="middle" className={`viz-tick${i === active ? " on" : ""}`}>{d.short}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hp && (
        <div className="viz-tip" style={{ left: `${((L + band * hover + band / 2) / W) * 100}%` }} role="status">
          <b>{hp.done} / {hp.total}</b>
          <span>{hp.label} · ตรวจแล้ว / สุ่ม</span>
        </div>
      )}
      <div className="viz-legend">
        <span><i className="sw bar" />ตรวจเสร็จ</span>
        <span><i className="sw track" />สุ่มทั้งหมด</span>
      </div>
    </div>
  );
}

/* ---------- แท่งแนวนอน % สีตามระดับคะแนน พร้อมค่าและป้ายระดับ ---------- */
// rows: [{ key, label, sub, value (0–100), note }]
export function BarList({ rows, compact }) {
  return (
    <ul className={`barlist${compact ? " compact" : ""}`}>
      {rows.map((r) => (
        <li key={r.key} title={r.note}>
          <span className="bl-label">{r.label}{r.sub && <small>{r.sub}</small>}</span>
          <span className="bl-track">
            <span className={`bl-bar band-${bandKey(r.value)}`} style={{ width: `${Math.max(0, Math.min(100, r.value ?? 0))}%` }} />
          </span>
          <span className="bl-value num">{fmtPct(r.value)} <BandChip pct={r.value} /></span>
        </li>
      ))}
    </ul>
  );
}

// ป้ายระดับคะแนน — สีไม่ใช่ช่องทางเดียว มีไอคอนและข้อความกำกับ
export function BandChip({ pct, long }) {
  const b = bandOf(pct);
  if (!b) return null;
  return <span className={`chip band-${b.key}`}><i>{b.icon}</i>{long || b.key !== "poor" ? b.label : "ปรับปรุง"}</span>;
}

// แสดงป้ายแกน x ทุก n ตัว ให้แต่ละป้ายมีที่อย่างน้อย ~40px
function labelStep(count, width) {
  return Math.max(1, Math.ceil((count * 40) / width));
}

// คอลัมน์ปลายมน 4px ฐานเหลี่ยม
function colPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}
