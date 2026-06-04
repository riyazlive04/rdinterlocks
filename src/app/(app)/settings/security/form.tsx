"use client";
import { useState, useTransition } from "react";
import { Button, Card, Field, Input } from "@/components/ui";

export function SecurityForm({
  onSave,
}: {
  onSave: (d: { current: string; next: string }) => Promise<void>;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    setSaved(false);
    if (!current) return setError("Enter current password");
    if (next.length < 4) return setError("New password must be at least 4 characters");
    if (next !== confirm) return setError("Passwords don't match");
    startTransition(async () => {
      try {
        await onSave({ current, next });
        setSaved(true);
        setCurrent("");
        setNext("");
        setConfirm("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  };

  return (
    <Card className="max-w-md">
      <div className="space-y-3">
        <Field label="Current password">
          <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
        </Field>
        <Field label="New password">
          <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Confirm new password">
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
      </div>
      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
      {saved && <div className="text-xs text-emerald-700 mt-2">✓ Password changed</div>}
      <div className="mt-4">
        <Button onClick={submit} disabled={isPending} variant="primary">
          {isPending ? "Saving…" : "Change password"}
        </Button>
      </div>
    </Card>
  );
}
