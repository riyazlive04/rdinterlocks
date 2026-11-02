"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Pill, Select } from "@/components/ui";

type Message = {
  id: string;
  direction: string;
  status: string;
  body: string;
  templateName: string | null;
  createdAt: string;
};

type ActiveEnrollment = {
  id: string;
  sequenceName: string;
  currentTemplateName: string | null;
  nextRunAt: string | null;
};

const statusTone: Record<string, "success" | "danger" | "blue" | "slate"> = {
  sent: "blue",
  delivered: "success",
  read: "success",
  failed: "danger",
  queued: "slate",
  received: "slate",
};

export function WhatsAppThread({
  leadId,
  optOut,
  messages,
  activeEnrollment,
  availableSequences,
  onEnroll,
  onStop,
}: {
  leadId: string;
  optOut: boolean;
  messages: Message[];
  activeEnrollment: ActiveEnrollment | null;
  availableSequences: Array<{ id: string; name: string }>;
  onEnroll: (input: { leadId: string; sequenceId: string }) => Promise<void>;
  onStop: (id: string) => Promise<void>;
}) {
  const router = useRouter();
  const [sequenceId, setSequenceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const enroll = () => {
    if (!sequenceId) {
      setError("Pick a sequence first");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await onEnroll({ leadId, sequenceId });
        setSequenceId("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not enroll this lead");
      }
    });
  };

  const stop = () => {
    if (!activeEnrollment) return;
    startTransition(async () => {
      try {
        await onStop(activeEnrollment.id);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not stop the sequence");
      }
    });
  };

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <div className="text-base font-bold text-ink">WhatsApp</div>
          <div className="text-xs text-slate-500">Nurture sequence & conversation history</div>
        </div>
        {optOut && <Pill tone="danger">Opted out</Pill>}
      </div>

      {optOut ? (
        <div className="text-[12.5px] text-slate-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3">
          This lead replied STOP and will not receive further WhatsApp messages.
        </div>
      ) : activeEnrollment ? (
        <div className="flex flex-wrap items-center gap-2 bg-slate-50 rounded-xl px-3 py-2.5 mb-3">
          <Pill tone="blue">{activeEnrollment.sequenceName}</Pill>
          <span className="text-[12px] text-slate-600">
            {activeEnrollment.currentTemplateName ? `next: ${activeEnrollment.currentTemplateName}` : ""}
            {activeEnrollment.nextRunAt
              ? ` · ${new Date(activeEnrollment.nextRunAt).toLocaleString("en-IN")}`
              : ""}
          </span>
          <Button onClick={stop} variant="ghost" size="sm" disabled={isPending} className="ml-auto">
            Stop
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Select value={sequenceId} onChange={(e) => setSequenceId(e.target.value)} className="max-w-xs">
            <option value="">- enroll in sequence -</option>
            {availableSequences.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Button onClick={enroll} variant="secondary" size="sm" disabled={isPending}>
            Enroll
          </Button>
        </div>
      )}
      {error && <div className="text-xs text-red-600 mb-3">{error}</div>}

      {messages.length === 0 ? (
        <div className="text-sm text-slate-500 py-4 text-center">No WhatsApp messages yet.</div>
      ) : (
        <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[75%] rounded-xl px-3 py-2 text-[12.5px] ${
                  m.direction === "out" ? "bg-brand-blueLight text-ink" : "bg-slate-100 text-ink"
                }`}
              >
                {m.templateName && (
                  <div className="mono text-[10px] text-slate-500 mb-0.5">{m.templateName}</div>
                )}
                <div className="whitespace-pre-wrap break-words">{m.body || <em className="text-slate-400">no text</em>}</div>
                <div className="flex items-center gap-1.5 mt-1">
                  <Pill tone={statusTone[m.status] ?? "slate"}>{m.status}</Pill>
                  <span className="text-[10px] text-slate-400">
                    {new Date(m.createdAt).toLocaleString("en-IN")}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
