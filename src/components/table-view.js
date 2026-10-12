// ตารางแทนกราฟ (server component: รับ format เป็นฟังก์ชันได้)
export default function TableView({ columns, rows }) {
  return (
    <details className="tableview">
      <summary>ดูเป็นตาราง</summary>
      <div className="tbl" style={{ maxHeight: "none" }}>
        <table>
          <thead><tr>{columns.map((c) => <th key={c.key} className={c.num ? "r" : undefined}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>{columns.map((c) => <td key={c.key} className={c.num ? "r num" : undefined}>{c.format ? c.format(r[c.key], r) : r[c.key]}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

