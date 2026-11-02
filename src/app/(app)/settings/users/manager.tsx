"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Select, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";
import { DEFAULT_AREAS_BY_ROLE } from "@/lib/access";
import { ROLES, isFullAccess, roleLabel, type Role } from "@/lib/roles";

type Area = { key: string; label: string };
type User = {
  id: string;
  name: string;
  role: string;
  active: boolean;
  permissions: string[];
};

type CreateData = { name: string; password: string; role: Role; permissions: string[] };
type UpdateData = {
  name: string;
  role: Role;
  permissions: string[];
  active: boolean;
  password?: string;
};

// Two role strings share the label "Owner" (admin is the legacy spelling of
// owner), so the raw key is appended when it differs from the label. That
// keeps all six of ROLES selectable without two identical options.
function roleOptionLabel(r: Role): string {
  const label = roleLabel(r);
  return label.toLowerCase() === r ? label : `${label} (${r})`;
}

export function UsersManager({
  areas,
  users,
  onCreate,
  onUpdate,
  onDelete,
}: {
  areas: Area[];
  users: User[];
  onCreate: (d: CreateData) => Promise<void>;
  onUpdate: (id: string, d: UpdateData) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("manager");
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const defaultsFor = (r: Role) => DEFAULT_AREAS_BY_ROLE[r] ?? [];

  /**
   * Picking a role suggests that role's default areas — it never imposes
   * them.
   *
   * For a NEW user the defaults are applied straight away: there is nothing
   * to lose, and the owner watches the checkboxes fill in, so the change is
   * visible before they save. For an EXISTING user nothing is touched —
   * their areas were set by hand at some point and silently replacing them
   * on a role change would be a quiet data loss. Instead the defaults are
   * offered as a button below, which the owner can press and then edit.
   */
  const changeRole = (next: Role) => {
    setRole(next);
    if (editing === "new") setPerms(new Set(defaultsFor(next)));
  };

  const applyDefaults = () => setPerms(new Set(defaultsFor(role)));

  const startNew = () => {
    setEditing("new");
    setName("");
    setPassword("");
    setRole("manager");
    setPerms(new Set(defaultsFor("manager")));
    setActive(true);
    setError(null);
  };
  const startEdit = (u: User) => {
    setEditing(u.id);
    setName(u.name);
    setPassword("");
    setRole((ROLES.includes(u.role as Role) ? u.role : "staff") as Role);
    setPerms(new Set(u.permissions));
    setActive(u.active);
    setError(null);
  };
  const cancel = () => {
    setEditing(null);
    setError(null);
  };

  const togglePerm = (k: string) =>
    setPerms((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const save = () => {
    setError(null);
    if (!name.trim()) return setError("Name is required");
    if (editing === "new" && password.length < 4)
      return setError("Set a password (min 4 characters)");
    // A full-access role never stores per-area grants (isAdmin short-circuits
    // can()), so don't carry the previous role's areas across with it — e.g.
    // promoting a telecaller to manager would otherwise file their old leads
    // grant under a manager who needs none of it.
    const permissions = isFullAccess(role) ? [] : Array.from(perms);
    startTransition(async () => {
      try {
        if (editing === "new") {
          await onCreate({ name: name.trim(), password, role, permissions });
        } else if (editing) {
          await onUpdate(editing, {
            name: name.trim(),
            role,
            permissions,
            active,
            password: password.length >= 4 ? password : undefined,
          });
        }
        setEditing(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  };

  const remove = (u: User) => {
    if (!confirm(`Delete login for ${u.name}?`)) return;
    startTransition(async () => {
      try {
        await onDelete(u.id);
        router.refresh();
      } catch (e) {
        alert(e instanceof Error ? e.message : "Delete failed");
      }
    });
  };

  // What the current role's defaults would add or remove, so the owner can
  // see what the button does before pressing it.
  const suggested = defaultsFor(role);
  const defaultsDiffer =
    suggested.length > 0 &&
    (suggested.length !== perms.size || suggested.some((k) => !perms.has(k)));

  const form = (
    <Card className="border-2 border-brand-red/30">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Manager" autoFocus />
        </Field>
        <Field
          label={editing === "new" ? "Password" : "New password (leave blank to keep)"}
          hint="They log in with this password."
        >
          <Input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={editing === "new" ? "min 4 characters" : "unchanged"}
          />
        </Field>
        <Field
          label="Role"
          hint="The role also decides who can assign them tasks: work only flows downward."
        >
          {/* All six roles from lib/roles.ts — supervisor included, which
              this dropdown used to be unable to express. */}
          <Select value={role} onChange={(e) => changeRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {roleOptionLabel(r)}
                {isFullAccess(r) ? " · full access" : ""}
              </option>
            ))}
          </Select>
        </Field>
        {editing !== "new" && (
          <Field label="Status">
            <Select value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}>
              <option value="1">Active</option>
              <option value="0">Disabled (can&apos;t log in)</option>
            </Select>
          </Field>
        )}
      </div>

      {isFullAccess(role) ? (
        <div className="mt-3 text-[12px] text-slate-500">
          {roleLabel(role)}s can see and do everything, including revenue and user management.
          Per-area grants are not stored for them.
        </div>
      ) : (
        <div className="mt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Areas this user can access
          </div>

          {/* The defaults are a starting point, never enforced — and for an
              existing user they are applied only when the owner asks, so a
              role change can't quietly wipe areas granted by hand. */}
          {defaultsDiffer && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-brand-blueLight/60 border border-brand-blue/20 px-2.5 py-2">
              <span className="text-[12px] text-ink">
                Usual areas for a {roleLabel(role)}:{" "}
                <strong>
                  {suggested
                    .map((k) => areas.find((a) => a.key === k)?.label ?? k)
                    .join(", ")}
                </strong>
              </span>
              <Button onClick={applyDefaults} variant="secondary" size="sm">
                Use these
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {areas.map((a) => {
              const on = perms.has(a.key);
              return (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => togglePerm(a.key)}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-[12px] border transition ${
                    on
                      ? "bg-brand-redLight border-brand-red/40 text-ink font-semibold"
                      : "bg-white border-slate-200 text-slate-600 hover:border-slate-400"
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded flex items-center justify-center ${
                      on ? "bg-brand-red text-white" : "bg-slate-100"
                    }`}
                  >
                    {on && <Icon.Check size={11} stroke={2.6} />}
                  </span>
                  {a.label}
                </button>
              );
            })}
          </div>
          <div className="text-[11px] text-slate-400 mt-2">
            Tip: leave <strong>&quot;See revenue, profit &amp; cash totals&quot;</strong> off to hide all
            money/profit figures from this user.
          </div>
        </div>
      )}

      {error && <div className="text-xs text-red-600 mt-3">{error}</div>}
      <div className="flex gap-2 mt-4">
        <Button onClick={save} disabled={isPending} variant="primary">
          {isPending ? "Saving…" : editing === "new" ? "Create user" : "Save changes"}
        </Button>
        <Button onClick={cancel} variant="ghost">
          Cancel
        </Button>
      </div>
    </Card>
  );

  return (
    <div className="space-y-3">
      {editing && form}

      {!editing && (
        <div className="flex justify-end">
          <Button onClick={startNew} variant="primary" size="sm">
            <Icon.Plus size={14} stroke={2.4} /> Add user
          </Button>
        </div>
      )}

      <div className="space-y-2">
        {users.map((u) => {
          const unrestricted = isFullAccess(u.role);
          return (
            <Card key={u.id} className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-ink text-white flex items-center justify-center text-[13px] font-bold">
                {u.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-bold text-ink truncate">{u.name}</span>
                  <Pill tone={unrestricted ? "dark" : "slate"}>{roleLabel(u.role)}</Pill>
                  {!u.active && <Pill tone="red">disabled</Pill>}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {unrestricted
                    ? "Full access"
                    : u.permissions.length === 0
                      ? "No areas yet"
                      : `${u.permissions.length} area${u.permissions.length === 1 ? "" : "s"}${
                          u.permissions.includes("revenue") ? " · sees revenue" : " · no revenue"
                        }`}
                </div>
              </div>
              <button
                onClick={() => startEdit(u)}
                className="w-8 h-8 rounded-md hover:bg-slate-100 flex items-center justify-center text-slate-600"
                aria-label="Edit"
              >
                <Icon.Pencil size={15} />
              </button>
              <button
                onClick={() => remove(u)}
                className="w-8 h-8 rounded-md hover:bg-red-50 flex items-center justify-center text-red-600"
                aria-label="Delete"
              >
                <Icon.Trash size={15} />
              </button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
