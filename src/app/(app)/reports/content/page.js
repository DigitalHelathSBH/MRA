import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, logAccess } from "@/lib/auth";
import { getContentDetail } from "@/lib/reports";
import { getDepartmentsAndWards } from "@/lib/audit";
import { bandOf } from "@/lib/bands";
import { pctText } from "@/lib/format";
import { BarList, BandChip } from "@/components/charts";
import ReportFilters, { readFilter, filterQuery, scopeText } from "../filters";

export const metadata = { title: "รายละเอียดหัวข้อ · MRA IPD" };

export default async function ContentPage({ searchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const f = readFilter(sp);
  const cn = Number(sp.cn);
  if (!(cn >= 1 && cn <= 12)) notFound();

  const [d, { departments }] = await Promise.all([getContentDetail(f, cn), getDepartmentsAndWards()]);
  if (!d) notFound();
  f.month = d.month;
  await logAccess(user.UserId, "REPORT", null, `content ${cn} ${filterQuery(f)}`);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="crumb">
        <Link href={`/reports?${filterQuery(f)}`} className="btn" style={{ border: "none", background: "transparent" }}>← รายงานรายเกณฑ์</Link>
        <span className="muted">/</span>
        <span>หัวข้อ {cn}. {d.info.TitleEn}</span>
      </div>

      <ReportFilters filter={f} departments={departments} hidden={{ cn }} />

      <div className="dash-grid">
        <div className="panel span-12">
          <h1 style={{ fontSize: 22 }}>{cn}. {d.info.TitleEn}</h1>
          <p className="muted">{d.info.TitleTh} · {scopeText(f, departments)}</p>
          {d.info.HintText && <p className="hint">{d.info.HintText}</p>}
        </div>

        <div className="panel span-7">
          <h2>เกณฑ์ทั้ง {d.criteria.length} ข้อ เรียงจาก % ผ่านต่ำไปสูง</h2>
          <p className="sub">กดที่เกณฑ์เพื่อดูว่าตกที่แผนก ward แพทย์ หรือเคสไหน</p>
          <ol className="crit-rank">
            {d.criteria.map((c) => (
              <li key={c.CriterionNo}>
                <Link href={`/reports/criterion?${filterQuery(f, { cn, no: c.CriterionNo })}`}>
                  <span className={`hm band-${bandOf(c.pct)?.key ?? "none"}`}><b>{pctText(c.pct)}</b><small>{c.Passed}/{c.Rated}</small></span>
                  <span className="ct"><span className="num muted">ข้อ {c.CriterionNo}</span> {c.CriterionText}</span>
                  <BandChip pct={c.pct} />
                </Link>
              </li>
            ))}
          </ol>
        </div>

        <div className="panel span-5">
          <h2>คะแนนหัวข้อนี้แยกตามแผนก</h2>
          <p className="sub">เรียงจากต่ำไปสูง · ไม่นับเคสที่หัวข้อนี้เป็น NA</p>
          {d.depts.some((x) => x.pct != null) ? (
            <BarList rows={d.depts.filter((x) => x.pct != null).map((x) => ({
              key: x.DepartmentId, label: x.DepartmentName, value: x.pct,
              sub: `${x.N - x.NA} เคสที่ประเมิน${x.MissingNo ? ` · Missing/No ${x.MissingNo}` : ""}`,
            }))} />
          ) : <p className="hint">ยังไม่มีข้อมูล</p>}
        </div>
      </div>
    </section>
  );
}
