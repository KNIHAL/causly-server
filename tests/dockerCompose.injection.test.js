import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// P0-04: the WSL fallback for `docker compose` must never put the project directory into shell text.
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
const { dockerComposeUp, dockerComposeDown } = await import("../tools/dockerOps.js");

const originalPlatform = process.platform;
const setPlatform = (p) => Object.defineProperty(process, "platform", { value: p });
const notFound = () => {
  const err = new Error("'docker' is not recognized as an internal or external command");
  err.code = 1;
  err.stdout = "";
  err.stderr = "";
  return err;
};

const HOSTILE = ["a'b", 'a"b', "a;b", "a$(touch x)b", "a`touch x`b", "a b", "a&b", "a|b", "a'; touch pwned; '", "a\nb", "%PATH%", "ünï 🙂"];

beforeEach(() => {
  execFile.mockReset();
  setPlatform("win32");
});
afterEach(() => setPlatform(originalPlatform));

function failTwiceThen(result) {
  execFile.mockImplementationOnce((c, a, o, cb) => cb(notFound())); // docker
  execFile.mockImplementationOnce((c, a, o, cb) => cb(notFound())); // wsl docker
  execFile.mockImplementationOnce((c, a, o, cb) => cb(null, result, "")); // compose fallback
}

describe("docker compose via WSL keeps the directory out of shell text", () => {
  for (const name of HOSTILE) {
    const dir = `D:\\proj\\${name}`;
    const wslDir = `/mnt/d/proj/${name}`;

    it(`up: ${JSON.stringify(name)}`, async () => {
      failTwiceThen("ok");
      const result = await dockerComposeUp({ project_dir: dir });
      expect(result.exit_code).toBe(0);
      const [file, args] = execFile.mock.calls[2];
      expect(file).toBe("wsl");
      expect(args).toEqual(["--cd", wslDir, "--", "docker", "compose", "up", "-d"]);
    });

    it(`down: ${JSON.stringify(name)}`, async () => {
      failTwiceThen("ok");
      const result = await dockerComposeDown({ project_dir: dir });
      expect(result.exit_code).toBe(0);
      const [file, args] = execFile.mock.calls[2];
      expect(file).toBe("wsl");
      expect(args).toEqual(["--cd", wslDir, "--", "docker", "compose", "down"]);
    });
  }

  it("never uses bash -lc", async () => {
    failTwiceThen("ok");
    await dockerComposeUp({ project_dir: "D:\\proj\\x", detach: false });
    const args = execFile.mock.calls[2][1];
    expect(args).not.toContain("bash");
    expect(args).not.toContain("-lc");
    expect(args).toEqual(["--cd", "/mnt/d/proj/x", "--", "docker", "compose", "up"]);
  });
});
