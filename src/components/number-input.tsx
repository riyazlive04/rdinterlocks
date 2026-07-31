"use client";
import * as React from "react";
import { useEffect, useState } from "react";
import clsx from "clsx";
import { inputClass } from "./ui";

// A controlled number <input> that keeps its own text while the box is empty
// or mid-typing. This means:
//  - a value of 0 shows as an EMPTY box (no stuck "0" you can't delete), and
//  - decimals like "0.5" type cleanly (typing the leading "0" isn't erased).
// When rendered without a `value` (uncontrolled) it behaves like a plain
// number input. Used automatically by <Input type="number" /> in ui.tsx.
export function NumberField({
  value,
  onChange,
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  const isControlled = value !== undefined && value !== null;
  const num = typeof value === "number" ? value : Number(value);
  const [text, setText] = useState(() => (isControlled && num ? String(num) : ""));

  // Keep the text in step when the numeric value changes from OUTSIDE (prefill,
  // reset, a computed field) — but never clobber the user's in-progress text
  // when it already represents the same number (e.g. "" and 0, or "0.").
  useEffect(() => {
    if (!isControlled) return;
    const parsed = text === "" ? 0 : Number(text);
    if (!(Number.isFinite(parsed) && parsed === num)) {
      setText(num ? String(num) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [num, isControlled]);

  if (!isControlled) {
    return (
      <input type="number" {...rest} onChange={onChange} className={clsx(inputClass, className)} />
    );
  }
  return (
    <input
      {...rest}
      type="number"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange?.(e);
      }}
      className={clsx(inputClass, className)}
    />
  );
}
