import { useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { BRAND } from "@/lib/brand";

export default function CTASection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || done) return;
    setLoading(true);
    setTimeout(() => { setLoading(false); setDone(true); }, 700);
  }

  return (
    <section id="access" ref={ref}
      className="relative py-32 px-6 overflow-hidden"
      style={{ background: "#0C100A" }}>

      <div className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(74,94,58,0.08) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }} />
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at 50% 100%, rgba(74,94,58,0.15) 0%, transparent 55%)" }} />

      <div className="relative z-10 max-w-xl mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.4 }}
          className="inline-flex items-center gap-2 mb-8 px-3 py-1.5 rounded-full"
          style={{ background: "rgba(74,94,58,0.15)", border: "1px solid rgba(74,94,58,0.3)" }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#8FCC80" }} />
          <span className="text-xs font-medium" style={{ color: "#8FCC80" }}>The product is live</span>
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 20 }} animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.08 }}
          className="font-display font-bold uppercase leading-none mb-6"
          style={{ fontSize: "clamp(2.4rem,7vw,4rem)", color: "#FFFFFF", letterSpacing: "-0.01em" }}>
          Get access —<br />
          <span style={{ color: "#8FCC80" }}>the product is live.</span>
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 14 }} animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.14 }}
          className="text-base mb-10 leading-relaxed"
          style={{ color: "#6E7D62", fontWeight: 300 }}>
          {BRAND.name} is ready to use. Drop your email and we'll set you up within a few days.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 14 }} animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.2 }}>
          <form onSubmit={handleSubmit}
            className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
            <input
              type="email" required placeholder="your@email.com"
              value={email} onChange={e => setEmail(e.target.value)}
              disabled={done}
              className="flex-1 px-4 py-3.5 rounded-xl text-sm focus:outline-none transition-all disabled:opacity-50"
              style={{
                background: "#141910",
                border: "1.5px solid rgba(255,255,255,0.1)",
                color: "#D0DCC0",
              }}
              onFocus={e => (e.target.style.borderColor = "rgba(74,94,58,0.6)")}
              onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.1)")}
              data-testid="input-email"
            />
            <motion.button
              type="submit"
              whileHover={!done ? { scale: 1.02 } : {}}
              whileTap={!done ? { scale: 0.97 } : {}}
              disabled={loading}
              className="flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-sm font-semibold text-white transition-all min-w-[150px]"
              style={{ background: "#4A5E3A", border: "1px solid rgba(255,255,255,0.1)" }}
              data-testid="btn-submit">
              {done ? "You're in ✓" : loading ? "Sending…" : <><span>Get Access</span><ArrowRight size={13} /></>}
            </motion.button>
          </form>
          <p className="mt-4 text-xs" style={{ color: "#4A6038" }}>
            {done ? "We'll reach out within a few days with your access details." : "No spam. No commitment. Cancel anytime."}
          </p>
        </motion.div>
      </div>
    </section>
  );
}
