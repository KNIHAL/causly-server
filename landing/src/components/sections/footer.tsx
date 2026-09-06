import Link from "next/link";

const productLinks = [
    { label: "Product", href: "#product" },

    { label: "Local vs Hosted", href: "#local-vs-hosted" },
    { label: "How It Works", href: "#how-it-works" },
];

const resourceLinks = [
    { label: "Documentation", href: "https://knihal.github.io/causly-server/docs/architecture" },
    { label: "GitHub", href: "https://github.com/knihal/causly-server" },
    { label: "Hosted", href: "https://tally.so/r/NpZkpW" },
];

const legalLinks = [
    { label: "Privacy Policy", href: "/privacy" },
    { label: "Terms of Service", href: "/terms" }
];

export default function Footer() {
    return (
        <footer className="border-t border-white/[0.07] bg-[#020708] text-white">
            <div className="mx-auto w-full max-w-[1240px] px-4 py-14 sm:px-6 sm:py-16 lg:px-9">
                <div className="grid grid-cols-2 gap-x-8 gap-y-12 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:gap-8">
                    {/* Brand */}
                    <div className="max-w-[300px]">
                        <Link
                            href="/"
                            className="inline-flex items-center"
                            aria-label="Causly home"
                        >
                            <img
                                src="/logo.png"
                                alt="Causly"
                                className="h-auto w-[120px]"
                            />
                        </Link>

                        <p className="mt-5 text-sm leading-6 text-white/35">
                            An execution environment for AI agents to build, run, and
                            operate real work.
                        </p>
                    </div>

                    {/* Product */}
                    <FooterColumn title="Product" links={productLinks} />

                    {/* Resources */}
                    <FooterColumn title="Resources" links={resourceLinks} />

                    {/* Legal */}
                    <FooterColumn title="Legal" links={legalLinks} />
                </div>


                {/* Bottom */}
                <div className="mt-14 flex flex-col gap-4 border-t border-white/[0.06] pt-6 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-white/25">
                        © {new Date().getFullYear()} Causly. All rights reserved.
                    </p>

                    <p className="text-xs text-white/20">
                        Built for agents that do more than talk.
                    </p>
                </div>
            </div>
        </footer>
    );
}

function FooterColumn({
    title,
    links,
}: {
    title: string;
    links: { label: string; href: string }[];
}) {
    return (
        <div>
            <h3 className="text-[10px] font-semibold tracking-[0.22em] text-white/45">
                {title.toUpperCase()}
            </h3>

            <div className="mt-5 flex flex-col gap-3">
                {links.map((link) => {
                    const external = link.href.startsWith("http");

                    if (external) {
                        return (
                            <a
                                key={link.label}
                                href={link.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-fit text-sm text-white/40 transition-colors duration-200 hover:text-white"
                            >
                                {link.label}
                            </a>
                        );
                    }

                    return (
                        <Link
                            key={link.label}
                            href={link.href}
                            className="w-fit text-sm text-white/40 transition-colors duration-200 hover:text-white"
                        >
                            {link.label}
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}