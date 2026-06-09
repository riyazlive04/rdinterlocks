import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { can, isAdmin } from "./access";

const COOKIE_NAME = "rd_session";
const ALGO = "HS256";

// Secret used to SIGN new sessions.
function getSigningSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET not set");
  return new TextEncoder().encode(s);
}

// Secrets accepted when VERIFYING an existing session. Includes the current
// secret plus an optional previous one (SESSION_SECRET_OLD), so rotating the
// secret — or a deploy briefly seeing a different value — does NOT instantly
// log everyone out. Old cookies keep working until they naturally expire.
function getVerifySecrets() {
  const enc = (v: string) => new TextEncoder().encode(v);
  const list: Uint8Array[] = [];
  if (process.env.SESSION_SECRET) list.push(enc(process.env.SESSION_SECRET));
  if (process.env.SESSION_SECRET_OLD) list.push(enc(process.env.SESSION_SECRET_OLD));
  if (list.length === 0) throw new Error("SESSION_SECRET not set");
  return list;
}

// HTTPS-only cookie on Vercel (and any production deploy) by default, so the
// session is sent reliably. Honour COOKIE_SECURE if it is explicitly set;
// otherwise fall back to "secure in production, plain on local dev".
function cookieSecure() {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;
  return process.env.NODE_ENV === "production";
}

export type Session = {
  userId: string;
  name: string;
  role: string;
  permissions: string[];
};

// Sign a session into a JWT string. Exposed so a Route Handler can set the
// cookie directly on its redirect response (the most reliable cross-browser
// path) instead of relying on Server-Action cookie persistence.
export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ ...s })
    .setProtectedHeader({ alg: ALGO })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getSigningSecret());
}

// The cookie attributes used everywhere we set rd_session. Shared so the
// Route Handler and createSession() are byte-for-byte identical.
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    secure: cookieSecure(),
  };
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;

export async function createSession(s: Session) {
  const token = await signSession(s);
  const c = await cookies();
  c.set(COOKIE_NAME, token, sessionCookieOptions());
}

export async function clearSession() {
  const c = await cookies();
  c.delete(COOKIE_NAME);
}

export async function getSession(): Promise<Session | null> {
  const c = await cookies();
  const token = c.get(COOKIE_NAME)?.value;
  if (!token) {
    console.log("[auth] no rd_session cookie sent");
    return null;
  }
  for (const secret of getVerifySecrets()) {
    try {
      const { payload } = await jwtVerify(token, secret, { algorithms: [ALGO] });
      return {
        userId: payload.userId as string,
        name: payload.name as string,
        role: payload.role as string,
        permissions: (payload.permissions as string[] | undefined) ?? [],
      };
    } catch {
      // try the next accepted secret
    }
  }
  console.log("[auth] jwt verify failed against all known secrets");
  return null;
}

// Helper to add to server actions when debugging - logs the action name + whether the cookie is present.
export async function debugSessionInAction(actionName: string) {
  const c = await cookies();
  const has = !!c.get(COOKIE_NAME)?.value;
  console.log(`[auth] action=${actionName} cookie=${has ? "yes" : "NO"}`);
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

// Require access to a given area; admin always passes. Redirects to the
// dashboard if the logged-in user lacks the area.
export async function requireArea(area: string): Promise<Session> {
  const s = await requireSession();
  if (!can(s, area)) redirect("/");
  return s;
}

export async function requireAdmin(): Promise<Session> {
  const s = await requireSession();
  if (!isAdmin(s.role)) redirect("/");
  return s;
}

// Password-only login: match the entered password against every active user
// (admin should keep passwords unique). Returns the matching user's session.
export async function verifyPin(pin: string): Promise<Session | null> {
  const users = await prisma.user.findMany({ where: { active: true } });
  for (const u of users) {
    if (await bcrypt.compare(pin, u.pinHash)) {
      return { userId: u.id, name: u.name, role: u.role, permissions: u.permissions };
    }
  }
  return null;
}
