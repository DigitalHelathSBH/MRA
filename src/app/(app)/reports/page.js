import Link from "next/link";
import { requireUser, logAccess } from "@/lib/auth";
import { getCriteriaMatrix } from "@/lib/reports";
import { getDepartmentsAndWards } from "@/lib/audit";
import { bandOf } from "@/lib/bands";
import { pctText } from "@/lib/format";
import { BandChip } from "@/components/charts";
import ReportFilters, { readFilter, filterQuery, scopeText } from "./filters";

export const metadata = { title: "รายงานรายเกณฑ์ · MRA IPD" };

export default async function ReportsPage({ searchParams }) {
  const user = await requireUser();
  const f = readFilter(await searchParams);
  const [m, { departments }] = await Promise.all([getCriteriaMatrix(f), getDepartmentsAndWards()]);
  f.month = m.month;
  await logAccess(user.UserId, "REPORT", null, `matrix ${filterQuery(f)}`);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>รายงาน % ผ่านรายเกณฑ์</h1>
          <p>แถว = หัวข้อ (content) · คอลัมน์ = เกณฑ์ข้อ 1–9 · กดที่ช่องเพื่อดูว่าเกณฑ์นั้นตกที่แผนก ward แพทย์ หรือเคสไหน · กดชื่อหัวข้อเพื่อดูข้อความเกณฑ์ทั้งหมด</p>
        </div>
      </div>

      <ReportFilters filter={f} departments={departments} />

      <div className="panel">
        <h2>{scopeText(f, departments)} · {m.cases.toLocaleString("th-TH")} เคสที่ตรวจเสร็จ</h2>
        <p className="sub">% ผ่าน = ผ่าน ÷ จำนวนที่ประเมิน · ไม่นับ NA · หัวข้อที่เป็น Missing/No นับเป็นไม่ผ่าน · ข้อที่โดน gate (content 7) นับเป็นไม่ผ่าน</p>
        {m.cases === 0 ? (
          <div className="msg warn">ยังไม่มีเคสที่บันทึกเสร็จในช่วงนี้</div>
        ) : (
          <div className="tbl heat" style={{ maxHeight: "none" }}>
            <table>
              <thead>
                <tr>
                  <th>หัวข้อ</th>
                  {Array.from({ length: 9 }, (_, i) => <th key={i} className="c">ข้อ {i + 1}</th>)}
                  <th className="c">รวมหัวข้อ</th>
                </tr>
              </thead>
              <tbody>
                {m.rows.map((r) => (
                  <tr key={r.ContentNo}>
                    <th scope="row" className="rowhead">
                      <Link href={`/reports/content?${filterQuery(f, { cn: r.ContentNo })}`}>
                        {r.ContentNo}. {r.TitleEn}
                      </Link>
                      <small>{r.TitleTh}</small>
                      <small>ประเมิน {r.Assessed}/{r.Cases} เคส</small>
                    </th>
                    {r.cells.map((c) => (
                      <td key={c.no} className="c">
                        {c.rated ? (
                          <Link href={`/reports/criterion?${filterQuery(f, { cn: r.ContentNo, no: c.no })}`}
                            className={`hm band-${bandOf(c.pct)?.key}`} title={`ข้อ ${c.no}: ${c.text}\nผ่าน ${c.passed}/${c.rated}`}>
                            <b>{pctText(c.pct)}</b>
                            <small>{c.passed}/{c.rated}</small>
                          </Link>
                        ) : <span className="hm empty" title={c.text ? `ข้อ ${c.no}: ${c.text}` : undefined}>–</span>}
                      </td>
                    ))}
                    <td className="c total">
                      <b className="num">{pctText(r.pct)}</b>
                      <BandChip pct={r.pct} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
