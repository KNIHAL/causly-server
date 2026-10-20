import { z } from "zod";
import * as gitOps from "../tools/gitOps.js";
import { wrap } from "../tools/toolWrapper.js";

export default function register(server) {
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
}
