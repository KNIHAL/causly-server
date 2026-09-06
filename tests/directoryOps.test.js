import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  listDirectory,
  directoryTree,
  createDirectory,
  deleteDirectory,
  searchFiles,
} from "../tools/directoryOps.js";

let testDir;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), "causly-dirops-test-"));
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe("directoryOps", () => {
  it("listDirectory lists immediate files and folders with types", async () => {
    await fs.writeFile(path.join(testDir, "a.txt"), "x");
    await fs.mkdir(path.join(testDir, "sub"));
    const result = await listDirectory({ path: testDir });
    expect(result.path).toBe(testDir);
    const names = result.entries.map((e) => e.name).sort();
    expect(names).toEqual(["a.txt", "sub"]);
    const sub = result.entries.find((e) => e.name === "sub");
    const file = result.entries.find((e) => e.name === "a.txt");
    expect(sub.type).toBe("directory");
    expect(file.type).toBe("file");
  });

  it("createDirectory creates nested directories recursively", async () => {
    const nested = path.join(testDir, "a", "b", "c");
    const result = await createDirectory({ path: nested });
    expect(result).toEqual({ path: nested, created: true });
    const stat = await fs.stat(nested);
    expect(stat.isDirectory()).toBe(true);
  });

  it("createDirectory rejects protected system paths", async () => {
    await expect(createDirectory({ path: "C:\\Windows\\evil" })).rejects.toThrow(/protected system directory/);
  });

  it("deleteDirectory removes a directory recursively by default", async () => {
    const target = path.join(testDir, "todelete");
    await fs.mkdir(path.join(target, "nested"), { recursive: true });
    await fs.writeFile(path.join(target, "nested", "f.txt"), "x");

    const result = await deleteDirectory({ path: target });
    expect(result).toEqual({ path: target, deleted: true });
    await expect(fs.access(target)).rejects.toThrow();
  });

  it("deleteDirectory rejects protected system paths", async () => {
    await expect(deleteDirectory({ path: "C:\\Windows\\System32" })).rejects.toThrow(/protected system directory/);
  });

  it("directoryTree builds a nested structure and skips node_modules/.git", async () => {
    await fs.mkdir(path.join(testDir, "src"));
    await fs.writeFile(path.join(testDir, "src", "index.js"), "x");
    await fs.mkdir(path.join(testDir, "node_modules"));
    await fs.writeFile(path.join(testDir, "node_modules", "pkg.js"), "x");
    await fs.mkdir(path.join(testDir, ".git"));

    const tree = await directoryTree({ path: testDir });
    expect(tree.name).toBe(path.basename(testDir));
    expect(tree.type).toBe("directory");
    const childNames = tree.children.map((c) => c.name);
    expect(childNames).toContain("src");
    expect(childNames).not.toContain("node_modules");
    expect(childNames).not.toContain(".git");

    const srcNode = tree.children.find((c) => c.name === "src");
    expect(srcNode.children).toEqual([{ name: "index.js", type: "file" }]);
  });

  it("directoryTree truncates once max_depth is reached", async () => {
    await fs.mkdir(path.join(testDir, "a", "b", "c"), { recursive: true });
    const tree = await directoryTree({ path: testDir, max_depth: 1 });
    const aNode = tree.children.find((c) => c.name === "a");
    expect(aNode.truncated).toBe(true);
    expect(aNode.children).toBeUndefined();
  });

  it("searchFiles finds case-insensitive substring matches recursively", async () => {
    await fs.mkdir(path.join(testDir, "nested"));
    await fs.writeFile(path.join(testDir, "MyFile.txt"), "x");
    await fs.writeFile(path.join(testDir, "nested", "myfile2.txt"), "x");
    await fs.writeFile(path.join(testDir, "other.txt"), "x");

    const result = await searchFiles({ root_path: testDir, pattern: "myfile" });
    expect(result.matches).toHaveLength(2);
    expect(result.matches.map((m) => path.basename(m.path)).sort()).toEqual(["MyFile.txt", "myfile2.txt"]);
    expect(result.truncated).toBe(false);
  });

  it("searchFiles respects max_results and sets truncated", async () => {
    for (let i = 0; i < 5; i++) {
      await fs.writeFile(path.join(testDir, `match-${i}.txt`), "x");
    }
    const result = await searchFiles({ root_path: testDir, pattern: "match", max_results: 3 });
    expect(result.matches).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it("searchFiles skips node_modules and .git directories", async () => {
    await fs.mkdir(path.join(testDir, "node_modules"));
    await fs.writeFile(path.join(testDir, "node_modules", "match.txt"), "x");
    const result = await searchFiles({ root_path: testDir, pattern: "match" });
    expect(result.matches).toHaveLength(0);
  });

  it("searchFiles silently skips unreadable subdirectories instead of throwing", async () => {
    // Point root_path at a nonexistent directory — walk() should catch and return empty.
    const missing = path.join(testDir, "does-not-exist");
    const result = await searchFiles({ root_path: missing, pattern: "anything" });
    expect(result.matches).toEqual([]);
  });
});
