import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { FUZZ_VALUES, injectionPayloads, asFileName, makeSandbox, attempt, expectNoEvaluation, snapshot } from "./helpers/fuzz.js";
import { createFile, readFile, getFileInfo, copyFile, moveFile, editFile, deleteFile } from "../tools/fileOps.js";
import { createDirectory, listDirectory, directoryTree, deleteDirectory, searchFiles } from "../tools/directoryOps.js";
import * as git from "../tools/gitOps.js";
import { runCommand } from "../tools/commandOps.js";
import { projectDetect, projectHealth } from "../tools/projectOps.js";
import { terraformValidate, terraformFmt } from "../tools/terraformOps.js";
import { dockerComposeUp, dockerComposeDown, dockerBuild } from "../tools/dockerOps.js";
import { checkWorkspace } from "../tools/workspace.js";

// P0-10: hostile values in every path and shell argument. Helper: tests/helpers/fuzz.js.
let box;
let all; // every fuzz value plus the injection payloads
beforeAll(async () => {
  box = await makeSandbox();
  all = [...FUZZ_VALUES, ...injectionPayloads(box.sentinel)];
});
afterAll(async () => {
  await box.cleanup();
});

describe("files and directories", () => {
  it("handle every usable name literally: nothing is evaluated, nothing leaves the workspace", async () => {
    for (const { label, value } of all) {
      const name = asFileName(value);
      if (!name) continue;
      const file = path.join(box.ws, name);
      const copy = path.join(box.ws, `${name}.copy`);
      const moved = path.join(box.ws, `${name}.moved`);
      const dir = path.join(box.ws, `${name}-dir`);

      expect((await attempt(() => createFile({ path: file, content: `body ${label}` }))).ok, `createFile ${label}`).toBe(true);
      expect(await fs.readdir(box.ws), `${label}: the file is created under exactly this name`).toContain(name);
      expect((await readFile({ path: file })).content).toBe(`body ${label}`);
      await getFileInfo({ path: file });
      await editFile({ path: file, old_str: "body", new_str: "BODY" });
      await copyFile({ source: file, destination: copy });
      await moveFile({ source: copy, destination: moved });
      await createDirectory({ path: dir });
      await listDirectory({ path: box.ws });
      await directoryTree({ path: box.ws, max_depth: 2 });
      const found = await searchFiles({ root_path: box.ws, pattern: value });
      expect(found, `searchFiles ${label}`).toBeTruthy();
      await deleteFile({ path: file });
      await deleteFile({ path: moved });
      await deleteDirectory({ path: dir });
    }
    expect(await fs.readdir(box.ws)).toEqual([]);
    await expectNoEvaluation(box);
  }, 120000);

  it("traversal and UNC values are stopped by the workspace jail; the rest fail cleanly or succeed", async () => {
    const TRAVERSAL = new Set(["parent traversal", "parent traversal (slash)", "UNC path"]);
    for (const { label, value } of all) {
      // A UNC value is a whole path, not a name to join onto the workspace.
      const target = label === "UNC path" ? value : path.join(box.ws, "nested", value);
      // The wrapper runs this check before any tool. Without it a traversal path is a legitimate path.
      const gate = checkWorkspace("write_file", { path: target }, box.ws);
      if (TRAVERSAL.has(label)) {
        expect(gate.allowed, `jail must block ${label}: ${target}`).toBe(false);
        continue;
      }
      expect(gate.allowed, `jail must allow ${label}`).toBe(true);
      for (const call of [
        () => createFile({ path: target, content: "x" }),
        () => readFile({ path: target }),
        () => getFileInfo({ path: target }),
        () => deleteFile({ path: target }),
        () => createDirectory({ path: target }),
        () => listDirectory({ path: target }),
        () => deleteDirectory({ path: target }),
        () => searchFiles({ root_path: box.ws, pattern: value }),
      ]) {
        await attempt(call);
      }
    }
    await fs.rm(path.join(box.ws, "nested"), { recursive: true, force: true });
    await expectNoEvaluation(box);
  }, 120000);
});

describe("workspace jail", () => {
  const field = (p) => ({ path: p });
  it("blocks traversal, UNC paths and a symlink that points outside", async () => {
    const jail = box.ws;
    const outsideFile = path.join(box.outside, "x.txt");
    const blocked = [
      path.join(jail, "..", "outside", "x.txt"),
      path.join(jail, "..", "..", "x.txt"),
      outsideFile,
      "\\\\server\\share\\x",
    ];
    for (const p of blocked) {
      expect(checkWorkspace("write_file", field(p), jail).allowed, `should block ${p}`).toBe(false);
    }
    expect(checkWorkspace("write_file", field(path.join(jail, "inside.txt")), jail).allowed).toBe(true);

    const link = path.join(jail, "link");
    const linked = await fs.symlink(box.outside, link, "junction").then(() => true, () => false);
    if (linked) {
      expect(checkWorkspace("write_file", field(path.join(link, "x.txt")), jail).allowed, "symlink out of the workspace").toBe(false);
      await fs.rm(link, { recursive: true, force: true });
    }
  });
});

describe("git tools", () => {
  let repo;
  beforeAll(async () => {
    repo = path.join(box.ws, "repo");
    await fs.mkdir(repo);
    await git.gitInit({ repo_path: repo });
    const { simpleGit } = await import("simple-git");
    const g = simpleGit(repo);
    await g.addConfig("user.email", "fuzz@example.com");
    await g.addConfig("user.name", "Fuzz");
    await g.addConfig("commit.gpgsign", "false");
    await fs.writeFile(path.join(repo, "seed.txt"), "seed");
    await git.gitAdd({ repo_path: repo, files: "seed.txt" });
    await git.gitCommit({ repo_path: repo, message: "seed" });
  });

  it("pass every value as an argument, never to a shell", async () => {
    let n = 0;
    for (const { value } of all) {
      n++;
      await attempt(() => git.gitCreateBranch({ repo_path: repo, branch_name: value, checkout: false }));
      await attempt(() => git.gitCheckout({ repo_path: repo, branch: value }));
      await attempt(() => git.gitAdd({ repo_path: repo, files: value }));
      await attempt(() => git.gitTag({ repo_path: repo, action: "create", tag_name: value, message: value }));
      await attempt(() => git.gitStash({ repo_path: repo, action: "save", message: value }));
      await attempt(() => git.gitShow({ repo_path: repo, ref: value }));
      await attempt(() => git.gitDiff({ repo_path: repo, file: value }));
      await attempt(() => git.gitRemote({ repo_path: repo, action: "add", name: `r${n}`, url: value }));

      // A commit message is stored exactly as given (git trims surrounding whitespace).
      if (value.trim()) {
        await fs.writeFile(path.join(repo, `c${n}.txt`), String(n));
        await git.gitAdd({ repo_path: repo, files: `c${n}.txt` });
        const result = await attempt(() => git.gitCommit({ repo_path: repo, message: value }));
        if (result.ok) {
          const { simpleGit } = await import("simple-git");
          const stored = (await simpleGit(repo).raw(["log", "-1", "--format=%B"])).trim();
          expect(stored.replace(/\r\n/g, "\n"), "commit message stored verbatim").toBe(value.trim().replace(/\r\n/g, "\n"));
        }
      }
    }
    await expectNoEvaluation(box);
  }, 240000);

  it("work in a repository whose folder name is hostile", async () => {
    for (const { value } of all) {
      const name = asFileName(value);
      if (!name) continue;
      const dir = path.join(box.ws, `repo-${name}`);
      await fs.mkdir(dir);
      await attempt(() => git.gitInit({ repo_path: dir }));
      await attempt(() => git.gitStatus({ repo_path: dir }));
      await attempt(() => git.gitLog({ repo_path: dir }));
    }
    await expectNoEvaluation(box);
  }, 240000);
});

describe("command, project, terraform and docker tools", () => {
  // Folder names that are legal on this OS, a few of each kind.
  const names = () =>
    all
      .map((v) => ({ ...v, name: asFileName(v.value) }))
      .filter((v) => v.name && !["very long name", "newline injection", "newline"].includes(v.label))
      .slice(0, 12);

  it("run_command uses a hostile folder name as its working directory, not as shell text", async () => {
    for (const { label, name } of names()) {
      const cwd = path.join(box.ws, `cwd-${name}`);
      await fs.mkdir(cwd, { recursive: true });
      const result = await attempt(() => runCommand({ command: "echo fuzz-ok", cwd, timeout_ms: 20000 }));
      if (result.ok) expect(JSON.stringify(result.value), `run_command in ${label}`).toContain("fuzz-ok");
    }
    await expectNoEvaluation(box);
  }, 240000);

  it("project, terraform and docker tools take hostile folder names as plain arguments", async () => {
    for (const { name } of names().slice(0, 6)) {
      const dir = path.join(box.ws, `proj-${name}`);
      await fs.mkdir(dir, { recursive: true });
      await attempt(() => projectDetect({ repo_path: dir }));
      await attempt(() => projectHealth({ repo_path: dir }));
      await attempt(() => terraformValidate({ dir }));
      await attempt(() => terraformFmt({ dir, check: true }));
      await attempt(() => dockerComposeUp({ project_dir: dir, confirm: true }));
      await attempt(() => dockerComposeDown({ project_dir: dir, confirm: true }));
      await attempt(() => dockerBuild({ context_dir: dir, tag: "fuzz:test", confirm: true }));
    }
    await expectNoEvaluation(box);
    expect((await snapshot(box.outside)).length).toBe(box.before.length);
  }, 300000);
});
