"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input } from "@/components/ui";

type Values = { name: string; location: string; phone: string; notes: string };

export function EditClientForm({
  initial,
  onSubmit,
}: {
  initial: Values;
  onSubmit: (d: {
    name: string;
    location?: string;
    phone?: string;
    notes?: string;
  }) => Promise<void>;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [location, setLocation] = useState(initial.location);
  const [phone, setPhone] = useState(initial.phone);
  const [notes, setNotes] = useState(initial.notes);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    if (!name.trim()) return setError("Name is required");
    startTransition(async () => {
      try {
        await onSubmit({
          name: name.trim(),
          location: location.trim() || undefined,
          phone: phone.trim() || undefined,
          notes: notes.trim() || undefined,
        });
        router.push("/clients");
        router.refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Save failed";
        if (!msg.includes("NEXT_REDIRECT")) setError(msg);
      }
    });
  };

  return (
    <Card className="max-w-xl">
      <div className="space-y-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Location">
          <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Salem" />
        </Field>
        <Field label="Phone">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" />
        </Field>
        <Field label="Notes">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </Field>
        {error && <div className="text-xs text-red-600">{error}</div>}
        <Button onClick={submit} disabled={isPending} variant="primary" size="lg">
          {isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </Card>
  );
}
