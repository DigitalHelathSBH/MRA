// คิดคะแนนฝั่งหน้าจอ (แสดงผลทันที) ให้ตรงกับ mra.vw_AuditContentScore
// คะแนนที่บันทึกจริงคำนวณที่เซิร์ฟเวอร์ด้วย mra.usp_RecalculateAuditScore

// item = { status: 'ASSESS'|'NA'|'MISSING'|'NO', ded: bool, crit: { [criterionId]: 'PASS'|'FAIL'|'NA' } }
export function contentScore(content, item) {
  const n = content.criteria.length;
  if (item.status === "NA") return { excluded: true, full: 0, sum: 0, todo: 0, gatedNos: new Map() };
  if (item.status !== "ASSESS") return { excluded: false, full: n, sum: 0, todo: 0, gatedNos: new Map() };

  const resultByNo = new Map(content.criteria.map((c) => [c.no, item.crit[c.criterionId] ?? null]));
  const gatedNos = new Map(); // criterionNo -> gate ที่ทำให้ไม่ได้คะแนน
  for (const g of content.gates) {
    if (resultByNo.get(g.sig) === "FAIL") {
      for (let no = g.from; no <= g.to; no++) if (!gatedNos.has(no)) gatedNos.set(no, g);
    }
  }

  let full = 0, todo = 0, pass = 0;
  for (const [no, v] of resultByNo) {
    if (v !== "NA") full++;
    if (v === null) todo++;
    if (v === "PASS" && !gatedNos.has(no)) pass++;
  }
  const deduction = content.allowDeduction && item.ded ? content.maxDeduction : 0;
  return { excluded: false, full, sum: Math.max(0, pass - deduction), todo, gatedNos };
}

export function totalScore(contents, items) {
  let full = 0, sum = 0, todo = 0, assessCount = 0;
  contents.forEach((c, i) => {
    const s = contentScore(c, items[i]);
    full += s.full;
    sum += s.sum;
    todo += s.todo;
    if (items[i].status === "ASSESS") assessCount += c.criteria.length;
  });
  return { full, sum, todo, pct: full ? (sum * 100) / full : null, assessCount };
}
