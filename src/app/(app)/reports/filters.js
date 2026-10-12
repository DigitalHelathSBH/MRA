import SearchSelect from "@/components/search-select";
import { BANDS, bandRangeText } from "@/lib/bands";
import { currentFiscalYear, fiscalMonths } from "@/lib/dashboard";
import { monLabel } from "@/lib/format";
import { BASIS, normBasis } from "@/lib/basis";

// อ่านตัวกรองจาก searchParams (ใช้ร่วมกันทุกหน้ารายงาน)
export function readFilter(sp) {
  return { fy: Number(sp.fy) || currentFiscalYear(), month: sp.month || null, deptId: Number(sp.dept) || null, by: normBasis(sp.by) };
}

// query string ของตัวกรอง สำหรับลิงก์ไปหน้ารายละเอียด/ย้อนกลับ
export function filterQuery(f, extra = {}) {
  const q = new URLSearchParams();
  q.set("fy", f.fy);
  if (f.month) q.set("month", f.month);
  if (f.deptId) q.set("dept", f.deptId);
  if (f.by === "audit") q.set("by", "audit");
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return q.toString();
}

export function scopeText(f, departments) {
  const dept = departments.find((d) => d.DepartmentId === f.deptId)?.DepartmentName;
  const basis = BASIS[f.by ?? "discharge"].label;
  return `${f.month ? `${basis} ${monLabel(f.month).full}` : `ปีงบประมาณ ${f.fy} (ตาม${basis})`}${dept ? ` · ${dept}` : ""}`;
}

// เลือกว่าจะจัดกลุ่มตามเดือนที่จำหน่ายหรือเดือนที่ Audit (ใช้ร่วมกับหน้า dashboard)
export function BasisSelect({ value }) {
  return (
    <div className="field" style={{ minWidth: 190 }}>
      <label htmlFor="by">จัดตามเดือน</label>
      <SearchSelect id="by" name="by" defaultValue={normBasis(value)} submitOnChange
        options={Object.entries(BASIS).map(([k, v]) => ({ value: k, label: v.label }))} />
    </div>
  );
}

export default function ReportFilters({ filter, departments, hidden = {} }) {
  const now = currentFiscalYear();
  const fyOptions = [now, now - 1, now - 2].map((y) => ({ value: y, label: `ปีงบประมาณ ${y}` }));
  return (
    <form method="get" className="row" style={{ alignItems: "flex-end" }}>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div className="field" style={{ minWidth: 200 }}>
        <label htmlFor="fy">ปีงบประมาณ</label>
        <SearchSelect id="fy" name="fy" defaultValue={filter.fy} options={fyOptions} submitOnChange />
      </div>
      <div className="field" style={{ minWidth: 200 }}>
        <label htmlFor="month">{BASIS[filter.by ?? "discharge"].label}</label>
        <SearchSelect id="month" name="month" defaultValue={filter.month ?? ""} emptyLabel="ทั้งปี" submitOnChange
          options={fiscalMonths(filter.fy).map((m) => ({ value: m, label: monLabel(m).full }))} />
      </div>
      <div className="field" style={{ minWidth: 220 }}>
        <label htmlFor="dept">แผนก</label>
        <SearchSelect id="dept" name="dept" defaultValue={filter.deptId ?? ""} emptyLabel="ทุกแผนก" submitOnChange
          options={departments.map((d) => ({ value: d.DepartmentId, label: d.DepartmentName }))} />
      </div>
      <BasisSelect value={filter.by} />
      <span className="spacer" />
      <span className="band-legend" aria-label="เกณฑ์ระดับคะแนน">
        {BANDS.map((b, i) => <span key={b.key} className={`chip band-${b.key}`}><i>{b.icon}</i>{b.label} {bandRangeText(b, i)}</span>)}
      </span>
    </form>
  );
}
