import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("child_process", async () => {
  const { promisify } = await import("node:util");
  const execFile = vi.fn();
  execFile[promisify.custom] = (file, args, options) =>
    new Promise((resolve, reject) => {
      execFile(file, args, options, (err, stdout, stderr) => {
        if (err) {
          err.stdout = err.stdout ?? stdout;
          err.stderr = err.stderr ?? stderr;
          reject(err);
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  return { execFile };
});

vi.mock("../tools/githubOps.js", () => ({
  githubAddComment: vi.fn(),
}));

const { execFile } = await import("child_process");
const githubOps = await import("../tools/githubOps.js");
const {
  terraformInit,
  terraformValidate,
  terraformFmt,
  terraformPlan,
  terraformApply,
  terraformDestroy,
  terraformShow,
  terraformOutput,
  terraformWorkspace,
  terraformStateList,
  terraformStateShow,
  terraformStateMv,
  terraformStateRm,
  terraformStatePull,
  terraformImport,
  terraformTaint,
  terraformUntaint,
  terraformGraph,
  terraformProviders,
  terraformPlanComment,
} = await import("../tools/terraformOps.js");

function ok(stdout = "", stderr = "") {
  return (cmd, args, options, callback) => callback(null, stdout, stderr);
}
function fail(stdout = "", stderr = "error", code = 1) {
  return (cmd, args, options, callback) => {
    const err = new Error(stderr);
    err.code = code;
    err.stdout = stdout;
    err.stderr = stderr;
    callback(err);
  };
}

beforeEach(() => {
  execFile.mockReset();
  githubOps.githubAddComment.mockReset();
});

describe("terraformOps — arg construction & success path", () => {
  it("terraformInit builds base args, adds -upgrade when requested", async () => {
    execFile.mockImplementationOnce(ok("initialized", ""));
    const result = await terraformInit({ dir: "/infra" });
    expect(result).toEqual({ stdout: "initialized", stderr: "", exit_code: 0 });
    expect(execFile.mock.calls[0][0]).toBe("terraform");
    expect(execFile.mock.calls[0][1]).toEqual(["init", "-no-color"]);
    expect(execFile.mock.calls[0][2].cwd).toBe("/infra");

    execFile.mockImplementationOnce(ok("", ""));
    await terraformInit({ dir: "/infra", upgrade: true });
    expect(execFile.mock.calls[1][1]).toEqual(["init", "-no-color", "-upgrade"]);
  });

  it("terraformValidate requests JSON output", async () => {
    execFile.mockImplementationOnce(ok('{"valid":true}', ""));
    await terraformValidate({ dir: "/infra" });
    expect(execFile.mock.calls[0][1]).toEqual(["validate", "-no-color", "-json"]);
  });

  it("terraformFmt adds -check only when requested", async () => {
    execFile.mockImplementationOnce(ok("", ""));
    await terraformFmt({ dir: "/infra" });
    expect(execFile.mock.calls[0][1]).toEqual(["fmt", "-no-color"]);

    execFile.mockImplementationOnce(ok("", ""));
    await terraformFmt({ dir: "/infra", check: true });
    expect(execFile.mock.calls[1][1]).toEqual(["fmt", "-no-color", "-check"]);
  });

  it("terraformPlan includes var-file and out flags when given", async () => {
    execFile.mockImplementationOnce(ok("plan output", ""));
    await terraformPlan({ dir: "/infra", var_file: "prod.tfvars", out: "plan.out" });
    expect(execFile.mock.calls[0][1]).toEqual([
      "plan",
      "-no-color",
      "-input=false",
      "-var-file=prod.tfvars",
      "-out=plan.out",
    ]);
  });

  it("terraformApply prefers plan_file over var_file when both given", async () => {
    execFile.mockImplementationOnce(ok("applied", ""));
    await terraformApply({ dir: "/infra", var_file: "prod.tfvars", plan_file: "plan.out", confirm: true });
    expect(execFile.mock.calls[0][1]).toEqual([
      "apply",
      "-no-color",
      "-input=false",
      "-auto-approve",
      "plan.out",
    ]);
  });

  it("terraformApply falls back to var_file when no plan_file given", async () => {
    execFile.mockImplementationOnce(ok("applied", ""));
    await terraformApply({ dir: "/infra", var_file: "prod.tfvars", confirm: true });
    expect(execFile.mock.calls[0][1]).toEqual([
      "apply",
      "-no-color",
      "-input=false",
      "-auto-approve",
      "-var-file=prod.tfvars",
    ]);
  });

  it("terraformDestroy includes var-file flag when given", async () => {
    execFile.mockImplementationOnce(ok("destroyed", ""));
    await terraformDestroy({ dir: "/infra", var_file: "prod.tfvars", confirm: true });
    expect(execFile.mock.calls[0][1]).toEqual([
      "destroy",
      "-no-color",
      "-input=false",
      "-auto-approve",
      "-var-file=prod.tfvars",
    ]);
  });

  it("terraformShow adds -json and target when given", async () => {
    execFile.mockImplementationOnce(ok("{}", ""));
    await terraformShow({ dir: "/infra", target: "plan.out", json: true });
    expect(execFile.mock.calls[0][1]).toEqual(["show", "-no-color", "-json", "plan.out"]);
  });

  it("terraformOutput defaults to json=true and adds a name when given", async () => {
    execFile.mockImplementationOnce(ok("{}", ""));
    await terraformOutput({ dir: "/infra" });
    expect(execFile.mock.calls[0][1]).toEqual(["output", "-no-color", "-json"]);

    execFile.mockImplementationOnce(ok('"value"', ""));
    await terraformOutput({ dir: "/infra", name: "vpc_id" });
    expect(execFile.mock.calls[1][1]).toEqual(["output", "-no-color", "-json", "vpc_id"]);

    execFile.mockImplementationOnce(ok("value", ""));
    await terraformOutput({ dir: "/infra", name: "vpc_id", json: false });
    expect(execFile.mock.calls[2][1]).toEqual(["output", "-no-color", "vpc_id"]);
  });

  it("terraformWorkspace dispatches list/new/select/delete correctly", async () => {
    execFile.mockImplementation(ok("", ""));
    await terraformWorkspace({ dir: "/infra" });
    expect(execFile.mock.calls[0][1]).toEqual(["workspace", "list", "-no-color"]);

    await terraformWorkspace({ dir: "/infra", action: "new", name: "staging" });
    expect(execFile.mock.calls[1][1]).toEqual(["workspace", "new", "-no-color", "staging"]);

    await terraformWorkspace({ dir: "/infra", action: "select", name: "staging" });
    expect(execFile.mock.calls[2][1]).toEqual(["workspace", "select", "-no-color", "staging"]);

    await terraformWorkspace({ dir: "/infra", action: "delete", name: "staging" });
    expect(execFile.mock.calls[3][1]).toEqual(["workspace", "delete", "-no-color", "staging"]);
  });

  it("terraformWorkspace throws on an unknown action", async () => {
    await expect(terraformWorkspace({ dir: "/infra", action: "bogus" })).rejects.toThrow(/Unknown workspace action/);
    expect(execFile).not.toHaveBeenCalled();
  });

  it("terraformStateList adds an optional filter", async () => {
    execFile.mockImplementationOnce(ok("aws_instance.web", ""));
    await terraformStateList({ dir: "/infra" });
    expect(execFile.mock.calls[0][1]).toEqual(["state", "list", "-no-color"]);

    execFile.mockImplementationOnce(ok("", ""));
    await terraformStateList({ dir: "/infra", filter: "aws_instance.*" });
    expect(execFile.mock.calls[1][1]).toEqual(["state", "list", "-no-color", "aws_instance.*"]);
  });

  it("terraformStateShow/StateMv/StateRm/StatePull/Taint/Untaint/Graph/Providers build correct args", async () => {
    execFile.mockImplementation(ok("", ""));

    await terraformStateShow({ dir: "/infra", address: "aws_instance.web" });
    expect(execFile.mock.calls[0][1]).toEqual(["state", "show", "-no-color", "aws_instance.web"]);

    await terraformStateMv({ dir: "/infra", source: "a", destination: "b", confirm: true });
    expect(execFile.mock.calls[1][1]).toEqual(["state", "mv", "-no-color", "a", "b"]);

    await terraformStateRm({ dir: "/infra", address: "aws_instance.web", confirm: true });
    expect(execFile.mock.calls[2][1]).toEqual(["state", "rm", "-no-color", "aws_instance.web"]);

    await terraformStatePull({ dir: "/infra" });
    expect(execFile.mock.calls[3][1]).toEqual(["state", "pull"]);

    await terraformTaint({ dir: "/infra", address: "aws_instance.web", confirm: true });
    expect(execFile.mock.calls[4][1]).toEqual(["taint", "-no-color", "aws_instance.web"]);

    await terraformUntaint({ dir: "/infra", address: "aws_instance.web" });
    expect(execFile.mock.calls[5][1]).toEqual(["untaint", "-no-color", "aws_instance.web"]);

    await terraformGraph({ dir: "/infra" });
    expect(execFile.mock.calls[6][1]).toEqual(["graph"]);

    await terraformProviders({ dir: "/infra" });
    expect(execFile.mock.calls[7][1]).toEqual(["providers"]);
  });

  it("terraformImport includes var-file when given, and always address+resource_id", async () => {
    execFile.mockImplementationOnce(ok("imported", ""));
    await terraformImport({
      dir: "/infra",
      address: "aws_instance.web",
      resource_id: "i-12345",
      var_file: "prod.tfvars",
      confirm: true,
    });
    expect(execFile.mock.calls[0][1]).toEqual([
      "import",
      "-no-color",
      "-input=false",
      "-var-file=prod.tfvars",
      "aws_instance.web",
      "i-12345",
    ]);
  });
});

describe("terraformOps — failure path", () => {
  it("returns a nonzero exit_code and stderr on command failure, without throwing", async () => {
    execFile.mockImplementationOnce(fail("", "Error: no configuration files", 1));
    const result = await terraformValidate({ dir: "/empty" });
    expect(result.exit_code).toBe(1);
    expect(result.stderr).toContain("no configuration files");
  });
});

describe("terraformPlanComment", () => {
  it("posts a comment with 'no changes' status when plan exit_code is 0", async () => {
    execFile.mockImplementationOnce(ok("No changes. Infrastructure is up-to-date.", ""));
    githubOps.githubAddComment.mockResolvedValueOnce({ id: 1, html_url: "https://github.com/x/y/pull/1#comment" });

    const result = await terraformPlanComment({
      dir: "/infra",
      owner: "acme",
      repo: "infra",
      pull_number: 1,
      confirm: true,
    });

    expect(result.plan_exit_code).toBe(0);
    expect(result.had_error).toBe(false);
    expect(result.comment_url).toBe("https://github.com/x/y/pull/1#comment");
    const commentArg = githubOps.githubAddComment.mock.calls[0][0];
    expect(commentArg.body).toContain("✅ No changes");
    expect(commentArg.body).toContain("No changes. Infrastructure is up-to-date.");
  });

  it("posts a comment with 'has changes' status when plan exit_code is 2", async () => {
    execFile.mockImplementationOnce(fail("~ update in place", "", 2));
    githubOps.githubAddComment.mockResolvedValueOnce({ id: 2, html_url: "https://github.com/x/y/pull/2#comment" });

    const result = await terraformPlanComment({
      dir: "/infra",
      owner: "acme",
      repo: "infra",
      pull_number: 2,
      confirm: true,
    });

    expect(result.plan_exit_code).toBe(2);
    expect(result.had_error).toBe(false);
    const commentArg = githubOps.githubAddComment.mock.calls[0][0];
    expect(commentArg.body).toContain("📋 Plan has changes");
    expect(commentArg.body).toContain("update in place");
  });

  it("posts a comment with 'failed' status and stderr when plan errors out", async () => {
    execFile.mockImplementationOnce(fail("", "Error: invalid provider config", 1));
    githubOps.githubAddComment.mockResolvedValueOnce({ id: 3, html_url: "https://github.com/x/y/pull/3#comment" });

    const result = await terraformPlanComment({
      dir: "/infra",
      owner: "acme",
      repo: "infra",
      pull_number: 3,
      confirm: true,
    });

    expect(result.plan_exit_code).toBe(1);
    expect(result.had_error).toBe(true);
    const commentArg = githubOps.githubAddComment.mock.calls[0][0];
    expect(commentArg.body).toContain("❌ Plan failed");
    expect(commentArg.body).toContain("invalid provider config");
  });

  it("passes owner/repo/pull_number through to githubAddComment", async () => {
    execFile.mockImplementationOnce(ok("no changes", ""));
    githubOps.githubAddComment.mockResolvedValueOnce({ id: 4, html_url: "url" });
    await terraformPlanComment({ dir: "/infra", owner: "acme", repo: "infra", pull_number: 9, confirm: true });
    expect(githubOps.githubAddComment).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "acme", repo: "infra", issue_number: 9 })
    );
  });

  it("includes -detailed-exitcode and var-file in the underlying plan command", async () => {
    execFile.mockImplementationOnce(ok("no changes", ""));
    githubOps.githubAddComment.mockResolvedValueOnce({ id: 5, html_url: "url" });
    await terraformPlanComment({
      dir: "/infra",
      owner: "acme",
      repo: "infra",
      pull_number: 9,
      var_file: "prod.tfvars",
      confirm: true,
    });
    expect(execFile.mock.calls[0][1]).toEqual([
      "plan",
      "-no-color",
      "-input=false",
      "-detailed-exitcode",
      "-var-file=prod.tfvars",
    ]);
  });
});
