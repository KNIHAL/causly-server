"use client";

import { useEffect, useState } from "react";

const activities = [
    "Reading project files...",
    "Running agent task...",
    "Executing command...",
    "Updating environment...",
];

const desktopNodes = [
    { label: "Code", position: "left-[4%] top-[18%]" },
    { label: "Files", position: "left-[4%] bottom-[18%]" },
    { label: "Git", position: "right-[4%] top-[18%]" },
    { label: "Tools", position: "right-[2%] bottom-[18%]" },
];

const mobileNodes = ["Code", "Files", "Tools", "Shell"];

export default function AgentVisual() {
    const [activity, setActivity] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setActivity((current) => (current + 1) % activities.length);
        }, 2400);

        return () => clearInterval(interval);
    }, []);

    return (
        <div className="relative mx-auto w-full max-w-[650px]">
            {/* =========================================================
          DESKTOP VISUAL
      ========================================================= */}
            <div className="relative hidden min-h-[560px] items-center justify-center lg:flex">
                {/* Ambient glow */}
                <div className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#25d6c5]/10 blur-[110px]" />

                {/* Connection lines */}
                <svg
                    className="pointer-events-none absolute inset-0 h-full w-full"
                    viewBox="0 0 650 560"
                    fill="none"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                >
                    <path
                        d="M70 135 C175 135 190 250 325 280"
                        stroke="rgba(53,214,197,0.20)"
                        strokeWidth="1"
                    />
                    <path
                        d="M80 425 C175 425 195 315 325 280"
                        stroke="rgba(53,214,197,0.20)"
                        strokeWidth="1"
                    />
                    <path
                        d="M580 135 C475 135 460 250 325 280"
                        stroke="rgba(53,214,197,0.20)"
                        strokeWidth="1"
                    />
                    <path
                        d="M570 425 C475 425 455 315 325 280"
                        stroke="rgba(53,214,197,0.20)"
                        strokeWidth="1"
                    />

                    <circle r="3" fill="#35d6c5">
                        <animateMotion
                            dur="3.2s"
                            repeatCount="indefinite"
                            path="M70 135 C175 135 190 250 325 280"
                        />
                    </circle>

                    <circle r="3" fill="#35d6c5">
                        <animateMotion
                            dur="3.8s"
                            repeatCount="indefinite"
                            path="M570 425 C475 425 455 315 325 280"
                        />
                    </circle>
                </svg>

                {/* Outer frame */}
                <div className="relative flex aspect-square w-full max-w-[520px] items-center justify-center rounded-[30px] border border-white/[0.07] bg-white/[0.015] backdrop-blur-sm">
                    {/* Grid */}
                    <div
                        className="pointer-events-none absolute inset-0 rounded-[30px] opacity-20"
                        style={{
                            backgroundImage:
                                "linear-gradient(rgba(53,214,197,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(53,214,197,0.07) 1px, transparent 1px)",
                            backgroundSize: "32px 32px",
                            maskImage:
                                "radial-gradient(circle at center, black 20%, transparent 78%)",
                            WebkitMaskImage:
                                "radial-gradient(circle at center, black 20%, transparent 78%)",
                        }}
                    />

                    {/* Nodes */}
                    {desktopNodes.map((node) => (
                        <div
                            key={node.label}
                            className={`absolute ${node.position} z-20`}
                        >
                            <div className="flex items-center gap-2 rounded-xl border border-white/[0.09] bg-[#081719]/90 px-3.5 py-2.5 backdrop-blur-md">
                                <span className="h-1.5 w-1.5 rounded-full bg-[#35d6c5] shadow-[0_0_10px_rgba(53,214,197,0.8)]" />

                                <span className="text-[11px] font-medium text-white/65">
                                    {node.label}
                                </span>
                            </div>
                        </div>
                    ))}

                    {/* Main environment */}
                    <EnvironmentCard activity={activities[activity]} />

                    {/* Bottom label */}
                    <div className="absolute bottom-[8%] left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/[0.07] bg-[#071416]/80 px-3 py-1.5 backdrop-blur-md">
                        <span className="font-mono text-[8px] tracking-[0.18em] text-white/30">
                            REAL EXECUTION · ISOLATED · READY
                        </span>
                    </div>
                </div>
            </div>

            {/* =========================================================
          TABLET VISUAL
      ========================================================= */}
            <div className="relative hidden items-center justify-center py-10 sm:flex lg:hidden">
                <div className="pointer-events-none absolute h-[360px] w-[360px] rounded-full bg-[#25d6c5]/10 blur-[90px]" />

                <div className="relative w-full max-w-[480px] rounded-[28px] border border-white/[0.07] bg-white/[0.015] p-8 backdrop-blur-sm">
                    {/* Top connection */}
                    <div className="absolute left-1/2 top-0 h-10 w-px -translate-y-full bg-gradient-to-t from-[#35d6c5]/40 to-transparent" />

                    {/* Small nodes */}
                    <div className="mb-7 grid grid-cols-4 gap-2">
                        {mobileNodes.map((node) => (
                            <div
                                key={node}
                                className="flex items-center justify-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.025] px-2 py-2"
                            >
                                <span className="h-1.5 w-1.5 rounded-full bg-[#35d6c5]" />
                                <span className="text-[9px] text-white/50">{node}</span>
                            </div>
                        ))}
                    </div>

                    <EnvironmentCard activity={activities[activity]} compact />

                    <div className="mt-5 text-center font-mono text-[8px] tracking-[0.16em] text-white/25">
                        AGENT ENVIRONMENT · READY
                    </div>
                </div>
            </div>

            {/* =========================================================
          MOBILE VISUAL
      ========================================================= */}
            <div className="relative block py-7 sm:hidden">
                {/* Small ambient glow */}
                <div className="pointer-events-none absolute left-1/2 top-1/2 h-[230px] w-[230px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#25d6c5]/10 blur-[70px]" />

                {/* Mobile visual */}
                <div className="relative mx-auto w-full max-w-[330px]">
                    {/* Top agent */}
                    <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-white/[0.09] bg-[#071416]/90 px-4 py-2 backdrop-blur-md">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-[#35d6c5]" />

                        <span className="text-[10px] font-medium tracking-wide text-white/60">
                            AI AGENT
                        </span>
                    </div>

                    {/* Connection */}
                    <div className="mx-auto h-8 w-px bg-gradient-to-b from-[#35d6c5]/60 to-[#35d6c5]/10" />

                    {/* Runtime card */}
                    <div className="relative overflow-hidden rounded-[22px] border border-[#35d6c5]/25 bg-[#071416]/95 shadow-[0_0_45px_rgba(53,214,197,0.08)] backdrop-blur-xl">
                        {/* Header */}
                        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
                            <div>
                                <div className="text-[8px] font-medium tracking-[0.25em] text-[#35d6c5]/70">
                                    CAUSLY
                                </div>

                                <div className="mt-1 text-sm font-medium text-white">
                                    Agent Environment
                                </div>
                            </div>

                            <div className="flex items-center gap-1.5 rounded-full border border-[#35d6c5]/20 bg-[#35d6c5]/[0.06] px-2.5 py-1">
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#35d6c5]" />

                                <span className="text-[8px] font-medium text-[#35d6c5]">
                                    READY
                                </span>
                            </div>
                        </div>

                        {/* Runtime capabilities */}
                        <div className="grid grid-cols-2 gap-2 p-4">
                            {mobileNodes.map((node) => (
                                <div
                                    key={node}
                                    className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-3"
                                >
                                    <div className="mb-2 h-1.5 w-1.5 rounded-full bg-[#35d6c5]/80" />

                                    <span className="text-[9px] text-white/45">
                                        {node}
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* Activity */}
                        <div className="mx-4 mb-4 overflow-hidden rounded-xl border border-white/[0.06] bg-[#02090a]">
                            <div className="flex items-center gap-1.5 border-b border-white/[0.05] px-3 py-2">
                                <span className="h-1.5 w-1.5 rounded-full bg-white/15" />
                                <span className="h-1.5 w-1.5 rounded-full bg-white/15" />
                                <span className="h-1.5 w-1.5 rounded-full bg-white/15" />
                            </div>

                            <div className="px-3 py-3 font-mono text-[8px] leading-5">
                                <div className="text-white/25">$ causly run</div>

                                <div className="text-[#35d6c5]/80">
                                    {activities[activity]}
                                </div>

                                <div className="text-white/20">
                                    environment://active
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Bottom execution status */}
                    <div className="mx-auto h-8 w-px bg-gradient-to-b from-[#35d6c5]/40 to-transparent" />

                    <div className="mx-auto flex w-fit items-center gap-2 rounded-full border border-white/[0.07] bg-[#071416]/80 px-4 py-2 backdrop-blur-md">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#35d6c5]" />

                        <span className="font-mono text-[8px] tracking-[0.14em] text-white/35">
                            REAL EXECUTION
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* =========================================================
   REUSABLE ENVIRONMENT CARD
========================================================= */

function EnvironmentCard({
    activity,
    compact = false,
}: {
    activity: string;
    compact?: boolean;
}) {
    return (
        <div
            className={`relative z-30 w-[68%] max-w-[330px] ${compact ? "w-[75%]" : ""
                }`}
        >
            <div className="absolute -inset-8 rounded-[30px] bg-[#35d6c5]/10 blur-[45px] animate-pulse" />

            <div className="relative overflow-hidden rounded-[24px] border border-[#35d6c5]/30 bg-[#071416]/95 shadow-[0_0_50px_rgba(53,214,197,0.10)] backdrop-blur-xl">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
                    <div>
                        <div className="text-[9px] font-medium tracking-[0.25em] text-[#35d6c5]/70">
                            CAUSLY
                        </div>

                        <div className="mt-1 text-sm font-medium text-white">
                            Agent Environment
                        </div>
                    </div>

                    <div className="flex items-center gap-1.5 rounded-full border border-[#35d6c5]/20 bg-[#35d6c5]/[0.06] px-2.5 py-1">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#35d6c5]" />

                        <span className="text-[9px] font-medium text-[#35d6c5]">
                            READY
                        </span>
                    </div>
                </div>

                {/* Environment */}
                <div className="space-y-3 p-5">
                    <div className="grid grid-cols-2 gap-2">
                        {["Terminal", "Runtime", "Workspace", "Network"].map((item) => (
                            <div
                                key={item}
                                className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2.5"
                            >
                                <div className="mb-1 h-1.5 w-1.5 rounded-full bg-[#35d6c5]/70" />

                                <span className="text-[9px] text-white/45">
                                    {item}
                                </span>
                            </div>
                        ))}
                    </div>

                    {/* Terminal */}
                    <div className="overflow-hidden rounded-lg border border-white/[0.06] bg-[#02090a]">
                        <div className="flex items-center gap-1.5 border-b border-white/[0.05] px-3 py-2">
                            <span className="h-1.5 w-1.5 rounded-full bg-white/15" />
                            <span className="h-1.5 w-1.5 rounded-full bg-white/15" />
                            <span className="h-1.5 w-1.5 rounded-full bg-white/15" />

                            <span className="ml-1 text-[8px] text-white/25">
                                agent-terminal
                            </span>
                        </div>

                        <div className="min-h-[72px] px-3 py-3 font-mono text-[9px] leading-5">
                            <div className="text-white/30">$ causly run</div>

                            <div className="text-[#35d6c5]/80">
                                {activity}
                            </div>

                            <div className="text-white/20">
                                environment://active
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}