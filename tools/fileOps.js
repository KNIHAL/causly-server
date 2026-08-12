import fs from "fs/promises";
import path from "path";
import { isPathDenied } from "./security.js";

function assertPathAllowed(targetPath) {
  const check = isPathDenied(targetPath);
  if (check.denied) throw new Error(check.reason);
}

/**
 * mkdir(recursive: true) that tolerates Windows quirks where the target
 * directory is a drive root (e.g. "D:\") — Node throws EPERM there even
 * though the directory already exists.
 */
async function safeMkdir(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (err) {
    if (err.code !== "EPERM" && err.code !== "EEXIST") throw err;
  }
}

/** Read a single file's full text content. */
export async function readFile({ path: filePath, encoding = "utf8" }) {
  const content = await fs.readFile(filePath, encoding);
  return { path: filePath, content };
}

/** Read multiple files in one call — avoids repeated round trips. */
export async function readMultipleFiles({ paths, encoding = "utf8" }) {
  const results = await Promise.all(
    paths.map(async (p) => {
      try {
        const content = await fs.readFile(p, encoding);
        return { path: p, content, success: true };
      } catch (err) {
        return { path: p, error: err.message, success: false };
      }
    })
  );
  return { results };
}

/** Create a brand-new file. Fails if the file already exists (safety). */
export async function createFile({ path: filePath, content = "" }) {
  assertPathAllowed(filePath);
  await safeMkdir(path.dirname(filePath));
  await fs.writeFile(filePath, content, { flag: "wx" });
  return { path: filePath, created: true };
}

/** Write/overwrite a file completely. Creates parent dirs if needed. */
export async function writeFile({ path: filePath, content }) {
  assertPathAllowed(filePath);
  await safeMkdir(path.dirname(filePath));
  await fs.writeFile(filePath, content, "utf8");
  return { path: filePath, written: true };
}

/**
 * Edit a file via exact string replacement (find & replace) without
 * rewriting the whole file manually. `old_str` must be unique unless
 * replace_all is true.
 */
export async function editFile({ path: filePath, old_str, new_str, replace_all = false }) {
  assertPathAllowed(filePath);
  const original = await fs.readFile(filePath, "utf8");

  if (!original.includes(old_str)) {
    throw new Error("old_str not found in file — no changes made.");
  }

  let updated;
  if (replace_all) {
    updated = original.split(old_str).join(new_str);
  } else {
    const firstIndex = original.indexOf(old_str);
    const lastIndex = original.lastIndexOf(old_str);
    if (firstIndex !== lastIndex) {
      throw new Error(
        "old_str appears multiple times. Pass replace_all: true, or make old_str more specific/unique."
      );
    }
    updated = original.slice(0, firstIndex) + new_str + original.slice(firstIndex + old_str.length);
  }

  await fs.writeFile(filePath, updated, "utf8");
  return { path: filePath, edited: true };
}

/** Delete a single file. */
export async function deleteFile({ path: filePath }) {
  assertPathAllowed(filePath);
  await fs.unlink(filePath);
  return { path: filePath, deleted: true };
}

/** Move or rename a file/directory. */
export async function moveFile({ source, destination }) {
  assertPathAllowed(source);
  assertPathAllowed(destination);
  await safeMkdir(path.dirname(destination));
  await fs.rename(source, destination);
  return { source, destination, moved: true };
}

/** Copy a file (not recursive — for directories use copyDirectory). */
export async function copyFile({ source, destination }) {
  await safeMkdir(path.dirname(destination));
  await fs.copyFile(source, destination);
  return { source, destination, copied: true };
}

/** Get metadata about a file or directory. */
export async function getFileInfo({ path: targetPath }) {
  const stats = await fs.stat(targetPath);
  return {
    path: targetPath,
    type: stats.isDirectory() ? "directory" : "file",
    size_bytes: stats.size,
    created: stats.birthtime,
    modified: stats.mtime,
    accessed: stats.atime,
  };
}
