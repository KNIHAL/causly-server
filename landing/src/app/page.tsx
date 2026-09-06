import Nav from "@/components/nav";
import Footer from "@/components/footer";
import TerminalHero from "@/components/terminal-hero";
import ServerCard from "@/components/server-card";

const GITHUB_URL = "https://github.com/KNIHAL/causly-server";
const DOCS_URL = "https://docs.causly.in";
const HOSTED_URL = "https://hosted.causly.in";

export default function Home() {
  return (
    <>
      <Nav />
      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto max-w-5xl px-6 pt-20 pb-16">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <h1 className="max-w-md text-4xl font-medium leading-tight text-foreground sm:text-5xl">
                One connection. Every server Causly builds.
              </h1>
              <p className="mt-6 max-w-sm text-base leading-relaxed text-muted">
                MCP servers that give AI clients real access to your
                infrastructure — code, ship, and run it, not just talk about
                it. Start with the open-source server, or run the hosted
                version.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md bg-accent px-5 py-2.5 font-mono text-sm text-background transition-opacity hover:opacity-90"
                >
                  View on GitHub
                </a>
                <a
                  href={DOCS_URL}
                  className="rounded-md border border-border px-5 py-2.5 font-mono text-sm text-foreground transition-colors hover:border-accent/40"
                >
                  Read the docs
                </a>
              </div>
            </div>
            <div className="flex justify-center lg:justify-end">
              <TerminalHero />
            </div>
          </div>
        </section>

        {/* Servers */}
        <section className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="font-mono text-sm text-muted">Servers</h2>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <ServerCard
              name="causly-server"
              status="live"
              description="Open-source MCP server — GitHub, Docker, Terraform, databases, Vercel, Slack, Gmail, Notion, Sentry, and a built-in security layer."
              meta="181 tools"
              href={GITHUB_URL}
              ctaLabel="View on GitHub"
            />
            <ServerCard
              name="causly-hosted"
              status="building"
              description="The same server, hosted and managed — no local setup, connect and go."
              href={HOSTED_URL}
              ctaLabel="Learn more"
            />
            <ServerCard
              name="More servers"
              status="planned"
              description="Additional MCP servers for other parts of the stack. Nothing scoped yet — check back."
            />
          </div>
        </section>

        {/* Docs strip */}
        <section className="border-t border-border">
          <div className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-10 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted">
              Tool reference, setup guides, and architecture notes for every
              server.
            </p>
            <a
              href={DOCS_URL}
              className="font-mono text-sm text-accent transition-opacity hover:opacity-80"
            >
              docs.causly.in
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
