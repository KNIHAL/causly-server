import { z } from "zod";
import * as dirOps from "../tools/directoryOps.js";
import { wrap } from "../tools/toolWrapper.js";

export default function register(server) {
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
}
