import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  readFile,
  readMultipleFiles,
  createFile,
  writeFile,
  editFile,
  deleteFile,
  moveFile,
  copyFile,
  getFileInfo,
} from "../tools/fileOps.js";

let testDir;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), "causly-fileops-test-"));
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe("fileOps", () => {
  it("createFile writes content and fails if the file already exists", async () => {
    const filePath = path.join(testDir, "new.txt");
    const result = await createFile({ path: filePath, content: "hello" });
    expect(result).toEqual({ path: filePath, created: true });
    expect(await fs.readFile(filePath, "utf8")).toBe("hello");

    await expect(createFile({ path: filePath, content: "again" })).rejects.toThrow();
  });

  it("createFile creates missing parent directories", async () => {
    const filePath = path.join(testDir, "nested", "deep", "file.txt");
    await createFile({ path: filePath, content: "x" });
    expect(await fs.readFile(filePath, "utf8")).toBe("x");
  });

  it("readFile returns full content", async () => {
    const filePath = path.join(testDir, "read.txt");
    await fs.writeFile(filePath, "some content", "utf8");
    const result = await readFile({ path: filePath });
    expect(result).toEqual({ path: filePath, content: "some content" });
  });

  it("readMultipleFiles reads several files and reports per-file success/failure", async () => {
    const p1 = path.join(testDir, "a.txt");
    const p2 = path.join(testDir, "missing.txt");
    await fs.writeFile(p1, "A", "utf8");

    const result = await readMultipleFiles({ paths: [p1, p2] });
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toEqual({ path: p1, content: "A", success: true });
    expect(result.results[1].success).toBe(false);
    expect(result.results[1].error).toBeTruthy();
  });

  it("writeFile overwrites existing content and creates parent dirs", async () => {
    const filePath = path.join(testDir, "sub", "overwrite.txt");
    await writeFile({ path: filePath, content: "v1" });
    expect(await fs.readFile(filePath, "utf8")).toBe("v1");
    await writeFile({ path: filePath, content: "v2" });
    expect(await fs.readFile(filePath, "utf8")).toBe("v2");
  });

  it("editFile replaces a unique old_str with new_str", async () => {
    const filePath = path.join(testDir, "edit.txt");
    await fs.writeFile(filePath, "Hello, World!", "utf8");
    await editFile({ path: filePath, old_str: "World", new_str: "Causly" });
    expect(await fs.readFile(filePath, "utf8")).toBe("Hello, Causly!");
  });

  it("editFile throws if old_str is not found", async () => {
    const filePath = path.join(testDir, "edit2.txt");
    await fs.writeFile(filePath, "Hello", "utf8");
    await expect(editFile({ path: filePath, old_str: "Nope", new_str: "X" })).rejects.toThrow(
      /old_str not found/
    );
  });

  it("editFile throws when old_str is ambiguous (appears more than once) without replace_all", async () => {
    const filePath = path.join(testDir, "edit3.txt");
    await fs.writeFile(filePath, "foo foo foo", "utf8");
    await expect(editFile({ path: filePath, old_str: "foo", new_str: "bar" })).rejects.toThrow(
      /appears multiple times/
    );
  });

  it("editFile replaces all occurrences when replace_all is true", async () => {
    const filePath = path.join(testDir, "edit4.txt");
    await fs.writeFile(filePath, "foo foo foo", "utf8");
    await editFile({ path: filePath, old_str: "foo", new_str: "bar", replace_all: true });
    expect(await fs.readFile(filePath, "utf8")).toBe("bar bar bar");
  });

  it("deleteFile removes the file", async () => {
    const filePath = path.join(testDir, "delete-me.txt");
    await fs.writeFile(filePath, "x", "utf8");
    const result = await deleteFile({ path: filePath });
    expect(result).toEqual({ path: filePath, deleted: true });
    await expect(fs.access(filePath)).rejects.toThrow();
  });

  it("moveFile relocates a file and creates the destination's parent dir", async () => {
    const src = path.join(testDir, "src.txt");
    const dest = path.join(testDir, "moved", "dest.txt");
    await fs.writeFile(src, "content", "utf8");
    const result = await moveFile({ source: src, destination: dest });
    expect(result).toEqual({ source: src, destination: dest, moved: true });
    expect(await fs.readFile(dest, "utf8")).toBe("content");
    await expect(fs.access(src)).rejects.toThrow();
  });

  it("copyFile duplicates a file, leaving the source intact", async () => {
    const src = path.join(testDir, "orig.txt");
    const dest = path.join(testDir, "copied", "copy.txt");
    await fs.writeFile(src, "content", "utf8");
    const result = await copyFile({ source: src, destination: dest });
    expect(result).toEqual({ source: src, destination: dest, copied: true });
    expect(await fs.readFile(dest, "utf8")).toBe("content");
    expect(await fs.readFile(src, "utf8")).toBe("content");
  });

  it("getFileInfo reports type and size for a file", async () => {
    const filePath = path.join(testDir, "info.txt");
    await fs.writeFile(filePath, "12345", "utf8");
    const result = await getFileInfo({ path: filePath });
    expect(result.path).toBe(filePath);
    expect(result.type).toBe("file");
    expect(result.size_bytes).toBe(5);
    expect(result.modified).toBeInstanceOf(Date);
  });

  it("getFileInfo reports type 'directory' for a directory", async () => {
    const result = await getFileInfo({ path: testDir });
    expect(result.type).toBe("directory");
  });

  it("rejects writes/creates/edits/deletes/moves targeting protected system paths", async () => {
    const deniedPath = "C:\\Windows\\System32\\evil.txt";
    await expect(createFile({ path: deniedPath, content: "x" })).rejects.toThrow(/protected system directory/);
    await expect(writeFile({ path: deniedPath, content: "x" })).rejects.toThrow(/protected system directory/);
    await expect(deleteFile({ path: deniedPath })).rejects.toThrow(/protected system directory/);
    await expect(
      moveFile({ source: path.join(testDir, "x.txt"), destination: deniedPath })
    ).rejects.toThrow(/protected system directory/);
  });
});
