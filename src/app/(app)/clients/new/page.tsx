"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Input, PageHeader } from "@/components/ui";
import { createClient } from "../actions";

export default function NewClientPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    if (!name.trim()) return setError("Name is required");
    startTransition(async () => {
      try {
        const c = await createClient({
          name: name.trim(),
          location: location.trim() || undefined,
          phone: phone.trim() || undefined,
          notes: notes.trim() || undefined,
        });
        router.push(`/clients/${c.id}`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  };

  return (
    <>
      <PageHeader title="Add client" back="/clients" />
      <Card className="max-w-xl">
        <div className="space-y-3">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Raja" />
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
            {isPending ? "Saving…" : "Add client"}
          </Button>
        </div>
      </Card>
    </>
  );
}
