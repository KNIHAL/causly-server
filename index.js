import { loadEnv } from "./tools/envLoader.js";
loadEnv();

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import * as fileOps from "./tools/fileOps.js";
import * as dirOps from "./tools/directoryOps.js";
import * as gitOps from "./tools/gitOps.js";
import * as commandOps from "./tools/commandOps.js";
import * as githubOps from "./tools/githubOps.js";
import * as vercelOps from "./tools/vercelOps.js";
import * as supabaseOps from "./tools/supabaseOps.js";
import * as slackOps from "./tools/slackOps.js";
import * as gmailOps from "./tools/gmailOps.js";
import * as projectOps from "./tools/projectOps.js";
import * as workflowOps from "./tools/workflowOps.js";
import { logActivity } from "./tools/logger.js";
import { checkApproval } from "./tools/security.js";
import * as notionOps from "./tools/notionOps.js";
import * as terraformOps from "./tools/terraformOps.js";
import * as dockerOps from "./tools/dockerOps.js";
import * as dbOps from "./tools/dbOps.js";
import * as secretsOps from "./tools/secretsOps.js";

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
    const approval = checkApproval(toolName, input);
    if (!approval.allowed) {
      logActivity(toolName, input, "BLOCKED", approval.reason);
      return {
        content: [{ type: "text", text: `Blocked: ${approval.reason}` }],
        isError: true,
      };
    }
    const startedAt = Date.now();
    try {
      const result = await handler(input);
      logActivity(toolName, input, "SUCCESS", "", Date.now() - startedAt);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      logActivity(toolName, input, "ERROR", err.message, Date.now() - startedAt);
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  };
}

//---------------- Database tools ----------------
server.registerTool(
  "postgres_query",
  {
    description: "Run a read or write SQL query against a Postgres database.",
    inputSchema: {
      connection_string: z.string().describe("postgres://user:pass@host:5432/dbname"),
      sql: z.string(),
      params: z.array(z.any()).optional().describe("Positional params for $1, $2, ..."),
    },
  },
  wrap("postgres_query", dbOps.postgresQuery)
);

server.registerTool(
  "postgres_list_tables",
  {
    description: "List all tables in a Postgres database (public schema by default).",
    inputSchema: {
      connection_string: z.string(),
      schema: z.string().optional().describe("Defaults to 'public'"),
    },
  },
  wrap("postgres_list_tables", dbOps.postgresListTables)
);

server.registerTool(
  "postgres_describe_table",
  {
    description: "Get column names, types, and nullability for a Postgres table.",
    inputSchema: {
      connection_string: z.string(),
      table: z.string(),
      schema: z.string().optional().describe("Defaults to 'public'"),
    },
  },
  wrap("postgres_describe_table", dbOps.postgresDescribeTable)
);

server.registerTool(
  "postgres_test_connection",
  {
    description: "Test a Postgres connection string — returns server version on success.",
    inputSchema: { connection_string: z.string() },
  },
  wrap("postgres_test_connection", dbOps.postgresTestConnection)
);

server.registerTool(
  "mysql_query",
  {
    description: "Run a read or write SQL query against a MySQL database.",
    inputSchema: {
      connection_string: z.string().describe("mysql://user:pass@host:3306/dbname"),
      sql: z.string(),
      params: z.array(z.any()).optional().describe("Positional params for ? placeholders"),
    },
  },
  wrap("mysql_query", dbOps.mysqlQuery)
);

server.registerTool(
  "mysql_list_tables",
  {
    description: "List all tables in a MySQL database.",
    inputSchema: { connection_string: z.string() },
  },
  wrap("mysql_list_tables", dbOps.mysqlListTables)
);

server.registerTool(
  "mysql_describe_table",
  {
    description: "Get column names, types, and nullability for a MySQL table.",
    inputSchema: { connection_string: z.string(), table: z.string() },
  },
  wrap("mysql_describe_table", dbOps.mysqlDescribeTable)
);

server.registerTool(
  "mysql_test_connection",
  {
    description: "Test a MySQL connection string — returns server version on success.",
    inputSchema: { connection_string: z.string() },
  },
  wrap("mysql_test_connection", dbOps.mysqlTestConnection)
);

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
    description: "Delete a single file. DESTRUCTIVE — requires confirm: true.",
    inputSchema: { path: z.string(), confirm: z.boolean().optional().describe("Must be true to proceed") },
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
    description: "Delete a directory. Recursive by default so it removes nested contents too. DESTRUCTIVE — requires confirm: true.",
    inputSchema: {
      path: z.string(),
      recursive: z.boolean().optional(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
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

//----------------Sceret management tools----------------

server.registerTool(
  "secrets_set",
  {
    description: "Store an encrypted secret by name. HIGH risk — requires confirm: true.",
    inputSchema: {
      name: z.string(),
      value: z.string(),
      store_path: z.string().optional().describe("Defaults to .causly-secrets.enc in the server's working directory"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("secrets_set", secretsOps.secretsSet)
);

server.registerTool(
  "secrets_get",
  {
    description: "Retrieve and decrypt a secret by name.",
    inputSchema: {
      name: z.string(),
      store_path: z.string().optional(),
    },
  },
  wrap("secrets_get", secretsOps.secretsGet)
);

server.registerTool(
  "secrets_list",
  {
    description: "List secret names in the store (never returns values).",
    inputSchema: { store_path: z.string().optional() },
  },
  wrap("secrets_list", secretsOps.secretsList)
);

server.registerTool(
  "secrets_delete",
  {
    description: "Delete a secret by name. DESTRUCTIVE — requires confirm: true.",
    inputSchema: {
      name: z.string(),
      store_path: z.string().optional(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("secrets_delete", secretsOps.secretsDelete)
);

server.registerTool(
  "secrets_rotate_key",
  {
    description:
      "Re-encrypt every secret in the store under a new master key. Call this AFTER setting SECRETS_MASTER_KEY_NEW in your environment. HIGH risk — requires confirm: true.",
    inputSchema: {
      store_path: z.string().optional(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("secrets_rotate_key", secretsOps.secretsRotateKey)
);

server.registerTool(
  "secrets_generate_key",
  {
    description: "Generate a new random 32-byte master key (hex-encoded) — use to initialize SECRETS_MASTER_KEY or for rotation.",
    inputSchema: {},
  },
  wrap("secrets_generate_key", secretsOps.secretsGenerateKey)
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

server.registerTool(
  "git_create_branch",
  {
    description: "Create a new local branch, optionally checking it out immediately (default: yes).",
    inputSchema: {
      repo_path: z.string(),
      branch_name: z.string(),
      checkout: z.boolean().optional().describe("Defaults to true"),
    },
  },
  wrap("git_create_branch", gitOps.gitCreateBranch)
);

server.registerTool(
  "git_checkout",
  {
    description: "Checkout an existing local branch.",
    inputSchema: { repo_path: z.string(), branch: z.string() },
  },
  wrap("git_checkout", gitOps.gitCheckout)
);

server.registerTool(
  "git_merge",
  {
    description: "Merge the given branch into the current branch.",
    inputSchema: { repo_path: z.string(), branch: z.string() },
  },
  wrap("git_merge", gitOps.gitMerge)
);

server.registerTool(
  "git_reset",
  {
    description: "Reset the current branch to a ref. mode: 'soft' | 'mixed' | 'hard' (defaults to mixed). HIGH risk (can lose uncommitted work with --hard) — requires confirm: true.",
    inputSchema: {
      repo_path: z.string(),
      mode: z.string().optional().describe("soft, mixed, or hard"),
      ref: z.string().optional().describe("Defaults to HEAD"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("git_reset", gitOps.gitReset)
);

server.registerTool(
  "git_stash",
  {
    description: "Stash working changes. action: 'save' | 'pop' | 'apply' | 'list' | 'drop' (defaults to save).",
    inputSchema: {
      repo_path: z.string(),
      action: z.string().optional().describe("save, pop, apply, list, or drop"),
      message: z.string().optional().describe("Stash message, only used with save"),
      stash_id: z.string().optional().describe("e.g. stash@{0}, used with pop/apply/drop"),
    },
  },
  wrap("git_stash", gitOps.gitStash)
);

server.registerTool(
  "git_show",
  {
    description: "Show details of a commit or object. Defaults to HEAD.",
    inputSchema: { repo_path: z.string(), ref: z.string().optional() },
  },
  wrap("git_show", gitOps.gitShow)
);

server.registerTool(
  "git_remote",
  {
    description: "Manage git remotes. action: 'list' | 'add' | 'remove' (defaults to list).",
    inputSchema: {
      repo_path: z.string(),
      action: z.string().optional().describe("list, add, or remove"),
      name: z.string().optional().describe("Remote name, required for add/remove"),
      url: z.string().optional().describe("Remote URL, required for add"),
    },
  },
  wrap("git_remote", gitOps.gitRemote)
);

server.registerTool(
  "git_tag",
  {
    description: "Manage git tags. action: 'list' | 'create' | 'delete' (defaults to list).",
    inputSchema: {
      repo_path: z.string(),
      action: z.string().optional().describe("list, create, or delete"),
      tag_name: z.string().optional().describe("Required for create/delete"),
      message: z.string().optional().describe("Annotation message, optional for create"),
    },
  },
  wrap("git_tag", gitOps.gitTag)
);

server.registerTool(
  "git_changed_files",
  {
    description: "List changed files in the working tree with their change type (modified/untracked/created/deleted/renamed).",
    inputSchema: { repo_path: z.string() },
  },
  wrap("git_changed_files", gitOps.gitChangedFiles)
);

server.registerTool(
  "git_diff_stat",
  {
    description: "Show a summary of changes (files changed, insertions, deletions) rather than the full diff.",
    inputSchema: { repo_path: z.string(), file: z.string().optional() },
  },
  wrap("git_diff_stat", gitOps.gitDiffStat)
);

server.registerTool(
  "git_check_clean",
  {
    description: "Check whether the working tree is clean (no uncommitted changes).",
    inputSchema: { repo_path: z.string() },
  },
  wrap("git_check_clean", gitOps.gitCheckClean)
);

// ---------------- Command execution ----------------

server.registerTool(
  "run_command",
  {
    description:
      "Run a shell command in a given working directory (npm install, npm run build, pip install, tests, etc.). A short list of catastrophic patterns (drive wipes, format, shutdown) is blocked; everything else executes with full permissions. HIGH risk — requires confirm: true.",
    inputSchema: {
      command: z.string().describe("The shell command to run"),
      cwd: z.string().describe("Working directory to run the command in"),
      timeout_ms: z.number().optional().describe("Timeout in ms, default 60000"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
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
    description: "Delete a GitHub repository. Requires Administration: write on the token. DESTRUCTIVE — requires confirm: true.",
    inputSchema: { owner: z.string(), repo: z.string(), confirm: z.boolean().optional().describe("Must be true to proceed") },
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

server.registerTool(
  "github_get_repo",
  {
    description: "Get a repository's details (default branch, visibility, open issues, language, etc).",
    inputSchema: { owner: z.string(), repo: z.string() },
  },
  wrap("github_get_repo", githubOps.githubGetRepo)
);

server.registerTool(
  "github_get_issue",
  {
    description: "Get a single issue's details.",
    inputSchema: { owner: z.string(), repo: z.string(), issue_number: z.number() },
  },
  wrap("github_get_issue", githubOps.githubGetIssue)
);

server.registerTool(
  "github_update_issue",
  {
    description: "Update an issue's title, body, state, or labels.",
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      issue_number: z.number(),
      title: z.string().optional(),
      body: z.string().optional(),
      state: z.string().optional().describe("open or closed"),
      labels: z.array(z.string()).optional(),
    },
  },
  wrap("github_update_issue", githubOps.githubUpdateIssue)
);

server.registerTool(
  "github_get_pull_request",
  {
    description: "Get a single pull request's details, including mergeable status.",
    inputSchema: { owner: z.string(), repo: z.string(), pull_number: z.number() },
  },
  wrap("github_get_pull_request", githubOps.githubGetPullRequest)
);

server.registerTool(
  "github_update_pull_request",
  {
    description: "Update a pull request's title, body, state, or base branch.",
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      pull_number: z.number(),
      title: z.string().optional(),
      body: z.string().optional(),
      state: z.string().optional().describe("open or closed"),
      base: z.string().optional(),
    },
  },
  wrap("github_update_pull_request", githubOps.githubUpdatePullRequest)
);

server.registerTool(
  "github_merge_pull_request",
  {
    description: "Merge a pull request. HIGH risk — requires confirm: true.",
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      pull_number: z.number(),
      merge_method: z.string().optional().describe("merge, squash, or rebase — defaults to merge"),
      commit_title: z.string().optional(),
      commit_message: z.string().optional(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("github_merge_pull_request", githubOps.githubMergePullRequest)
);

server.registerTool(
  "github_get_pull_request_files",
  {
    description: "List the files changed in a pull request, with additions/deletions per file.",
    inputSchema: { owner: z.string(), repo: z.string(), pull_number: z.number(), per_page: z.number().optional() },
  },
  wrap("github_get_pull_request_files", githubOps.githubGetPullRequestFiles)
);

server.registerTool(
  "github_get_pull_request_diff",
  {
    description: "Get the full raw diff of a pull request.",
    inputSchema: { owner: z.string(), repo: z.string(), pull_number: z.number() },
  },
  wrap("github_get_pull_request_diff", githubOps.githubGetPullRequestDiff)
);

server.registerTool(
  "github_get_pull_request_comments",
  {
    description: "List conversation comments on a pull request.",
    inputSchema: { owner: z.string(), repo: z.string(), pull_number: z.number(), per_page: z.number().optional() },
  },
  wrap("github_get_pull_request_comments", githubOps.githubGetPullRequestComments)
);

server.registerTool(
  "github_get_pull_request_reviews",
  {
    description: "List reviews (approved/changes-requested/commented) on a pull request.",
    inputSchema: { owner: z.string(), repo: z.string(), pull_number: z.number(), per_page: z.number().optional() },
  },
  wrap("github_get_pull_request_reviews", githubOps.githubGetPullRequestReviews)
);

server.registerTool(
  "github_get_branch",
  {
    description: "Get details of a single branch, including protection status and latest commit SHA.",
    inputSchema: { owner: z.string(), repo: z.string(), branch: z.string() },
  },
  wrap("github_get_branch", githubOps.githubGetBranch)
);

server.registerTool(
  "github_list_branches",
  {
    description: "List branches on a repository.",
    inputSchema: { owner: z.string(), repo: z.string(), per_page: z.number().optional() },
  },
  wrap("github_list_branches", githubOps.githubListBranches)
);

server.registerTool(
  "github_list_workflows",
  {
    description: "List workflows defined in a repository (from .github/workflows).",
    inputSchema: { owner: z.string(), repo: z.string() },
  },
  wrap("github_list_workflows", githubOps.githubListWorkflows)
);

server.registerTool(
  "github_list_workflow_runs",
  {
    description: "List recent GitHub Actions workflow runs, optionally filtered by branch or status (e.g. 'failure', 'in_progress').",
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      branch: z.string().optional(),
      status: z.string().optional(),
      per_page: z.number().optional(),
    },
  },
  wrap("github_list_workflow_runs", githubOps.githubListWorkflowRuns)
);

server.registerTool(
  "github_get_workflow_run",
  {
    description: "Get details of a single workflow run (status, conclusion, branch, timestamps).",
    inputSchema: { owner: z.string(), repo: z.string(), run_id: z.number() },
  },
  wrap("github_get_workflow_run", githubOps.githubGetWorkflowRun)
);

server.registerTool(
  "github_get_workflow_run_jobs",
  {
    description: "List jobs in a workflow run, with per-job and per-step status/conclusion — use to find which job/step failed.",
    inputSchema: { owner: z.string(), repo: z.string(), run_id: z.number() },
  },
  wrap("github_get_workflow_run_jobs", githubOps.githubGetWorkflowRunJobs)
);

server.registerTool(
  "github_get_job_logs",
  {
    description: "Get the raw log text for a specific job — use after finding a failed job via github_get_workflow_run_jobs.",
    inputSchema: { owner: z.string(), repo: z.string(), job_id: z.number() },
  },
  wrap("github_get_job_logs", githubOps.githubGetJobLogs)
);

server.registerTool(
  "github_rerun_workflow",
  {
    description: "Re-run a workflow run. Set failed_only=true to re-run only the failed jobs instead of the whole run.",
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      run_id: z.number(),
      failed_only: z.boolean().optional().describe("Defaults to false"),
    },
  },
  wrap("github_rerun_workflow", githubOps.githubRerunWorkflow)
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

// ---------------- Project intelligence tools ----------------

server.registerTool(
  "project_detect",
  {
    description: "Detect a project's language, framework, and package manager by inspecting its manifest files.",
    inputSchema: { repo_path: z.string() },
  },
  wrap("project_detect", projectOps.projectDetect)
);

server.registerTool(
  "project_info",
  {
    description: "Get structured project info: language, framework, package manager, resolved test/lint/typecheck/build commands, and current git branch/remotes.",
    inputSchema: { repo_path: z.string() },
  },
  wrap("project_info", projectOps.projectInfo)
);

server.registerTool(
  "project_health",
  {
    description: "Get a health snapshot of a project: git cleanliness/ahead-behind, whether dependencies are installed, and which env files are present.",
    inputSchema: { repo_path: z.string() },
  },
  wrap("project_health", projectOps.projectHealth)
);

server.registerTool(
  "run_tests",
  {
    description: "Detect and run the project's test command, returning stdout/stderr/exit_code.",
    inputSchema: { repo_path: z.string(), timeout_ms: z.number().optional() },
  },
  wrap("run_tests", projectOps.runTests)
);

server.registerTool(
  "run_lint",
  {
    description: "Detect and run the project's lint command, returning stdout/stderr/exit_code.",
    inputSchema: { repo_path: z.string(), timeout_ms: z.number().optional() },
  },
  wrap("run_lint", projectOps.runLint)
);

server.registerTool(
  "run_typecheck",
  {
    description: "Detect and run the project's typecheck command, returning stdout/stderr/exit_code.",
    inputSchema: { repo_path: z.string(), timeout_ms: z.number().optional() },
  },
  wrap("run_typecheck", projectOps.runTypecheck)
);

server.registerTool(
  "run_build",
  {
    description: "Detect and run the project's build command, returning stdout/stderr/exit_code.",
    inputSchema: { repo_path: z.string(), timeout_ms: z.number().optional() },
  },
  wrap("run_build", projectOps.runBuild)
);

// ---------------- Supabase tools ----------------

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
    description: "Delete a Supabase project. DESTRUCTIVE — requires confirm: true.",
    inputSchema: { project_ref: z.string(), confirm: z.boolean().optional().describe("Must be true to proceed") },
  },
  wrap("supabase_delete_project", supabaseOps.supabaseDeleteProject)
);

server.registerTool(
  "supabase_run_sql",
  {
    description:
      "Run raw SQL against a project's database — used for creating tables, altering schema, seeding data, or running queries. HIGH risk — requires confirm: true.",
    inputSchema: {
      project_ref: z.string(),
      query: z.string().describe("Raw SQL statement(s) to execute"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("supabase_run_sql", supabaseOps.supabaseRunSql)
);

// ---------------- Slack tools ----------------

server.registerTool(
  "slack_get_user",
  {
    description: "Look up a Slack user's info by user ID.",
    inputSchema: { user_id: z.string() },
  },
  wrap("slack_get_user", slackOps.slackGetUser)
);

server.registerTool(
  "slack_list_channels",
  {
    description: "List channels in the workspace.",
    inputSchema: {
      limit: z.number().optional().describe("Defaults to 100"),
      types: z.string().optional().describe("Comma-separated: public_channel, private_channel, mpim, im — defaults to public_channel,private_channel"),
    },
  },
  wrap("slack_list_channels", slackOps.slackListChannels)
);

server.registerTool(
  "slack_get_channel",
  {
    description: "Get details of a single channel.",
    inputSchema: { channel_id: z.string() },
  },
  wrap("slack_get_channel", slackOps.slackGetChannel)
);

server.registerTool(
  "slack_read_messages",
  {
    description: "Read recent message history from a channel.",
    inputSchema: { channel_id: z.string(), limit: z.number().optional().describe("Defaults to 20") },
  },
  wrap("slack_read_messages", slackOps.slackReadMessages)
);

server.registerTool(
  "slack_search_messages",
  {
    description: "Search messages across the workspace. Requires a user token with search:read scope.",
    inputSchema: { query: z.string(), count: z.number().optional().describe("Defaults to 20") },
  },
  wrap("slack_search_messages", slackOps.slackSearchMessages)
);

server.registerTool(
  "slack_send_message",
  {
    description: "Post a message to a channel. HIGH risk — requires confirm: true.",
    inputSchema: {
      channel_id: z.string(),
      text: z.string(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("slack_send_message", slackOps.slackSendMessage)
);

server.registerTool(
  "slack_reply_thread",
  {
    description: "Reply in a thread. HIGH risk — requires confirm: true.",
    inputSchema: {
      channel_id: z.string(),
      thread_ts: z.string(),
      text: z.string(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("slack_reply_thread", slackOps.slackReplyThread)
);

server.registerTool(
  "slack_create_channel",
  {
    description: "Create a new channel. HIGH risk — requires confirm: true.",
    inputSchema: {
      name: z.string(),
      is_private: z.boolean().optional().describe("Defaults to false"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("slack_create_channel", slackOps.slackCreateChannel)
);

// ---------------- Gmail tools ----------------

server.registerTool(
  "gmail_get_profile",
  {
    description: "Get the authenticated Gmail account's profile — connectivity/auth check.",
    inputSchema: {},
  },
  wrap("gmail_get_profile", gmailOps.gmailGetProfile)
);

server.registerTool(
  "gmail_search",
  {
    description: "Search messages using Gmail search syntax (e.g. 'from:x@y.com is:unread').",
    inputSchema: { query: z.string(), max_results: z.number().optional().describe("Defaults to 10") },
  },
  wrap("gmail_search", gmailOps.gmailSearch)
);

server.registerTool(
  "gmail_list_messages",
  {
    description: "List recent messages, optionally scoped to a label.",
    inputSchema: {
      label_ids: z.string().optional().describe("e.g. INBOX, UNREAD"),
      max_results: z.number().optional().describe("Defaults to 10"),
    },
  },
  wrap("gmail_list_messages", gmailOps.gmailListMessages)
);

server.registerTool(
  "gmail_get_message",
  {
    description: "Get a single message's decoded content by message ID.",
    inputSchema: { message_id: z.string() },
  },
  wrap("gmail_get_message", gmailOps.gmailGetMessage)
);

server.registerTool(
  "gmail_get_thread",
  {
    description: "Get a full thread (all messages in it) by thread ID.",
    inputSchema: { thread_id: z.string() },
  },
  wrap("gmail_get_thread", gmailOps.gmailGetThread)
);

server.registerTool(
  "gmail_send",
  {
    description: "Send a new email. HIGH risk — requires confirm: true.",
    inputSchema: {
      to: z.string(),
      subject: z.string(),
      body: z.string(),
      cc: z.string().optional(),
      bcc: z.string().optional(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("gmail_send", gmailOps.gmailSend)
);

server.registerTool(
  "gmail_reply",
  {
    description: "Reply to an existing message in the same thread. HIGH risk — requires confirm: true.",
    inputSchema: {
      message_id: z.string(),
      body: z.string(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("gmail_reply", gmailOps.gmailReply)
);

server.registerTool(
  "gmail_forward",
  {
    description: "Forward an existing message to a new recipient. HIGH risk — requires confirm: true.",
    inputSchema: {
      message_id: z.string(),
      to: z.string(),
      note: z.string().optional(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("gmail_forward", gmailOps.gmailForward)
);

// ----------------NOtion tools ----------------
server.registerTool(
  "notion_search",
  {
    description: "Search pages and databases across the workspace.",
    inputSchema: {
      query: z.string().optional(),
      filter_type: z.string().optional().describe("'page' or 'database' to restrict results"),
      page_size: z.number().optional().describe("Defaults to 20"),
    },
  },
  wrap("notion_search", notionOps.notionSearch)
);

server.registerTool(
  "notion_get_page",
  {
    description: "Get a single page's properties and metadata by page ID.",
    inputSchema: { page_id: z.string() },
  },
  wrap("notion_get_page", notionOps.notionGetPage)
);

server.registerTool(
  "notion_create_page",
  {
    description: "Create a new page under a parent page or database. HIGH risk — requires confirm: true.",
    inputSchema: {
      parent_id: z.string(),
      parent_type: z.string().optional().describe("'page_id' or 'database_id', defaults to page_id"),
      properties: z.record(z.any()),
      children: z.array(z.any()).optional(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("notion_create_page", notionOps.notionCreatePage)
);

server.registerTool(
  "notion_update_page",
  {
    description: "Update an existing page's properties, or archive/restore it. HIGH risk — requires confirm: true.",
    inputSchema: {
      page_id: z.string(),
      properties: z.record(z.any()).optional(),
      archived: z.boolean().optional(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("notion_update_page", notionOps.notionUpdatePage)
);

server.registerTool(
  "notion_get_database",
  {
    description: "Get a database's schema and metadata by database ID.",
    inputSchema: { database_id: z.string() },
  },
  wrap("notion_get_database", notionOps.notionGetDatabase)
);

server.registerTool(
  "notion_query_database",
  {
    description: "Query a database's rows with optional filter and sort.",
    inputSchema: {
      database_id: z.string(),
      filter: z.record(z.any()).optional(),
      sorts: z.array(z.any()).optional(),
      page_size: z.number().optional().describe("Defaults to 20"),
    },
  },
  wrap("notion_query_database", notionOps.notionQueryDatabase)
);

server.registerTool(
  "notion_create_database",
  {
    description: "Create a new database under a parent page. HIGH risk — requires confirm: true.",
    inputSchema: {
      parent_page_id: z.string(),
      title: z.string(),
      properties: z.record(z.any()),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("notion_create_database", notionOps.notionCreateDatabase)
);

server.registerTool(
  "notion_append_block_children",
  {
    description: "Append content blocks (text, lists, tables, etc.) to a page or block. HIGH risk — requires confirm: true.",
    inputSchema: {
      block_id: z.string(),
      children: z.array(z.any()),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("notion_append_block_children", notionOps.notionAppendBlockChildren)
);

server.registerTool(
  "notion_get_block_children",
  {
    description: "Get the child blocks of a page or block.",
    inputSchema: {
      block_id: z.string(),
      page_size: z.number().optional().describe("Defaults to 50"),
    },
  },
  wrap("notion_get_block_children", notionOps.notionGetBlockChildren)
);

server.registerTool(
  "notion_update_block",
  {
    description: "Update an existing block's content. HIGH risk — requires confirm: true.",
    inputSchema: {
      block_id: z.string(),
      block_data: z.record(z.any()),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("notion_update_block", notionOps.notionUpdateBlock)
);

server.registerTool(
  "notion_delete_block",
  {
    description: "Delete (archive) a block. HIGH risk — requires confirm: true.",
    inputSchema: {
      block_id: z.string(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("notion_delete_block", notionOps.notionDeleteBlock)
);

server.registerTool(
  "notion_get_comments",
  {
    description: "Get comments on a page or block.",
    inputSchema: { block_id: z.string() },
  },
  wrap("notion_get_comments", notionOps.notionGetComments)
);

server.registerTool(
  "notion_add_comment",
  {
    description: "Add a comment to a page, or reply in an existing discussion thread. HIGH risk — requires confirm: true.",
    inputSchema: {
      page_id: z.string().optional(),
      discussion_id: z.string().optional(),
      text: z.string(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("notion_add_comment", notionOps.notionAddComment)
);

server.registerTool(
  "notion_list_users",
  {
    description: "List all users in the workspace.",
    inputSchema: { page_size: z.number().optional().describe("Defaults to 50") },
  },
  wrap("notion_list_users", notionOps.notionListUsers)
);

server.registerTool(
  "notion_get_user",
  {
    description: "Get a single workspace user's info by user ID.",
    inputSchema: { user_id: z.string() },
  },
  wrap("notion_get_user", notionOps.notionGetUser)
);

// ----------------Terraform Cloud tools ----------------


server.registerTool(
  "terraform_init",
  {
    description: "Initialize a Terraform working directory (downloads providers/modules).",
    inputSchema: {
      dir: z.string().describe("Path to the Terraform config directory"),
      upgrade: z.boolean().optional().describe("Upgrade providers/modules to latest allowed version"),
    },
  },
  wrap("terraform_init", terraformOps.terraformInit)
);

server.registerTool(
  "terraform_validate",
  {
    description: "Validate the configuration's syntax and internal consistency.",
    inputSchema: { dir: z.string() },
  },
  wrap("terraform_validate", terraformOps.terraformValidate)
);

server.registerTool(
  "terraform_fmt",
  {
    description: "Format .tf files to canonical style.",
    inputSchema: {
      dir: z.string(),
      check: z.boolean().optional().describe("Only check formatting, don't rewrite files"),
    },
  },
  wrap("terraform_fmt", terraformOps.terraformFmt)
);

server.registerTool(
  "terraform_plan",
  {
    description: "Show an execution plan: what Terraform would change.",
    inputSchema: {
      dir: z.string(),
      var_file: z.string().optional().describe("Path to a .tfvars file"),
      out: z.string().optional().describe("Save the plan to this file for later apply"),
    },
  },
  wrap("terraform_plan", terraformOps.terraformPlan)
);

server.registerTool(
  "terraform_apply",
  {
    description: "Apply changes to reach the desired state. HIGH risk — requires confirm: true.",
    inputSchema: {
      dir: z.string(),
      var_file: z.string().optional().describe("Path to a .tfvars file"),
      plan_file: z.string().optional().describe("Apply a previously saved plan file instead of a fresh plan"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("terraform_apply", terraformOps.terraformApply)
);

server.registerTool(
  "terraform_destroy",
  {
    description: "Destroy all resources managed by this configuration. HIGH risk — requires confirm: true.",
    inputSchema: {
      dir: z.string(),
      var_file: z.string().optional().describe("Path to a .tfvars file"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("terraform_destroy", terraformOps.terraformDestroy)
);

server.registerTool(
  "terraform_show",
  {
    description: "Show the current state or a saved plan, human-readable or as JSON.",
    inputSchema: {
      dir: z.string(),
      target: z.string().optional().describe("A saved plan file to show instead of current state"),
      json: z.boolean().optional().describe("Output as JSON"),
    },
  },
  wrap("terraform_show", terraformOps.terraformShow)
);

server.registerTool(
  "terraform_output",
  {
    description: "Read output values from the root module's state.",
    inputSchema: {
      dir: z.string(),
      name: z.string().optional().describe("A single output name to read; omit for all outputs"),
      json: z.boolean().optional().describe("Defaults to true"),
    },
  },
  wrap("terraform_output", terraformOps.terraformOutput)
);

server.registerTool(
  "terraform_workspace",
  {
    description: "Manage Terraform workspaces (environments like dev/staging/prod). action: 'list' | 'new' | 'select' | 'delete' (defaults to list).",
    inputSchema: {
      dir: z.string(),
      action: z.string().optional().describe("list, new, select, or delete"),
      name: z.string().optional().describe("Workspace name, required for new/select/delete"),
    },
  },
  wrap("terraform_workspace", terraformOps.terraformWorkspace)
);

server.registerTool(
  "terraform_state_list",
  {
    description: "List all resources tracked in the current state.",
    inputSchema: { dir: z.string(), filter: z.string().optional().describe("Filter by resource address pattern") },
  },
  wrap("terraform_state_list", terraformOps.terraformStateList)
);

server.registerTool(
  "terraform_state_show",
  {
    description: "Show detailed attributes of a single resource in the state.",
    inputSchema: { dir: z.string(), address: z.string().describe("Resource address, e.g. azurerm_resource_group.main") },
  },
  wrap("terraform_state_show", terraformOps.terraformStateShow)
);

server.registerTool(
  "terraform_state_mv",
  {
    description: "Move a resource to a new address within the state (rename/refactor without destroy+recreate). HIGH risk — requires confirm: true.",
    inputSchema: {
      dir: z.string(),
      source: z.string(),
      destination: z.string(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("terraform_state_mv", terraformOps.terraformStateMv)
);

server.registerTool(
  "terraform_state_rm",
  {
    description: "Remove a resource from the state without destroying the real infrastructure (stops Terraform managing it). HIGH risk — requires confirm: true.",
    inputSchema: {
      dir: z.string(),
      address: z.string(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("terraform_state_rm", terraformOps.terraformStateRm)
);

server.registerTool(
  "terraform_state_pull",
  {
    description: "Download and print the raw remote state as JSON — useful for backend/state-drift inspection.",
    inputSchema: { dir: z.string() },
  },
  wrap("terraform_state_pull", terraformOps.terraformStatePull)
);

server.registerTool(
  "terraform_import",
  {
    description: "Import an existing real-world resource into Terraform state, so it becomes managed by this config. HIGH risk — requires confirm: true.",
    inputSchema: {
      dir: z.string(),
      address: z.string().describe("Terraform resource address to import into, e.g. azurerm_resource_group.main"),
      resource_id: z.string().describe("The real-world resource ID (e.g. Azure resource ID)"),
      var_file: z.string().optional(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("terraform_import", terraformOps.terraformImport)
);

server.registerTool(
  "terraform_taint",
  {
    description: "Mark a resource as tainted, forcing it to be destroyed and recreated on the next apply. HIGH risk — requires confirm: true.",
    inputSchema: {
      dir: z.string(),
      address: z.string(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("terraform_taint", terraformOps.terraformTaint)
);

server.registerTool(
  "terraform_untaint",
  {
    description: "Remove the tainted mark from a resource, so it will not be forcibly recreated.",
    inputSchema: { dir: z.string(), address: z.string() },
  },
  wrap("terraform_untaint", terraformOps.terraformUntaint)
);

server.registerTool(
  "terraform_graph",
  {
    description: "Generate a visual dependency graph of resources in DOT format.",
    inputSchema: { dir: z.string() },
  },
  wrap("terraform_graph", terraformOps.terraformGraph)
);

server.registerTool(
  "terraform_providers",
  {
    description: "List the providers required by the configuration and their resolved versions.",
    inputSchema: { dir: z.string() },
  },
  wrap("terraform_providers", terraformOps.terraformProviders)
);

server.registerTool(
  "terraform_plan_comment",
  {
    description:
      "CI/CD hook: run `terraform plan`, format a concise Markdown summary, and post it as a comment on a GitHub pull request — so reviewers see the infra diff before approving. HIGH risk — requires confirm: true.",
    inputSchema: {
      dir: z.string(),
      var_file: z.string().optional(),
      owner: z.string().describe("GitHub repo owner"),
      repo: z.string().describe("GitHub repo name"),
      pull_number: z.number().describe("PR number to comment on"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("terraform_plan_comment", terraformOps.terraformPlanComment)
);

// ---------------Docker tools ----------------
server.registerTool(
  "docker_version",
  {
    description: "Get Docker client/server version info — connectivity check.",
    inputSchema: {},
  },
  wrap("docker_version", dockerOps.dockerVersion)
);

server.registerTool(
  "docker_ps",
  {
    description: "List containers. Set all=true to include stopped ones (defaults to running only).",
    inputSchema: { all: z.boolean().optional().describe("Defaults to false (running only)") },
  },
  wrap("docker_ps", dockerOps.dockerPs)
);

server.registerTool(
  "docker_images",
  {
    description: "List images.",
    inputSchema: {},
  },
  wrap("docker_images", dockerOps.dockerImages)
);

server.registerTool(
  "docker_build",
  {
    description: "Build an image from a Dockerfile. HIGH risk — requires confirm: true.",
    inputSchema: {
      context_dir: z.string().describe("Build context directory"),
      tag: z.string().describe("Image tag, e.g. myapp:latest"),
      dockerfile: z.string().optional().describe("Path to Dockerfile, defaults to context_dir/Dockerfile"),
      build_args: z.record(z.string()).optional(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("docker_build", dockerOps.dockerBuild)
);

server.registerTool(
  "docker_run",
  {
    description: "Run a new container from an image. HIGH risk — requires confirm: true.",
    inputSchema: {
      image: z.string(),
      name: z.string().optional(),
      ports: z.array(z.string()).optional().describe("e.g. ['8080:80']"),
      env: z.record(z.string()).optional(),
      volumes: z.array(z.string()).optional().describe("e.g. ['/host/path:/container/path']"),
      detach: z.boolean().optional().describe("Defaults to true"),
      command: z.string().optional().describe("Override command to run in the container"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("docker_run", dockerOps.dockerRun)
);

server.registerTool(
  "docker_stop",
  {
    description: "Stop a running container. HIGH risk — requires confirm: true.",
    inputSchema: { container: z.string(), confirm: z.boolean().optional().describe("Must be true to proceed") },
  },
  wrap("docker_stop", dockerOps.dockerStop)
);

server.registerTool(
  "docker_start",
  {
    description: "Start a stopped container.",
    inputSchema: { container: z.string() },
  },
  wrap("docker_start", dockerOps.dockerStart)
);

server.registerTool(
  "docker_restart",
  {
    description: "Restart a container. HIGH risk — requires confirm: true.",
    inputSchema: { container: z.string(), confirm: z.boolean().optional().describe("Must be true to proceed") },
  },
  wrap("docker_restart", dockerOps.dockerRestart)
);

server.registerTool(
  "docker_remove",
  {
    description: "Remove a container. DESTRUCTIVE — requires confirm: true.",
    inputSchema: {
      container: z.string(),
      force: z.boolean().optional().describe("Force-remove even if running"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("docker_remove", dockerOps.dockerRemove)
);

server.registerTool(
  "docker_remove_image",
  {
    description: "Remove an image. DESTRUCTIVE — requires confirm: true.",
    inputSchema: {
      image: z.string(),
      force: z.boolean().optional(),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("docker_remove_image", dockerOps.dockerRemoveImage)
);

server.registerTool(
  "docker_logs",
  {
    description: "Get logs from a container.",
    inputSchema: {
      container: z.string(),
      tail: z.number().optional().describe("Number of lines from the end, defaults to 100"),
      since: z.string().optional().describe("e.g. '10m', '2026-09-01T00:00:00'"),
    },
  },
  wrap("docker_logs", dockerOps.dockerLogs)
);

server.registerTool(
  "docker_inspect",
  {
    description: "Inspect a container or image — full JSON metadata.",
    inputSchema: { target: z.string().describe("Container or image name/ID") },
  },
  wrap("docker_inspect", dockerOps.dockerInspect)
);

server.registerTool(
  "docker_exec",
  {
    description: "Execute a command inside a running container.",
    inputSchema: { container: z.string(), command: z.string().describe("e.g. 'ls -la'") },
  },
  wrap("docker_exec", dockerOps.dockerExec)
);

server.registerTool(
  "docker_stats",
  {
    description: "Show live resource usage stats (CPU, memory) for running containers — one-shot snapshot, not streaming.",
    inputSchema: {},
  },
  wrap("docker_stats", dockerOps.dockerStats)
);

server.registerTool(
  "docker_push",
  {
    description: "Push an image to a registry. HIGH risk — requires confirm: true.",
    inputSchema: { image: z.string(), confirm: z.boolean().optional().describe("Must be true to proceed") },
  },
  wrap("docker_push", dockerOps.dockerPush)
);

server.registerTool(
  "docker_pull",
  {
    description: "Pull an image from a registry.",
    inputSchema: { image: z.string() },
  },
  wrap("docker_pull", dockerOps.dockerPull)
);

server.registerTool(
  "docker_compose_up",
  {
    description: "Run docker compose up for a project directory. HIGH risk — requires confirm: true.",
    inputSchema: {
      project_dir: z.string().describe("Directory containing docker-compose.yml"),
      detach: z.boolean().optional().describe("Defaults to true"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("docker_compose_up", dockerOps.dockerComposeUp)
);

server.registerTool(
  "docker_compose_down",
  {
    description: "Run docker compose down for a project directory. HIGH risk — requires confirm: true.",
    inputSchema: {
      project_dir: z.string().describe("Directory containing docker-compose.yml"),
      confirm: z.boolean().optional().describe("Must be true to proceed"),
    },
  },
  wrap("docker_compose_down", dockerOps.dockerComposeDown)
);



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
  await server.connect(transport);
  console.error("causly-server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting server:", err);
  process.exit(1);
});
