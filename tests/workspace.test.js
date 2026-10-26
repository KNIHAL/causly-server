import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { checkWorkspace, isInsideRoot, workspaceRoots } from "../tools/workspace.js";
import { createToolWrapper } from "../tools/toolWrapper.js";

let base, root, other;

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "causly-ws-"));
  root = path.join(base, "project");
  other = path.join(base, "project-evil"); // shares a name prefix with root
  fs.mkdirSync(root);
  fs.mkdirSync(other);
});

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe("workspace jail", () => {
  it("is off when CAUSLY_WORKSPACE is unset or empty", () => {
    expect(checkWorkspace("read_file", { path: "/anywhere/at/all" }, "")).toEqual({ allowed: true });
    expect(checkWorkspace("read_file", { path: "/anywhere/at/all" }, undefined)).toEqual({ allowed: true });
  });

  it("allows paths inside the workspace, including files that do not exist yet", () => {
    expect(checkWorkspace("write_file", { path: path.join(root, "a.txt") }, root).allowed).toBe(true);
    expect(checkWorkspace("write_file", { path: path.join(root, "new", "deep", "b.txt") }, root).allowed).toBe(true);
    expect(checkWorkspace("git_status", { repo_path: root }, root).allowed).toBe(true);
  });

  it("blocks paths outside the workspace and names the offending field", () => {
    const result = checkWorkspace("read_file", { path: path.join(base, "secret.txt") }, root);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("path");
    expect(result.reason).toContain("read_file");
  });

  it("blocks a sibling folder that only shares a name prefix", () => {
    expect(isInsideRoot(root, other)).toBe(false);
    expect(checkWorkspace("read_file", { path: path.join(other, "x.txt") }, root).allowed).toBe(false);
  });

  it("blocks .. traversal", () => {
    expect(checkWorkspace("read_file", { path: path.join(root, "..", "project-evil", "x.txt") }, root).allowed).toBe(false);
  });

  it("checks every path field, including arrays", () => {
    expect(checkWorkspace("read_multiple_files", { paths: [path.join(root, "a"), path.join(other, "b")] }, root).allowed).toBe(false);
    expect(checkWorkspace("run_command", { command: "ls", cwd: other }, root).allowed).toBe(false);
    expect(checkWorkspace("move_file", { source: path.join(root, "a"), destination: path.join(other, "a") }, root).allowed).toBe(false);
    expect(checkWorkspace("terraform_plan", { dir: other }, root).allowed).toBe(false);
  });

  it("ignores non-path inputs", () => {
    expect(checkWorkspace("gmail_send", { to: "a@b.com", subject: "hi", body: "x" }, root).allowed).toBe(true);
  });

  it("supports several roots", () => {
    const value = [root, other].join(path.delimiter);
    expect(workspaceRoots(value)).toHaveLength(2);
    expect(checkWorkspace("read_file", { path: path.join(other, "x.txt") }, value).allowed).toBe(true);
    expect(checkWorkspace("read_file", { path: path.join(base, "x.txt") }, value).allowed).toBe(false);
  });

  it("blocks a symlink inside the workspace that points outside", () => {
    const link = path.join(root, "link-out");
    try {
      fs.symlinkSync(other, link, "junction");
    } catch {
      return; // symlinks not permitted on this machine; nothing to test
    }
    expect(checkWorkspace("read_file", { path: path.join(link, "x.txt") }, root).allowed).toBe(false);
  });
});

describe("wrapper integration", () => {
  it("blocks the call, logs it, and never runs the handler", async () => {
    const handler = vi.fn();
    const activityLogger = vi.fn();
    const wrap = createToolWrapper({
      workspaceCheck: () => ({ allowed: false, reason: "outside workspace" }),
      activityLogger,
      receiptEmitter: () => {},
    });
    const result = await wrap("read_file", handler)({ path: "/x" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Blocked: outside workspace");
    expect(handler).not.toHaveBeenCalled();
    expect(activityLogger).toHaveBeenCalledWith("read_file", { path: "/x" }, "BLOCKED", "outside workspace", null, expect.any(String));
  });

  it("runs the handler when the workspace check passes", async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const wrap = createToolWrapper({
      workspaceCheck: () => ({ allowed: true }),
      approvalCheck: () => ({ allowed: true, level: "READ" }),
      activityLogger: () => {},
      receiptEmitter: () => {},
    });
    const result = await wrap("read_file", handler)({ path: "/x" });
    expect(result.isError).toBeUndefined();
    expect(handler).toHaveBeenCalledOnce();
  });
});
