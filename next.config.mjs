/** @type {import('next').NextConfig} */
const nextConfig = {
  // ไม่เปิด cacheComponents: ทุกหน้าอ่านข้อมูลผู้ป่วยตาม request และห้าม cache ฝั่งเซิร์ฟเวอร์
  output: "standalone",
  // เว็บอยู่ใต้ path ย่อย เช่น /mra (กำหนดตอน build ด้วย BASE_PATH · เครื่องพัฒนาเว้นว่าง)
  basePath: process.env.BASE_PATH || "",
  poweredByHeader: false,
  // ให้ mssql/tedious โหลดจาก node_modules ชุดเดียว (ถ้า bundle แยกหน้า/route จะได้ 2 ชุด
  // แล้ว connection pool ที่แชร์ผ่าน globalThis ใช้ชนิดข้อมูลข้ามชุดไม่ได้ → "validate is not a function")
  serverExternalPackages: ["mssql", "tedious"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/((?!_next/static|_next/image|api/chart).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
      {
        // เวชระเบียนสแกน: ให้แสดงใน iframe ของหน้าแบบตรวจ (เว็บเดียวกัน) ได้
        source: "/api/chart/:an",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
