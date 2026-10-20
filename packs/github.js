import { z } from "zod";
import * as githubOps from "../tools/githubOps.js";
import { wrap } from "../tools/toolWrapper.js";

export default function register(server) {
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
}
