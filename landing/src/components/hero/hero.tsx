import HeroContent from "./HeroContent";

export default function Hero() {
    return (
        <section className="relative min-h-screen overflow-hidden bg-[#030b0d] text-white">
            <div className="mx-auto flex min-h-screen w-full max-w-[1440px] px-6 sm:px-8 lg:px-">
                <div className="flex w-full items-center py-10 lg:py-12">
                    <HeroContent />
                </div>
            </div>
        </section>
    );
}