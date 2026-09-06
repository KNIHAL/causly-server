"use client";

import { useEffect, useRef, useState } from "react";

const resources = ["CODE", "FILES", "PROJECTS", "ENVIRONMENT"];
const tools = ["TERMINAL", "GIT", "TOOLS"];
const actions = ["READ", "WRITE", "RUN", "BUILD", "TEST", "DEPLOY"];

export default function HowItWorks() {
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
            { threshold: 0.12 }
        );

        observer.observe(element);

        return () => observer.disconnect();
    }, []);

    return (
        <section
            ref={sectionRef}
            id="how-it-works"
            className="relative overflow-hidden bg-[#050914] px-4 py-12 text-white sm:px-6 sm:py-14 lg:px-9 lg:py-20"
        >
            {/* Background grid */}
            <div
                className="pointer-events-none absolute inset-0 opacity-[0.035]"
                style={{
                    backgroundImage:
                        "linear-gradient(rgba(255,255,255,.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.7) 1px, transparent 1px)",
                    backgroundSize: "48px 48px",
                }}
            />

            <div className="pointer-events-none absolute left-1/2 top-1/3 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-[#5b5ce2]/[0.035] blur-[150px]" />

            <div className="relative mx-auto w-full max-w-[1500px]">
                {/* Intro */}
                <div
                    className={`mx-auto max-w-[820px] text-center transition-all duration-700 ${visible
                        ? "translate-y-0 opacity-100"
                        : "translate-y-6 opacity-0"
                        }`}
                >
                    <div className="mb-3.5 flex items-center justify-center gap-3">
                        <span className="h-px w-5 bg-[#7c7cff]" />
                        <span className="text-[9px] font-medium tracking-[0.3em] text-white/45 sm:text-xs">
                            HOW IT WORKS
                        </span>
                        <span className="h-px w-5 bg-[#7c7cff]" />
                    </div>

                    <h2 className="text-[clamp(2rem,3.5vw,3rem)] font-semibold leading-[1.06] tracking-[-0.035em]">
                        From instruction to
                        <span className="block text-[#8b8cff]">
                            real execution.
                        </span>

                    </h2>

                    <p className="mt-3 max-w-[860px] text-base leading-7 text-white/50 sm:text-m sm:leading-8">
                        Causly connects your AI agent to the environment where the work
                        needs to happen — giving it access to the resources, tools, and
                        execution capabilities required to actually get things done.
                    </p>
                </div>

                {/* ================= DESKTOP DIAGRAM ================= */}
                <div
                    className={`mt-10 hidden transition-all duration-1000 lg:block ${visible
                        ? "translate-y-0 opacity-100"
                        : "translate-y-8 opacity-0"
                        }`}
                >
                    <div className="relative rounded-[25px] border border-white/[0.08] bg-[#070d18]/80 p-8 xl:p-10">
                        {/* Main flow */}
                        <div className="flex w-[200px] items-center justify-between gap-1">
                            {/* AI */}
                            <DiagramNode
                                color="purple"
                                label="AI AGENT"
                                sub="Your preferred agent"
                            />

                            <FlowLine />

                            {/* Causly */}
                            <DiagramNode
                                color="teal"
                                label="CAUSLY"
                                sub="Execution layer"
                                highlighted
                            />

                            <FlowLine />

                            {/* Environment */}
                            <div className="flex w-[210px] shrink-0 flex-col gap-3">
                                <SmallNode color="blue" label="CAUSLY OSS" sub="Your machine" />
                                <SmallNode
                                    color="orange"
                                    label="CAUSLY HOSTED"
                                    sub="Managed cloud"
                                />
                            </div>

                            <FlowLine />

                            {/* Workspace */}
                            <div className="w-[220px] shrink-0">
                                <SectionNode title="WORKSPACE" color="yellow">
                                    <div className="grid grid-cols-2 gap-2">
                                        {resources.map((item) => (
                                            <MiniNode key={item}>{item}</MiniNode>
                                        ))}
                                    </div>
                                </SectionNode>
                            </div>

                            <FlowLine />

                            {/* Tools */}
                            <div className="w-[180px] shrink-0">
                                <SectionNode title="TOOLS" color="blue">
                                    <div className="space-y-2">
                                        {tools.map((item) => (
                                            <MiniNode key={item}>{item}</MiniNode>
                                        ))}
                                    </div>
                                </SectionNode>
                            </div>

                            <FlowLine />

                            {/* Execution */}
                            <div className="w-[220px] shrink-0">
                                <SectionNode title="EXECUTION" color="green">
                                    <div className="grid grid-cols-3 gap-2">
                                        {actions.map((item) => (
                                            <MiniNode key={item}>{item}</MiniNode>
                                        ))}
                                    </div>
                                </SectionNode>
                            </div>
                        </div>

                        {/* Result */}
                        <div className="mt-3 flex items-center justify-center gap-3">
                            <div className="h-px w-20 bg-gradient-to-r from-transparent to-[#65e6a7]/50" />

                            <div className="rounded-full border border-[#65e6a7]/30 bg-[#65e6a7]/[0.06] px-6 py-3 text-center">
                                <span className="block text-[9px] tracking-[0.25em] text-[#65e6a7]/70">
                                    RESULT
                                </span>
                                <span className="mt-1 block text-sm font-medium text-white/80">
                                    REAL WORK GETS DONE
                                </span>
                            </div>

                            <div className="h-px w-20 bg-gradient-to-l from-transparent to-[#65e6a7]/50" />
                        </div>
                    </div>
                </div>

                {/* ================= MOBILE DIAGRAM ================= */}
                <div
                    className={`mt-10 transition-all duration-1000 lg:hidden ${visible
                        ? "translate-y-0 opacity-100"
                        : "translate-y-8 opacity-0"
                        }`}
                >
                    <div className="mx-auto h-fit max-w-[250px]">
                        <MobileNode
                            color="purple"
                            label="AI CLIENT"
                            sub="Claude · Cursor · Any Agent"
                        />

                        <MobileArrow color="purple" />

                        <MobileNode
                            color="purple"
                            label="AI AGENT"
                            sub="Instruction"
                        />

                        <MobileArrow color="teal" />

                        <MobileNode
                            color="teal"
                            label="CAUSLY"
                            sub="Agent execution layer"
                            highlighted
                        />

                        <MobileArrow color="teal" />

                        {/* OSS / Hosted branch */}
                        <div className="grid grid-cols-2 gap-2.5">
                            <MobileNode
                                color="blue"
                                label="OSS"
                                sub="Your machine"
                                compact
                            />
                            <MobileNode
                                color="orange"
                                label="HOSTED"
                                sub="Managed cloud"
                                compact
                            />
                        </div>

                        <MobileArrow color="yellow" />

                        {/* Workspace */}
                        <MobileNode
                            color="yellow"
                            label="WORKSPACE"
                            sub="Where the agent works"
                        />

                        <div className="my-3 grid grid-cols-2 gap-2">
                            {resources.map((item) => (
                                <MiniNode key={item}>{item}</MiniNode>
                            ))}
                        </div>

                        <MobileArrow color="blue" />

                        <MobileNode
                            color="blue"
                            label="TOOLS"
                            sub="Terminal · Git · Services"
                        />

                        <MobileArrow color="green" />

                        {/* Execution */}
                        <MobileNode
                            color="green"
                            label="EXECUTION"
                            sub="Real actions"
                        />

                        <div className="mt-3 grid grid-cols-3 gap-2">
                            {actions.map((item) => (
                                <MiniNode key={item}>{item}</MiniNode>
                            ))}
                        </div>

                        <MobileArrow color="green" />

                        <div className="rounded-2xl border border-[#65e6a7]/30 bg-[#65e6a7]/[0.06] px-5 py-4 text-center">
                            <span className="block text-[9px] tracking-[0.25em] text-[#65e6a7]/70">
                                RESULT
                            </span>
                            <span className="mt-1 block text-sm font-medium text-white/85">
                                REAL WORK GETS DONE
                            </span>
                        </div>
                    </div>
                </div>

                {/* Punch line */}
                <div
                    className={`mx-auto mt-5 max-w-[8000px] text-center transition-all delay-500 duration-700 ${visible
                        ? "translate-y-0 opacity-100"
                        : "translate-y-5 opacity-0"
                        }`}
                >
                    <p className="text-[clamp(0.7rem,2vw,2rem)] font-small leading-tight tracking-[-0.035em] text-white/85">
                        Use whatever agent you like. {""}

                        <span className="text-[#8b8cff]">
                            Give it Causly, and let it get the work done.
                        </span>
                    </p>
                </div>
            </div>
        </section>
    );
}

/* ---------------- Desktop Components ---------------- */

function DiagramNode({
    color,
    label,
    sub,
    highlighted = false,
}: {
    color: string;
    label: string;
    sub: string;
    highlighted?: boolean;
}) {
    const colors: Record<string, string> = {
        purple: "border-[#8b8cff]/40 bg-[#8b8cff]/[0.07] text-[#a7a7ff]",
        teal: "border-[#35d6c5]/45 bg-[#35d6c5]/[0.07] text-[#35d6c5]",
    };

    return (
        <div
            className={`w-[170px] shrink-0 rounded-2xl border px-5 py-5 ${colors[color]
                } ${highlighted ? "shadow-[0_0_40px_rgba(53,214,197,0.08)]" : ""}`}
        >
            <span className="block text-[10px] font-semibold tracking-[0.2em]">
                {label}
            </span>
            <span className="mt-2 block text-xs text-white/40">{sub}</span>
        </div>
    );
}

function SmallNode({
    color,
    label,
    sub,
}: {
    color: string;
    label: string;
    sub: string;
}) {
    const colorMap: Record<string, string> = {
        blue: "border-[#65a8ff]/30 text-[#7eb5ff]",
        orange: "border-[#ffad70]/30 text-[#ffb37a]",
    };

    return (
        <div
            className={`rounded-xl border bg-white/[0.015] px-4 py-3 ${colorMap[color]}`}
        >
            <span className="block text-[9px] font-semibold tracking-[0.18em]">
                {label}
            </span>
            <span className="mt-1 block text-[10px] text-white/35">{sub}</span>
        </div>
    );
}

function SectionNode({
    title,
    color,
    children,
}: {
    title: string;
    color: string;
    children: React.ReactNode;
}) {
    const colorMap: Record<string, string> = {
        yellow: "border-[#ffd76a]/30 text-[#ffe08a]",
        blue: "border-[#65a8ff]/30 text-[#7eb5ff]",
        green: "border-[#65e6a7]/30 text-[#76e9ae]",
    };

    return (
        <div className={`rounded-2xl border bg-white/[0.015] p-4 ${colorMap[color]}`}>
            <span className="mb-2 block text-[9px] font-semibold tracking-[0.2em]">
                {title}
            </span>
            {children}
        </div>
    );
}

function MiniNode({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex min-h-8 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 text-center font-mono text-[8px] tracking-[0.08em] text-white/40">
            {children}
        </div>
    );
}

function FlowLine() {
    return (
        <div className="relative flex min-w-[24px] flex-1 items-center">
            <div className="h-px w-full bg-white/[0.12]" />
            <div className="absolute left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[#8b8cff] shadow-[0_0_12px_rgba(139,140,255,0.8)]" />
        </div>
    );
}

/* ---------------- Mobile Components ---------------- */

function MobileNode({
    color,
    label,
    sub,
    highlighted = false,
    compact = false,
}: {
    color: string;
    label: string;
    sub: string;
    highlighted?: boolean;
    compact?: boolean;
}) {
    const colors: Record<string, string> = {
        purple: "border-[#8b8cff]/35 bg-[#8b8cff]/[0.06] text-[#aaaaff]",
        teal: "border-[#35d6c5]/40 bg-[#35d6c5]/[0.06] text-[#35d6c5]",
        blue: "border-[#65a8ff]/30 bg-[#65a8ff]/[0.04] text-[#7eb5ff]",
        orange: "border-[#ffad70]/30 bg-[#ffad70]/[0.04] text-[#ffb37a]",
        yellow: "border-[#ffd76a]/30 bg-[#ffd76a]/[0.04] text-[#ffe08a]",
        green: "border-[#65e6a7]/30 bg-[#65e6a7]/[0.04] text-[#76e9ae]",
    };

    return (
        <div
            className={`rounded-2xl border text-center ${compact ? "px-3 py-4" : "px-5 py-4"
                } ${colors[color]} ${highlighted
                    ? "shadow-[0_0_35px_rgba(53,214,197,0.08)]"
                    : ""
                }`}
        >
            <span className="block text-[10px] font-semibold tracking-[0.2em]">
                {label}
            </span>

            <span className="mt-2 block text-[10px] text-white/40">{sub}</span>
        </div>
    );
}

function MobileArrow({ color }: { color: string }) {
    const colorMap: Record<string, string> = {
        purple: "text-[#8b8cff]",
        teal: "text-[#35d6c5]",
        blue: "text-[#65a8ff]",
        yellow: "text-[#ffd76a]",
        green: "text-[#65e6a7]",
    };

    return (
        <div className="flex h-9.5 items-center justify-center">
            <div className="flex h-full flex-col items-center justify-center">
                <div className="h-5 w-px bg-white/[0.14]" />
                <span className={`text-xs ${colorMap[color]}`}>↓</span>
            </div>
        </div>
    );
}