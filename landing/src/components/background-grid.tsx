type BackgroundGridProps = {
  /** Words stacked diagonally along the grid, top to bottom. */
  words?: string[];
  /** Extra classes for positioning this instance (e.g. within a section). */
  className?: string;
};

/**
 * Decorative isometric grid + rotated keyword stack, used as a subtle
 * background accent. Meant to sit behind content with pointer-events
 * disabled. Reuse this with different `words` / `className` per section
 * instead of duplicating the whole page background.
 */
export default function BackgroundGrid({
  words = ["Build", "Automate", "Scale", "Without Limits"],
  className = "",
}: BackgroundGridProps) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none select-none absolute inset-0 overflow-hidden ${className}`}
    >
      <svg
        className="absolute -bottom-24 -left-24 h-[640px] w-[640px] text-border"
        viewBox="0 0 640 640"
      >
        <defs>
          <pattern
            id="iso-grid"
            width="40"
            height="69.28"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M0 0 L40 23.09 L40 69.28 L0 46.19 Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
            <path
              d="M0 46.19 L40 23.09"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </pattern>
          <linearGradient id="iso-fade" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="white" stopOpacity="0.9" />
            <stop offset="65%" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <mask id="iso-fade-mask">
            <rect width="100%" height="100%" fill="url(#iso-fade)" />
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="url(#iso-grid)"
          mask="url(#iso-fade-mask)"
        />
      </svg>

      <div className="absolute bottom-10 left-10 flex -rotate-[18deg] flex-col gap-3 origin-bottom-left">
        {words.map((word) => (
          <span
            key={word}
            className="font-mono text-2xl tracking-wide text-border/70 md:text-4xl"
          >
            {word}
          </span>
        ))}
      </div>
    </div>
  );
}
