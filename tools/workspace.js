// Workspace jail: optionally restrict file/path arguments to approved folders.
//
// Off by default. Turn on by setting CAUSLY_WORKSPACE to one or more folders,
// separated by ";" on Windows or ":" on macOS/Linux, e.g.
//   CAUSLY_WORKSPACE=D:\causly-server;D:\causly-site
//
// This guards the path arguments of tool calls (files, directories, cwd,
// repo_path, terraform dir, ...). It is a guardrail, not a sandbox: shell
// command strings and docker volume mounts are not inspected.
import fs from "fs";
import path from "path";

// Tool input fields that hold a filesystem path (or an array of paths).
export const PATH_FIELDS = [
  "path",
  "paths",
  "root_path",
  "cwd",
  "repo_path",
  "dir",
  "project_dir",
  "context_dir",
  "dockerfile",
  "source",
  "destination",
  "store_path",
  "plan_file",
  "var_file",
  "transcript_file",
];

// Resolve symlinks in the deepest existing part of a path, then re-attach the
// parts that don't exist yet (so new files are checked correctly and a symlink
// inside the workspace can't point outside it).
function realish(p) {
  let current = path.resolve(p);
  const missing = [];
  for (;;) {
    try {
      const real = fs.realpathSync.native(current);
      return missing.length ? path.join(real, ...missing.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(p);
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

const normalize = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

export function isInsideRoot(root, target) {
  const rel = path.relative(normalize(realish(root)), normalize(realish(target)));
  if (rel === "") return true;
  if (path.isAbsolute(rel)) return false; // e.g. a different drive
  return rel !== ".." && !rel.startsWith(".." + path.sep);
}

export function workspaceRoots(value = process.env.CAUSLY_WORKSPACE) {
  return (value || "")
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => path.resolve(s));
}

/** Returns { allowed: true } or { allowed: false, reason }. */
export function checkWorkspace(toolName, input, value = process.env.CAUSLY_WORKSPACE) {
  const roots = workspaceRoots(value);
  if (!roots.length) return { allowed: true };
  for (const field of PATH_FIELDS) {
    const raw = input?.[field];
    for (const v of Array.isArray(raw) ? raw : [raw]) {
      if (typeof v !== "string" || !v) continue;
      if (!roots.some((root) => isInsideRoot(root, v))) {
        return {
          allowed: false,
          reason: `'${toolName}' ${field} "${v}" is outside the allowed workspace (CAUSLY_WORKSPACE).`,
        };
      }
    }
  }
  return { allowed: true };
}
