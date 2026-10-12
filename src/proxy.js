import { NextResponse } from "next/server";

// ตรวจเบื้องต้นว่ามี cookie session หรือไม่ (ตรวจจริงทำใน requireUser ทุกหน้า/ทุก action)
export function proxy(request) {
  if (!request.cookies.has("mra_session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
