"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, Select, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";

type Area = { key: string; label: string };
type Role = "admin" | "manager" | "staff";
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

  const startNew = () => {
    setEditing("new");
    setName("");
    setPassword("");
    setRole("manager");
    setPerms(new Set());
    setActive(true);
    setError(null);
  };
  const startEdit = (u: User) => {
    setEditing(u.id);
    setName(u.name);
    setPassword("");
    setRole((["admin", "manager", "staff"].includes(u.role) ? u.role : "manager") as Role);
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
    startTransition(async () => {
      try {
        if (editing === "new") {
          await onCreate({ name: name.trim(), password, role, permissions: Array.from(perms) });
        } else if (editing) {
          await onUpdate(editing, {
            name: name.trim(),
            role,
            permissions: Array.from(perms),
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
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="admin">Admin (full access)</option>
            <option value="manager">Manager</option>
            <option value="staff">Staff</option>
          </Select>
        </Field>
        {editing !== "new" && (
          <Field label="Status">
            <Select value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}>
              <option value="1">Active</option>
              <option value="0">Disabled (can't log in)</option>
            </Select>
          </Field>
        )}
      </div>

      {role === "admin" ? (
        <div className="mt-3 text-[12px] text-slate-500">
          Admins can see and do everything, including revenue and user management.
        </div>
      ) : (
        <div className="mt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Areas this user can access
          </div>
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
          const isAdminRole = u.role === "admin" || u.role === "owner";
          return (
            <Card key={u.id} className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-ink text-white flex items-center justify-center text-[13px] font-bold">
                {u.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-bold text-ink truncate">{u.name}</span>
                  <Pill tone={isAdminRole ? "dark" : "slate"}>{u.role}</Pill>
                  {!u.active && <Pill tone="red">disabled</Pill>}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {isAdminRole
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
