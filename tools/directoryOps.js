import fs from "fs/promises";
import path from "path";
import { assertPathAllowed, isPathAllowed } from "./pathGuard.js";
import { limit } from "./limits.js";

/**
 * List immediate contents (files + folders) of a directory, up to CAUSLY_MAX_LIST_ENTRIES
 * (default 2000). A larger folder returns the first entries plus `truncated: true`.
 */
export async function listDirectory({ path: dirPath }) {
  assertPathAllowed(dirPath, "read");
  const max = limit("CAUSLY_MAX_LIST_ENTRIES");
  const dir = await fs.opendir(dirPath);
  const entries = [];
  let truncated = false;
  try {
    for await (const e of dir) {
      if (entries.length >= max) {
        truncated = true;
        break;
      }
      entries.push({ name: e.name, type: e.isDirectory() ? "directory" : "file" });
    }
  } finally {
    await dir.close().catch(() => {});
  }
  return truncated ? { path: dirPath, entries, truncated: true, limit: max } : { path: dirPath, entries };
}

const MAX_TREE_DEPTH = 20;
const DEFAULT_TREE_DEPTH = 3;

// Folders that are dependencies or build output: large, regenerated, and rarely what the agent wants
// to read. directory_tree lists their names under `skipped` instead of walking into them.
const TREE_IGNORED = new Set([
  "node_modules", ".git", "build", "dist", ".next", ".docusaurus", ".venv", "venv", "__pycache__", ".turbo", "coverage",
]);

/**
 * Recursively build a tree view of a directory, up to max_depth (default 3, at most 20) and
 * CAUSLY_MAX_TREE_ENTRIES (default 1000) entries in total. Where a limit cuts the tree short the
 * node carries `truncated: true`. Dependency and build folders are not walked; their names appear in
 * `skipped`, unless include_ignored is true.
 */
export async function directoryTree({ path: dirPath, max_depth = DEFAULT_TREE_DEPTH, include_ignored = false }) {
  assertPathAllowed(dirPath, "read");
  const depthLimit = Math.max(1, Math.min(Number(max_depth) || DEFAULT_TREE_DEPTH, MAX_TREE_DEPTH));
  const state = { left: limit("CAUSLY_MAX_TREE_ENTRIES"), include: include_ignored === true };
  return walkTree(dirPath, depthLimit, 0, state);
}

async function walkTree(dirPath, maxDepth, depth, state) {
  if (depth >= maxDepth) {
    return { name: path.basename(dirPath), type: "directory", truncated: true };
  }

  const children = [];
  const skipped = [];
  let truncated = false;
  const dir = await fs.opendir(dirPath);
  try {
    for await (const entry of dir) {
      // Skip dependency and build folders (named in `skipped`).
      if (!state.include && entry.isDirectory() && TREE_IGNORED.has(entry.name)) {
        skipped.push(entry.name);
        continue;
      }
      if (state.left <= 0) {
        truncated = true;
        break;
      }
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (!isPathAllowed(fullPath, "read")) continue; // protected folders are not listed
        state.left--;
        children.push(await walkTree(fullPath, maxDepth, depth + 1, state));
      } else {
        state.left--;
        children.push({ name: entry.name, type: "file" });
      }
    }
  } finally {
    await dir.close().catch(() => {});
  }

  const node = { name: path.basename(dirPath), type: "directory", children };
  if (skipped.length) node.skipped = skipped;
  if (truncated) node.truncated = true;
  return node;
}

/** Create a new directory (and any missing parents). */
export async function createDirectory({ path: dirPath }) {
  assertPathAllowed(dirPath);
  await fs.mkdir(dirPath, { recursive: true });
  return { path: dirPath, created: true };
}

/** Delete a directory. Recursive by default so nested folders can be removed. */
export async function deleteDirectory({ path: dirPath, recursive = true }) {
  assertPathAllowed(dirPath);
  await fs.rm(dirPath, { recursive, force: false });
  return { path: dirPath, deleted: true };
}

/**
 * Search for files/folders by name pattern (case-insensitive substring
 * match) starting from a root directory. Stops after max_results matches (at most 1000) or
 * CAUSLY_MAX_SCAN_ENTRIES (default 100000) entries looked at, and says so with `truncated: true`.
 */
export async function searchFiles({ root_path, pattern, max_results = 100 }) {
  assertPathAllowed(root_path, "read");
  const cap = Math.max(1, Math.min(Number(max_results) || 100, 1000));
  const results = [];
  const lowerPattern = pattern.toLowerCase();
  let scanLeft = limit("CAUSLY_MAX_SCAN_ENTRIES");
  let scanCut = false;

  async function walk(currentPath) {
    if (results.length >= cap || scanCut) return;

    let dir;
    try {
      dir = await fs.opendir(currentPath);
    } catch {
      return; // permission denied or path vanished — skip silently
    }

    const subdirs = [];
    try {
      for await (const entry of dir) {
        if (results.length >= cap) break;
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        if (scanLeft-- <= 0) {
          scanCut = true;
          break;
        }

        const fullPath = path.join(currentPath, entry.name);
        if (entry.name.toLowerCase().includes(lowerPattern)) {
          results.push({ path: fullPath, type: entry.isDirectory() ? "directory" : "file" });
        }
        if (entry.isDirectory()) subdirs.push(fullPath);
      }
    } catch {
      // a folder that fails halfway is skipped like an unreadable one
    } finally {
      await dir.close().catch(() => {});
    }

    for (const sub of subdirs) {
      if (results.length >= cap || scanCut) return;
      if (isPathAllowed(sub, "read")) await walk(sub);
    }
  }

  await walk(root_path);
  const truncated = results.length >= cap || scanCut;
  return { root_path, pattern, matches: results, truncated, ...(scanCut ? { scan_limit_reached: true } : {}) };
}
