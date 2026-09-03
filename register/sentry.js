// Paste this block into index.js, in the tools import section (near the top):
//   import * as sentryOps from "./tools/sentryOps.js";
//
// Then paste the block below as a new "Sentry / monitoring tools" section.

server.registerTool(
  "sentry_list_projects",
  {
    description: "List projects in the organization.",
    inputSchema: { org_slug: z.string().describe("Sentry organization slug") },
  },
  wrap("sentry_list_projects", sentryOps.sentryListProjects)
);

server.registerTool(
  "sentry_list_issues",
  {
    description: "List recent issues (errors) for a project.",
    inputSchema: {
      org_slug: z.string(),
      project_slug: z.string(),
      query: z.string().optional().describe("Sentry search syntax, e.g. 'is:unresolved'"),
      limit: z.number().optional().describe("Defaults to 25"),
    },
  },
  wrap("sentry_list_issues", sentryOps.sentryListIssues)
);

server.registerTool(
  "sentry_search_issues",
  {
    description: "Search issues with a Sentry query string (e.g. 'is:unresolved level:error').",
    inputSchema: {
      org_slug: z.string(),
      project_slug: z.string(),
      query: z.string(),
      limit: z.number().optional().describe("Defaults to 25"),
    },
  },
  wrap("sentry_search_issues", sentryOps.sentrySearchIssues)
);

server.registerTool(
  "sentry_get_issue",
  {
    description: "Get a single issue's full detail (stack trace context, occurrence counts).",
    inputSchema: { issue_id: z.string() },
  },
  wrap("sentry_get_issue", sentryOps.sentryGetIssue)
);

server.registerTool(
  "sentry_resolve_issue",
  {
    description: "Mark an issue as resolved. HIGH risk — requires confirm: true.",
    inputSchema: { issue_id: z.string(), confirm: z.boolean().optional().describe("Must be true to proceed") },
  },
  wrap("sentry_resolve_issue", sentryOps.sentryResolveIssue)
);

server.registerTool(
  "sentry_ignore_issue",
  {
    description: "Mute/ignore an issue so it stops notifying. HIGH risk — requires confirm: true.",
    inputSchema: { issue_id: z.string(), confirm: z.boolean().optional().describe("Must be true to proceed") },
  },
  wrap("sentry_ignore_issue", sentryOps.sentryIgnoreIssue)
);

server.registerTool(
  "sentry_get_project_stats",
  {
    description: "Get error-count stats/trends for a project over a time period.",
    inputSchema: {
      org_slug: z.string(),
      project_slug: z.string(),
      stat: z.string().optional().describe("Defaults to 'received'"),
      period: z.string().optional().describe("Defaults to '24h' (informational label only)"),
    },
  },
  wrap("sentry_get_project_stats", sentryOps.sentryGetProjectStats)
);

server.registerTool(
  "sentry_add_comment",
  {
    description: "Add a comment/note to an issue. HIGH risk — requires confirm: true.",
    inputSchema: {
      issue_id: z.string(),
      text: z.string(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("sentry_add_comment", sentryOps.sentryAddComment)
);
