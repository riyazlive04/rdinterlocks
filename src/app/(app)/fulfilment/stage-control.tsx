"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Select } from "@/components/ui";
import { Icon } from "@/components/icons";
import {
  FULFILMENT_STAGES,
  STAGE_LABEL,
  nextStage,
  type FulfilmentStage,
} from "./stage";

/**
 * The per-order stage control on the queue.
 *
 * A supervisor gets exactly ONE button: the next stage. That is not a UI
 * simplification, it is the rule in actions.ts made visible — the server
 * refuses a jump or a step backwards, so offering a free-choice dropdown
 * would only invite an error message. The dropdown appears for owner/manager
 * (`canOverride`), who are allowed to correct a mistake in either direction.
 *
 * Same useTransition + router.refresh() + inline-error shape as the quotation
 * send list, so the two queues behave identically under the hand.
 */
export function StageControl({
  orderId,
  stage,
  canOverride,
  onSetStage,
}: {
  orderId: string;
  stage: FulfilmentStage;
  canOverride: boolean;
  onSetStage: (orderId: string, stage: string) => Promise<void>;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<FulfilmentStage>(stage);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const next = nextStage(stage);

  const move = (to: FulfilmentStage) => {
    setError(null);
    startTransition(async () => {
      try {
        await onSetStage(orderId, to);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not change the stage");
      }
    });
  };

  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="flex flex-wrap items-center gap-2">
        {next ? (
          <Button onClick={() => move(next)} disabled={isPending} size="sm">
            <Icon.ArrowRight size={14} /> Move to {STAGE_LABEL[next].toLowerCase()}
          </Button>
        ) : (
          <span className="text-[11px] text-slate-400">
            End of the line — dispatch is recorded in Deliveries.
          </span>
        )}

        <span className="flex-1" />

        {canOverride && (
          <>
            <Select
              value={target}
              onChange={(e) => setTarget(e.target.value as FulfilmentStage)}
              className="w-auto py-1.5 text-[12px]"
            >
              {FULFILMENT_STAGES.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABEL[s]}
                </option>
              ))}
            </Select>
            <Button
              onClick={() => move(target)}
              disabled={isPending || target === stage}
              variant="secondary"
              size="sm"
            >
              Correct stage
            </Button>
          </>
        )}
      </div>
      {error && <div className="text-xs text-red-600 mt-2">{error}</div>}
    </div>
  );
}
