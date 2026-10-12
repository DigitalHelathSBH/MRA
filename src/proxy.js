import { NextResponse } from "next/server";

// ตรวจเบื้องต้นว่ามี cookie session หรือไม่ (ตรวจจริงทำใน requireUser ทุกหน้า/ทุก action)
export function proxy(request) {
  if (!request.cookies.has("mra_session")) {
    const url = request.nextUrl.clone(); // clone เก็บ basePath (เช่น /mra) ไว้ให้
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
