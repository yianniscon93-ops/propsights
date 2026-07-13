"use client";

import { UI } from "./tokens";

/** Labelled range slider — the standard input for calculator-style cards. */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  fmt,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[12px] font-medium" style={{ color: UI.text }}>
          {label}
        </span>
        <span className="text-[12px] font-bold" style={{ color: UI.green }}>
          {fmt(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#8FCC80]"
        style={{ height: 18 }}
      />
    </div>
  );
}

/** Small labelled on/off switch. */
export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2.5"
    >
      <span
        className="relative inline-block w-9 h-5 rounded-full transition-colors"
        style={{ background: checked ? UI.olive : "rgba(255,255,255,0.12)" }}
      >
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full transition-transform"
          style={{
            left: 2,
            transform: checked ? "translateX(16px)" : "translateX(0)",
            background: checked ? UI.green : "#8B937F",
          }}
        />
      </span>
      <span className="text-[13px] font-semibold" style={{ color: UI.text }}>
        {label}
      </span>
    </button>
  );
}
