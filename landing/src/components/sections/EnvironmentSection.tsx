"use client";

import { useEffect, useRef, useState } from "react";

const capabilities = [
    {
        number: "01",
        title: "Code & Files",
        description:
            "Work directly with real projects, codebases, files, and workspaces instead of being limited to generating text.",
        icon: (
            <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
            >
                <path d="m8 9-3 3 3 3" />
                <path d="m16 9 3 3-3 3" />
                <path d="m14 5-4 14" />
            </svg>
        ),
    },
    {
        number: "02",
        title: "Tools",
        description:
            "Use the tools your workflow already depends on, from terminals and Git to databases and other connected services.",
        icon: (
            <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
            >
                <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.1 2.1-2.5-.5-.5-2.5 2.1-2.1Z" />
            </svg>
        ),
    },
    {
        number: "03",
        title: "Infrastructure",
        description:
            "Interact with the infrastructure and environments required to build, test, deploy, and operate real products.",
        icon: (
            <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
            >
                <rect x="4" y="4" width="16" height="6" rx="1.5" />
                <rect x="4" y="14" width="16" height="6" rx="1.5" />
                <path d="M8 7h.01M8 17h.01" />
            </svg>
        ),
    },
    {
        number: "04",
        title: "Execution",
        description:
            "Run commands, apply changes, test results, and perform actual work across the product lifecycle — not just generate answers.",
        icon: (
            <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5"
            >
                <path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z" />
            </svg>
        ),
    },
];

export default function EnvironmentSection() {
    const sectionRef = useRef<HTMLElement>(null);
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
            id="product"
            ref={sectionRef}
            className="relative overflow-hidden bg-[#030b0d] px-4 py-24 text-white sm:px-6 sm:py-28 lg:px-9 lg:py-32"
        >
            {/* Ambient glow */}
            <div className="pointer-events-none absolute -left-32 top-1/3 h-[350px] w-[350px] rounded-full bg-[#25d6c5]/[0.035] blur-[110px]" />

            <div className="relative mx-auto max-w-[1440px]">
                <div className="grid gap-14 lg:grid-cols-[0.8fr_1.2fr] lg:items-start lg:gap-20">
                    {/* LEFT CONTENT */}
                    <div
                        className={`max-w-[520px] transition-all duration-700 ${visible
                                ? "translate-y-0 opacity-100"
                                : "translate-y-5 opacity-0"
                            }`}
                    >
                        {/* Eyebrow */}
                        <div className="mb-5 flex items-center gap-3">
                            <span className="h-px w-7 bg-[#25d6c5]" />

                            <span className="text-[10px] font-medium tracking-[0.3em] text-white/40 sm:text-xs">
                                THE ENVIRONMENT
                            </span>
                        </div>

                        {/* Heading */}
                        <h2 className="text-[clamp(2.1rem,4vw,3.6rem)] font-semibold leading-[1.05] tracking-[-0.04em]">
                            An environment built for agents,
                            <span className="block text-[#27d8c7]">
                                not just conversations.
                            </span>
                        </h2>

                        {/* Description */}
                        <p className="mt-7 max-w-[500px] text-[15px] leading-7 text-white/55 sm:text-base sm:leading-8">
                            Causly gives AI agents a real workspace where they can access
                            code, files, tools, infrastructure, and execution capabilities —
                            so they can work across the full product lifecycle, from
                            building and testing to deploying and operating real products.
                        </p>

                        {/* Bottom statement */}
                        <div className="mt-9 border-l border-[#35d6c5]/30 pl-4">
                            <p className="text-sm leading-6 text-white/35">
                                Everything an agent needs to move from{" "}
                                <span className="text-white/60">intent</span> to{" "}
                                <span className="text-white/60">execution</span>.
                            </p>
                        </div>
                    </div>

                    {/* RIGHT CAPABILITIES */}
                    <div className="grid gap-3 sm:grid-cols-2">
                        {capabilities.map((capability, index) => (
                            <div
                                key={capability.number}
                                className={`group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 backdrop-blur-xl transition-all duration-500 hover:-translate-y-1 hover:border-[#35d6c5]/25 hover:bg-[#35d6c5]/[0.035] hover:shadow-[0_15px_45px_rgba(53,214,197,0.06)] sm:p-6 ${visible
                                        ? "translate-y-0 opacity-100"
                                        : "translate-y-6 opacity-0"
                                    }`}
                                style={{
                                    transitionDelay: visible ? `${150 + index * 100}ms` : "0ms",
                                }}
                            >
                                {/* Hover glow */}
                                <div className="pointer-events-none absolute -right-16 -top-16 h-32 w-32 rounded-full bg-[#35d6c5]/[0.06] opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100" />

                                {/* Header */}
                                <div className="relative flex items-center justify-between">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#35d6c5]/15 bg-[#35d6c5]/[0.05] text-[#35d6c5] transition-all duration-300 group-hover:border-[#35d6c5]/30 group-hover:bg-[#35d6c5]/[0.09]">
                                        {capability.icon}
                                    </div>

                                    <span className="font-mono text-[10px] tracking-[0.18em] text-white/20 transition-colors duration-300 group-hover:text-[#35d6c5]/40">
                                        {capability.number}
                                    </span>
                                </div>

                                {/* Content */}
                                <div className="relative mt-6">
                                    <h3 className="text-base font-medium text-white">
                                        {capability.title}
                                    </h3>

                                    <p className="mt-2 text-[12px] leading-5 text-white/40 sm:text-[13px] sm:leading-6">
                                        {capability.description}
                                    </p>
                                </div>

                                {/* Bottom accent */}
                                <div className="absolute bottom-0 left-5 right-5 h-px origin-left scale-x-0 bg-gradient-to-r from-[#35d6c5]/50 to-transparent transition-transform duration-500 group-hover:scale-x-100 sm:left-6 sm:right-6" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}