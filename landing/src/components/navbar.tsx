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
    <>
      {/* Navbar */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.06] bg-[#030b0d]/85 backdrop-blur-xl">
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
            onClick={() => setIsOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-white lg:hidden"
            aria-label="Open menu"
          >
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
          </button>
        </nav>
      </header>

      {/* Mobile Overlay */}
      <div
        onClick={() => setIsOpen(false)}
        className={`fixed inset-0 z-[60] bg-black/50 backdrop-blur-[2px] transition-opacity duration-300 lg:hidden ${isOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
          }`}
      />

      {/* Mobile Drawer */}
      <aside
        className={`fixed right-0 top-0 z-[70] flex h-dvh w-[min(340px,88vw)] flex-col border-l border-white/[0.08] bg-[#061012] shadow-[-20px_0_60px_rgba(0,0,0,0.45)] transition-transform duration-300 ease-out lg:hidden ${isOpen ? "translate-x-0" : "translate-x-full"
          }`}
      >
        {/* Drawer Header */}
        <div className="flex h-[70px] items-center justify-between border-b border-white/[0.06] px-5">
          <img
            src="/logo.png"
            alt="Causly"
            className="w-[125px] object-contain"
          />

          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-white/80 transition-colors hover:text-white"
            aria-label="Close menu"
          >
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
          </button>
        </div>

        {/* Links */}
        <div className="flex flex-1 flex-col px-5 py-6">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              onClick={() => setIsOpen(false)}
              className="border-b border-white/[0.06] py-4 text-[15px] font-medium text-white/75 transition-colors hover:text-white"
            >
              {item.label}
            </a>
          ))}

          <a
            href="https://tally.so/r/NpZkpW"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setIsOpen(false)}
            className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-[#35d6c5] px-5 py-3.5 text-[15px] font-semibold text-[#031012]"
          >
            Use Hosted
            <span className="text-lg leading-none">→</span>
          </a>
        </div>
      </aside>
    </>
  );
}