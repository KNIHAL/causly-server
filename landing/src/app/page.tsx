import Navbar from "@/components/navbar";
import Hero from "@/components/hero/hero";
import EnvironmentSection from "@/components/sections/EnvironmentSection";
import LocalHosted from "@/components/sections/LocalHosted";
import HowItWorks from "@/components/sections/HowItWorks";
import FinalCTA from "@/components/sections/FinalCTA";
import Footer from "@/components/sections/footer";

export default function Home() {
  return (
    <>
      <Navbar />
      <Hero />
      <EnvironmentSection />
      <LocalHosted />
      <HowItWorks />
      <FinalCTA />
      <Footer />
    </>
  );
}