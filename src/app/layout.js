import { Anuphan, IBM_Plex_Sans_Thai, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const anuphan = Anuphan({ variable: "--font-anuphan", subsets: ["thai", "latin"], weight: ["500", "600", "700"] });
const plexThai = IBM_Plex_Sans_Thai({ variable: "--font-plex-thai", subsets: ["thai", "latin"], weight: ["400", "500", "600"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["500"] });

export const metadata = {
  title: "MRA IPD รพ.สระบุรี",
  description: "ระบบตรวจประเมินคุณภาพการบันทึกเวชระเบียนผู้ป่วยใน",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return (
    <html lang="th" className={`${anuphan.variable} ${plexThai.variable} ${plexMono.variable}`}>
      <body>
        {/* filter สำหรับเอฟเฟกต์กระเด็นของ radio/checkbox (components/fancy-check.js) */}
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
          <defs>
            <filter id="goo">
              <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
              <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -7" result="goo" />
              <feBlend in="SourceGraphic" in2="goo" />
            </filter>
          </defs>
        </svg>
        {children}
      </body>
    </html>
  );
}
