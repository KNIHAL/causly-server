import fs from "fs/promises";
import path from "path";
import { isPathDenied } from "./security.js";

function assertPathAllowed(targetPath) {
  const check = isPathDenied(targetPath);
  if (check.denied) throw new Error(check.reason);
}

/** List immediate contents (files + folders) of a directory. */
export async function listDirectory({ path: dirPath }) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return {
    path: dirPath,
    entries: entries.map((e) => ({
      name: e.name,
      type: e.isDirectory() ? "directory" : "file",
    })),
  };
}

/** Recursively build a tree view of a directory, up to max_depth. */
export async function directoryTree({ path: dirPath, max_depth = 5, _currentDepth = 0 }) {
  if (_currentDepth >= max_depth) {
    return { name: path.basename(dirPath), type: "directory", truncated: true };
  }

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const children = [];

  for (const entry of entries) {
    // Skip common noise directories.
    if (entry.name === "node_modules" || entry.name === ".git") continue;

    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      children.push(
        await directoryTree({ path: fullPath, max_depth, _currentDepth: _currentDepth + 1 })
      );
    } else {
      children.push({ name: entry.name, type: "file" });
    }
  }

  return { name: path.basename(dirPath), type: "directory", children };
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
 * match) starting from a root directory.
 */
export async function searchFiles({ root_path, pattern, max_results = 100 }) {
  const results = [];
  const lowerPattern = pattern.toLowerCase();

  async function walk(currentPath) {
    if (results.length >= max_results) return;

    let entries;
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return; // permission denied or path vanished — skip silently
    }

    for (const entry of entries) {
      if (results.length >= max_results) return;
      if (entry.name === "node_modules" || entry.name === ".git") continue;

      const fullPath = path.join(currentPath, entry.name);
      if (entry.name.toLowerCase().includes(lowerPattern)) {
        results.push({ path: fullPath, type: entry.isDirectory() ? "directory" : "file" });
      }
      if (entry.isDirectory()) {
        await walk(fullPath);
      }
    }
  }

  await walk(root_path);
  return { root_path, pattern, matches: results, truncated: results.length >= max_results };
}
