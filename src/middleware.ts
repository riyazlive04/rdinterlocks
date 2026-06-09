import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Edge middleware: validate the session cookie on EVERY app request in one
// place, so auth behaves consistently (no "looks logged in but isn't" state).
// If the cookie is missing or can't be verified, redirect to /login AND clear
// the bad cookie so the next login starts clean.

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
  const res = NextResponse.redirect(url);
  // Clear the invalid cookie so re-login is clean.
  if (token) res.cookies.delete(COOKIE_NAME);
  return res;
}

export const config = {
  // Protect everything except the login/logout routes, API routes, Next
  // internals, and static files (anything with a dot in the path).
  matcher: ["/((?!api|_next|login|logout|.*\\..*).*)"],
};
