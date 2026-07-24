import { loadEnv } from "./tools/envLoader.js";
loadEnv();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import * as fileOps from "./tools/fileOps.js";
import * as dirOps from "./tools/directoryOps.js";
import * as gitOps from "./tools/gitOps.js";
import * as commandOps from "./tools/commandOps.js";
import * as githubOps from "./tools/githubOps.js";
import * as vercelOps from "./tools/vercelOps.js";
import * as supabaseOps from "./tools/supabaseOps.js";
import { logActivity } from "./tools/logger.js";

const server = new McpServer({
  name: "causly-server",
  version: "1.1.0",
});

/**
 * Wraps a tool handler with consistent logging + error handling so every
 * tool call is recorded to logs/activity.log, success or failure.
 */
function wrap(toolName, handler) {
  return async (input) => {
    try {
      const result = await handler(input);
      logActivity(toolName, input, "SUCCESS");
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      logActivity(toolName, input, "ERROR", err.message);
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  };
}

// ---------------- File tools ----------------

server.registerTool(
  "read_file",
  {
    description: "Read the full text content of a single file.",
    inputSchema: {
      path: z.string().describe("Absolute path to the file"),
      encoding: z.string().optional().describe("Text encoding, defaults to utf8"),
    },
  },
  wrap("read_file", fileOps.readFile)
);

server.registerTool(
  "read_multiple_files",
  {
    description: "Read multiple files in a single call. Failures on individual files do not stop the batch.",
    inputSchema: {
      paths: z.array(z.string()).describe("Array of absolute file paths"),
      encoding: z.string().optional(),
    },
  },
  wrap("read_multiple_files", fileOps.readMultipleFiles)
);

server.registerTool(
  "create_file",
  {
    description: "Create a brand-new file. Fails if the file already exists (use write_file to overwrite).",
    inputSchema: {
      path: z.string(),
      content: z.string().optional().describe("Initial file content, defaults to empty"),
    },
  },
  wrap("create_file", fileOps.createFile)
);

server.registerTool(
  "write_file",
  {
    description: "Create or completely overwrite a file with new content. Creates parent directories if needed.",
    inputSchema: {
      path: z.string(),
      content: z.string(),
    },
  },
  wrap("write_file", fileOps.writeFile)
);

server.registerTool(
  "edit_file",
  {
    description:
      "Edit a file via exact string find-and-replace, without rewriting the whole file. old_str must match exactly and be unique unless replace_all is set.",
    inputSchema: {
      path: z.string(),
      old_str: z.string().describe("Exact text to find"),
      new_str: z.string().describe("Text to replace it with"),
      replace_all: z.boolean().optional().describe("Replace every occurrence instead of requiring uniqueness"),
    },
  },
  wrap("edit_file", fileOps.editFile)
);

server.registerTool(
  "delete_file",
  {
    description: "Delete a single file.",
    inputSchema: { path: z.string() },
  },
  wrap("delete_file", fileOps.deleteFile)
);

server.registerTool(
  "move_file",
  {
    description: "Move or rename a file or directory.",
    inputSchema: { source: z.string(), destination: z.string() },
  },
  wrap("move_file", fileOps.moveFile)
);

server.registerTool(
  "copy_file",
  {
    description: "Copy a single file to a new location.",
    inputSchema: { source: z.string(), destination: z.string() },
  },
  wrap("copy_file", fileOps.copyFile)
);

server.registerTool(
  "get_file_info",
  {
    description: "Get metadata about a file or directory: size, type, created/modified timestamps.",
    inputSchema: { path: z.string() },
  },
  wrap("get_file_info", fileOps.getFileInfo)
);

// ---------------- Directory tools ----------------

server.registerTool(
  "list_directory",
  {
    description: "List the immediate files and subfolders inside a directory.",
    inputSchema: { path: z.string() },
  },
  wrap("list_directory", dirOps.listDirectory)
);

server.registerTool(
  "directory_tree",
  {
    description: "Recursively build a tree view of a directory's contents (skips node_modules and .git).",
    inputSchema: {
      path: z.string(),
      max_depth: z.number().optional().describe("Maximum recursion depth, default 5"),
    },
  },
  wrap("directory_tree", dirOps.directoryTree)
);

server.registerTool(
  "create_directory",
  {
    description: "Create a new directory, including any missing parent directories.",
    inputSchema: { path: z.string() },
  },
  wrap("create_directory", dirOps.createDirectory)
);

server.registerTool(
  "delete_directory",
  {
    description: "Delete a directory. Recursive by default so it removes nested contents too.",
    inputSchema: {
      path: z.string(),
      recursive: z.boolean().optional(),
    },
  },
  wrap("delete_directory", dirOps.deleteDirectory)
);

server.registerTool(
  "search_files",
  {
    description: "Recursively search for files/folders whose name contains a given pattern (case-insensitive).",
    inputSchema: {
      root_path: z.string(),
      pattern: z.string(),
      max_results: z.number().optional(),
    },
  },
  wrap("search_files", dirOps.searchFiles)
);

// ---------------- Git tools ----------------

server.registerTool(
  "git_init",
  {
    description: "Initialize a new git repository in the given directory.",
    inputSchema: { repo_path: z.string() },
  },
  wrap("git_init", gitOps.gitInit)
);

server.registerTool(
  "git_status",
  {
    description: "Show the working tree status of a git repository.",
    inputSchema: { repo_path: z.string() },
  },
  wrap("git_status", gitOps.gitStatus)
);

server.registerTool(
  "git_add",
  {
    description: "Stage files for commit. Defaults to staging everything ('.').",
    inputSchema: { repo_path: z.string(), files: z.union([z.string(), z.array(z.string())]).optional() },
  },
  wrap("git_add", gitOps.gitAdd)
);

server.registerTool(
  "git_commit",
  {
    description: "Commit staged changes with a message.",
    inputSchema: { repo_path: z.string(), message: z.string() },
  },
  wrap("git_commit", gitOps.gitCommit)
);

server.registerTool(
  "git_push",
  {
    description: "Push commits to a remote.",
    inputSchema: { repo_path: z.string(), remote: z.string().optional(), branch: z.string().optional() },
  },
  wrap("git_push", gitOps.gitPush)
);

server.registerTool(
  "git_pull",
  {
    description: "Pull changes from a remote.",
    inputSchema: { repo_path: z.string(), remote: z.string().optional(), branch: z.string().optional() },
  },
  wrap("git_pull", gitOps.gitPull)
);

server.registerTool(
  "git_log",
  {
    description: "Show recent commit history.",
    inputSchema: { repo_path: z.string(), max_count: z.number().optional() },
  },
  wrap("git_log", gitOps.gitLog)
);

server.registerTool(
  "git_diff",
  {
    description: "Show uncommitted changes, optionally scoped to one file.",
    inputSchema: { repo_path: z.string(), file: z.string().optional() },
  },
  wrap("git_diff", gitOps.gitDiff)
);

server.registerTool(
  "git_branch",
  {
    description: "List local branches and show the current branch.",
    inputSchema: { repo_path: z.string() },
  },
  wrap("git_branch", gitOps.gitBranch)
);

// ---------------- Command execution ----------------

server.registerTool(
  "run_command",
  {
    description:
      "Run a shell command in a given working directory (npm install, npm run build, pip install, tests, etc.). A short list of catastrophic patterns (drive wipes, format, shutdown) is blocked; everything else executes with full permissions.",
    inputSchema: {
      command: z.string().describe("The shell command to run"),
      cwd: z.string().describe("Working directory to run the command in"),
      timeout_ms: z.number().optional().describe("Timeout in ms, default 60000"),
    },
  },
  wrap("run_command", commandOps.runCommand)
);

// ---------------- GitHub tools ----------------

server.registerTool(
  "github_get_authenticated_user",
  {
    description: "Get the authenticated GitHub user's profile. Useful as a connectivity/auth check.",
    inputSchema: {},
  },
  wrap("github_get_authenticated_user", githubOps.githubGetAuthenticatedUser)
);

server.registerTool(
  "github_create_repo",
  {
    description: "Create a new GitHub repository for the authenticated user.",
    inputSchema: {
      name: z.string(),
      description: z.string().optional(),
      private: z.boolean().optional().describe("Defaults to false (public)"),
      auto_init: z.boolean().optional().describe("Initialize with a README, defaults to true"),
    },
  },
  wrap("github_create_repo", githubOps.githubCreateRepo)
);

server.registerTool(
  "github_delete_repo",
  {
    description: "Delete a GitHub repository. Requires Administration: write on the token.",
    inputSchema: { owner: z.string(), repo: z.string() },
  },
  wrap("github_delete_repo", githubOps.githubDeleteRepo)
);

server.registerTool(
  "github_list_repos",
  {
    description: "List repositories for the authenticated user.",
    inputSchema: {
      per_page: z.number().optional(),
      sort: z.string().optional().describe("created, updated, pushed, or full_name"),
    },
  },
  wrap("github_list_repos", githubOps.githubListRepos)
);

server.registerTool(
  "github_create_issue",
  {
    description: "Create an issue on a GitHub repository.",
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      title: z.string(),
      body: z.string().optional(),
      labels: z.array(z.string()).optional(),
    },
  },
  wrap("github_create_issue", githubOps.githubCreateIssue)
);

server.registerTool(
  "github_list_issues",
  {
    description: "List issues on a GitHub repository.",
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      state: z.string().optional().describe("open, closed, or all"),
      per_page: z.number().optional(),
    },
  },
  wrap("github_list_issues", githubOps.githubListIssues)
);

server.registerTool(
  "github_create_pull_request",
  {
    description: "Create a pull request on a GitHub repository.",
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      title: z.string(),
      head: z.string().describe("Branch containing the changes"),
      base: z.string().optional().describe("Branch to merge into, defaults to main"),
      body: z.string().optional(),
    },
  },
  wrap("github_create_pull_request", githubOps.githubCreatePullRequest)
);

server.registerTool(
  "github_list_pull_requests",
  {
    description: "List pull requests on a GitHub repository.",
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      state: z.string().optional().describe("open, closed, or all"),
      per_page: z.number().optional(),
    },
  },
  wrap("github_list_pull_requests", githubOps.githubListPullRequests)
);

server.registerTool(
  "github_add_comment",
  {
    description: "Add a comment to a GitHub issue or pull request.",
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      issue_number: z.number(),
      body: z.string(),
    },
  },
  wrap("github_add_comment", githubOps.githubAddComment)
);

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
      "Trigger a new deployment for a git-connected Vercel project by deploying from a given git ref (branch/commit). The project must already be linked to a git repo in Vercel.",
    inputSchema: {
      name: z.string().describe("Deployment/project name"),
      project: z.string().describe("Vercel project ID or name"),
      git_source_repo: z.string().describe("owner/repo"),
      git_source_ref: z.string().optional().describe("Branch or commit, defaults to main"),
      git_source_type: z.string().optional().describe("Defaults to github"),
    },
  },
  wrap("vercel_create_deployment", vercelOps.vercelCreateDeployment)
);

server.registerTool(
  "vercel_delete_project",
  {
    description: "Delete a Vercel project.",
    inputSchema: { project: z.string() },
  },
  wrap("vercel_delete_project", vercelOps.vercelDeleteProject)
);

// ---------------- Supabase tools ----------------

server.registerTool(
  "supabase_list_organizations",
  {
    description: "List organizations the authenticated account belongs to. Needed to create a new project.",
    inputSchema: {},
  },
  wrap("supabase_list_organizations", supabaseOps.supabaseListOrganizations)
);

server.registerTool(
  "supabase_list_projects",
  {
    description: "List Supabase projects for the authenticated account.",
    inputSchema: {},
  },
  wrap("supabase_list_projects", supabaseOps.supabaseListProjects)
);

server.registerTool(
  "supabase_get_project",
  {
    description: "Get details of a single Supabase project by its ref/ID.",
    inputSchema: { project_ref: z.string() },
  },
  wrap("supabase_get_project", supabaseOps.supabaseGetProject)
);

server.registerTool(
  "supabase_create_project",
  {
    description:
      "Create a new Supabase project. Requires an organization_id (use supabase_list_organizations to find it) and a database password.",
    inputSchema: {
      name: z.string(),
      organization_id: z.string(),
      db_pass: z.string(),
      region: z.string().optional().describe("Defaults to ap-south-1"),
      plan: z.string().optional().describe("Defaults to free"),
    },
  },
  wrap("supabase_create_project", supabaseOps.supabaseCreateProject)
);

server.registerTool(
  "supabase_delete_project",
  {
    description: "Delete a Supabase project.",
    inputSchema: { project_ref: z.string() },
  },
  wrap("supabase_delete_project", supabaseOps.supabaseDeleteProject)
);

server.registerTool(
  "supabase_run_sql",
  {
    description:
      "Run raw SQL against a project's database — used for creating tables, altering schema, seeding data, or running queries.",
    inputSchema: {
      project_ref: z.string(),
      query: z.string().describe("Raw SQL statement(s) to execute"),
    },
  },
  wrap("supabase_run_sql", supabaseOps.supabaseRunSql)
);

// ---------------- Start server ----------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("causly-server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting server:", err);
  process.exit(1);
});
