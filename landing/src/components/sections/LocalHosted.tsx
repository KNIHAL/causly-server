"use client";

import { useEffect, useRef, useState } from "react";

const options = [
    {
        number: "01",
        label: "CAUSLY OSS",
        title: "Run it on your machine.",
        description:
            "Causly OSS lets an AI agent work directly with the environment you already have. Your code, files, terminal, Git repositories, and tools stay on your machine while Causly gives the agent a way to interact with them.",
        points: [
            "Your own machine",
            "Your existing code & files",
            "Your tools & development workflow",
            "Open-source and self-controlled",
        ],
        flow: ["YOUR MACHINE", "CAUSLY OSS", "AI AGENT"],
    },
    {
        number: "02",
        label: "CAUSLY HOSTED",
        title: "Give your agent its own environment.",
        description:
            "Causly Hosted provides an isolated, managed environment where an AI agent can build, run, test, and operate real workloads without depending on your local machine.",
        points: [
            "Managed cloud environment",
            "Isolated agent workspace",
            "Built for real execution",
            "Run remotely without your machine",
        ],
        flow: ["CAUSLY CLOUD", "HOSTED ENVIRONMENT", "AI AGENT"],
    },
];

export default function LocalHosted() {
    const sectionRef = useRef<HTMLElement | null>(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const element = sectionRef.current;
        if (!element) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setVisible(true);
                    observer.disconnect();
                }
            },
            { threshold: 0.15 }
        );

        observer.observe(element);

        return () => observer.disconnect();
    }, []);

    return (
        <section
            ref={sectionRef}
            id="local-vs-hosted"
            className="relative overflow-hidden bg-[#030b0d] px-1 py-1 text-white sm:px-1 sm:py-1 lg:px-1 lg:py-1"
        >
            {/* Subtle background glow */}
            <div className="pointer-events-none absolute left-1/2 top-1/3 h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-[#25d6c5]/[0.025] blur-[120px]" />

            <div className="relative mx-auto w-full max-w-[1240px]">
                {/* Heading */}
                <div
                    className={`max-w-[760px] transition-all duration-700 ${visible
                        ? "translate-y-0 opacity-100"
                        : "translate-y-6 opacity-0"
                        }`}
                >
                    <div className="mb-4 flex items-center gap-3">
                        <span className="h-px w-5 bg-[#25d6c5]" />
                        <span className="text-[10px] font-medium tracking-[0.3em] text-white/45 sm:text-xs">
                            LOCAL OR HOSTED
                        </span>
                    </div>

                    <h2 className="text-[clamp(2.2rem,4vw,3.5rem)] font-semibold leading-[1.04] tracking-[-0.045em]">
                        Run Causly where your
                        <span className="block text-[#27d8c7]">work needs to happen.</span>
                    </h2>

                    <p className="mt-2 max-w-[680px] text-base leading-6 text-white/55 sm:text-lg sm:leading-7">
                        Use Causly OSS to give an AI agent access to your own machine, or
                        use Causly Hosted when you need a dedicated execution environment
                        in the cloud.
                    </p>
                </div>

                {/* Comparison */}
                <div className="mt-8 grid gap-5 lg:grid-cols-2 lg:gap-6">
                    {options.map((option, index) => (
                        <article
                            key={option.label}
                            className={`group relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#061113] p-6 transition-all duration-700 hover:-translate-y-1 hover:border-[#35d6c5]/30 hover:shadow-[0_20px_70px_rgba(0,0,0,0.25)] sm:p-8 lg:p-9 ${visible
                                ? "translate-y-0 opacity-100"
                                : "translate-y-8 opacity-0"
                                }`}
                            style={{
                                transitionDelay: `${150 + index * 120}ms`,
                            }}
                        >
                            {/* Top accent */}
                            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#35d6c5]/50 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                            {/* Header */}
                            <div className="flex items-start justify-between">
                                <div>
                                    <span className="text-[10px] font-medium tracking-[0.28em] text-[#35d6c5]/70">
                                        {option.label}
                                    </span>

                                    <h3 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">
                                        {option.title}
                                    </h3>
                                </div>

                                <span className="font-mono text-xs text-white/20">
                                    {option.number}
                                </span>
                            </div>

                            {/* Description */}
                            <p className="mt-5 max-w-[560px] text-sm leading-6 text-white/50 sm:text-[15px] sm:leading-7">
                                {option.description}
                            </p>

                            {/* Execution flow */}
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
                                {option.flow.map((item, flowIndex) => (
                                    <div
                                        key={item}
                                        className="flex w-full flex-col items-center sm:flex-1 sm:flex-row sm:gap-2"
                                    >
                                        <div className="flex min-h-10 w-full items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 text-center font-mono text-[9px] tracking-[0.12em] text-white/55">
                                            {item}
                                        </div>

                                        {flowIndex < option.flow.length - 1 && (
                                            <>
                                                {/* Desktop */}
                                                <span className="hidden shrink-0 text-[#35d6c5]/60 sm:block">
                                                    →
                                                </span>

                                                {/* Mobile */}
                                                <span className="block py-1 text-center text-[#35d6c5]/50 sm:hidden">
                                                    ↓
                                                </span>
                                            </>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {/* Points */}
                            <div className="mt-7 grid gap-3 sm:grid-cols-2">
                                {option.points.map((point) => (
                                    <div
                                        key={point}
                                        className="flex items-start gap-3 text-sm text-white/55"
                                    >
                                        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[#35d6c5]" />
                                        <span>{point}</span>
                                    </div>
                                ))}
                            </div>
                        </article>
                    ))}
                </div>

                {/* Bottom statement */}
                <div
                    className={`mt-8 border-t border-white/[0.07] pt-4 transition-all duration-700 delay-500 ${visible
                        ? "translate-y-0 opacity-100"
                        : "translate-y-5 opacity-0"
                        }`}
                >
                    <p className="text-sm leading-6 text-white/35 sm:text-[16px]">
                        Same agent. Same execution model.{" "}
                        <span className="text-white/60">
                            The environment changes based on where you want the work to run.
                        </span>
                    </p>
                </div>
            </div>
        </section>
    );
}