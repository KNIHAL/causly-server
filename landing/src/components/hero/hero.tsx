import HeroContent from "./HeroContent";
import AgentVisual from "./AgentVisual";

export default function Hero() {
    return (
        <section className="relative min-h-screen overflow-hidden bg-[#030b0d] text-white">
            {/* Hero content starts below fixed navbar */}
            <div className="mx-auto flex min-h-screen w-full max-w-[1440px] px-4 pt-[50px] sm:px-5 lg:px-9">
                <div className="grid w-full grid-cols-1 items-start gap-4 pt-14 lg:grid-cols-2 lg:items-center lg:gap-4 lg:pt-6">
                    {/* LEFT — existing content, untouched */}
                    <div>
                        <HeroContent />
                    </div>

                    {/* RIGHT — Agent Environment visual will come here */}
                    <div className="w-full">
                        <AgentVisual />
                    </div>
                </div>
            </div>
        </section>
    );
}