"use client";

import { useEffect, useRef, useState } from "react";

const actions = [
    {
        type: "docs",
        eyebrow: "LEARN",
        title: "Documentation",
        description:
            "Understand how Causly works and start building with the agent environment.",
        cta: "Read Docs",
        href: "https://knihal.github.io/causly-server/docs/architecture",
    },
    {
        type: "github",
        eyebrow: "OPEN SOURCE",
        title: "Causly OSS",
        description:
            "Run Causly on your own machine and give your agent access to your environment.",
        cta: "View on GitHub",
        href: "https://github.com/KNIHAL/causly-server",
    },
    {
        type: "hosted",
        eyebrow: "CLOUD",
        title: "Causly Hosted",
        description:
            "Give your agent a dedicated managed environment built for real execution.",
        cta: "Join Waitlist",
        href: "https://tally.so/r/NpZkpW",
    },
];

export default function FinalCTA() {
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
            id="docs"
            className="relative overflow-hidden bg-[#030b0d] px-4 py-12 text-white sm:px-6 sm:py-14 lg:px-9 lg:py-16"
        >
            {/* Background glow */}
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-[500px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#8b5cf6]/[0.025] blur-[150px]" />

            <div className="relative mx-auto max-w-[1250px]">
                {/* Intro */}
                <div
                    className={`mx-auto max-w-[700px] text-center transition-all duration-700 ${visible
                        ? "translate-y-0 opacity-100"
                        : "translate-y-6 opacity-0"
                        }`}
                >
                    <div className="mb-4 flex items-center justify-center gap-3">
                        <span className="h-px w-5 bg-white/30" />
                        <span className="text-[11px] font-medium tracking-[0.3em] text-white/40 sm:text-xs">
                            READY TO BUILD?
                        </span>
                        <span className="h-px w-5 bg-white/30" />
                    </div>

                    <h2 className="text-[clamp(2.3rem,4vw,3rem)] font-semibold leading-[1.02] tracking-[-0.045em]">
                        Give your agent
                        <span className="block text-white/40">
                            a place to work.
                        </span>
                    </h2>

                    <p className="mx-auto mt-4 max-w-[750px] text-base leading-7 text-white/50 sm:text-m sm:leading-6">
                        Explore Causly, run it yourself, or get access to a managed
                        environment built for real agent execution.
                    </p>
                </div>

                {/* CTA options */}
                <div className="mt-10 grid gap-4 md:grid-cols-3">
                    {actions.map((action, index) => (
                        <CTAItem
                            key={action.type}
                            action={action}
                            index={index}
                            visible={visible}
                        />
                    ))}
                </div>
            </div>
        </section>
    );
}

function CTAItem({
    action,
    index,
    visible,
}: {
    action: (typeof actions)[number];
    index: number;
    visible: boolean;
}) {
    const styles = {
        docs: {
            border: "border-[#8b5cf6]/30 hover:border-[#8b5cf6]/60",
            bg: "bg-[#8b5cf6]/[0.045] hover:bg-[#8b5cf6]/[0.08]",
            text: "text-[#a78bfa]",
            glow: "group-hover:shadow-[0_20px_60px_rgba(139,92,246,0.10)]",
        },
        github: {
            border: "border-white/[0.12] hover:border-white/25",
            bg: "bg-[#181717] hover:bg-[#202020]",
            text: "text-white",
            glow: "group-hover:shadow-[0_20px_60px_rgba(0,0,0,0.35)]",
        },
        hosted: {
            border: "border-[#f97316]/35 hover:border-[#f97316]/70",
            bg: "bg-[#f97316]/[0.055] hover:bg-[#f97316]/[0.10]",
            text: "text-[#fb923c]",
            glow: "group-hover:shadow-[0_20px_60px_rgba(249,115,22,0.10)]",
        },
    };

    const style = styles[action.type as keyof typeof styles];

    return (
        <a
            href={action.href}
            target={action.type === "hosted" ? "_blank" : undefined}
            rel={action.type === "hosted" ? "noopener noreferrer" : undefined}
            className={`group relative flex min-h-[310px] flex-col overflow-hidden rounded-2xl border p-7 transition-all duration-500 hover:-translate-y-1 sm:p-8 ${style.border} ${style.bg} ${style.glow} ${visible
                ? "translate-y-0 opacity-100"
                : "translate-y-8 opacity-0"
                }`}
            style={{
                transitionDelay: `${150 + index * 100}ms`,
            }}
        >
            {/* Icon */}
            <div
                className={`flex h-12 w-12 items-center justify-center rounded-xl border border-white/[0.08] bg-black/20 ${style.text}`}
            >
                {action.type === "docs" && <DocsIcon />}
                {action.type === "github" && <GithubIcon />}
                {action.type === "hosted" && <CloudIcon />}
            </div>

            <div className="mt-4">
                <span
                    className={`text-[9px] font-semibold tracking-[0.25em] ${style.text}`}
                >
                    {action.eyebrow}
                </span>

                <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                    {action.title}
                </h3>

                <p className="mt-3 text-sm leading-6 text-white/45">
                    {action.description}
                </p>
            </div>

            <div className="mt-auto flex items-center justify-between pt-8">
                <span className="text-sm font-medium text-white/70">
                    {action.cta}
                </span>

                <span
                    className={`text-lg transition-transform duration-300 group-hover:translate-x-1 ${style.text}`}
                >
                    →
                </span>
            </div>
        </a>
    );
}

/* Icons */

function DocsIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            className="h-6 w-6"
        >
            <path d="M6 3.5h9l3 3V20.5H6z" />
            <path d="M14 3.5v4h4" />
            <path d="M9 12h6M9 15.5h6" />
        </svg>
    );
}

function GithubIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-6 w-6"
        >
            <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.04c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.74.08-.74 1.2.08 1.83 1.23 1.83 1.23 1.07 1.83 2.8 1.3 3.49.99.11-.77.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.94 0-1.31.47-2.38 1.23-3.22-.12-.3-.53-1.52.12-3.17 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6-.01c2.3-1.55 3.3-1.23 3.3-1.23.65 1.65.24 2.87.12 3.17.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.63-5.48 5.93.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.57A12 12 0 0 0 12 .5Z" />
        </svg>
    );
}

function CloudIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            className="h-6 w-6"
        >
            <path d="M7.5 18.5h9a4 4 0 0 0 .5-7.97A5.5 5.5 0 0 0 6.26 9.2 4.75 4.75 0 0 0 7.5 18.5Z" />
        </svg>
    );
}