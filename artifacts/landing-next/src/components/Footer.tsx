import { BRAND } from "@/lib/brand";

export default function Footer() {
  return (
    <footer
      className="py-8 px-6 border-t"
      style={{ background: "#0C100A", borderColor: "rgba(255,255,255,0.06)" }}
    >
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #4A5E3A, #6B7B4F)" }}
          >
            <span className="text-white font-display text-xs font-bold">P</span>
          </div>
          <span className="font-display font-bold text-base uppercase tracking-tight">
            <span style={{ color: "#D0DCC0" }}>{BRAND.namePart1}</span>
            <span style={{ color: "#6B7B4F" }}>{BRAND.namePart2}</span>
          </span>
        </div>

        <p className="text-xs" style={{ color: "#4A6038" }}>
          © 2026 {BRAND.name}
        </p>

        <div className="flex gap-5 text-xs" style={{ color: "#4A6038" }}>
          <a href="#" className="transition-colors hover:text-white">
            Privacy
          </a>
          <a href="#" className="transition-colors hover:text-white">
            Terms
          </a>
        </div>
      </div>
    </footer>
  );
}
