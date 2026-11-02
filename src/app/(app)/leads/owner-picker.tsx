"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Pill, Select } from "@/components/ui";
import { assignLead } from "./actions";

// Who is working this lead. A one-field control rather than a trip through
// the edit form, in the same spirit as StagePicker and FollowUpControl —
// ~753 of 833 leads arrived from Meta with no owner at all, so assigning has
// to be a single click from wherever the lead is open.

export function OwnerPicker({
  id,
  ownerUserId,
  ownerName,
  users,
  locked,
}: {
  id: string;
  ownerUserId: string | null;
  ownerName: string | null;
  users: { id: string; name: string }[];
  locked: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [current, setCurrent] = useState(ownerUserId ?? "");
  const [error, setError] = useState<string | null>(null);

  const selectedName = users.find((u) => u.id === current)?.name ?? ownerName;

  if (locked) {
    return selectedName ? (
      <div className="flex items-center gap-2">
        <Avatar name={selectedName} size={24} />
        <span className="text-[13px] font-semibold text-ink">{selectedName}</span>
      </div>
    ) : (
      <Pill tone="red">Unassigned</Pill>
    );
  }

  const save = (next: string) => {
    const prev = current;
    setCurrent(next);
    setError(null);
    startTransition(async () => {
      try {
        await assignLead(id, next || null);
        router.refresh();
      } catch (e) {
        // Snap back — e.g. the user was deactivated between page load and now.
        setCurrent(prev);
        setError(e instanceof Error ? e.message : "Could not assign this lead");
      }
    });
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        {selectedName ? (
          <Avatar name={selectedName} size={28} />
        ) : (
          <span className="w-7 h-7 rounded-full bg-brand-redLight flex-shrink-0" />
        )}
        <Select
          value={current}
          disabled={isPending}
          onChange={(e) => save(e.target.value)}
          className="py-1.5 text-[13px]"
        >
          <option value="">Unassigned</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </div>
      {error && <div className="text-[11px] text-red-600 mt-1">{error}</div>}
    </div>
  );
}
