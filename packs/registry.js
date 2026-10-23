// Toolset ("pack") registry. Each pack is a module in this folder that
// exports a default register(server) function. Packs are imported only when
// they are loaded, so unused integrations cost nothing at startup.
//
// core: true  -> loaded at startup
// core: false -> loaded on demand (load_toolset tool) or via CAUSLY_TOOLSETS

export const PACKS = {
  files: {
    core: true,
    description: "Read, write, edit, copy, move and inspect files",
    load: () => import("./files.js"),
  },
  directory: {
    core: true,
    description: "List, create and delete directories; search file names",
    load: () => import("./directory.js"),
  },
  command: {
    core: true,
    description: "Run shell commands with safety checks",
    load: () => import("./command.js"),
  },
  project: {
    core: true,
    description: "Detect project type and health; run build, tests, lint and typecheck",
    load: () => import("./project.js"),
  },
  git: {
    core: false,
    description: "Local git: status, diff, commit, branch, merge, stash, tags, remotes",
    load: () => import("./git.js"),
  },
  github: {
    core: false,
    description: "GitHub repos, issues, pull requests, reviews and Actions workflows",
    load: () => import("./github.js"),
  },
  workflow: {
    core: false,
    description: "Ship pipeline: ship_change, deploy_project, fix_ci, verify_ci_fix",
    load: () => import("./workflow.js"),
  },
  vercel: {
    core: false,
    description: "Vercel projects and deployments, plus HTTP health checks",
    load: () => import("./vercel.js"),
  },
  supabase: {
    core: false,
    description: "Supabase projects, organizations and SQL",
    load: () => import("./supabase.js"),
  },
  database: {
    core: false,
    description: "Postgres and MySQL queries and schema inspection",
    load: () => import("./database.js"),
  },
  secrets: {
    core: false,
    description: "Encrypted local secrets store",
    load: () => import("./secrets.js"),
  },
  sentry: {
    core: false,
    description: "Sentry projects and issues",
    load: () => import("./sentry.js"),
  },
  slack: {
    core: false,
    description: "Slack channels, messages and threads",
    load: () => import("./slack.js"),
  },
  gmail: {
    core: false,
    description: "Gmail search, read, send, reply and forward",
    load: () => import("./gmail.js"),
  },
  notion: {
    core: false,
    description: "Notion pages, databases, blocks and comments",
    load: () => import("./notion.js"),
  },
  terraform: {
    core: false,
    description: "Terraform init, plan, apply, state, workspaces and PR plan comments",
    load: () => import("./terraform.js"),
  },
  research: {
    core: false,
    description: "Web research: search the web and fetch readable page text",
    load: () => import("./research.js"),
  },
  leads: {
    core: false,
    description: "Find leads: companies hiring (HN, remote job boards) and public company contact details",
    load: () => import("./leads.js"),
  },
  seo: {
    core: false,
    description: "SEO and content: keyword ideas, page audit, draft check, Google Search Console",
    load: () => import("./seo.js"),
  },
  pipeline: {
    core: false,
    description: "Local sales pipeline: leads, deals, contacts, activity log, report and CSV export",
    load: () => import("./pipeline.js"),
  },
  calendar: {
    core: false,
    description: "Google Calendar: events, free/busy, find meeting slots, create, update and delete",
    load: () => import("./calendar.js"),
  },
  telegram: {
    core: false,
    description: "Telegram bot: alert yourself, read messages sent to the bot, send to chats",
    load: () => import("./telegram.js"),
  },
  linear: {
    core: false,
    description: "Linear issues: list, read, create, update, comment",
    load: () => import("./linear.js"),
  },
  stripe: {
    core: false,
    description: "Stripe (test mode first): customers, draft and sent invoices, payment links, payments, refunds",
    load: () => import("./stripe.js"),
  },
  discord: {
    core: false,
    description: "Discord bot: list servers and channels, read messages, post messages",
    load: () => import("./discord.js"),
  },
  reminders: {
    core: false,
    description: "Reminders and follow-ups saved locally; check what is due",
    load: () => import("./reminders.js"),
  },
  docker: {
    core: false,
    description: "Docker and Docker Compose: build, run, logs, images, exec",
    load: () => import("./docker.js"),
  },
};
