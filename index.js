import { loadEnv } from "./tools/envLoader.js";
loadEnv();

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as gitOps from "./tools/gitOps.js";
import * as projectOps from "./tools/projectOps.js";
import { initPacks } from "./packs/loader.js";

const server = new McpServer({
  name: "causly-server",
  version: "1.1.0",
});

// ---------------- MCP Resources ----------------
//
// Give the AI project context without forcing it to reconstruct
// everything through individual tool calls. The repo path is passed
// URI-encoded as a single path segment (Windows paths contain ':' and
// '\', which aren't safe as raw URI template variables) and decoded on
// read. Example URI: causly://project/D%3A%5Ccausly-server/health

function projectResourceUri(kind) {
  return new ResourceTemplate(`causly://project/{encodedPath}/${kind}`, { list: undefined });
}

server.registerResource(
  "project_health_resource",
  projectResourceUri("health"),
  {
    title: "Project Health",
    description: "Git cleanliness, dependency install status, and env file presence for a project directory.",
    mimeType: "application/json",
  },
  async (uri, { encodedPath }) => {
    const repo_path = decodeURIComponent(encodedPath);
    const data = await projectOps.projectHealth({ repo_path });
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
  }
);

server.registerResource(
  "project_info_resource",
  projectResourceUri("info"),
  {
    title: "Project Info",
    description: "Language, framework, package manager, resolved commands, and git branch/remotes for a project directory.",
    mimeType: "application/json",
  },
  async (uri, { encodedPath }) => {
    const repo_path = decodeURIComponent(encodedPath);
    const data = await projectOps.projectInfo({ repo_path });
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
  }
);

server.registerResource(
  "project_git_resource",
  projectResourceUri("git"),
  {
    title: "Project Git State",
    description: "Current git status (changed files, ahead/behind, clean state) for a project directory.",
    mimeType: "application/json",
  },
  async (uri, { encodedPath }) => {
    const repo_path = decodeURIComponent(encodedPath);
    const data = await gitOps.gitStatus({ repo_path });
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
  }
);


// ---------------- MCP Prompts ----------------
//
// Reusable prompt templates that guide the AI toward the safe, repeatable
// workflows this server was built for, instead of it reinventing the
// sequence each time.

server.registerPrompt(
  "ship-feature",
  {
    title: "Ship a feature",
    description: "Guide for taking a code change from request to open PR using this server's tools.",
    argsSchema: {
      repo_path: z.string(),
      description: z.string().describe("What the change should do"),
    },
  },
  ({ repo_path, description }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Ship this change in ${repo_path}: ${description}\n\n` +
            `Steps:\n` +
            `1. Use project_info to understand the stack and current branch.\n` +
            `2. Make the code changes with read_file/edit_file/write_file.\n` +
            `3. Call ship_change (repo_path, a descriptive branch_name, commit_message, confirm: true) — ` +
            `it will run tests/lint/typecheck/build, commit, push, and open a PR automatically. ` +
            `It stops early and reports exactly what failed if any check fails.\n` +
            `4. Report the PR URL back once ship_change succeeds.`,
        },
      },
    ],
  })
);

server.registerPrompt(
  "fix-ci",
  {
    title: "Fix a failing CI run",
    description: "Guide for diagnosing and fixing a failing GitHub Actions run using this server's tools.",
    argsSchema: {
      repo_path: z.string(),
      owner: z.string(),
      repo: z.string(),
      branch: z.string().optional(),
    },
  },
  ({ repo_path, owner, repo, branch }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Fix CI for ${owner}/${repo}${branch ? ` on branch ${branch}` : ""}.\n\n` +
            `Steps:\n` +
            `1. Call fix_ci (owner, repo${branch ? ", branch" : ""}) — it finds the latest failing run, ` +
            `lists failed jobs, and pulls their logs.\n` +
            `2. Read the logs_tail for each failed job to understand the actual failure.\n` +
            `3. Fix the code in ${repo_path} with read_file/edit_file.\n` +
            `4. Call verify_ci_fix (repo_path, owner, repo, branch, commit_message, confirm: true) — ` +
            `it commits, pushes, and polls until the new run completes.\n` +
            `5. If it still fails, repeat from step 2 with the new logs.`,
        },
      },
    ],
  })
);

server.registerPrompt(
  "deploy-project",
  {
    title: "Deploy a project",
    description: "Guide for safely deploying and verifying a project using this server's tools.",
    argsSchema: {
      repo_path: z.string(),
      project: z.string().describe("Vercel project ID or name"),
      git_source_repo: z.string().describe("owner/repo"),
    },
  },
  ({ repo_path, project, git_source_repo }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Deploy ${project} (${git_source_repo}) from ${repo_path}.\n\n` +
            `Call deploy_project (repo_path, project, git_source_repo, confirm: true). ` +
            `It checks the working tree is clean, runs tests + build, triggers the deployment, ` +
            `polls until ready, then HTTP-checks the live URL. Report the final ok/failed status ` +
            `and, if it failed, the failed_step and any build_errors/logs it returned — don't just ` +
            `say "deployment triggered", confirm it's actually live and healthy.`,
        },
      },
    ],
  })
);

server.registerPrompt(
  "review-changes",
  {
    title: "Review a pull request",
    description: "Guide for reviewing an open PR's diff, discussion, and CI status using this server's tools.",
    argsSchema: {
      owner: z.string(),
      repo: z.string(),
      pull_number: z.string().describe("PR number as a string, e.g. '42'"),
    },
  },
  ({ owner, repo, pull_number }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Review PR #${pull_number} on ${owner}/${repo}.\n\n` +
            `1. github_get_pull_request for status/mergeable state.\n` +
            `2. github_get_pull_request_files for the changed-file list and size of the change.\n` +
            `3. github_get_pull_request_diff for the actual code diff.\n` +
            `4. github_get_pull_request_comments and github_get_pull_request_reviews for existing discussion.\n` +
            `5. github_list_workflow_runs (branch: the PR's head branch) to check CI status.\n` +
            `Summarize: what changed, whether it looks correct, any concerns, and whether CI is green.`,
        },
      },
    ],
  })
);

// ---------------- Start server ----------------

async function main() {
  const transport = new StdioServerTransport();
  await initPacks(server);

  await server.connect(transport);
  console.error("causly-server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting server:", err);
  process.exit(1);
});
