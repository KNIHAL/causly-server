import { z } from "zod";
import * as fileOps from "../tools/fileOps.js";
import { wrap } from "../tools/toolWrapper.js";

export default function register(server) {
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
}
