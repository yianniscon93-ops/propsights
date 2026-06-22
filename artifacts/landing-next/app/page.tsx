import Nav from "@/components/Nav";
import SplitHero from "@/components/SplitHero";
import CredibilityStrip from "@/components/CredibilityStrip";
import ProductTabs from "@/components/ProductTabs";
import CTASection from "@/components/CTASection";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: "#0C100A" }}>
      <Nav />
      <SplitHero />
      <CredibilityStrip />
      <ProductTabs />
      <CTASection />
      <Footer />
    </div>
  );
}
