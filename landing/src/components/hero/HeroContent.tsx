import Link from "next/link";

export default function HeroContent() {
    return (
        <div className="w-full max-w-[680px]">
            {/* Eyebrow */}
            <div className="mb-6 flex items-center gap-3">
                <span className="h-px w-7 bg-[#25d6c5]" />

                <span className="text-[11px] font-medium tracking-[0.34em] text-white/55 sm:text-xs">
                    CAUSLY AGENT ENVIRONMENT
                </span>
            </div>

            {/* Heading */}
            <h1 className="text-[clamp(2.7rem,5vw,4.25rem)] font-semibold leading-[1.02] tracking-[-0.045em] text-white">
                Give AI Agents a{" "}
                <span className="block text-[#27d8c7]">
                    Real Environment
                </span>
                <span className="block">
                    to Build and Operate.
                </span>
            </h1>

            {/* Description */}
            <p className="mt-7 max-w-[600px] text-base leading-7 text-white/60 sm:text-lg sm:leading-8">
                A secure execution environment where AI agents can work with your
                code, infrastructure, databases, and tools — locally or in the cloud.
            </p>

            {/* CTAs */}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link
                    href="#local"
                    className="group inline-flex h-14 items-center justify-center gap-3 rounded-xl bg-[#35d6c5] px-7 text-[15px] font-semibold text-[#031012] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#48dfd0] hover:shadow-[0_12px_40px_rgba(53,214,197,0.18)]"
                >
                    Run Locally
                    <span className="text-lg transition-transform duration-200 group-hover:translate-x-1">
                        →
                    </span>
                </Link>

                <a
                    href="https://tally.so/r/NpZkpW"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group inline-flex h-14 items-center justify-center gap-3 rounded-xl border border-[#1dd5c3]/60 bg-transparent px-7 text-[15px] font-medium text-white transition-all duration-200 hover:border-[#35d6c5] hover:bg-[#35d6c5]/5"
                >
                    Use Hosted
                    <span className="text-lg transition-transform duration-200 group-hover:translate-x-1">
                        →
                    </span>
                </a>
            </div>

            {/* Feature highlights */}
            <div className="mt-12 grid grid-cols-1 gap-7 sm:grid-cols-3 sm:gap-5">
                {/* Secure */}
                <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.025]">
                        <svg
                            width="21"
                            height="21"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#27d8c7"
                            strokeWidth="1.6"
                        >
                            <path d="M12 3 20 6v5c0 5.2-3.4 8.7-8 10-4.6-1.3-8-4.8-8-10V6l8-3Z" />
                            <path d="m9 12 2 2 4-4" />
                        </svg>
                    </div>

                    <div>
                        <h3 className="text-sm font-medium text-white">
                            Secure & Isolated
                        </h3>

                        <p className="mt-1 text-[11px] leading-4 text-white/40">
                            Each agent in its own environment
                        </p>
                    </div>
                </div>

                {/* Execution */}
                <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.025]">
                        <svg
                            width="21"
                            height="21"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#27d8c7"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z" />
                        </svg>
                    </div>

                    <div>
                        <h3 className="text-sm font-medium text-white">
                            Real Execution
                        </h3>

                        <p className="mt-1 text-[11px] leading-4 text-white/40">
                            Not just answers — real work
                        </p>
                    </div>
                </div>

                {/* Flexible */}
                <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.025]">
                        <svg
                            width="21"
                            height="21"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#27d8c7"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
                            <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
                        </svg>
                    </div>

                    <div>
                        <h3 className="text-sm font-medium text-white">
                            Open & Flexible
                        </h3>

                        <p className="mt-1 text-[11px] leading-4 text-white/40">
                            Use your tools, your stack
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}