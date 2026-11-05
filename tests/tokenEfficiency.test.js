import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCommand } from "../tools/commandOps.js";
import { directoryTree } from "../tools/directoryOps.js";

const TREE_IGNORED = ["node_modules", ".git", "build", "dist", ".next", ".docusaurus", ".venv", "venv", "__pycache__", ".turbo", "coverage"];

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "causly-tokens-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function makeProject() {
  fs.mkdirSync(path.join(dir, "src", "components"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "index.js"), "");
  fs.writeFileSync(path.join(dir, "src", "components", "A.js"), "");
  fs.writeFileSync(path.join(dir, "package.json"), "{}");
  for (const name of TREE_IGNORED) {
    fs.mkdirSync(path.join(dir, name, "inner"), { recursive: true });
    for (let i = 0; i < 50; i++) fs.writeFileSync(path.join(dir, name, "inner", `junk${i}.js`), "x");
  }
}

describe("directory_tree output size", () => {
  it("does not walk dependency or build folders, and names them", async () => {
    makeProject();
    const tree = await directoryTree({ path: dir });
    const json = JSON.stringify(tree);
    expect(json).not.toContain("junk");
    expect(tree.skipped).toEqual(expect.arrayContaining([".docusaurus", "build", "dist", ".next", ".venv", "node_modules", ".git"]));
    expect(tree.children.map((c) => c.name)).toEqual(expect.arrayContaining(["src", "package.json"]));
  });

  it("include_ignored walks them", async () => {
    makeProject();
    const tree = await directoryTree({ path: dir, include_ignored: true, max_depth: 4 });
    expect(JSON.stringify(tree)).toContain("junk");
    expect(tree.skipped).toBeUndefined();
  });

  it("defaults to depth 3", async () => {
    let p = dir;
    for (const n of ["a", "b", "c", "d", "e"]) {
      p = path.join(p, n);
      fs.mkdirSync(p);
    }
    const tree = await directoryTree({ path: dir });
    expect(JSON.stringify(tree)).toContain('"name":"c","type":"directory","truncated":true');
    expect(JSON.stringify(tree)).not.toContain('"name":"d"');
  });

  it("stays under a size ceiling on a large fixture", async () => {
    // 30 folders x 100 files, 3,000 entries in all, plus heavy ignored folders.
    for (let d = 0; d < 30; d++) {
      fs.mkdirSync(path.join(dir, `pkg${d}`));
      for (let i = 0; i < 100; i++) fs.writeFileSync(path.join(dir, `pkg${d}`, `file${i}.js`), "");
    }
    fs.mkdirSync(path.join(dir, "build"));
    for (let i = 0; i < 500; i++) fs.writeFileSync(path.join(dir, "build", `chunk${i}.js`), "");
    const tree = await directoryTree({ path: dir, max_depth: 20 });
    const bytes = Buffer.byteLength(JSON.stringify(tree));
    expect(bytes).toBeLessThan(80 * 1024);
    expect(JSON.stringify(tree)).toContain('"truncated":true');
    expect(JSON.stringify(tree)).not.toContain("chunk");
  }, 60000);
});

describe("run_command result", () => {
  it("does not echo the command or cwd, and omits a plain LOW risk note", async () => {
    const r = await runCommand({ command: "node -p 1+1", cwd: dir });
    expect(r.stdout.trim()).toBe("2");
    expect(r.command).toBeUndefined();
    expect(r.cwd).toBeUndefined();
    expect(r.risk).toBeUndefined();
    expect(Object.keys(r).sort()).toEqual(["exit_code", "stderr", "stdout"]);
  });

  it("still reports a flagged command", async () => {
    const r = await runCommand({ command: "git push --force --dry-run", cwd: dir });
    expect(r.risk?.risk).toBe("ELEVATED");
    expect(r.command).toBeUndefined();
  });

  it("a failing command keeps its output without echoing inputs", async () => {
    const r = await runCommand({ command: "node -e process.exitCode=3", cwd: dir });
    expect(r.exit_code).toBeGreaterThan(0);
    expect(r.command).toBeUndefined();
    expect(r.cwd).toBeUndefined();
  });
});
