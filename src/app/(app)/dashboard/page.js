import { requireUser, logAccess } from "@/lib/auth";
import { getDashboard, currentFiscalYear, fiscalMonths } from "@/lib/dashboard";
import { getDepartmentsAndWards } from "@/lib/audit";
import { BANDS, bandRangeText } from "@/lib/bands";
import SearchSelect from "@/components/search-select";
import { TrendLine, ProgressColumns, BarList, BandChip } from "@/components/charts";
import TableView from "@/components/table-view";
import { monLabel, pctText } from "@/lib/format";

export const metadata = { title: "Dashboard · MRA IPD" };

const num = (v) => (v ?? 0).toLocaleString("th-TH");

export default async function DashboardPage({ searchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const nowFy = currentFiscalYear();
  const fy = Number(sp.fy) || nowFy;
  const deptId = Number(sp.dept) || null;

  const [d, { departments }] = await Promise.all([getDashboard({ fy, month: sp.month, deptId }), getDepartmentsAndWards()]);
  await logAccess(user.UserId, "DASHBOARD", null, `fy ${fy}${d.month ? ` month ${d.month}` : ""}${deptId ? ` dept ${deptId}` : ""}`);

  const s = d.summary;
  const fyOptions = [...new Set([nowFy, nowFy - 1, ...d.fiscalYears])].sort((a, b) => b - a).map((y) => ({ value: y, label: `ปีงบประมาณ ${y}` }));
  const monthOptions = fiscalMonths(fy).map((m) => ({ value: m, label: monLabel(m).full }));
  const months = d.months.map((m) => ({ ...m, ...monLabel(m.Mon) }));
  const active = d.month ? months.findIndex((m) => m.Mon === d.month) : null;
  const deptName = departments.find((x) => x.DepartmentId === deptId)?.DepartmentName;
  const scopeText = `${d.month ? `เดือน${monLabel(d.month).full}` : `ปีงบประมาณ ${fy}`}${deptName ? ` · ${deptName}` : ""}`;

  // เทียบกับเดือนก่อนหน้าที่มีข้อมูล (เฉพาะเมื่อเลือกเดือน)
  const prev = active > 0 ? months.slice(0, active).findLast((m) => m.pct != null) : null;
  const delta = d.month && prev && s.pct != null ? s.pct - prev.pct : null;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Dashboard คุณภาพการบันทึกเวชระเบียนผู้ป่วยใน</h1>
          <p>นับเฉพาะเคสที่บันทึกเสร็จ จัดตามเดือนที่จำหน่าย · คะแนนรวม = คะแนนที่ได้ ÷ คะแนนเต็ม ของทุกเคส</p>
        </div>
      </div>

      <form method="get" className="row" style={{ alignItems: "flex-end" }}>
        <div className="field" style={{ minWidth: 200 }}>
          <label htmlFor="fy">ปีงบประมาณ</label>
          <SearchSelect id="fy" name="fy" defaultValue={fy} options={fyOptions} submitOnChange />
        </div>
        <div className="field" style={{ minWidth: 200 }}>
          <label htmlFor="month">เดือน</label>
          <SearchSelect id="month" name="month" defaultValue={d.month ?? ""} emptyLabel="ทั้งปี" options={monthOptions} submitOnChange />
        </div>
        <div className="field" style={{ minWidth: 220 }}>
          <label htmlFor="dept">แผนก</label>
          <SearchSelect id="dept" name="dept" defaultValue={deptId ?? ""} emptyLabel="ทุกแผนก" submitOnChange
            options={departments.map((x) => ({ value: x.DepartmentId, label: x.DepartmentName }))} />
        </div>
        <span className="spacer" />
        <span className="band-legend" aria-label="เกณฑ์ระดับคะแนน">
          {BANDS.map((b, i) => <span key={b.key} className={`chip band-${b.key}`}><i>{b.icon}</i>{b.label} {bandRangeText(b, i)}</span>)}
        </span>
      </form>

      {s.Completed === 0 && <div className="msg warn">ยังไม่มีเคสที่บันทึกเสร็จใน{scopeText}</div>}

      <div className="dash-grid">
        <div className="panel span-4 hero">
          <span className="l">คะแนนรวม {scopeText}</span>
          <span className="v">{pctText(s.pct)}</span>
          <span><BandChip pct={s.pct} long /></span>
          <span className="l">{num(s.ScoreSum)} จาก {num(s.FullSum)} คะแนน · {num(s.Completed)} เคส</span>
          {delta != null && (
            <span className={`delta ${delta >= 0 ? "up" : "down"}`}>
              {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)} จุด จาก {prev.label} ({pctText(prev.pct)})
            </span>
          )}
        </div>
        <div className="panel span-8">
          <div className="tiles">
            <div className="tile">
              <span className="v">{num(s.Completed)} <span className="muted" style={{ fontSize: 16.5 }}>/ {num(s.Sampled)}</span></span>
              <span className="l">ตรวจเสร็จ / สุ่มทั้งหมด</span>
              <span className="meter"><span style={{ width: `${s.Sampled ? (s.Completed * 100) / s.Sampled : 0}%` }} /></span>
            </div>
            <div className="tile">
              <span className="v">{num(s.Drafts)}</span>
              <span className="l">ร่าง (ยังไม่เสร็จ)</span>
            </div>
            <div className="tile">
              <span className="v">{s.Completed ? pctText((s.Adequate * 100) / s.Completed) : "–"}</span>
              <span className="l">เคสที่คะแนนเต็ม ≥ 56 (ข้อมูลพอประเมิน)</span>
              <span className="meter"><span style={{ width: `${s.Completed ? (s.Adequate * 100) / s.Completed : 0}%` }} /></span>
            </div>
            <div className="tile">
              <span className="v">{num(s.Ov2)}</span>
              <span className="l">ไม่มีปัญหาสำคัญ (Overall 2)</span>
            </div>
            <div className="tile">
              <span className="v">{num(s.Ov3)}</span>
              <span className="l">มีปัญหาที่ต้องค้นต่อ (Overall 3)</span>
            </div>
            <div className="tile">
              <span className="v">{num(s.Ov1)}</span>
              <span className="l">ข้อมูลไม่พอทบทวน (Overall 1)</span>
            </div>
          </div>
        </div>

        <div className="panel span-7">
          <h2>คะแนนรวมรายเดือน ปีงบ {fy}</h2>
          <p className="sub">จุดแต่ละเดือนมีสีตามระดับคะแนน{d.month ? ` · ไฮไลต์${monLabel(d.month).label}` : ""}</p>
          <TrendLine ariaLabel="กราฟเส้นคะแนนรวมรายเดือน" active={active}
            points={months.map((m) => ({ label: m.label, short: m.short, value: m.pct, n: m.Completed }))} />
          <TableView rows={months} columns={[
            { key: "label", label: "เดือน" },
            { key: "Completed", label: "เคสที่ตรวจ", num: true },
            { key: "pct", label: "คะแนนรวม", num: true, format: pctText },
            { key: "band", label: "ระดับ", format: (_, r) => <BandChip pct={r.pct} long /> },
          ]} />
        </div>
        <div className="panel span-5">
          <h2>ความคืบหน้าการตรวจ</h2>
          <p className="sub">เคสที่ตรวจเสร็จเทียบกับเคสที่สุ่มในแต่ละเดือน</p>
          <ProgressColumns ariaLabel="กราฟแท่งเคสตรวจเสร็จเทียบกับเคสที่สุ่มรายเดือน" active={active}
            items={months.map((m) => ({ label: m.label, short: m.short, done: m.Completed, total: m.Sampled }))} />
          <TableView rows={months} columns={[
            { key: "label", label: "เดือน" },
            { key: "Sampled", label: "สุ่ม", num: true },
            { key: "Completed", label: "ตรวจเสร็จ", num: true },
          ]} />
        </div>

        {d.deptTrends.length > 1 && (
          <div className="panel span-12">
            <h2>แนวโน้มรายแผนก ปีงบ {fy}</h2>
            <p className="sub">คะแนนรวมรายเดือนของแต่ละแผนก สเกล 0–100% เท่ากันทุกกราฟ เพื่อเทียบกันได้ตรงๆ</p>
            <div className="multiples">
              {d.deptTrends.map((t) => (
                <div key={t.DepartmentId} className="multiple">
                  <div className="mh">{t.DepartmentName}<span className="muted"> · {t.N} เคส</span></div>
                  <TrendLine compact height={150} active={active} ariaLabel={`แนวโน้มคะแนนแผนก${t.DepartmentName}`}
                    points={t.months.map((m) => ({ ...monLabel(m.Mon), value: m.pct, n: m.Completed }))} />
                </div>
              ))}
            </div>
            <TableView rows={d.deptTrends.map((t) => ({ name: t.DepartmentName, ...Object.fromEntries(t.months.map((m) => [m.Mon, m.pct])) }))}
              columns={[{ key: "name", label: "แผนก" }, ...months.map((m) => ({ key: m.Mon, label: m.short, num: true, format: pctText }))]} />
          </div>
        )}

        <div className="panel span-6">
          <h2>คะแนนรวมรายแผนก</h2>
          <p className="sub">{scopeText} · เรียงจากมากไปน้อย · ชี้ที่แถบเพื่อดูคะแนน</p>
          {d.depts.length ? (
            <BarList rows={d.depts.map((x) => ({ key: x.DepartmentId, label: x.DepartmentName, sub: `${x.N} เคส`, value: x.pct, note: `${x.ScoreSum}/${x.FullSum} คะแนน` }))} />
          ) : <p className="hint">ยังไม่มีข้อมูล</p>}
        </div>
        <div className="panel span-6">
          <h2>คะแนนราย content</h2>
          <p className="sub">{scopeText} · ไม่นับเคสที่หัวข้อนั้นเป็น NA</p>
          {d.contents.length ? (
            <>
              <BarList rows={d.contents.map((c) => ({ key: c.ContentNo, label: `${c.ContentNo}. ${c.TitleEn}`, value: c.pct,
                note: `ประเมิน ${c.Assess} · NA ${c.NA} · Missing ${c.Missing} · No ${c.NoRec}` }))} />
              <TableView rows={d.contents} columns={[
                { key: "ContentNo", label: "#" },
                { key: "TitleEn", label: "หัวข้อ" },
                { key: "pct", label: "คะแนน", num: true, format: pctText },
                { key: "Assess", label: "ประเมิน", num: true },
                { key: "NA", label: "NA", num: true },
                { key: "Missing", label: "Missing", num: true },
                { key: "NoRec", label: "No", num: true },
              ]} />
            </>
          ) : <p className="hint">ยังไม่มีข้อมูล</p>}
        </div>

        <div className="panel span-12">
          <h2>เกณฑ์ที่ไม่ผ่านบ่อยที่สุด 10 อันดับ</h2>
          <p className="sub">{scopeText} · % ไม่ผ่าน = ไม่ผ่าน ÷ จำนวนครั้งที่ประเมิน (ไม่นับ NA) · แสดงเฉพาะเกณฑ์ที่ประเมินอย่างน้อย 5 ครั้ง · แดง ≥ 30%, เหลือง 20–29%</p>
          {d.criteria.length ? (
            <div className="tbl crit-table" style={{ maxHeight: "none" }}>
              <table>
                <thead><tr><th>#</th><th>หัวข้อ</th><th>เกณฑ์</th><th className="r">ไม่ผ่าน</th><th>% ไม่ผ่าน</th></tr></thead>
                <tbody>
                  {d.criteria.map((c, i) => (
                    <tr key={`${c.ContentNo}-${c.CriterionNo}`}>
                      <td className="num muted">{i + 1}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{c.ContentNo}. {c.TitleEn}</td>
                      <td><span className="num muted">ข้อ {c.CriterionNo}</span> {c.CriterionText}</td>
                      <td className="r num">{c.Fail}/{c.Rated}</td>
                      <td><span className="rate"><span className="bl-track"><span className={`bl-bar fail-${c.rate >= 30 ? "poor" : c.rate >= 20 ? "fair" : "ok"}`} style={{ width: `${c.rate}%` }} /></span><span className="num">{pctText(c.rate)}</span></span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="hint">ยังไม่มีข้อมูล</p>}
        </div>
      </div>
    </section>
  );
}
