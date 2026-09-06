import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// util.promisify special-cases child_process.execFile via its promisify.custom
// symbol to resolve {stdout, stderr}. A plain vi.fn() mock lacks that symbol,
// so promisify(execFile) would fall back to resolving only the first callback
// arg. Attach the same custom symbol here so dockerOps.js's promisified calls
// behave exactly like the real execFile.
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

const { execFile } = await import("child_process");
const {
  dockerVersion,
  dockerPs,
  dockerImages,
  dockerBuild,
  dockerRun,
  dockerStop,
  dockerStart,
  dockerRestart,
  dockerRemove,
  dockerRemoveImage,
  dockerLogs,
  dockerInspect,
  dockerExec,
  dockerStats,
  dockerPull,
  dockerComposeUp,
  dockerComposeDown,
} = await import("../tools/dockerOps.js");

function ok(stdout = "", stderr = "") {
  return (cmd, args, options, callback) => callback(null, stdout, stderr);
}
function notFoundErr() {
  const err = new Error("'docker' is not recognized as an internal or external command");
  err.code = 1;
  err.stdout = "";
  err.stderr = "";
  return err;
}
function fail(stdout = "", stderr = "boom", code = 1) {
  const err = new Error(stderr);
  err.code = code;
  err.stdout = stdout;
  err.stderr = stderr;
  return err;
}

const originalPlatform = process.platform;
function setPlatform(p) {
  Object.defineProperty(process, "platform", { value: p });
}

beforeEach(() => {
  execFile.mockReset();
  setPlatform(originalPlatform);
});

afterEach(() => {
  setPlatform(originalPlatform);
});

describe("dockerOps — direct success path", () => {
  it("dockerVersion runs `docker version`", async () => {
    execFile.mockImplementationOnce(ok("Docker version 24.0", ""));
    const result = await dockerVersion();
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("Docker version");
    expect(execFile.mock.calls[0][0]).toBe("docker");
    expect(execFile.mock.calls[0][1]).toEqual(["version"]);
  });

  it("dockerPs parses JSON lines and respects all=true", async () => {
    execFile.mockImplementationOnce(ok('{"ID":"abc","Names":"web"}\n{"ID":"def","Names":"db"}\n', ""));
    const result = await dockerPs({ all: true });
    expect(result.containers).toHaveLength(2);
    expect(result.containers[0].Names).toBe("web");
    expect(execFile.mock.calls[0][1]).toContain("-a");
  });

  it("dockerPs without all omits -a flag", async () => {
    execFile.mockImplementationOnce(ok("", ""));
    await dockerPs({});
    expect(execFile.mock.calls[0][1]).not.toContain("-a");
  });

  it("dockerImages parses JSON lines", async () => {
    execFile.mockImplementationOnce(ok('{"Repository":"node","Tag":"20"}\n', ""));
    const result = await dockerImages();
    expect(result.images).toEqual([{ Repository: "node", Tag: "20" }]);
  });

  it("dockerLogs builds tail and since flags", async () => {
    execFile.mockImplementationOnce(ok("log line", ""));
    await dockerLogs({ container: "web", tail: 50, since: "10m" });
    const args = execFile.mock.calls[0][1];
    expect(args).toEqual(["logs", "--tail", "50", "--since", "10m", "web"]);
  });

  it("dockerInspect parses JSON output", async () => {
    execFile.mockImplementationOnce(ok('[{"Id":"abc"}]', ""));
    const result = await dockerInspect({ target: "web" });
    expect(result.data).toEqual([{ Id: "abc" }]);
  });

  it("dockerInspect falls back to raw result on invalid JSON", async () => {
    execFile.mockImplementationOnce(ok("not json", ""));
    const result = await dockerInspect({ target: "web" });
    expect(result.stdout).toBe("not json");
  });

  it("dockerExec splits the command string into args", async () => {
    execFile.mockImplementationOnce(ok("output", ""));
    await dockerExec({ container: "web", command: "ls -la /app" });
    expect(execFile.mock.calls[0][1]).toEqual(["exec", "web", "ls", "-la", "/app"]);
  });

  it("dockerStats parses JSON lines", async () => {
    execFile.mockImplementationOnce(ok('{"Name":"web","CPUPerc":"1.2%"}\n', ""));
    const result = await dockerStats();
    expect(result.stats).toEqual([{ Name: "web", CPUPerc: "1.2%" }]);
  });

  it("dockerStop/Start/Restart/Remove/RemoveImage/Pull build correct args", async () => {
    execFile.mockImplementation(ok("", ""));
    await dockerStop({ container: "web" });
    expect(execFile.mock.calls[0][1]).toEqual(["stop", "web"]);

    await dockerStart({ container: "web" });
    expect(execFile.mock.calls[1][1]).toEqual(["start", "web"]);

    await dockerRestart({ container: "web" });
    expect(execFile.mock.calls[2][1]).toEqual(["restart", "web"]);

    await dockerRemove({ container: "web", force: true });
    expect(execFile.mock.calls[3][1]).toEqual(["rm", "-f", "web"]);

    await dockerRemoveImage({ image: "node:20", force: true });
    expect(execFile.mock.calls[4][1]).toEqual(["rmi", "-f", "node:20"]);

    await dockerPull({ image: "node:20" });
    expect(execFile.mock.calls[5][1]).toEqual(["pull", "node:20"]);
  });

  it("dockerBuild includes tag, dockerfile, and build-arg flags", async () => {
    execFile.mockImplementationOnce(ok("built", ""));
    await dockerBuild({
      context_dir: "/app",
      tag: "myimg:1",
      dockerfile: "Dockerfile.prod",
      build_args: { NODE_ENV: "production" },
    });
    const args = execFile.mock.calls[0][1];
    expect(args).toEqual([
      "build",
      "-t",
      "myimg:1",
      "-f",
      "Dockerfile.prod",
      "--build-arg",
      "NODE_ENV=production",
      "/app",
    ]);
  });

  it("dockerRun builds name/ports/env/volumes/command flags", async () => {
    execFile.mockImplementationOnce(ok("container-id", ""));
    await dockerRun({
      image: "postgres:16",
      name: "pg",
      ports: ["5432:5432"],
      env: { POSTGRES_PASSWORD: "pw" },
      volumes: ["/data:/var/lib/postgresql/data"],
      command: "postgres -c log_statement=all",
    });
    const args = execFile.mock.calls[0][1];
    expect(args).toEqual([
      "run",
      "-d",
      "--name",
      "pg",
      "-p",
      "5432:5432",
      "-e",
      "POSTGRES_PASSWORD=pw",
      "-v",
      "/data:/var/lib/postgresql/data",
      "postgres:16",
      "postgres",
      "-c",
      "log_statement=all",
    ]);
  });
});

describe("dockerOps — WSL fallback on Windows", () => {
  it("falls back to `wsl docker` when direct docker is not recognized", async () => {
    setPlatform("win32");
    execFile.mockImplementationOnce((cmd, args, opts, cb) => cb(notFoundErr()));
    execFile.mockImplementationOnce(ok("wsl docker output", ""));

    const result = await dockerVersion();
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toBe("wsl docker output");
    expect(execFile.mock.calls[0][0]).toBe("docker");
    expect(execFile.mock.calls[1][0]).toBe("wsl");
    expect(execFile.mock.calls[1][1]).toEqual(["docker", "version"]);
  });

  it("does not fall back on non-Windows platforms", async () => {
    setPlatform("linux");
    execFile.mockImplementationOnce((cmd, args, opts, cb) => cb(notFoundErr()));

    const result = await dockerVersion();
    expect(result.exit_code).not.toBe(0);
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it("does not fall back when the error is not a 'not found' style error", async () => {
    setPlatform("win32");
    execFile.mockImplementationOnce((cmd, args, opts, cb) => cb(fail("", "no such container", 1)));

    const result = await dockerStop({ container: "ghost" });
    expect(result.exit_code).toBe(1);
    expect(result.stderr).toContain("no such container");
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it("dockerBuild WSL fallback translates Windows paths for context_dir and dockerfile", async () => {
    setPlatform("win32");
    execFile.mockImplementationOnce((cmd, args, opts, cb) => cb(notFoundErr()));
    execFile.mockImplementationOnce(ok("built via wsl", ""));

    await dockerBuild({
      context_dir: "D:\\projects\\myapp",
      tag: "myimg:1",
      dockerfile: "D:\\projects\\myapp\\Dockerfile",
    });

    const wslArgs = execFile.mock.calls[1][1];
    expect(execFile.mock.calls[1][0]).toBe("wsl");
    expect(wslArgs).toContain("/mnt/d/projects/myapp");
    expect(wslArgs).toContain("/mnt/d/projects/myapp/Dockerfile");
  });

  it("dockerRun WSL fallback translates the host side of volume mounts only", async () => {
    setPlatform("win32");
    execFile.mockImplementationOnce((cmd, args, opts, cb) => cb(notFoundErr()));
    execFile.mockImplementationOnce(ok("started via wsl", ""));

    await dockerRun({
      image: "node:20",
      volumes: ["D:\\projects\\myapp:/app"],
    });

    const wslArgs = execFile.mock.calls[1][1];
    const volIndex = wslArgs.indexOf("-v");
    expect(wslArgs[volIndex + 1]).toBe("/mnt/d/projects/myapp:/app");
  });

  it("dockerComposeUp falls back to `wsl bash -lc` when even `wsl docker` fails", async () => {
    setPlatform("win32");
    execFile.mockImplementationOnce((cmd, args, opts, cb) => cb(notFoundErr())); // direct `docker`
    execFile.mockImplementationOnce((cmd, args, opts, cb) => cb(notFoundErr())); // runDocker's own `wsl docker` retry
    execFile.mockImplementationOnce(ok("compose up via wsl bash", "")); // compose's own `wsl bash -lc`

    const result = await dockerComposeUp({ project_dir: "D:\\projects\\myapp" });
    expect(result.exit_code).toBe(0);
    expect(execFile.mock.calls[2][0]).toBe("wsl");
    expect(execFile.mock.calls[2][1][0]).toBe("bash");
    expect(execFile.mock.calls[2][1][1]).toBe("-lc");
    expect(execFile.mock.calls[2][1][2]).toContain("/mnt/d/projects/myapp");
    expect(execFile.mock.calls[2][1][2]).toContain("docker compose up -d");
  });

  it("dockerComposeDown falls back to `wsl bash -lc` when even `wsl docker` fails", async () => {
    setPlatform("win32");
    execFile.mockImplementationOnce((cmd, args, opts, cb) => cb(notFoundErr()));
    execFile.mockImplementationOnce((cmd, args, opts, cb) => cb(notFoundErr()));
    execFile.mockImplementationOnce(ok("compose down via wsl bash", ""));

    const result = await dockerComposeDown({ project_dir: "D:\\projects\\myapp" });
    expect(result.exit_code).toBe(0);
    expect(execFile.mock.calls[2][1][2]).toContain("docker compose down");
  });

  it("dockerComposeUp resolves via runDocker's own `wsl docker` retry without needing bash -lc", async () => {
    setPlatform("win32");
    execFile.mockImplementationOnce((cmd, args, opts, cb) => cb(notFoundErr())); // direct `docker` fails
    execFile.mockImplementationOnce(ok("compose up via wsl docker", "")); // `wsl docker compose up -d` succeeds

    const result = await dockerComposeUp({ project_dir: "D:\\projects\\myapp" });
    expect(result.exit_code).toBe(0);
    expect(execFile).toHaveBeenCalledTimes(2);
    expect(execFile.mock.calls[1][0]).toBe("wsl");
    expect(execFile.mock.calls[1][1]).toEqual(["docker", "compose", "up", "-d"]);
  });
});
