"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Dropdown to filter the payroll screen to a single person (grouped by type).
// Preserves the selected month and other params via client-side navigation.
export function PayrollPersonFilter({
  groups,
  value,
}: {
  groups: { label: string; people: { id: string; name: string }[] }[];
  value: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const sp = useSearchParams();

  const onChange = (v: string) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set("person", v);
    else p.delete("person");
    router.push(`${pathname}?${p.toString()}`);
  };

  return (
    <div className="flex items-center gap-2 mb-4">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Person
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 rounded-lg border border-slate-200 text-[13px] bg-white min-w-[200px]"
      >
        <option value="">All people</option>
        {groups.map((g) =>
          g.people.length === 0 ? null : (
            <optgroup key={g.label} label={g.label}>
              {g.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )
        )}
      </select>
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="text-[12px] text-brand-blue font-semibold"
        >
          Clear
        </button>
      )}
    </div>
  );
}
