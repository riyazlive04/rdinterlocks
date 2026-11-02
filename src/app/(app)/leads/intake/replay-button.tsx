"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { ReplayResult } from "@/lib/lead-webhook-replay";

export function ReplayButton({
  id,
  onReplay,
}: {
  id: string;
  onReplay: (id: string) => Promise<ReplayResult>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const replay = () => {
    setError(null);
    startTransition(async () => {
      try {
        // replayDelivery never throws — a failed import comes back as
        // ok:false with the reason, so the message is shown here rather
        // than only landing in the delivery row.
        const result = await onReplay(id);
        if (!result.ok) setError(result.message || "Could not replay this delivery");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not replay this delivery");
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={replay} disabled={isPending} variant="secondary" size="sm">
        <Icon.ArrowRight size={14} /> {isPending ? "Replaying…" : "Replay"}
      </Button>
      {error && <div className="text-[10px] text-red-600 max-w-[220px] text-right">{error}</div>}
    </div>
  );
}
