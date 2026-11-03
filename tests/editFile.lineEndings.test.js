import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { editFile } from "../tools/fileOps.js";

// P0-13: edit_file must match a multi-line old_str in files with CRLF (or mixed) line endings, and the
// file must keep its original line endings afterwards.
let dir;
let file;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "causly-edit-eol-"));
  file = path.join(dir, "f.txt");
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const read = () => fs.readFile(file, "utf8");

describe("editFile line endings", () => {
  it("LF file: multi-line edit works and stays LF", async () => {
    await fs.writeFile(file, "a\nb\nc\n");
    await editFile({ path: file, old_str: "a\nb", new_str: "x\ny" });
    expect(await read()).toBe("x\ny\nc\n");
  });

  it("CRLF file: an LF old_str matches and the file stays CRLF", async () => {
    await fs.writeFile(file, "a\r\nb\r\nc\r\n");
    await editFile({ path: file, old_str: "a\nb", new_str: "x\ny\nz" });
    expect(await read()).toBe("x\r\ny\r\nz\r\nc\r\n");
  });

  it("CRLF file: a CRLF old_str matches too", async () => {
    await fs.writeFile(file, "a\r\nb\r\nc\r\n");
    await editFile({ path: file, old_str: "b\r\nc", new_str: "B\r\nC" });
    expect(await read()).toBe("a\r\nB\r\nC\r\n");
  });

  it("CRLF file: a single-line edit with a multi-line replacement keeps CRLF", async () => {
    await fs.writeFile(file, "one\r\ntwo\r\n");
    await editFile({ path: file, old_str: "two", new_str: "2a\n2b" });
    expect(await read()).toBe("one\r\n2a\r\n2b\r\n");
  });

  it("mixed file: untouched lines keep their own endings", async () => {
    await fs.writeFile(file, "a\r\nb\r\nc\nd\n");
    await editFile({ path: file, old_str: "c\nd", new_str: "C\nD" });
    expect(await read()).toBe("a\r\nb\r\nC\nD\n");
  });

  it("CRLF file: regex characters in old_str are matched literally", async () => {
    await fs.writeFile(file, "x = (a.b)\r\ny = [1]\r\n");
    await editFile({ path: file, old_str: "(a.b)\ny = [1]", new_str: "ok" });
    expect(await read()).toBe("x = ok\r\n");
  });

  it("CRLF file: ambiguity, not found and replace_all behave as for LF files", async () => {
    await fs.writeFile(file, "a\r\nb\r\na\r\nb\r\n");
    await expect(editFile({ path: file, old_str: "a\nb", new_str: "x" })).rejects.toThrow(/multiple times/);
    await expect(editFile({ path: file, old_str: "nope\nnope", new_str: "x" })).rejects.toThrow(/not found/);
    await editFile({ path: file, old_str: "a\nb", new_str: "x\ny", replace_all: true });
    expect(await read()).toBe("x\r\ny\r\nx\r\ny\r\n");
  });
});
