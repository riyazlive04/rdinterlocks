"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";
import { endShift, startShift } from "./actions";
import { LiveDuration } from "./live-duration";

// "My shift" — the one control a telecaller touches, at the top of the board.
//
// Same shape as OwnerPicker: useTransition for the pending state, a
// router.refresh() so the rest of the board (open-lead counts, coverage,
// everyone else's cards) re-reads from the server, and the error inline
// rather than thrown away. The server action is the only authority — nothing
// here is optimistic, because showing somebody as on duty when the write
// failed is the one lie this screen must never tell.

export function ShiftControl({
  open,
  lastLocation,
}: {
  /** The viewer's open session, or null when they are off duty. */
  open: { startedAt: number; startedLabel: string; durationLabel: string; location: string; note: string } | null;
  /** Where they worked from last time, pre-filled so the common case is one click. */
  lastLocation: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [location, setLocation] = useState(lastLocation);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<void>, fallback: string) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : fallback);
      }
    });
  };

  if (open) {
    return (
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <Pill tone="success">
            <Icon.Phone size={12} color="#065F46" /> On duty
          </Pill>
          <div className="text-[13px] text-slate-600">
            Since <span className="font-semibold text-ink">{open.startedLabel}</span> ·{" "}
            <LiveDuration
              startedAt={open.startedAt}
              initial={open.durationLabel}
              className="font-semibold text-ink num"
            />
            {open.location && (
              <>
                {" "}
                from <span className="font-semibold text-ink">{open.location}</span>
              </>
            )}
          </div>
          <div className="flex-1" />
          <Button
            onClick={() => run(() => endShift(), "Could not end your shift")}
            disabled={isPending}
            variant="secondary"
            size="sm"
          >
            <Icon.Logout size={14} /> {isPending ? "Ending…" : "End shift"}
          </Button>
        </div>
        {open.note && <div className="text-[12px] text-slate-500 mt-2">{open.note}</div>}
        {error && <div className="text-[11px] text-red-600 mt-2">{error}</div>}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[180px] flex-1">
          <Field label="From where" hint="Factory office, home, a branch — whatever is true today">
            <Input
              value={location}
              disabled={isPending}
              placeholder="Factory office"
              onChange={(e) => setLocation(e.target.value)}
              className="py-2 text-[13px]"
            />
          </Field>
        </div>
        <div className="min-w-[180px] flex-1">
          <Field label="Note (optional)">
            <Input
              value={note}
              disabled={isPending}
              placeholder="Covering for Priya till 2pm"
              onChange={(e) => setNote(e.target.value)}
              className="py-2 text-[13px]"
            />
          </Field>
        </div>
        <Button
          onClick={() => run(() => startShift(location, note), "Could not start your shift")}
          disabled={isPending}
          size="md"
        >
          <Icon.Phone size={15} /> {isPending ? "Starting…" : "Start shift"}
        </Button>
      </div>
      {error && <div className="text-[11px] text-red-600 mt-2">{error}</div>}
    </div>
  );
}
