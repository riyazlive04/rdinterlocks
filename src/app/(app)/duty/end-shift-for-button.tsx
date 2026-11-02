"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { Icon } from "@/components/icons";
import { endShiftFor } from "./actions";

// Close somebody else's shift — the telecaller who went home at six and is
// still shown as covering the phones. Rendered only for isFullAccess viewers;
// the action re-checks the role anyway, because a hidden button is not a
// permission.

export function EndShiftForButton({ userId, name }: { userId: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const end = () => {
    setError(null);
    startTransition(async () => {
      try {
        await endShiftFor(userId);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : `Could not end ${name}'s shift`);
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={end} disabled={isPending} variant="ghost" size="sm">
        <Icon.X size={13} /> {isPending ? "Ending…" : "End shift"}
      </Button>
      {error && <div className="text-[10px] text-red-600 max-w-[200px] text-right">{error}</div>}
    </div>
  );
}
