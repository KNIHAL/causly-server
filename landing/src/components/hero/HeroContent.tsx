"use client";

import Link from "next/link";
import { motion, Variants } from "framer-motion";

// Container variant to stagger child animations smoothly
const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: {
            staggerChildren: 0.1,
            delayChildren: 0.05,
        },
    },
};

// Item variants for text & CTAs (fade up effect)
const itemVariants: Variants = {
    hidden: { opacity: 0, y: 16 },
    visible: {
        opacity: 1,
        y: 0,
        transition: {
            duration: 0.6,
            ease: [0.16, 1, 0.3, 1],
        },
    },
};

// Distinct slide-in animation for eyebrow line
const lineVariants: Variants = {
    hidden: { scaleX: 0, originX: 0 },
    visible: {
        scaleX: 1,
        transition: { duration: 0.5, ease: "easeOut" },
    },
};

// Feature cards stagger & fade-up
const cardVariants: Variants = {
    hidden: { opacity: 0, y: 12 },
    visible: {
        opacity: 1,
        y: 0,
        transition: {
            duration: 0.5,
            ease: "easeOut",
        },
    },
};

export default function HeroContent() {
    return (
        <motion.div
            className="w-full max-w-[680px]"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
        >
            {/* Eyebrow */}
            <motion.div
                variants={itemVariants}
                className="mb-4 flex items-center gap-3"
            >
                <motion.span
                    variants={lineVariants}
                    className="h-px w-4 bg-[#25d6c5]"
                />
                <span className="text-[11px] font-medium tracking-[0.30em] text-white/55 sm:text-xs">
                    CAUSLY AGENT ENVIRONMENT
                </span>
            </motion.div>

            {/* Heading */}
            <h1 className="text-[clamp(2.7rem,5vw,4.25rem)] font-semibold leading-[1.02] tracking-[-0.045em] text-white">
                <motion.span variants={itemVariants} className="block">
                    Give AI Agents a
                </motion.span>

                <motion.span
                    variants={itemVariants}
                    className="block text-[#27d8c7] [text-shadow:0_0_30px_rgba(39,216,199,0.12)]"
                >
                    Real Environment
                </motion.span>

                <motion.span variants={itemVariants} className="block">
                    to Build and Operate.
                </motion.span>
            </h1>

            {/* Description */}
            <motion.p
                variants={itemVariants}
                className="mt-7 max-w-[600px] text-base leading-7 text-white/60 sm:text-lg sm:leading-8"
            >
                A secure execution environment where AI agents can work with your
                code, infrastructure, databases, and tools — locally or in the cloud.
            </motion.p>

            {/* CTAs */}
            <motion.div
                variants={itemVariants}
                className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center"
            >
                <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>
                    <Link
                        href="https://github.com/KNIHAL/causly-server"
                        className="group inline-flex h-14 w-full items-center justify-center gap-3 rounded-xl bg-[#35d6c5] px-7 text-[15px] font-semibold text-[#031012] transition-colors duration-200 hover:bg-[#48dfd0] hover:shadow-[0_12px_40px_rgba(53,214,197,0.18)] sm:w-auto"
                    >
                        Run Locally
                        <span className="text-lg transition-transform duration-200 group-hover:translate-x-1">
                            →
                        </span>
                    </Link>
                </motion.div>

                <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>
                    <a
                        href="https://tally.so/r/NpZkpW"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group inline-flex h-14 w-full items-center justify-center gap-3 rounded-xl border border-[#1dd5c3]/60 bg-transparent px-7 text-[15px] font-medium text-white transition-colors duration-200 hover:border-[#35d6c5] hover:bg-[#35d6c5]/5 sm:w-auto"
                    >
                        Use Hosted
                        <span className="text-lg transition-transform duration-200 group-hover:translate-x-1">
                            →
                        </span>
                    </a>
                </motion.div>
            </motion.div>

            {/* Feature highlights — hidden on mobile */}
            <motion.div
                variants={itemVariants}
                className="mt-12 hidden grid-cols-1 gap-7 sm:grid sm:grid-cols-3 sm:gap-5"
            >
                {/* Secure */}
                <motion.div
                    variants={cardVariants}
                    whileHover={{ y: -3 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    className="flex items-start gap-3 rounded-lg p-1"
                >
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
                </motion.div>

                {/* Execution */}
                <motion.div
                    variants={cardVariants}
                    whileHover={{ y: -3 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    className="flex items-start gap-3 rounded-lg p-1"
                >
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
                </motion.div>

                {/* Flexible */}
                <motion.div
                    variants={cardVariants}
                    whileHover={{ y: -3 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    className="flex items-start gap-3 rounded-lg p-1"
                >
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
                </motion.div>
            </motion.div>
        </motion.div>
    );
}