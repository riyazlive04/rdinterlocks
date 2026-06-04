import * as React from "react";
import clsx from "clsx";
import Image from "next/image";

export function Avatar({
  name,
  size = 32,
  tone,
}: {
  name: string;
  size?: number;
  tone?: string;
}) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const palette = ["#0E2143", "#E11D2C", "#1F4FFF", "#2F8F5A", "#7C2D9C", "#C97A18"];
  const c = tone || palette[(name.charCodeAt(0) + name.length) % palette.length];
  return (
    <div
      style={{
        width: size,
        height: size,
        background: c,
        fontSize: size * 0.36,
      }}
      className="rounded-full text-white flex items-center justify-center font-semibold tracking-wide flex-shrink-0"
    >
      {initials}
    </div>
  );
}

const pillTones: Record<string, string> = {
  slate: "bg-slate-100 text-slate-700",
  red: "bg-brand-redLight text-brand-red",
  blue: "bg-brand-blueLight text-brand-blue",
  success: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-800",
  info: "bg-blue-100 text-blue-800",
  dark: "bg-ink text-white",
};

export function Pill({
  children,
  tone = "slate",
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof pillTones;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 px-2 py-[3px] rounded-full text-[11px] font-semibold leading-none whitespace-nowrap",
        pillTones[tone] ?? pillTones.slate,
        className
      )}
    >
      {children}
    </span>
  );
}

export function SectionHead({
  title,
  sub,
  action,
  onAction,
}: {
  title: string;
  sub?: string;
  action?: React.ReactNode;
  onAction?: () => void;
}) {
  return (
    <div className="flex items-baseline justify-between mb-3">
      <div>
        <div className="text-base font-bold text-ink tracking-tight">{title}</div>
        {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
      </div>
      {action && (typeof action === "string" ? (
        <button onClick={onAction} className="text-xs font-semibold text-brand-blue hover:text-brand-blueDark">
          {action}
        </button>
      ) : action)}
    </div>
  );
}

export function BrandMark({
  size = 36,
  showText = true,
  textColor,
}: {
  size?: number;
  showText?: boolean;
  textColor?: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        style={{ width: size, height: size }}
        className="rounded-full overflow-hidden flex-shrink-0 ring-1 ring-black/10"
      >
        <Image src="/logo.svg" alt="RD Interlock Bricks" width={size} height={size} unoptimized />
      </div>
      {showText && (
        <div className="flex flex-col leading-tight">
          <span
            className="display text-[15px] font-bold tracking-tight"
            style={{ color: textColor ?? "#0B1220" }}
          >
            RD <span className="text-brand-red">INTER</span>
            <span className="text-brand-blue">LOCK</span>
          </span>
          <span className="mono text-[9px] font-medium text-slate-500 tracking-widest uppercase">
            Bricks
          </span>
        </div>
      )}
    </div>
  );
}

export function PageHeader({
  title,
  sub,
  back,
  right,
}: {
  title: string;
  sub?: string;
  back?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 mb-4">
      {back && (
        <a
          href={back}
          className="w-9 h-9 rounded-xl bg-white border border-slate-900/[.08] flex items-center justify-center hover:bg-slate-50"
          aria-label="Back"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0B1220" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </a>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-xl md:text-2xl font-bold text-ink tracking-tight truncate">{title}</div>
        {sub && <div className="text-xs md:text-sm text-slate-500 truncate">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone = "default",
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "red" | "blue" | "success" | "ink";
  icon?: React.ReactNode;
}) {
  const toneClass = {
    default: "bg-white border-slate-900/[.06] text-ink",
    red: "bg-brand-red text-white border-transparent",
    blue: "bg-brand-blue text-white border-transparent",
    success: "bg-emerald-500 text-white border-transparent",
    ink: "bg-ink text-white border-transparent",
  }[tone];
  return (
    <div className={clsx("rounded-2xl p-4 border shadow-card relative overflow-hidden", toneClass)}>
      <div className="flex items-center justify-between">
        <span
          className={clsx(
            "text-[11px] font-semibold tracking-wider uppercase",
            tone === "default" ? "text-slate-500" : "text-white/75"
          )}
        >
          {label}
        </span>
        {icon}
      </div>
      <div className="display num text-[26px] font-bold tracking-tight mt-1.5 leading-none">
        {value}
      </div>
      {sub && (
        <div
          className={clsx(
            "text-[11px] mt-1.5",
            tone === "default" ? "text-slate-500" : "text-white/75"
          )}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

export function Card({
  children,
  className,
  padding = "default",
}: {
  children: React.ReactNode;
  className?: string;
  padding?: "default" | "tight" | "none";
}) {
  return (
    <div
      className={clsx(
        "bg-white rounded-2xl border border-slate-900/[.06] shadow-card",
        padding === "default" && "p-4",
        padding === "tight" && "p-3",
        padding === "none" && "",
        className
      )}
    >
      {children}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "blue";
  size?: "sm" | "md" | "lg";
}) {
  const sizeCls = {
    sm: "px-3 py-1.5 text-[12px]",
    md: "px-4 py-2.5 text-[13px]",
    lg: "px-5 py-3.5 text-[14px]",
  }[size];
  const variantCls = {
    primary: "bg-brand-red text-white hover:bg-brand-redDark shadow-red disabled:opacity-50",
    blue: "bg-brand-blue text-white hover:bg-brand-blueDark shadow-blue disabled:opacity-50",
    secondary:
      "bg-white text-ink border border-slate-900/[.1] hover:bg-slate-50 disabled:opacity-50",
    ghost: "bg-transparent text-ink hover:bg-slate-100 disabled:opacity-50",
    danger: "bg-red-600 text-white hover:bg-red-700 disabled:opacity-50",
  }[variant];
  return (
    <button
      className={clsx(
        "rounded-xl font-semibold inline-flex items-center justify-center gap-1.5 transition",
        sizeCls,
        variantCls,
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      {label && (
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
          {label}
        </div>
      )}
      {children}
      {hint && !error && <div className="text-[11px] text-slate-500 mt-1">{hint}</div>}
      {error && <div className="text-[11px] text-red-600 mt-1">{error}</div>}
    </div>
  );
}

export const inputClass =
  "w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 text-[14px] text-ink focus:outline-none focus:ring-2 focus:ring-brand-red/30 focus:border-brand-red/50 disabled:bg-slate-50 disabled:cursor-not-allowed";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(inputClass, props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={clsx(inputClass, "appearance-none pr-8 bg-no-repeat bg-[right_0.7rem_center]", props.className)} style={{ backgroundImage: "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='%2364748B' stroke-width='1.5'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E\")", ...props.style }} />;
}

export function EmptyState({
  title,
  sub,
  action,
}: {
  title: string;
  sub?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center">
      <div className="text-[14px] font-semibold text-ink">{title}</div>
      {sub && <div className="text-[12px] text-slate-500 mt-1">{sub}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  empty,
}: {
  columns: Array<{ key: string; header: string; render: (row: T) => React.ReactNode; align?: "left" | "right" | "center"; width?: string; className?: string }>;
  rows: T[];
  empty?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-900/[.06] p-8 text-center text-sm text-slate-500">
        {empty ?? "No data"}
      </div>
    );
  }
  return (
    <div className="bg-white rounded-2xl border border-slate-900/[.06] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={clsx(
                    "px-3 py-2.5 font-semibold text-slate-600 uppercase tracking-wider text-[10px]",
                    c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left"
                  )}
                  style={c.width ? { width: c.width } : undefined}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={clsx(
                      "px-3 py-2.5",
                      c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                      c.className
                    )}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
