import * as React from "react";
import clsx from "clsx";
import { LedgerData, LedgerCol, LedgerRow } from "@/lib/reports";

function fmt(v: unknown, col: LedgerCol): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number") {
    if (col.format === "money") {
      const sign = v < 0 ? "−" : "";
      return `${sign}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`;
    }
    if (col.format === "number") return v.toLocaleString("en-IN");
    return String(v);
  }
  return String(v);
}

function formatClass(col: LedgerCol, val: unknown, emphasis?: LedgerRow["emphasis"]) {
  const isMoney = col.format === "money";
  const num = typeof val === "number";
  return clsx(
    "px-3 py-2 align-top",
    col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left",
    (col.format === "mono" || col.format === "number" || isMoney) && "num",
    col.format === "mono" && "mono text-slate-700",
    col.format === "muted" && "text-slate-500",
    isMoney && num && (val as number) < 0 && "text-brand-red font-semibold",
    isMoney && num && (val as number) > 0 && emphasis === "credit" && "text-emerald-700 font-semibold",
    isMoney && num && (val as number) > 0 && emphasis !== "credit" && col.key !== "balance" && "text-ink font-semibold",
    col.key === "balance" && "text-ink font-semibold"
  );
}

export function LedgerView({ data }: { data: LedgerData }) {
  const totalEntries = data.sections.reduce((s, sec) => s + sec.rows.length, 0);

  if (totalEntries === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-900/[.06] p-8 text-center text-sm text-slate-500">
        No {data.unit} for the selected period & filters.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-900/[.06] overflow-hidden">
      {/* Single sticky header row */}
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] border-separate border-spacing-0">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {data.columns.map((c) => (
                <th
                  key={c.key}
                  style={c.width ? { width: c.width } : undefined}
                  className={clsx(
                    "px-3 py-2.5 font-semibold text-slate-600 uppercase tracking-wider text-[10px] border-b border-slate-200 sticky top-0 bg-slate-50 z-10",
                    c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left"
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.sections.map((section) => (
              <React.Fragment key={section.dateKey}>
                {/* Date divider row */}
                <tr>
                  <td
                    colSpan={data.columns.length}
                    className="bg-paper2/60 px-3 py-1.5 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-700 font-semibold"
                  >
                    <div className="flex items-center justify-between">
                      <span>{section.dateLabel}</span>
                      <span className="text-slate-500">
                        {section.rows.length} {section.rows.length === 1 ? "entry" : "entries"}
                      </span>
                    </div>
                  </td>
                </tr>

                {section.rows.map((row) => (
                  <React.Fragment key={row.id}>
                    <tr className="border-b border-slate-100 hover:bg-slate-50/60">
                      {data.columns.map((c) => (
                        <td key={c.key} className={formatClass(c, row.cells[c.key], row.emphasis)}>
                          {fmt(row.cells[c.key], c)}
                        </td>
                      ))}
                    </tr>
                    {row.children?.map((child) => (
                      <tr
                        key={child.id}
                        className="border-b border-slate-100 hover:bg-slate-50/60 bg-slate-50/30"
                      >
                        {data.columns.map((c, i) => (
                          <td
                            key={c.key}
                            className={clsx(
                              formatClass(c, child.cells[c.key], child.emphasis),
                              i === 0 ? "pl-8 text-slate-500 italic" : ""
                            )}
                          >
                            {fmt(child.cells[c.key], c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}

                {/* Date sub-total */}
                {section.subtotals && Object.keys(section.subtotals).length > 0 && (
                  <tr className="bg-slate-50/80 border-b border-slate-200">
                    {data.columns.map((c, i) => {
                      const v = section.subtotals?.[c.key];
                      return (
                        <td
                          key={c.key}
                          className={clsx(
                            "px-3 py-1.5 text-[12px] font-semibold text-slate-700",
                            c.align === "right" ? "text-right num" : "text-left",
                            c.format === "money" && v != null && (v as number) > 0 && "text-ink",
                            c.format === "money" && v != null && (v as number) < 0 && "text-brand-red"
                          )}
                        >
                          {i === 0 ? `Day total` : v != null ? fmt(v as number, c) : ""}
                        </td>
                      );
                    })}
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
          <tfoot>
            {data.totals && (
              <tr className="bg-ink text-white">
                {data.columns.map((c, i) => {
                  const v = data.totals?.[c.key];
                  return (
                    <td
                      key={c.key}
                      className={clsx(
                        "px-3 py-3 font-bold text-[13px]",
                        c.align === "right" ? "text-right num" : "text-left"
                      )}
                    >
                      {i === 0 ? `GRAND TOTAL` : v != null ? fmt(v as number, c) : ""}
                    </td>
                  );
                })}
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    </div>
  );
}
