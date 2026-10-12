import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, logAccess, canViewCaseList } from "@/lib/auth";
import { getCriterionDetail } from "@/lib/reports";
import { getDepartmentsAndWards } from "@/lib/audit";
import { monLabel, pctText, thDate } from "@/lib/format";
import { TrendLine, BarList, BandChip } from "@/components/charts";
import TableView from "@/components/table-view";
import ReportFilters, { readFilter, filterQuery, scopeText } from "../filters";

export const metadata = { title: "รายละเอียดเกณฑ์ · MRA IPD" };

const MIN_N = 3; // กราฟแยกกลุ่มแสดงเฉพาะกลุ่มที่ประเมินอย่างน้อย 3 ครั้ง
const TOP = 10;  // และแสดงเฉพาะ 10 กลุ่มที่ต่ำที่สุด (ตาราง "ดูเป็นตาราง" แสดงครบทุกกลุ่ม)

export default async function CriterionPage({ searchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const f = readFilter(sp);
  const cn = Number(sp.cn), no = Number(sp.no);
  if (!(cn >= 1 && cn <= 12 && no >= 1 && no <= 9)) notFound();

  const showCases = await canViewCaseList(user);
  const [d, { departments }] = await Promise.all([getCriterionDetail(f, cn, no, { includeCases: showCases }), getDepartmentsAndWards()]);
  if (!d) notFound();
  f.month = d.month;
  await logAccess(user.UserId, "REPORT", null, `criterion ${cn}.${no} ${filterQuery(f)}${showCases ? ` · แสดง ${d.failed.length} AN` : ""}`);
  const failedCount = d.total.Rated - d.total.Passed;

  const months = d.months.map((m) => ({ ...m, ...monLabel(m.Mon) }));
  const active = f.month ? months.findIndex((m) => m.Mon === f.month) : null;
  const group = (rows, title, sub) => {
    const eligible = rows.filter((r) => r.rated >= MIN_N);
    const shown = eligible.slice(0, TOP);
    return (
      <div className="panel span-4">
        <h2>{title}</h2>
        <p className="sub">{sub} · {eligible.length > TOP ? `${TOP} อันดับที่ต่ำที่สุด จาก ${eligible.length}` : "เรียงจากต่ำไปสูง"} · นับกลุ่มที่ประเมิน ≥ {MIN_N} ครั้ง</p>
        {shown.length ? (
          <BarList compact rows={shown.map((r) => ({ key: r.key, label: r.name, sub: `ผ่าน ${r.passed}/${r.rated}`, value: r.pct }))} />
        ) : <p className="hint">ยังมีข้อมูลไม่พอ</p>}
        <TableView rows={rows} columns={[
          { key: "name", label: title.replace("แยกตาม", "") },
          { key: "passed", label: "ผ่าน", num: true },
          { key: "rated", label: "ประเมิน", num: true },
          { key: "pct", label: "%", num: true, format: pctText },
        ]} />
      </div>
    );
  };

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="crumb">
        <Link href={`/reports?${filterQuery(f)}`} className="btn" style={{ border: "none", background: "transparent" }}>← รายงานรายเกณฑ์</Link>
        <span className="muted">/</span>
        <Link href={`/reports/content?${filterQuery(f, { cn })}`}>หัวข้อ {cn}. {d.info.TitleEn}</Link>
        <span className="muted">/</span>
        <span>ข้อ {no}</span>
      </div>

      <ReportFilters filter={f} departments={departments} hidden={{ cn, no }} />

      <div className="dash-grid">
        <div className="panel span-8">
          <span className="eyebrow-sm">หัวข้อ {cn}. {d.info.TitleEn} · {d.info.TitleTh}</span>
          <h1 style={{ fontSize: 21, marginTop: 4 }}>ข้อ {no}: {d.info.CriterionText}</h1>
          {d.info.NoteText && <p className="hint" style={{ marginTop: 6 }}>{d.info.NoteText}</p>}
        </div>
        <div className="panel span-4 hero">
          <span className="l">% ผ่าน · {scopeText(f, departments)}</span>
          <span className="v">{pctText(d.total.pct)}</span>
          <span><BandChip pct={d.total.pct} long /></span>
          <span className="l">ผ่าน {d.total.Passed}/{d.total.Rated} ครั้ง · NA {d.total.NA ?? 0} · Missing/No {d.total.MissingNo ?? 0}{d.total.Gated ? ` · โดน gate ${d.total.Gated}` : ""}</span>
        </div>

        <div className="panel span-12">
          <h2>% ผ่านรายเดือน ปีงบ {f.fy}</h2>
          <TrendLine ariaLabel="กราฟเส้น % ผ่านของเกณฑ์นี้รายเดือน" active={active}
            points={months.map((m) => ({ label: m.label, short: m.short, value: m.pct, n: m.rated }))} />
          <TableView rows={months} columns={[
            { key: "label", label: "เดือน" },
            { key: "rated", label: "ประเมิน", num: true },
            { key: "pct", label: "% ผ่าน", num: true, format: pctText },
          ]} />
        </div>

        {group(d.byDept, "แยกตามแผนก", "แผนกของเคส")}
        {group(d.byWard, "แยกตาม ward", "ward ที่ admit")}
        {group(d.byDoctor, "แยกตามแพทย์", "แพทย์เจ้าของไข้")}

        <div className="panel span-12">
          <h2>เคสที่ไม่ผ่านเกณฑ์นี้ ({failedCount.toLocaleString("th-TH")} เคส)</h2>
          {!showCases ? (
            <div className="msg info">รายชื่อเคสดูได้เฉพาะเจ้าหน้าที่ฝ่ายเวชระเบียนและฝ่ายสุขภาพดิจิทัล</div>
          ) : d.failed.length ? (<>
            <p className="sub">กด AN เพื่อเปิดแบบตรวจ · หมายเหตุมาจากหมายเหตุของหัวข้อที่ผู้ตรวจบันทึก</p>
            <div className="tbl crit-table">
              <table>
                <thead>
                  <tr><th>AN</th><th>Discharge</th><th>แผนก</th><th>Ward</th><th>แพทย์</th><th>ผู้ตรวจ</th><th>สาเหตุ</th><th>หมายเหตุ</th></tr>
                </thead>
                <tbody>
                  {d.failed.map((x) => (
                    <tr key={x.AN}>
                      <td className="num"><Link href={`/audit/${x.AN}`}><b>{x.AN}</b></Link></td>
                      <td style={{ whiteSpace: "nowrap" }}>{thDate(x.DischargeDate)}</td>
                      <td>{x.DepartmentName}</td>
                      <td>{x.HisWardCode ? `${x.HisWardCode} · ${x.WardName}` : "–"}</td>
                      <td>{x.DoctorName ?? "–"}</td>
                      <td>{x.AuditorName}</td>
                      <td>{x.Reason}</td>
                      <td>{x.Remark ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>) : <p className="hint">ไม่มีเคสที่ไม่ผ่านในช่วงนี้</p>}
        </div>
      </div>
    </section>
  );
}
