"use client";

import { useEffect, useState } from "react";

type Line = {
  text: string;
  className?: string;
  pause?: number; // ms to wait after this line finishes
};

const LINES: Line[] = [
  { text: "$ claude mcp connect causly", className: "text-foreground" },
  { text: "  resolving servers...", className: "text-muted", pause: 200 },
  {
    text: "  causly-server   ready   181 tools",
    className: "text-status-green",
  },
  {
    text: "  causly-hosted   building",
    className: "text-muted",
    pause: 300,
  },
];

const TYPE_SPEED_MS = 18;

export default function TerminalHero() {
  const [visibleLines, setVisibleLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const out: string[] = [];
      for (const line of LINES) {
        let current = "";
        for (const char of line.text) {
          if (cancelled) return;
          current += char;
          out[out.length] = current;
          setVisibleLines([...out.slice(0, -1), current]);
          await sleep(TYPE_SPEED_MS);
        }
        out[out.length - 1] = line.text;
        setVisibleLines([...out]);
        await sleep(line.pause ?? 120);
      }
      if (!cancelled) setDone(true);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="w-full max-w-lg rounded-md border border-border bg-surface font-mono text-sm shadow-none">
      <div className="flex items-center gap-1.5 border-b border-border px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-border" />
        <span className="h-2.5 w-2.5 rounded-full bg-border" />
        <span className="h-2.5 w-2.5 rounded-full bg-border" />
        <span className="ml-2 text-xs text-muted">mcp-client</span>
      </div>
      <div className="px-4 py-4 leading-relaxed">
        {LINES.map((line, i) => {
          const shown = visibleLines[i];
          if (shown === undefined) return null;
          return (
            <div key={i} className={line.className}>
              {shown}
              {i === visibleLines.length - 1 && !done && (
                <span className="cursor-blink">_</span>
              )}
            </div>
          );
        })}
        {done && <span className="cursor-blink text-accent">_</span>}
      </div>
    </div>
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
