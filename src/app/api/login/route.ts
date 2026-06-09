import { NextResponse } from "next/server";
import { verifyPin, signSession, sessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/auth";

// Classic form-POST login. Setting the session cookie directly on a redirect
// response here is the most reliable path in every browser — unlike a Server
// Action that sets a cookie and then redirect()s, where Chrome may render the
// destination but not persist the Set-Cookie (you "see" the dashboard, then
// get bounced on the next click because no cookie was actually stored).
export async function POST(req: Request) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "").trim();

  if (!password) {
    return NextResponse.redirect(new URL("/login?error=missing", req.url), 303);
  }

  const session = await verifyPin(password);
  if (!session) {
    return NextResponse.redirect(new URL("/login?error=invalid", req.url), 303);
  }

  const token = await signSession(session);
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions());
  return res;
}
