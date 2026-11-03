import fs from "fs/promises";
import path from "path";
import { assertPathAllowed } from "./pathGuard.js";

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
  assertPathAllowed(filePath, "read");
  const content = await fs.readFile(filePath, encoding);
  return { path: filePath, content };
}

/** Read multiple files in one call — avoids repeated round trips. */
export async function readMultipleFiles({ paths, encoding = "utf8" }) {
  const results = await Promise.all(
    paths.map(async (p) => {
      try {
        assertPathAllowed(p, "read");
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
/** Escape text for use inside a RegExp. */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find old_str in a file that uses CRLF line endings. Line endings in old_str are matched leniently
 * (LF or CRLF), so a multi-line old_str copied from an LF-only source still matches.
 */
function findIgnoringLineEndings(original, old_str) {
  const pattern = escapeRegExp(old_str.replace(/\r\n/g, "\n")).replace(/\n/g, "\\r?\\n");
  return [...original.matchAll(new RegExp(pattern, "g"))].map((m) => ({ index: m.index, length: m[0].length, text: m[0] }));
}

/** new_str with its line endings set to the ending used where it goes (the match, else the file). */
function withLineEndingOf(newStr, matchedText, original) {
  const sample = /\r?\n/.exec(matchedText) ?? /\r?\n/.exec(original);
  const eol = sample ? sample[0] : "\n";
  return newStr.replace(/\r\n/g, "\n").replace(/\n/g, eol);
}

/**
 * Replace text in a file. Files with CRLF endings match multi-line old_str whichever ending it uses,
 * and the file keeps its original line endings (inserted lines get the ending used at that spot).
 */
export async function editFile({ path: filePath, old_str, new_str, replace_all = false }) {
  assertPathAllowed(filePath);
  const original = await fs.readFile(filePath, "utf8");
  const crlf = original.includes("\r\n");

  const matches = crlf
    ? findIgnoringLineEndings(original, old_str)
    : (() => {
        const found = [];
        for (let i = original.indexOf(old_str); i !== -1 && old_str.length; i = original.indexOf(old_str, i + old_str.length)) {
          found.push({ index: i, length: old_str.length, text: old_str });
        }
        return found;
      })();

  if (matches.length === 0) {
    throw new Error("old_str not found in file - no changes made.");
  }
  if (matches.length > 1 && !replace_all) {
    throw new Error(
      "old_str appears multiple times. Pass replace_all: true, or make old_str more specific/unique."
    );
  }

  const chosen = replace_all ? matches : [matches[0]];
  let updated = "";
  let cursor = 0;
  for (const m of chosen) {
    updated += original.slice(cursor, m.index) + (crlf ? withLineEndingOf(new_str, m.text, original) : new_str);
    cursor = m.index + m.length;
  }
  updated += original.slice(cursor);

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
  assertPathAllowed(source, "read");
  assertPathAllowed(destination);
  await safeMkdir(path.dirname(destination));
  await fs.copyFile(source, destination);
  return { source, destination, copied: true };
}

/** Get metadata about a file or directory. */
export async function getFileInfo({ path: targetPath }) {
  assertPathAllowed(targetPath, "read");
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
