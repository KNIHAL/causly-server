const LINKEDIN_URL = "https://www.linkedin.com/in/kumar-nihal/";
const X_URL = "https://x.com/PandeyNiha54531";
const GITHUB_URL = "https://github.com/KNIHAL/causly-server";

export default function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-8 font-mono text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
        <span>Causly &copy; {new Date().getFullYear()}</span>
        <div className="flex items-center gap-5">
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-foreground">
            GitHub
          </a>
          <a href={X_URL} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-foreground">
            X
          </a>
          <a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-foreground">
            LinkedIn
          </a>
        </div>
      </div>
    </footer>
  );
}
