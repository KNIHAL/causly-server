import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGit = {
  init: vi.fn(),
  status: vi.fn(),
  add: vi.fn(),
  commit: vi.fn(),
  push: vi.fn(),
  pull: vi.fn(),
  log: vi.fn(),
  diff: vi.fn(),
  branch: vi.fn(),
  checkoutLocalBranch: vi.fn(),
  checkout: vi.fn(),
  merge: vi.fn(),
  reset: vi.fn(),
  stash: vi.fn(),
  stashList: vi.fn(),
  show: vi.fn(),
  getRemotes: vi.fn(),
  addRemote: vi.fn(),
  removeRemote: vi.fn(),
  tags: vi.fn(),
  addAnnotatedTag: vi.fn(),
  addTag: vi.fn(),
  tag: vi.fn(),
  diffSummary: vi.fn(),
};

vi.mock("simple-git", () => ({
  simpleGit: vi.fn(() => mockGit),
}));

const { simpleGit } = await import("simple-git");
const {
  gitInit,
  gitStatus,
  gitAdd,
  gitCommit,
  gitPush,
  gitPull,
  gitLog,
  gitDiff,
  gitBranch,
  gitCreateBranch,
  gitCheckout,
  gitMerge,
  gitReset,
  gitStash,
  gitShow,
  gitRemote,
  gitTag,
  gitChangedFiles,
  gitDiffStat,
  gitCheckClean,
} = await import("../tools/gitOps.js");

beforeEach(() => {
  Object.values(mockGit).forEach((fn) => fn.mockReset());
  simpleGit.mockClear();
});

describe("gitOps", () => {
  it("gitInit calls git.init and returns confirmation", async () => {
    mockGit.init.mockResolvedValue({ ok: true });
    const result = await gitInit({ repo_path: "/repo" });
    expect(simpleGit).toHaveBeenCalledWith({ baseDir: "/repo" });
    expect(result).toEqual({ repo_path: "/repo", initialized: true, result: { ok: true } });
  });

  it("gitStatus returns the status object", async () => {
    mockGit.status.mockResolvedValue({ current: "main", files: [] });
    const result = await gitStatus({ repo_path: "/repo" });
    expect(result).toEqual({ repo_path: "/repo", status: { current: "main", files: [] } });
  });

  it("gitAdd defaults files to '.'", async () => {
    mockGit.add.mockResolvedValue();
    const result = await gitAdd({ repo_path: "/repo" });
    expect(mockGit.add).toHaveBeenCalledWith(".");
    expect(result).toEqual({ repo_path: "/repo", added: "." });
  });

  it("gitAdd passes through explicit files", async () => {
    mockGit.add.mockResolvedValue();
    await gitAdd({ repo_path: "/repo", files: ["a.js", "b.js"] });
    expect(mockGit.add).toHaveBeenCalledWith(["a.js", "b.js"]);
  });

  it("gitCommit passes the message and returns commit result", async () => {
    mockGit.commit.mockResolvedValue({ commit: "abc123" });
    const result = await gitCommit({ repo_path: "/repo", message: "fix bug" });
    expect(mockGit.commit).toHaveBeenCalledWith("fix bug");
    expect(result).toEqual({ repo_path: "/repo", commit: { commit: "abc123" } });
  });

  it("gitPush uses git.push() with no args when branch is omitted", async () => {
    mockGit.push.mockResolvedValue({ pushed: [] });
    await gitPush({ repo_path: "/repo" });
    expect(mockGit.push).toHaveBeenCalledWith();
  });

  it("gitPush passes remote and branch when given", async () => {
    mockGit.push.mockResolvedValue({ pushed: [] });
    await gitPush({ repo_path: "/repo", remote: "upstream", branch: "feature/x" });
    expect(mockGit.push).toHaveBeenCalledWith("upstream", "feature/x");
  });

  it("gitPull uses git.pull() with no args when branch is omitted", async () => {
    mockGit.pull.mockResolvedValue({});
    await gitPull({ repo_path: "/repo" });
    expect(mockGit.pull).toHaveBeenCalledWith();
  });

  it("gitPull passes remote and branch when given", async () => {
    mockGit.pull.mockResolvedValue({});
    await gitPull({ repo_path: "/repo", remote: "origin", branch: "main" });
    expect(mockGit.pull).toHaveBeenCalledWith("origin", "main");
  });

  it("gitLog respects max_count and unwraps .all", async () => {
    mockGit.log.mockResolvedValue({ all: [{ hash: "1" }, { hash: "2" }] });
    const result = await gitLog({ repo_path: "/repo", max_count: 5 });
    expect(mockGit.log).toHaveBeenCalledWith({ maxCount: 5 });
    expect(result.log).toEqual([{ hash: "1" }, { hash: "2" }]);
  });

  it("gitLog defaults max_count to 10", async () => {
    mockGit.log.mockResolvedValue({ all: [] });
    await gitLog({ repo_path: "/repo" });
    expect(mockGit.log).toHaveBeenCalledWith({ maxCount: 10 });
  });

  it("gitDiff diffs a specific file when given", async () => {
    mockGit.diff.mockResolvedValue("diff content");
    const result = await gitDiff({ repo_path: "/repo", file: "a.js" });
    expect(mockGit.diff).toHaveBeenCalledWith(["a.js"]);
    expect(result.diff).toBe("diff content");
  });

  it("gitDiff diffs everything when no file given", async () => {
    mockGit.diff.mockResolvedValue("full diff");
    await gitDiff({ repo_path: "/repo" });
    expect(mockGit.diff).toHaveBeenCalledWith();
  });

  it("gitBranch returns branch summary", async () => {
    mockGit.branch.mockResolvedValue({ current: "main", all: ["main", "dev"] });
    const result = await gitBranch({ repo_path: "/repo" });
    expect(result.branches.current).toBe("main");
  });

  it("gitCreateBranch checks out by default via checkoutLocalBranch", async () => {
    mockGit.checkoutLocalBranch.mockResolvedValue();
    const result = await gitCreateBranch({ repo_path: "/repo", branch_name: "feature/y" });
    expect(mockGit.checkoutLocalBranch).toHaveBeenCalledWith("feature/y");
    expect(mockGit.branch).not.toHaveBeenCalled();
    expect(result).toEqual({ repo_path: "/repo", branch_name: "feature/y", checked_out: true });
  });

  it("gitCreateBranch creates without checkout when checkout is false", async () => {
    mockGit.branch.mockResolvedValue();
    await gitCreateBranch({ repo_path: "/repo", branch_name: "feature/z", checkout: false });
    expect(mockGit.branch).toHaveBeenCalledWith(["feature/z"]);
    expect(mockGit.checkoutLocalBranch).not.toHaveBeenCalled();
  });

  it("gitCheckout switches branches", async () => {
    mockGit.checkout.mockResolvedValue();
    const result = await gitCheckout({ repo_path: "/repo", branch: "main" });
    expect(mockGit.checkout).toHaveBeenCalledWith("main");
    expect(result).toEqual({ repo_path: "/repo", checked_out: "main" });
  });

  it("gitMerge merges the given branch", async () => {
    mockGit.merge.mockResolvedValue({ result: "merged" });
    const result = await gitMerge({ repo_path: "/repo", branch: "feature/x" });
    expect(mockGit.merge).toHaveBeenCalledWith(["feature/x"]);
    expect(result.result).toEqual({ result: "merged" });
  });

  it("gitReset defaults to --mixed HEAD", async () => {
    mockGit.reset.mockResolvedValue();
    await gitReset({ repo_path: "/repo" });
    expect(mockGit.reset).toHaveBeenCalledWith(["--mixed", "HEAD"]);
  });

  it("gitReset supports --hard and a custom ref", async () => {
    mockGit.reset.mockResolvedValue();
    await gitReset({ repo_path: "/repo", mode: "hard", ref: "HEAD~1" });
    expect(mockGit.reset).toHaveBeenCalledWith(["--hard", "HEAD~1"]);
  });

  it("gitReset supports --soft", async () => {
    mockGit.reset.mockResolvedValue();
    await gitReset({ repo_path: "/repo", mode: "soft" });
    expect(mockGit.reset).toHaveBeenCalledWith(["--soft", "HEAD"]);
  });

  describe("gitStash", () => {
    it("save without message uses plain stash()", async () => {
      mockGit.stash.mockResolvedValue("stashed");
      await gitStash({ repo_path: "/repo" });
      expect(mockGit.stash).toHaveBeenCalledWith();
    });

    it("save with message uses push -m", async () => {
      mockGit.stash.mockResolvedValue("stashed");
      await gitStash({ repo_path: "/repo", message: "WIP" });
      expect(mockGit.stash).toHaveBeenCalledWith(["push", "-m", "WIP"]);
    });

    it("pop without stash_id", async () => {
      mockGit.stash.mockResolvedValue("popped");
      await gitStash({ repo_path: "/repo", action: "pop" });
      expect(mockGit.stash).toHaveBeenCalledWith(["pop"]);
    });

    it("pop with stash_id", async () => {
      mockGit.stash.mockResolvedValue("popped");
      await gitStash({ repo_path: "/repo", action: "pop", stash_id: "stash@{1}" });
      expect(mockGit.stash).toHaveBeenCalledWith(["pop", "stash@{1}"]);
    });

    it("apply with stash_id", async () => {
      mockGit.stash.mockResolvedValue("applied");
      await gitStash({ repo_path: "/repo", action: "apply", stash_id: "stash@{0}" });
      expect(mockGit.stash).toHaveBeenCalledWith(["apply", "stash@{0}"]);
    });

    it("list calls stashList", async () => {
      mockGit.stashList.mockResolvedValue({ all: [] });
      const result = await gitStash({ repo_path: "/repo", action: "list" });
      expect(mockGit.stashList).toHaveBeenCalled();
      expect(result.result).toEqual({ all: [] });
    });

    it("drop with stash_id", async () => {
      mockGit.stash.mockResolvedValue("dropped");
      await gitStash({ repo_path: "/repo", action: "drop", stash_id: "stash@{0}" });
      expect(mockGit.stash).toHaveBeenCalledWith(["drop", "stash@{0}"]);
    });

    it("throws on unknown action", async () => {
      await expect(gitStash({ repo_path: "/repo", action: "bogus" })).rejects.toThrow(/Unknown stash action/);
    });
  });

  it("gitShow defaults ref to HEAD", async () => {
    mockGit.show.mockResolvedValue("commit details");
    const result = await gitShow({ repo_path: "/repo" });
    expect(mockGit.show).toHaveBeenCalledWith(["HEAD"]);
    expect(result.result).toBe("commit details");
  });

  describe("gitRemote", () => {
    it("list calls getRemotes(true)", async () => {
      mockGit.getRemotes.mockResolvedValue([{ name: "origin" }]);
      const result = await gitRemote({ repo_path: "/repo" });
      expect(mockGit.getRemotes).toHaveBeenCalledWith(true);
      expect(result.result).toEqual([{ name: "origin" }]);
    });

    it("add calls addRemote with name and url", async () => {
      mockGit.addRemote.mockResolvedValue();
      await gitRemote({ repo_path: "/repo", action: "add", name: "upstream", url: "https://x.git" });
      expect(mockGit.addRemote).toHaveBeenCalledWith("upstream", "https://x.git");
    });

    it("remove calls removeRemote with name", async () => {
      mockGit.removeRemote.mockResolvedValue();
      await gitRemote({ repo_path: "/repo", action: "remove", name: "upstream" });
      expect(mockGit.removeRemote).toHaveBeenCalledWith("upstream");
    });

    it("throws on unknown action", async () => {
      await expect(gitRemote({ repo_path: "/repo", action: "bogus" })).rejects.toThrow(/Unknown remote action/);
    });
  });

  describe("gitTag", () => {
    it("list calls tags()", async () => {
      mockGit.tags.mockResolvedValue({ all: ["v1.0"] });
      const result = await gitTag({ repo_path: "/repo" });
      expect(mockGit.tags).toHaveBeenCalled();
      expect(result.result).toEqual({ all: ["v1.0"] });
    });

    it("create without message uses addTag", async () => {
      mockGit.addTag.mockResolvedValue();
      await gitTag({ repo_path: "/repo", action: "create", tag_name: "v1.1" });
      expect(mockGit.addTag).toHaveBeenCalledWith("v1.1");
      expect(mockGit.addAnnotatedTag).not.toHaveBeenCalled();
    });

    it("create with message uses addAnnotatedTag", async () => {
      mockGit.addAnnotatedTag.mockResolvedValue();
      await gitTag({ repo_path: "/repo", action: "create", tag_name: "v1.1", message: "release" });
      expect(mockGit.addAnnotatedTag).toHaveBeenCalledWith("v1.1", "release");
    });

    it("delete calls tag(['-d', name])", async () => {
      mockGit.tag.mockResolvedValue();
      await gitTag({ repo_path: "/repo", action: "delete", tag_name: "v1.0" });
      expect(mockGit.tag).toHaveBeenCalledWith(["-d", "v1.0"]);
    });

    it("throws on unknown action", async () => {
      await expect(gitTag({ repo_path: "/repo", action: "bogus" })).rejects.toThrow(/Unknown tag action/);
    });
  });

  it("gitChangedFiles maps every status category with its type label", async () => {
    mockGit.status.mockResolvedValue({
      modified: ["a.js"],
      not_added: ["b.js"],
      created: ["c.js"],
      deleted: ["d.js"],
      renamed: [{ from: "e.js", to: "f.js" }],
    });
    const result = await gitChangedFiles({ repo_path: "/repo" });
    expect(result.changed_files).toEqual([
      { file: "a.js", type: "modified" },
      { file: "b.js", type: "untracked" },
      { file: "c.js", type: "created" },
      { file: "d.js", type: "deleted" },
      { file: "f.js", type: "renamed" },
    ]);
  });

  it("gitDiffStat scopes to a file when given", async () => {
    mockGit.diffSummary.mockResolvedValue({ files: [{ file: "a.js", changes: 3 }] });
    const result = await gitDiffStat({ repo_path: "/repo", file: "a.js" });
    expect(mockGit.diffSummary).toHaveBeenCalledWith(["a.js"]);
    expect(result.summary.files).toHaveLength(1);
  });

  it("gitDiffStat covers the whole repo when no file given", async () => {
    mockGit.diffSummary.mockResolvedValue({ files: [] });
    await gitDiffStat({ repo_path: "/repo" });
    expect(mockGit.diffSummary).toHaveBeenCalledWith();
  });

  it("gitCheckClean reports is_clean from status.isClean()", async () => {
    mockGit.status.mockResolvedValue({ isClean: () => true, files: [] });
    const result = await gitCheckClean({ repo_path: "/repo" });
    expect(result.is_clean).toBe(true);
  });

  it("gitCheckClean reports false for a dirty repo", async () => {
    mockGit.status.mockResolvedValue({ isClean: () => false, files: [{ path: "a.js" }] });
    const result = await gitCheckClean({ repo_path: "/repo" });
    expect(result.is_clean).toBe(false);
  });
});
