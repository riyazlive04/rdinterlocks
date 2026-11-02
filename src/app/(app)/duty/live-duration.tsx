"use client";

import { useEffect, useState } from "react";

// "2h 14m", kept roughly current without a background job.
//
// The board's whole claim is "this person has been on the phone since 9:40,
// for 2h 14m". Rendered once on the server that second half goes stale the
// moment it is read, and a telecaller glancing at it before a call would
// trust a number that is twenty minutes old. So the server renders the
// correct initial label (no hydration mismatch, no flash of "0m") and this
// re-derives it on a one-minute tick afterwards.
//
// The formatter is duplicated from lib/duty.ts's dutyDurationLabel ON PURPOSE:
// that module imports the Prisma client, and importing it from a client
// component would drag the whole of it into the browser bundle. Two lines of
// arithmetic are the cheaper of the two problems.

function label(startedAt: number, now: number): string {
  const mins = Math.max(0, Math.floor((now - startedAt) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function LiveDuration({
  startedAt,
  initial,
  className,
}: {
  /** Epoch milliseconds — a Date would not survive the server boundary intact. */
  startedAt: number;
  initial: string;
  className?: string;
}) {
  const [text, setText] = useState(initial);

  useEffect(() => {
    const tick = () => setText(label(startedAt, Date.now()));
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [startedAt]);

  return <span className={className}>{text}</span>;
}
