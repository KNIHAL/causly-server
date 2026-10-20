import { z } from "zod";
import * as vercelOps from "../tools/vercelOps.js";
import { wrap } from "../tools/toolWrapper.js";

export default function register(server) {
// ---------------- Vercel tools ----------------

server.registerTool(
  "vercel_get_authenticated_user",
  {
    description: "Get the authenticated Vercel user/team. Useful as a connectivity/auth check.",
    inputSchema: {},
  },
  wrap("vercel_get_authenticated_user", vercelOps.vercelGetAuthenticatedUser)
);

server.registerTool(
  "vercel_list_projects",
  {
    description: "List Vercel projects for the authenticated account.",
    inputSchema: { limit: z.number().optional() },
  },
  wrap("vercel_list_projects", vercelOps.vercelListProjects)
);

server.registerTool(
  "vercel_get_project",
  {
    description: "Get details of a single Vercel project by name or ID.",
    inputSchema: { project: z.string() },
  },
  wrap("vercel_get_project", vercelOps.vercelGetProject)
);

server.registerTool(
  "vercel_list_deployments",
  {
    description: "List recent Vercel deployments, optionally scoped to a project.",
    inputSchema: { project: z.string().optional(), limit: z.number().optional() },
  },
  wrap("vercel_list_deployments", vercelOps.vercelListDeployments)
);

server.registerTool(
  "vercel_get_deployment",
  {
    description: "Get the status/details of a specific Vercel deployment.",
    inputSchema: { deployment_id: z.string() },
  },
  wrap("vercel_get_deployment", vercelOps.vercelGetDeployment)
);

server.registerTool(
  "vercel_create_deployment",
  {
    description:
      "Trigger a new deployment for a git-connected Vercel project by deploying from a given git ref (branch/commit). The project must already be linked to a git repo in Vercel. HIGH risk — requires confirm: true.",
    inputSchema: {
      name: z.string().describe("Deployment/project name"),
      project: z.string().describe("Vercel project ID or name"),
      git_source_repo: z.string().describe("owner/repo"),
      git_source_ref: z.string().optional().describe("Branch or commit, defaults to main"),
      git_source_type: z.string().optional().describe("Defaults to github"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("vercel_create_deployment", vercelOps.vercelCreateDeployment)
);

server.registerTool(
  "vercel_delete_project",
  {
    description: "Delete a Vercel project. DESTRUCTIVE — requires confirm: true.",
    inputSchema: { project: z.string(), confirm: z.boolean().optional().describe("Must be true to proceed") },
  },
  wrap("vercel_delete_project", vercelOps.vercelDeleteProject)
);

server.registerTool(
  "vercel_get_deployment_logs",
  {
    description: "Get build/runtime logs for a deployment.",
    inputSchema: { deployment_id: z.string(), limit: z.number().optional() },
  },
  wrap("vercel_get_deployment_logs", vercelOps.vercelGetDeploymentLogs)
);

server.registerTool(
  "vercel_get_deployment_events",
  {
    description: "Get a deployment's build/progress state — ready state, checks state, and build error details if it failed.",
    inputSchema: { deployment_id: z.string() },
  },
  wrap("vercel_get_deployment_events", vercelOps.vercelGetDeploymentEvents)
);

server.registerTool(
  "vercel_cancel_deployment",
  {
    description: "Cancel a currently building or queued deployment.",
    inputSchema: { deployment_id: z.string() },
  },
  wrap("vercel_cancel_deployment", vercelOps.vercelCancelDeployment)
);

server.registerTool(
  "http_check",
  {
    description: "Hit a URL and report status code, health, and response time — use to verify a deployment is actually live and healthy.",
    inputSchema: { url: z.string(), timeout_ms: z.number().optional() },
  },
  wrap("http_check", vercelOps.httpCheck)
);
}
