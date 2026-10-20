import { z } from "zod";
import * as workflowOps from "../tools/workflowOps.js";
import { wrap } from "../tools/toolWrapper.js";

export default function register(server) {
// ---------------- Workflow tools ----------------

server.registerTool(
  "ship_change",
  {
    description:
      "WORKFLOW: take already-made file edits from working tree to an open pull request. Inspects changed files, creates a branch, runs tests/lint/typecheck/build (stopping early on failure), commits, pushes, and opens a PR. Does not edit files itself — make the code changes first with file tools, then call this. HIGH risk — requires confirm: true.",
    inputSchema: {
      repo_path: z.string(),
      branch_name: z.string(),
      commit_message: z.string(),
      pr_title: z.string().optional().describe("Defaults to commit_message"),
      pr_body: z.string().optional(),
      base: z.string().optional().describe("Base branch to PR into, defaults to main"),
      owner: z.string().optional().describe("GitHub owner, auto-resolved from git remote if omitted"),
      repo: z.string().optional().describe("GitHub repo, auto-resolved from git remote if omitted"),
      run_checks: z.boolean().optional().describe("Run tests/lint/typecheck/build before committing, defaults to true"),
      skip_if_no_changes: z.boolean().optional().describe("Defaults to true"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("ship_change", workflowOps.shipChange)
);

server.registerTool(
  "fix_ci",
  {
    description:
      "WORKFLOW: investigate a failing GitHub Actions run — finds the latest failing run (or a given run_id), lists its jobs, pulls logs for every failed job, and returns a structured diagnosis. Does not write the fix itself. After reading the logs and fixing the code with file tools, call verify_ci_fix.",
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      branch: z.string().optional().describe("Filter to a branch when auto-finding the latest failing run"),
      run_id: z.number().optional().describe("Investigate a specific run instead of auto-finding the latest failure"),
    },
  },
  wrap("fix_ci", workflowOps.fixCi)
);

server.registerTool(
  "verify_ci_fix",
  {
    description:
      "WORKFLOW: after fixing code found via fix_ci, commit and push the change, then poll GitHub Actions until the new run completes and report pass/fail. HIGH risk — requires confirm: true.",
    inputSchema: {
      repo_path: z.string(),
      owner: z.string(),
      repo: z.string(),
      branch: z.string(),
      commit_message: z.string(),
      poll_interval_ms: z.number().optional().describe("Defaults to 15000"),
      max_polls: z.number().optional().describe("Defaults to 20 (5 min at default interval)"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("verify_ci_fix", workflowOps.verifyCiFix)
);

server.registerTool(
  "deploy_project",
  {
    description:
      "WORKFLOW: safely deploy a project and verify it. Checks project health (working tree clean), runs tests + build (aborts if either fails), triggers a Vercel deployment, polls until ready, then HTTP health-checks the live URL. Returns a verified pass/fail result, not just a 'deployment triggered' status. HIGH risk — requires confirm: true.",
    inputSchema: {
      repo_path: z.string(),
      project: z.string().describe("Vercel project ID or name"),
      git_source_repo: z.string().describe("owner/repo"),
      git_source_ref: z.string().optional().describe("Branch or commit, defaults to main"),
      deployment_name: z.string().optional().describe("Defaults to the project name"),
      health_check_url: z.string().optional().describe("Defaults to the deployment's own URL"),
      run_checks: z.boolean().optional().describe("Run tests + build before deploying, defaults to true"),
      poll_interval_ms: z.number().optional().describe("Defaults to 10000"),
      max_polls: z.number().optional().describe("Defaults to 30 (5 min at default interval)"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("deploy_project", workflowOps.deployProject)
);
}
