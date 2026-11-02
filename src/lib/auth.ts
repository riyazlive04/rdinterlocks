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
      const userId = payload.userId as string;

      // Re-read the user on every request instead of trusting the token's
      // copy of their role and areas.
      //
      // The JWT lives for 30 days and used to be the sole authority, which
      // meant the only remedies the UI offers did nothing to an open tab:
      // demoting a manager, withdrawing a telecaller's grants, deactivating
      // an account or deleting it outright all left that cookie working at
      // its original rank until it expired. With a manager now able to
      // approve payments — creating orders and writing to the cashbook — and
      // to mint new logins, a compromised or dismissed manager could not be
      // shut out at all. deleteUser's own comment worried about exactly this
      // orphaned cookie.
      //
      // The cost is one indexed primary-key lookup per request, which for a
      // factory with a handful of staff is not worth trading away revocation
      // for. If this ever needs to scale, the shape to move to is a
      // sessionVersion on User bumped on any role/permission/active change
      // and compared against a claim — not going back to trusting the token.
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, role: true, permissions: true, active: true },
      });
      if (!user || !user.active) {
        console.warn(`[auth] session rejected: user ${userId} is ${user ? "deactivated" : "gone"}`);
        return null;
      }

      return {
        userId: user.id,
        name: user.name,
        role: user.role,
        permissions: user.permissions,
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

/**
 * For a Server Action reachable from more than one area's screens — holding
 * EITHER area is enough.
 *
 * Three actions are shared across areas: deleteLoadingCharge (the loading page
 * and the client's charge list), createDailyProduction (the daily-entry sheet
 * and production), and setDeliveryDone (the deliveries list and sales).
 * Gating those on a single area would lock out the other screen's legitimate
 * users — e.g. a supervisor with `day` but not `production` could no longer
 * save the daily entry.
 */
export async function requireAnyArea(areas: string[]): Promise<Session> {
  const s = await requireSession();
  if (!areas.some((a) => can(s, a))) redirect("/");
  return s;
}

export async function requireAdmin(): Promise<Session> {
  const s = await requireSession();
  if (!isAdmin(s.role)) redirect("/");
  return s;
}

/**
 * Owner/admin OR manager — the archive console, which both run.
 *
 * Now exactly equivalent to requireAdmin(), because isAdmin() covers manager
 * since the two roles were given the same access. Kept rather than collapsed
 * for two reasons: its five call sites say what they mean at a glance, and
 * if the owner/manager split is ever reintroduced this is the seam where it
 * belongs. The redundant `role !== "manager"` arm is gone — it could never
 * fire, which made the condition read as though it still did something.
 */
export async function requireAdminOrManager(): Promise<Session> {
  const s = await requireSession();
  if (!isAdmin(s.role)) redirect("/");
  return s;
}

// Username + password login. Matches the name (case-insensitive) AND the
// password against active users. If name is blank, falls back to matching by
// password alone (so an empty name field still works). Returns the session.
/**
 * Name + password. BOTH are required.
 *
 * This used to skip the name comparison whenever `name` was empty, which
 * turned a blank name into a password-only login against every active user:
 * the first account whose hash matched was returned, owner included. With a
 * four-character minimum password that is a guessing game against the whole
 * table with no username to find first, and the legitimate user who simply
 * left the name blank could land in a stranger's account that happened to
 * share their password.
 *
 * The name is now the first factor again — one user is looked up by it, and
 * the password is compared against that single hash.
 */
export async function verifyLogin(name: string, password: string): Promise<Session | null> {
  const target = name.trim().toLowerCase();
  if (!target || !password) return null;

  // Names are unique case-insensitively (enforced in settings/actions.ts), so
  // this matches at most one row. Compared in JS rather than with an SQL
  // `mode: "insensitive"` filter so pre-existing rows that differ only by
  // case still resolve the same way the old code did.
  const users = await prisma.user.findMany({ where: { active: true } });
  const u = users.find((x) => x.name.trim().toLowerCase() === target);
  if (!u) {
    // Compare against a dummy hash anyway so an unknown name and a wrong
    // password take the same time; otherwise the response time says which
    // names exist.
    await bcrypt.compare(password, "$2a$10$ynUDPBtHbJbtY9vRcLEKsetY9d0nJ0xHRTCMKmpNCGJg6hQqBkbtK");
    return null;
  }

  if (!(await bcrypt.compare(password, u.pinHash))) return null;
  return { userId: u.id, name: u.name, role: u.role, permissions: u.permissions };
}

/**
 * Retired. It called verifyLogin("", pin), which is exactly the
 * password-only path described above; keeping it as a working alias would
 * leave the bypass reachable from anywhere that still imported it. It now
 * always fails, so any forgotten caller stops authenticating rather than
 * silently authenticating the wrong person.
 */
export async function verifyPin(_pin: string): Promise<Session | null> {
  console.warn("[auth] verifyPin is retired — a login needs a name as well as a password.");
  return null;
}
