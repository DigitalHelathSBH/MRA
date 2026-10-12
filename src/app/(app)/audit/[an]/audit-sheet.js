"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { contentScore, totalScore } from "@/lib/scoring";
import { STATUS_TH } from "@/lib/format";
import { saveAuditAction } from "../../actions";
import SearchSelect from "@/components/search-select";
import FancyCheck from "@/components/fancy-check";

const CSTATUS = { ASSESS: "ประเมิน", NA: "NA (ไม่มีการให้บริการ)", MISSING: "Missing", NO: "No" };
const CSTATUS_HINT = {
  NA: "ไม่มีการให้บริการ ไม่นำมาคิดคะแนน",
  MISSING: "ควรมีแต่ไม่พบเอกสาร ได้ 0 คะแนน (นับคะแนนเต็ม)",
  NO: "มีเอกสารแต่ไม่มีการบันทึก ได้ 0 คะแนน (นับคะแนนเต็ม)",
};
const OVERALL = [
  ["1", "Documentation inadequate for meaningful review (ข้อมูลไม่เพียงพอสำหรับการทบทวน)"],
  ["2", "No significant medical record issue identified (ไม่มีปัญหาสำคัญจากการทบทวน)"],
  ["3", "Certain issues in question specify (มีปัญหาจากการทบทวนที่ต้องค้นต่อ)"],
];

export default function AuditSheet({ criteria, initial, patient, refs, meta }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState(
    meta.status === "LEGACY"
      ? { kind: "warn", text: "AN นี้บันทึกผลตรวจจากระบบเดิม (IPDForm) แล้ว ระบบใหม่จะไม่เขียนทับ ถ้าต้องแก้ไขให้แก้ในระบบเดิม" }
      : meta.status === "COMPLETED"
        ? { kind: "info", text: "เคสนี้ตรวจเสร็จและส่งเข้าระบบเดิมแล้ว ถ้าแก้ไข ต้องระบุเหตุผลและระบบจะส่งข้อมูลชุดใหม่แทน" }
        : null
  );
  const [confirm, setConfirm] = useState(null); // { text, yes, needReason, onYes }
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(() => new Set([0]));
  const [pending, startTransition] = useTransition();
  const msgRef = useRef(null);

  const ro = meta.readOnly;
  const completed = meta.status === "COMPLETED";
  const t = useMemo(() => totalScore(criteria, form.items), [criteria, form.items]);

  // เตือนก่อนออกจากหน้าถ้ายังไม่ได้บันทึก
  useEffect(() => {
    if (!dirty) return;
    const h = (e) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const set = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const setItem = (i, fn) => {
    setForm((f) => ({ ...f, items: f.items.map((it, j) => (j === i ? fn(it) : it)) }));
    setDirty(true);
  };

  function chooseStatus(i, s) {
    const it = form.items[i];
    const next = s === it.status && s !== "ASSESS" ? "ASSESS" : s;
    const apply = () => setItem(i, (x) => ({ ...x, status: next, ...(next !== "ASSESS" ? { crit: {}, ded: false } : {}) }));
    if (next !== "ASSESS" && Object.keys(it.crit).length) {
      setConfirm({ text: `เปลี่ยนหัวข้อ ${i + 1} เป็น "${CSTATUS[next]}" ผลรายเกณฑ์ที่เลือกไว้จะถูกล้าง`, yes: "เปลี่ยนสถานะ", onYes: apply });
    } else apply();
  }

  function chooseCrit(i, criterionId, v) {
    setItem(i, (x) => {
      const crit = { ...x.crit };
      if (crit[criterionId] === v) delete crit[criterionId];
      else crit[criterionId] = v;
      return { ...x, crit };
    });
  }

  function show(kind, text) {
    setMsg({ kind, text });
    requestAnimationFrame(() => msgRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }

  function submit(mode, why) {
    startTransition(async () => {
      const r = await saveAuditAction({ ...form, reason: why ?? "" }, mode);
      if (r.error) return show("err", r.error);
      setForm((f) => ({ ...f, rowVer: r.RowVer })); // rowVer ใหม่ใช้กันการบันทึกทับจากเครื่องอื่น
      setDirty(false);
      if (mode === "complete") {
        show("ok", `บันทึกเสร็จแล้ว ${r.SumScore}/${r.FullScore} คะแนน (${Number(r.ScorePct ?? 0).toFixed(2)}%) · ส่งเข้าระบบเดิมแล้ว รายงาน ReportIPD เดิมจะเห็นเคสนี้`);
      } else {
        show("info", `บันทึกร่างแล้ว ${r.SumScore}/${r.FullScore} คะแนน (ยังไม่ส่งเข้าระบบเดิม)`);
      }
      router.refresh();
    });
  }

  function onComplete() {
    const errs = [];
    if (t.todo) errs.push(`ยังไม่ได้ประเมินอีก ${t.todo} ข้อ`);
    if (!form.overall) errs.push("ยังไม่ได้เลือก Overall finding");
    if (form.overall === "3" && !form.spec.trim()) errs.push("Overall finding ข้อ 3 ต้องระบุรายละเอียด");
    if (form.auditDate < patient.dischargeIso) errs.push("วันที่ตรวจประเมินต้องไม่ก่อนวันที่ discharge");
    if (errs.length) return show("err", "บันทึกเสร็จไม่ได้: " + errs.join(" · "));
    const low = t.full < 56 ? ` (คะแนนเต็ม ${t.full} ต่ำกว่า 56 จะถูกระบุว่าข้อมูลไม่เพียงพอ)` : "";
    setReason("");
    setConfirm({
      text: `${completed ? "บันทึกการแก้ไข" : "บันทึกเสร็จ"} AN ${form.an} ได้ ${t.sum}/${t.full} คะแนน${low} และส่งข้อมูลเข้าระบบเดิม (mra_ipd_main, mra_ipd)`,
      yes: completed ? "บันทึกการแก้ไข" : "บันทึกเสร็จ",
      needReason: completed,
      onYes: (why) => submit("complete", why),
    });
  }

  return (
    <>
      <div className="row">
        <span className={`st ${meta.status}`}>{STATUS_TH[meta.status]}</span>
        <span className="spacer" />
        <span className="hint">{dirty ? "มีการแก้ไขที่ยังไม่บันทึก" : meta.savedAt ? `บันทึกล่าสุด ${meta.savedAt}` : "ยังไม่ได้บันทึก"}</span>
      </div>

      {msg && <div ref={msgRef} className={`msg ${msg.kind}`} role="status">{msg.text}</div>}

      <div className="panel">
        <h2>ข้อมูลผู้ป่วยและการตรวจประเมิน</h2>
        <div className="grid">
          <ReadField label="AN" value={patient.an} his mono />
          <ReadField label="HN" value={patient.hn} his mono />
          <ReadField label="Admit" value={patient.admit} his />
          <ReadField label="Discharge" value={patient.discharge} his />
          <ReadField label="LOS (วัน)" value={patient.los} mono />
          <div className="field">
            <label htmlFor="h_dept">แผนก</label>
            <SearchSelect id="h_dept" value={form.departmentId} disabled={ro} onChange={(v) => set({ departmentId: v })}
              options={refs.departments.map((d) => ({ value: d.DepartmentId, label: d.DepartmentName }))} />
          </div>
          <div className="field">
            <label htmlFor="h_ward">Ward</label>
            <SearchSelect id="h_ward" value={form.wardId} disabled={ro} onChange={(v) => set({ wardId: v })}
              options={refs.wards.map((w) => ({ value: w.WardId, label: `${w.HisWardCode} · ${w.WardName}` }))} />
          </div>
          <div className="field">
            <label htmlFor="h_doc">แพทย์เจ้าของไข้</label>
            <SearchSelect id="h_doc" value={form.doctorCode} disabled={ro} onChange={(v) => set({ doctorCode: v })}
              options={refs.doctors.map((d) => ({ value: d.code, label: `${d.name}${d.isSummary ? " (แพทย์ผู้สรุป)" : ""}` }))} />
          </div>
          <ReadField label="ผู้ตรวจประเมิน" value={meta.auditor} />
          <div className="field">
            <label htmlFor="h_adate">วันที่ตรวจประเมิน</label>
            <input id="h_adate" type="date" value={form.auditDate} min={patient.dischargeIso} disabled={ro}
              onChange={(e) => set({ auditDate: e.target.value })} />
          </div>
          <ReadField label="ครั้งที่" value="1" mono />
        </div>
      </div>

      <div className="strip" role="status" aria-live="polite">
        <div className={`stat ${t.full >= 56 ? "good" : "low"}`}><span className="v">{t.full}</span><span className="l">คะแนนเต็ม (ต้องไม่น้อยกว่า 56)</span></div>
        <div className="stat"><span className="v">{t.sum}</span><span className="l">คะแนนที่ได้</span></div>
        <div className="stat"><span className="v">{t.pct === null ? "–" : `${t.pct.toFixed(2)}%`}</span><span className="l">ร้อยละ</span></div>
        <div className="stat"><span className="v">{t.todo}</span><span className="l">ข้อที่ยังไม่ประเมิน</span></div>
        {!ro && (
          <div className="actions">
            {!completed && <button type="button" disabled={pending} onClick={() => submit("draft")}>บันทึกร่าง</button>}
            <button type="button" className="primary" disabled={pending} onClick={onComplete}>
              {pending ? "กำลังบันทึก…" : completed ? "บันทึกการแก้ไข" : "บันทึกเสร็จ"}
            </button>
          </div>
        )}
        <div className="progress" title="ความคืบหน้าการประเมิน">
          <span style={{ width: `${t.assessCount ? Math.round(((t.assessCount - t.todo) / t.assessCount) * 100) : 100}%` }} />
        </div>
      </div>

      <div className="row">
        <span className="hint">คลิกหัวข้อเพื่อเปิด/ปิด · คลิกปุ่มที่เลือกไว้ซ้ำเพื่อยกเลิก · คะแนนที่บันทึกจริงคำนวณที่เซิร์ฟเวอร์</span>
        <span className="spacer" />
        <button type="button" className="ghost" onClick={() => setOpen(new Set(criteria.map((_, i) => i)))}>เปิดทุกหัวข้อ</button>
        <button type="button" className="ghost" onClick={() => setOpen(new Set())}>ปิดทุกหัวข้อ</button>
      </div>

      <div className="items">
        {criteria.map((c, i) => (
          <ContentItem key={c.contentId} c={c} i={i} it={form.items[i]} ro={ro} isOpen={open.has(i)}
            onToggle={(v) => setOpen((s) => { const n = new Set(s); v ? n.add(i) : n.delete(i); return n; })}
            onStatus={(s) => chooseStatus(i, s)} onCrit={(id, v) => chooseCrit(i, id, v)}
            onDed={(v) => setItem(i, (x) => ({ ...x, ded: v }))} onRemark={(v) => setItem(i, (x) => ({ ...x, remark: v }))} />
        ))}
      </div>

      <div className="panel overall">
        <h2>ประเมินคุณภาพการบันทึกในภาพรวม (Overall finding)</h2>
        {OVERALL.map(([v, label]) => (
          <FancyCheck key={v} id={`ov${v}`} name="overall" value={v} label={label}
            checked={form.overall === v} disabled={ro} onChange={() => set({ overall: v })} />
        ))}
        <div className="field" style={{ marginLeft: 24 }}>
          <label htmlFor="ovSpec">ระบุรายละเอียด {form.overall === "3" && <span style={{ color: "var(--fail)" }}>*</span>}</label>
          <textarea id="ovSpec" rows={2} maxLength={1000} value={form.spec} disabled={ro}
            onChange={(e) => set({ spec: e.target.value, ...(e.target.value && !form.overall ? { overall: "3" } : {}) })} />
          <span className="hint">ห้ามใส่ชื่อ HN หรือเลขบัตรผู้ป่วยในช่องนี้</span>
        </div>
      </div>

      {confirm && (
        <div className="confirm" role="dialog" aria-live="assertive">
          <div>{confirm.text}</div>
          {confirm.needReason && (
            <div className="field">
              <label htmlFor="reason">เหตุผลการแก้ไข <span style={{ color: "var(--fail)" }}>*</span></label>
              <textarea id="reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
              <span className="hint">ห้ามใส่ชื่อ HN หรือเลขบัตรผู้ป่วย</span>
            </div>
          )}
          <div className="row">
            <span className="spacer" />
            <button type="button" onClick={() => setConfirm(null)}>ยกเลิก</button>
            <button type="button" className="primary" disabled={confirm.needReason && !reason.trim()}
              onClick={() => { const c = confirm; setConfirm(null); c.onYes(reason.trim()); }} autoFocus={!confirm.needReason}>
              {confirm.yes}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function ReadField({ label, value, his, mono }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input value={value} readOnly className={mono ? "num" : undefined} />
      {his && <span className="src">จาก HIS</span>}
    </div>
  );
}

function ContentItem({ c, i, it, ro, isOpen, onToggle, onStatus, onCrit, onDed, onRemark }) {
  const s = contentScore(c, it);
  const off = it.status !== "ASSESS";
  const statuses = ["ASSESS", ...(c.allowContentNA ? ["NA"] : []), "MISSING", "NO"];
  const badge = s.excluded ? "NA"
    : it.status === "MISSING" ? `Missing 0/${s.full}`
    : it.status === "NO" ? `No 0/${s.full}`
    : `${s.sum}/${s.full}${s.todo ? ` · เหลือ ${s.todo}` : ""}`;

  return (
    <details className="item" open={isOpen} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary>
        <span className="no">{c.no}</span>
        <span className="sum-title"><h3>{c.titleEn}<small>{c.titleTh}</small></h3></span>
        <span className={`badge ${s.excluded ? "off" : s.todo ? "todo" : "done"}`}>{badge}</span>
      </summary>
      <div className="item-body">
        <div className="status-row" role="group" aria-label={`สถานะหัวข้อ ${c.no}`}>
          <span className="lbl">สถานะ</span>
          {statuses.map((x) => (
            <button key={x} type="button" className="pill" aria-pressed={it.status === x} disabled={ro} onClick={() => onStatus(x)}>
              {CSTATUS[x]}
            </button>
          ))}
        </div>
        {c.hint && <div className="hint">{c.hint}</div>}
        {off && <div className="hint">{CSTATUS_HINT[it.status]}</div>}
        <div className={off ? "disabled-block" : undefined}>
          {c.criteria.map((cr) => {
            const v = it.crit[cr.criterionId];
            const gate = v === "PASS" && cr.no !== s.gatedNos.get(cr.no)?.sig ? s.gatedNos.get(cr.no) : null;
            return (
              <div className="crit" key={cr.criterionId}>
                <span className="cn">{cr.no}</span>
                <div className="ct">
                  {cr.text}
                  {cr.note && <span className="note">{cr.note}</span>}
                  {gate && <span className="gated">ไม่ได้คะแนน: {gate.description}</span>}
                </div>
                <div className="seg" role="group" aria-label={`ผลเกณฑ์ข้อ ${cr.no}`}>
                  {[["PASS", "ผ่าน"], ["FAIL", "ไม่ผ่าน"], ...(cr.allowNA ? [["NA", "NA"]] : [])].map(([val, label]) => (
                    <button key={val} type="button" data-v={val} aria-pressed={v === val} disabled={ro || off}
                      onClick={() => onCrit(cr.criterionId, val)}>{label}</button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="item-foot">
          <div>
            {c.allowDeduction && (
              <FancyCheck id={`ded-${i}`} type="checkbox" checked={it.ded} disabled={ro || off}
                onChange={(e) => onDed(e.target.checked)} label={`บันทึกไม่ต่อเนื่องทุกวันและทุกเวร (หัก ${c.maxDeduction} คะแนน)`} />
            )}
            <div className="hint" style={{ marginTop: 4 }}>
              คะแนนเต็ม <span className="num">{s.excluded ? "–" : s.full}</span> · ได้ <span className="num">{s.excluded ? "–" : s.sum}</span>
            </div>
          </div>
          <div className="field">
            <label htmlFor={`rm-${i}`}>หมายเหตุ <span className="hint">(ห้ามใส่ชื่อ/HN ผู้ป่วย)</span></label>
            <textarea id={`rm-${i}`} rows={2} maxLength={500} value={it.remark} disabled={ro} onChange={(e) => onRemark(e.target.value)} />
          </div>
        </div>
      </div>
    </details>
  );
}
