import { NextRequest, NextResponse } from "next/server";

// Single shared-password gate (Next 16 "proxy" convention, formerly middleware).
// Cookie `radar_auth` must equal APP_PASSWORD. Not cryptographically strong —
// just keeps the demo link private.
export function proxy(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  // If no password configured, leave the app open.
  if (!password) return NextResponse.next();

  const cookie = req.cookies.get("radar_auth")?.value;
  if (cookie === password) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/gate";
  url.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Gate everything except the gate page, its API, and static assets.
  matcher: ["/((?!gate|api/gate|_next/static|_next/image|favicon.ico).*)"],
};
