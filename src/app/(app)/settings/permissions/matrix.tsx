"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, Pill } from "@/components/ui";
import { roleLabel } from "@/lib/roles";

type AreaGroup = { key: string; label: string; areas: Array<{ key: string; label: string }> };

export type PermUser = {
  id: string;
  name: string;
  role: string;
  active: boolean;
  permissions: string[];
  /** Everything via isAdmin — per-area grants are not stored for them. */
  fullAccess: boolean;
  /** False when this row may not be edited by the signed-in user, with why. */
  editable: boolean;
  lockedReason: string;
};

/**
 * Who can open what, as a grid.
 *
 * The per-user editor on Settings → Users & access already does one person at
 * a time. What it cannot answer is "who can see the cashbook?" — that meant
 * opening every login in turn and remembering. Here it is one column.
 */
export function PermissionMatrix({
  users,
  groups,
  onToggle,
}: {
  users: PermUser[];
  groups: AreaGroup[];
  onToggle: (userId: string, area: string, granted: boolean) => Promise<void>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Optimistic local state, so a row of toggles feels like checkboxes rather
  // than a round trip each. Reconciled by router.refresh() below.
  const [local, setLocal] = useState<Record<string, Set<string>>>(() =>
    Object.fromEntries(users.map((u) => [u.id, new Set(u.permissions)]))
  );

  const toggle = (user: PermUser, area: string) => {
    if (!user.editable || user.fullAccess) return;
    const held = local[user.id] ?? new Set<string>();
    const granted = !held.has(area);

    setError(null);
    setLocal((s) => {
      const next = new Set(s[user.id] ?? []);
      if (granted) next.add(area);
      else next.delete(area);
      return { ...s, [user.id]: next };
    });

    startTransition(async () => {
      try {
        await onToggle(user.id, area, granted);
        router.refresh();
      } catch (e) {
        // Put the box back where it was — the server refused, so the screen
        // must not keep showing a grant that does not exist.
        setLocal((s) => {
          const next = new Set(s[user.id] ?? []);
          if (granted) next.delete(area);
          else next.add(area);
          return { ...s, [user.id]: next };
        });
        setError(e instanceof Error ? e.message : "Could not change that grant");
      }
    });
  };

  const totalAreas = groups.reduce((n, g) => n + g.areas.length, 0);

  return (
    <>
      {error && (
        <div
          role="alert"
          className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-800"
        >
          {error}
        </div>
      )}

      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="text-[12px] border-collapse">
            <caption className="sr-only">
              Each row is a login, each column an area of the app. A ticked box
              means that person can open it.
            </caption>
            <thead>
              {/* Group header row, so the columns read in the same order as
                  the menu the grant actually controls. */}
              <tr className="border-b border-slate-200">
                <th
                  scope="col"
                  className="sticky left-0 z-10 bg-white text-left px-3 py-2 min-w-[180px]"
                >
                  <span className="sr-only">User</span>
                </th>
                {groups.map((g) => (
                  <th
                    key={g.key}
                    scope="colgroup"
                    colSpan={g.areas.length}
                    className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 border-l border-slate-200"
                  >
                    {g.label}
                  </th>
                ))}
              </tr>
              <tr className="border-b border-slate-200 bg-slate-50/60">
                <th
                  scope="col"
                  className="sticky left-0 z-10 bg-slate-50 text-left px-3 py-2 font-semibold text-slate-600"
                >
                  Login
                </th>
                {groups.flatMap((g) =>
                  g.areas.map((a, i) => (
                    <th
                      key={a.key}
                      scope="col"
                      className={
                        "px-1.5 py-2 align-bottom " + (i === 0 ? "border-l border-slate-200" : "")
                      }
                    >
                      {/* Rotated so 22 columns fit without a horizontal
                          scroll on a laptop. Still real header text. */}
                      <div
                        className="whitespace-nowrap text-[11px] font-medium text-slate-600"
                        style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                      >
                        {a.label}
                      </div>
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const held = local[u.id] ?? new Set<string>();
                return (
                  <tr key={u.id} className="border-b border-slate-100 last:border-0">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-white text-left px-3 py-2 font-normal"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-bold text-ink">{u.name}</span>
                        {!u.active && <Pill tone="slate">disabled</Pill>}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {roleLabel(u.role)}
                        {u.fullAccess ? " · sees everything" : ` · ${held.size}/${totalAreas}`}
                      </div>
                      {!u.editable && (
                        <div className="text-[10px] text-slate-400">{u.lockedReason}</div>
                      )}
                    </th>

                    {u.fullAccess ? (
                      <td
                        colSpan={totalAreas}
                        className="px-3 py-2 text-[12px] text-slate-500 border-l border-slate-200"
                      >
                        {roleLabel(u.role)}s see and do everything, so no per-area
                        grants are stored for them.{" "}
                        <Link href="/settings/users" className="underline hover:text-ink">
                          Change their role
                        </Link>{" "}
                        to restrict them.
                      </td>
                    ) : (
                      groups.flatMap((g) =>
                        g.areas.map((a, i) => (
                          <td
                            key={a.key}
                            className={
                              "px-1.5 py-2 text-center " +
                              (i === 0 ? "border-l border-slate-200" : "")
                            }
                          >
                            <input
                              type="checkbox"
                              checked={held.has(a.key)}
                              disabled={!u.editable || isPending}
                              onChange={() => toggle(u, a.key)}
                              /* Names both ends, so a screen reader can place
                                 the cell without reading the whole grid. */
                              aria-label={`${a.label} for ${u.name}`}
                              className="w-4 h-4 accent-brand-red cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                            />
                          </td>
                        ))
                      )
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-3 text-[12px] text-slate-500">
        A change takes effect on the person&apos;s next page load — sessions are
        re-checked on every request, so revoking an area does not wait for them
        to sign out. Creating a login, setting a role or disabling an account is
        on{" "}
        <Link href="/settings/users" className="underline hover:text-ink">
          Users &amp; access
        </Link>
        .
      </div>
    </>
  );
}
