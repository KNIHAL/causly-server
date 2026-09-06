type Status = "live" | "building" | "planned";

const STATUS_LABEL: Record<Status, string> = {
  live: "live",
  building: "building",
  planned: "planned",
};

const STATUS_DOT: Record<Status, string> = {
  live: "bg-status-green",
  building: "bg-accent",
  planned: "bg-muted",
};

type ServerCardProps = {
  name: string;
  status: Status;
  description: string;
  meta?: string;
  href?: string;
  ctaLabel?: string;
};

export default function ServerCard({
  name,
  status,
  description,
  meta,
  href,
  ctaLabel,
}: ServerCardProps) {
  const isLinked = Boolean(href);

  const content = (
    <div className="flex h-full flex-col gap-4 rounded-md border border-border bg-surface p-6 transition-colors hover:border-accent/40 hover:bg-surface-hover">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-base text-foreground">{name}</h3>
        <span className="flex items-center gap-1.5 font-mono text-xs text-muted">
          <span
            className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`}
          />
          {STATUS_LABEL[status]}
        </span>
      </div>
      <p className="text-sm leading-relaxed text-muted">{description}</p>
      <div className="mt-auto flex items-center justify-between pt-2">
        {meta && (
          <span className="font-mono text-xs text-muted">{meta}</span>
        )}
        {ctaLabel && (
          <span className="font-mono text-xs text-accent">{ctaLabel}</span>
        )}
      </div>
    </div>
  );

  if (isLinked) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="block h-full">
        {content}
      </a>
    );
  }

  return content;
}
