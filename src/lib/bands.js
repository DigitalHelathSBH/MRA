// เกณฑ์ระดับคะแนนของ dashboard (ใช้ได้ทั้งฝั่ง server และ client)
export const BANDS = [
  { key: "excellent", min: 90, label: "ดีมาก", icon: "★" },
  { key: "good", min: 80, label: "ดี", icon: "✓" },
  { key: "fair", min: 70, label: "พอใช้", icon: "!" },
  { key: "poor", min: 0, label: "ต้องปรับปรุง", icon: "✕" },
];

export function bandOf(pct) {
  if (pct == null) return null;
  return BANDS.find((b) => pct >= b.min);
}

export function bandRangeText(b, i) {
  if (i === 0) return `≥ ${b.min}%`;
  if (b.min === 0) return `< ${BANDS[i - 1].min}%`;
  return `${b.min}–${BANDS[i - 1].min - 1}%`;
}
