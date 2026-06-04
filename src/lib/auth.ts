import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { prisma } from "./db";

const COOKIE_NAME = "rd_session";
const ALGO = "HS256";

function getSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET not set");
  return new TextEncoder().encode(s);
}

export type Session = { userId: string; name: string; role: string };

export async function createSession(s: Session) {
  const token = await new SignJWT({ ...s })
    .setProtectedHeader({ alg: ALGO })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getSecret());
  const c = await cookies();
  // Set COOKIE_SECURE=true in your env when deploying behind HTTPS.
  // On localhost HTTP, leaving it off avoids "no cookie sent" issues with
  // some browser/environment combos that don't honour the localhost exception.
  c.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    secure: process.env.COOKIE_SECURE === "true",
  });
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
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: [ALGO] });
    return {
      userId: payload.userId as string,
      name: payload.name as string,
      role: payload.role as string,
    };
  } catch (e) {
    console.log("[auth] jwt verify failed:", (e as Error).message);
    return null;
  }
}

// Helper to add to server actions when debugging — logs the action name + whether the cookie is present.
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

export async function verifyPin(pin: string): Promise<Session | null> {
  const owner = await prisma.user.findFirst({
    where: { role: { in: ["admin", "owner"] } },
  });
  if (!owner) return null;
  const ok = await bcrypt.compare(pin, owner.pinHash);
  if (!ok) return null;
  return { userId: owner.id, name: owner.name, role: owner.role };
}
