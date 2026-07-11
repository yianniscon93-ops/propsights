"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { EXPLAINERS, type ExplainerId } from "@/lib/dashboard/explain";
import { UI } from "./tokens";

/**
 * 💡 next to a stat label → a plain-language explanation of the number.
 * Clarity rules apply: readable sizes, near-white text, no jargon.
 * Hover opens on desktop; click/tap toggles (and works on mobile).
 */
export default function Explain({ id, align = "center" }: { id: ExplainerId; align?: "left" | "center" | "right" }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLSpanElement>(null);
  const { title, text } = EXPLAINERS[id];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pos =
    align === "left"
      ? { left: 0 }
      : align === "right"
        ? { right: 0 }
        : { left: "50%", transform: "translateX(-50%)" };

  return (
    <span
      ref={boxRef}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={`What does ${title} mean?`}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full text-[11px] leading-none transition-transform hover:scale-110"
        style={{
          background: open ? "rgba(143,204,128,0.18)" : "rgba(255,255,255,0.07)",
          border: `1px solid ${open ? "rgba(143,204,128,0.4)" : UI.border}`,
        }}
      >
        💡
      </button>
      <AnimatePresence>
        {open && (
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, y: 4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ duration: 0.16 }}
            className="absolute bottom-full mb-2 z-[1200] block w-[264px] rounded-xl p-3.5 shadow-2xl"
            style={{
              ...pos,
              background: "rgba(16,20,12,0.97)",
              border: `1px solid rgba(143,204,128,0.25)`,
              backdropFilter: "blur(12px)",
            }}
          >
            <span className="block text-[13px] font-bold mb-1" style={{ color: UI.green }}>
              💡 {title}
            </span>
            <span className="block text-[13px] leading-[1.5] font-normal normal-case tracking-normal" style={{ color: UI.text }}>
              {text}
            </span>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** Label row with a built-in 💡 — the standard header for stat cards. */
export function StatLabel({
  id,
  children,
  align,
}: {
  id: ExplainerId;
  children: React.ReactNode;
  align?: "left" | "center" | "right";
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-xs font-bold uppercase tracking-wider" style={{ color: UI.text }}>
        {children}
      </span>
      <Explain id={id} align={align} />
    </span>
  );
}
