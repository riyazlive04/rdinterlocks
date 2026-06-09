import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";

// Logout is a STATE-CHANGING action, so it must only happen on POST. If it ran
// on GET, Next.js's automatic <Link> prefetch would fetch /logout on page load
// and silently clear the session — logging the user out before they click
// anything. The UI now posts to this route via a form button.
export async function POST(req: Request) {
  await clearSession();
  return NextResponse.redirect(new URL("/login", req.url), 303);
}

// A bare GET (stray prefetch, bookmark, crawler) must NOT clear the session.
// Just send them to /login; if still logged in, /login bounces back to "/".
export function GET(req: Request) {
  return NextResponse.redirect(new URL("/login", req.url), 303);
}
