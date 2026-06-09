import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Edge middleware: validate the session cookie on EVERY app request in one
// place, so auth behaves consistently (no "looks logged in but isn't" state).
// If the cookie is missing or can't be verified, redirect to /login. We do NOT
// clear the cookie on redirect — see the note below for why that caused
// spurious logouts.

const COOKIE_NAME = "rd_session";
const ALGO = "HS256";

function verifySecrets(): Uint8Array[] {
  const enc = (v: string) => new TextEncoder().encode(v);
  const list: Uint8Array[] = [];
  if (process.env.SESSION_SECRET) list.push(enc(process.env.SESSION_SECRET));
  if (process.env.SESSION_SECRET_OLD) list.push(enc(process.env.SESSION_SECRET_OLD));
  return list;
}

async function isValid(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  for (const secret of verifySecrets()) {
    try {
      await jwtVerify(token, secret, { algorithms: [ALGO] });
      return true;
    } catch {
      // try next secret
    }
  }
  return false;
}

export async function middleware(req: NextRequest) {
  // Fail-safe: if the secret isn't available to the edge runtime, do NOT lock
  // everyone out — let the request through and rely on page-level auth.
  if (verifySecrets().length === 0) return NextResponse.next();

  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (await isValid(token)) return NextResponse.next();

  // Diagnostic: shows in Vercel runtime logs which case bounced the user.
  console.log(
    `[mw] redirect ${req.nextUrl.pathname} -> /login (${token ? "invalid-token" : "no-cookie"})`
  );

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  // IMPORTANT: do NOT delete the cookie here. Next.js fires background RSC
  // prefetch requests; if one transiently fails validation, deleting the
  // cookie on that response wipes a still-valid session and logs the user out
  // on their next click. A fresh login overwrites the cookie anyway.
  return NextResponse.redirect(url);
}

export const config = {
  // Protect everything except the login/logout routes, API routes, Next
  // internals, and static files (anything with a dot in the path).
  matcher: ["/((?!api|_next|login|logout|.*\\..*).*)"],
};
