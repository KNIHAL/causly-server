"use client";

import { useState } from "react";

const navItems = [
  { label: "Product", href: "#product" },
  { label: "Capabilities", href: "#capabilities" },
  { label: "Security", href: "#security" },
  { label: "Local vs Hosted", href: "#local-vs-hosted" },
  { label: "Docs", href: "#docs" },
];

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className="relative z-50 w-full border-b border-white/[0.06] bg-[#030b0d]/90 backdrop-blur-xl">
      <nav className="mx-auto flex h-[70px] w-full max-w-[1440px] items-center justify-between px-4 sm:px-5 lg:px-9">
        {/* Logo */}
        <a
          href="/"
          className="flex shrink-0 items-center"
          aria-label="Causly home"
        >
          <img
            src="/logo.png"
            alt="Causly"
            className="h-auto w-[122px] object-contain sm:w-[140px]"
          />
        </a>

        {/* Desktop Navigation */}
        <div className="hidden items-center gap-9 lg:flex">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="text-[15px] font-medium text-white/75 transition-colors duration-200 hover:text-white"
            >
              {item.label}
            </a>
          ))}
        </div>

        {/* Desktop CTA */}
        <a
          href="https://tally.so/r/NpZkpW"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden items-center gap-2 rounded-xl bg-[#35d6c5] px-6 py-3 text-[15px] font-semibold text-[#031012] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#45e0d0] hover:shadow-[0_8px_30px_rgba(53,214,197,0.2)] lg:flex"
        >
          Use Hosted
          <span className="text-lg leading-none">→</span>
        </a>

        {/* Mobile Menu Button */}
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-white lg:hidden"
          aria-label={isOpen ? "Close menu" : "Open menu"}
          aria-expanded={isOpen}
        >
          {isOpen ? (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          ) : (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          )}
        </button>
      </nav>

      {/* Mobile Navigation */}
      <div
        className={`overflow-hidden border-t border-white/[0.06] bg-[#030b0d] transition-all duration-300 lg:hidden ${isOpen ? "max-h-[420px] opacity-100" : "max-h-0 opacity-0"
          }`}
      >
        <div className="mx-auto flex max-w-[1440px] flex-col px-6 py-5 sm:px-8">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              onClick={() => setIsOpen(false)}
              className="border-b border-white/[0.05] py-4 text-[15px] font-medium text-white/75 transition-colors hover:text-white"
            >
              {item.label}
            </a>
          ))}

          {/* Mobile CTA */}
          <a
            href="https://tally.so/r/NpZkpW"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-[#35d6c5] px-5 py-3.5 text-[15px] font-semibold text-[#031012]"
          >
            Use Hosted
            <span className="text-lg leading-none">→</span>
          </a>
        </div>
      </div>
    </header>
  );
}