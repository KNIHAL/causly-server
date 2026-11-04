import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P1-03: names are positional docker arguments. One that starts with "-" would be read as an option
// (`--volume=/:/host`, `--privileged`, `--user=root`) and get around the workspace check of the volumes.
// Also: the Compose model that the workspace check reads (docker compose config).
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
        } else resolve({ stdout, stderr });
      });
    });
  return { execFile };
});

const { execFile } = await import("child_process");
const ops = await import("../tools/dockerOps.js");

const originalPlatform = process.platform;
const setPlatform = (p) => Object.defineProperty(process, "platform", { value: p });
const notFound = () => Object.assign(new Error("'docker' is not recognized as an internal or external command"), { code: 1, stdout: "", stderr: "" });

beforeEach(() => {
  execFile.mockReset();
  execFile.mockImplementation((c, a, o, cb) => cb(null, "{}", ""));
});
afterEach(() => setPlatform(originalPlatform));

describe("names cannot be options", () => {
  const BAD = ["--volume=/:/host", "-v", "--privileged", "--user=root", ""];
  const calls = [
    ["dockerBuild context_dir", (v) => ops.dockerBuild({ context_dir: v, tag: "t:1" })],
    ["dockerRun image", (v) => ops.dockerRun({ image: v, command: "sh" })],
    ["dockerStop container", (v) => ops.dockerStop({ container: v })],
    ["dockerStart container", (v) => ops.dockerStart({ container: v })],
    ["dockerRestart container", (v) => ops.dockerRestart({ container: v })],
    ["dockerRemove container", (v) => ops.dockerRemove({ container: v })],
    ["dockerRemoveImage image", (v) => ops.dockerRemoveImage({ image: v })],
    ["dockerLogs container", (v) => ops.dockerLogs({ container: v })],
    ["dockerInspect target", (v) => ops.dockerInspect({ target: v })],
    ["dockerExec container", (v) => ops.dockerExec({ container: v, command: "ls" })],
    ["dockerPush image", (v) => ops.dockerPush({ image: v })],
    ["dockerPull image", (v) => ops.dockerPull({ image: v })],
  ];

  for (const [label, call] of calls) {
    it(`${label}: refuses an option-like value and runs nothing`, async () => {
      for (const bad of BAD) await expect(call(bad)).rejects.toThrow(/must be a name or a path, not an option/);
      expect(execFile).not.toHaveBeenCalled();
    });
  }

  it("the smuggled --volume case from the review: an image of --volume=/:/host plus a command", async () => {
    await expect(ops.dockerRun({ image: "--volume=/:/host", command: "alpine cat /host/etc/shadow" })).rejects.toThrow(/not an option/);
    expect(execFile).not.toHaveBeenCalled();
  });

  it("ordinary names still reach docker unchanged", async () => {
    await ops.dockerRun({ image: "nginx:1.27", name: "web", volumes: ["pgdata:/d"] });
    expect(execFile.mock.calls[0][0]).toBe("docker");
    expect(execFile.mock.calls[0][1]).toEqual(["run", "-d", "--name", "web", "-v", "pgdata:/d", "nginx:1.27"]);
    execFile.mockClear();
    await ops.dockerStop({ container: "web" });
    expect(execFile.mock.calls[0][1]).toEqual(["stop", "web"]);
  });
});

describe("dockerComposeConfig", () => {
  const model = { name: "p", services: { web: { image: "alpine" } } };

  it("runs docker compose config in the project folder and returns the parsed model", async () => {
    execFile.mockImplementation((c, a, o, cb) => cb(null, JSON.stringify(model), ""));
    expect(await ops.dockerComposeConfig({ project_dir: "/work/app" })).toEqual(model);
    const [cmd, args, options] = execFile.mock.calls[0];
    expect(cmd).toBe("docker");
    expect(args).toEqual(["compose", "config", "--format", "json"]);
    expect(options.cwd).toBe("/work/app");
  });

  it("throws docker's own message when the Compose file is invalid", async () => {
    execFile.mockImplementation((c, a, o, cb) => cb(Object.assign(new Error("exit 1"), { code: 1, stdout: "", stderr: "services.web.volumes must be a list" })));
    await expect(ops.dockerComposeConfig({ project_dir: "/work/app" })).rejects.toThrow("services.web.volumes must be a list");
  });

  it("throws a plain message when the output is not JSON (old Compose)", async () => {
    execFile.mockImplementation((c, a, o, cb) => cb(null, "services:\n  web: {}\n", ""));
    await expect(ops.dockerComposeConfig({ project_dir: "/work/app" })).rejects.toThrow(/did not return JSON/);
  });

  it("on Windows without Docker Desktop, asks WSL with the folder as its own argument", async () => {
    setPlatform("win32");
    execFile.mockImplementationOnce((c, a, o, cb) => cb(notFound())); // docker
    execFile.mockImplementationOnce((c, a, o, cb) => cb(notFound())); // wsl docker
    execFile.mockImplementationOnce((c, a, o, cb) => cb(null, JSON.stringify(model), "")); // wsl --cd
    expect(await ops.dockerComposeConfig({ project_dir: "D:\\my 'app'; x" })).toEqual(model);
    const [cmd, args] = execFile.mock.calls[2];
    expect(cmd).toBe("wsl");
    expect(args).toEqual(["--cd", "/mnt/d/my 'app'; x", "--", "docker", "compose", "config", "--format", "json"]);
  });

  it("does not fall back to WSL when docker ran and failed", async () => {
    setPlatform("win32");
    execFile.mockImplementation((c, a, o, cb) => cb(Object.assign(new Error("exit 1"), { code: 1, stdout: "", stderr: "bad file" })));
    await expect(ops.dockerComposeConfig({ project_dir: "D:\\app" })).rejects.toThrow("bad file");
    expect(execFile).toHaveBeenCalledTimes(1);
  });
});
