"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";

type Status = "present" | "absent" | "leave" | "half";

export function AttendanceControls({
  current,
  onSet,
}: {
  employeeId: string;
  current: string | null;
  onSet: (status: Status) => Promise<void>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <div className="grid grid-cols-4 gap-2">
      {(["present", "absent", "leave", "half"] as Status[]).map((s) => (
        <button
          key={s}
          onClick={() => {
            startTransition(async () => {
              await onSet(s);
              router.refresh();
            });
          }}
          disabled={isPending}
          className={clsx(
            "py-2.5 rounded-xl text-[12px] font-semibold capitalize transition disabled:opacity-50",
            current === s
              ? s === "present"
                ? "bg-emerald-600 text-white"
                : s === "absent"
                  ? "bg-red-600 text-white"
                  : s === "leave"
                    ? "bg-amber-500 text-white"
                    : "bg-blue-600 text-white"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          )}
        >
          {s}
        </button>
      ))}
    </div>
  );
}
