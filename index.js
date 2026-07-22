import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import * as fileOps from "./tools/fileOps.js";
import * as dirOps from "./tools/directoryOps.js";
import * as gitOps from "./tools/gitOps.js";
import * as commandOps from "./tools/commandOps.js";
import { logActivity } from "./tools/logger.js";

const server = new McpServer({
  name: "causly-server",
  version: "1.0.0",
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
