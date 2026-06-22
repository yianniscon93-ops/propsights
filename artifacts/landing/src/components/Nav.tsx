import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X } from "lucide-react";
import { BRAND } from "@/lib/brand";

function BrandMark({ dark = false }: { dark?: boolean }) {
  return (
    <span className="font-display text-xl font-bold tracking-tight uppercase">
      <span style={{ color: dark ? "#FFFFFF" : "#D0DCC0" }}>{BRAND.namePart1}</span>
      <span style={{ color: "#6B7B4F" }}>{BRAND.namePart2}</span>
    </span>
  );
}

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  const links = [
    { label: "Products", href: "#products" },
    { label: "Data", href: "#credibility" },
    { label: "Get Access", href: "#access" },
  ];

  return (
    <motion.header
      initial={{ y: -12, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
      style={scrolled
        ? { background: "rgba(12,16,10,0.92)", backdropFilter: "blur(16px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }
        : { background: "transparent" }
      }
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <a href="#" className="flex items-center gap-2.5 group">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #4A5E3A, #6B7B4F)" }}>
            <span className="text-white font-display text-sm font-bold">P</span>
          </div>
          <BrandMark />
        </a>

        <nav className="hidden md:flex items-center gap-8">
          {links.map(l => (
            <a key={l.label} href={l.href}
              className="text-sm font-medium transition-colors hover:text-white"
              style={{ color: "#6E7D62" }}>
              {l.label}
            </a>
          ))}
        </nav>

        <a href="#access"
          className="hidden md:inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-95"
          style={{ background: "#4A5E3A", border: "1px solid rgba(255,255,255,0.1)" }}>
          Get Access
        </a>

        <button className="md:hidden p-2 text-[#6E7D62] hover:text-white transition-colors"
          onClick={() => setOpen(!open)}>
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="md:hidden px-6 pb-5 border-t"
            style={{ background: "#0C100A", borderColor: "rgba(255,255,255,0.06)" }}>
            {links.map(l => (
              <a key={l.label} href={l.href} onClick={() => setOpen(false)}
                className="block py-3.5 text-sm font-medium border-b transition-colors hover:text-white"
                style={{ color: "#6E7D62", borderColor: "rgba(255,255,255,0.06)" }}>
                {l.label}
              </a>
            ))}
            <a href="#access" onClick={() => setOpen(false)}
              className="mt-4 block text-center py-3 rounded-lg text-sm font-semibold text-white"
              style={{ background: "#4A5E3A" }}>
              Get Access
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
