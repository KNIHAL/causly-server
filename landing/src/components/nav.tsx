const GITHUB_URL = "https://github.com/KNIHAL/causly-server";
const DOCS_URL = "https://docs.causly.in";
const HOSTED_URL = "https://hosted.causly.in";

export default function Nav() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <a href="/" className="flex items-center gap-2">
          {/* PLACEHOLDER: swap for real logo mark, ~24px tall */}
          <img src="/logo.svg" alt="Causly" className="h-6 w-auto" />
        </a>
        <nav className="flex items-center gap-6 font-mono text-sm text-muted">
          <a href={DOCS_URL} className="transition-colors hover:text-foreground">
            Docs
          </a>
          <a href={HOSTED_URL} className="transition-colors hover:text-foreground">
            Hosted
          </a>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
