"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "เคสรอตรวจ", match: (p) => p === "/" || p.startsWith("/audit") },
  { href: "/sampling", label: "สุ่มรายชื่อ", match: (p) => p.startsWith("/sampling") },
  { href: "/dashboard", label: "Dashboard", match: (p) => p.startsWith("/dashboard") },
  { href: "/reports", label: "รายงาน", match: (p) => p.startsWith("/reports") },
];

export default function NavTabs() {
  const path = usePathname();
  return (
    <nav className="tabs" aria-label="เมนูหลัก">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.match(path) ? "page" : undefined} style={{ textDecoration: "none" }}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
