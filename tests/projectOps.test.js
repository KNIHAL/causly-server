import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";

const mockGit = { branch: vi.fn(), getRemotes: vi.fn(), status: vi.fn() };
vi.mock("simple-git", () => ({ simpleGit: vi.fn(() => mockGit) }));
vi.mock("../tools/commandOps.js", () => ({ runCommand: vi.fn() }));

const { runCommand } = await import("../tools/commandOps.js");
const {
  detectProject,
  projectDetect,
  runTests,
  runLint,
  runTypecheck,
  runBuild,
  projectInfo,
  projectHealth,
} = await import("../tools/projectOps.js");

let testDir;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), "causly-projectops-test-"));
  runCommand.mockReset();
  Object.values(mockGit).forEach((fn) => fn.mockReset());
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

async function writePkg(deps = {}, devDeps = {}, scripts = {}) {
  await fs.writeFile(
    path.join(testDir, "package.json"),
    JSON.stringify({ dependencies: deps, devDependencies: devDeps, scripts }),
    "utf8"
  );
}

describe("detectProject — Node.js ecosystem", () => {
  it("detects plain Node.js with npm when only package.json exists", async () => {
    await writePkg();
    const result = detectProject(testDir);
    expect(result).toEqual({
      language: "JavaScript/TypeScript",
      framework: "Node.js",
      package_manager: "npm",
      manifest: "package.json",
      scripts: {},
    });
  });

  it("detects Next.js from dependencies", async () => {
    await writePkg({ next: "^14.0.0" });
    expect(detectProject(testDir).framework).toBe("Next.js");
  });

  it("detects React from dependencies", async () => {
    await writePkg({ react: "^18.0.0" });
    expect(detectProject(testDir).framework).toBe("React");
  });

  it("detects Vue from dependencies", async () => {
    await writePkg({ vue: "^3.0.0" });
    expect(detectProject(testDir).framework).toBe("Vue");
  });

  it("detects Express from dependencies", async () => {
    await writePkg({ express: "^4.0.0" });
    expect(detectProject(testDir).framework).toBe("Express");
  });

  it("detects NestJS from dependencies", async () => {
    await writePkg({ "@nestjs/core": "^10.0.0" });
    expect(detectProject(testDir).framework).toBe("NestJS");
  });

  it("prioritizes Next.js over React when both are present", async () => {
    await writePkg({ next: "^14.0.0", react: "^18.0.0" });
    expect(detectProject(testDir).framework).toBe("Next.js");
  });

  it("detects pnpm via pnpm-lock.yaml", async () => {
    await writePkg();
    await fs.writeFile(path.join(testDir, "pnpm-lock.yaml"), "", "utf8");
    expect(detectProject(testDir).package_manager).toBe("pnpm");
  });

  it("detects yarn via yarn.lock", async () => {
    await writePkg();
    await fs.writeFile(path.join(testDir, "yarn.lock"), "", "utf8");
    expect(detectProject(testDir).package_manager).toBe("yarn");
  });

  it("detects bun via bun.lockb", async () => {
    await writePkg();
    await fs.writeFile(path.join(testDir, "bun.lockb"), "", "utf8");
    expect(detectProject(testDir).package_manager).toBe("bun");
  });

  it("captures scripts from package.json", async () => {
    await writePkg({}, {}, { test: "vitest run", build: "tsc" });
    expect(detectProject(testDir).scripts).toEqual({ test: "vitest run", build: "tsc" });
  });
});

describe("detectProject — Python ecosystem", () => {
  it("detects FastAPI via pyproject.toml", async () => {
    await fs.writeFile(path.join(testDir, "pyproject.toml"), "fastapi = '^0.100'", "utf8");
    const result = detectProject(testDir);
    expect(result).toEqual({ language: "Python", framework: "FastAPI", package_manager: "pip/poetry", manifest: "pyproject.toml", scripts: {} });
  });

  it("detects Django via pyproject.toml", async () => {
    await fs.writeFile(path.join(testDir, "pyproject.toml"), "django = '^5.0'", "utf8");
    expect(detectProject(testDir).framework).toBe("Django");
  });

  it("detects Flask via pyproject.toml", async () => {
    await fs.writeFile(path.join(testDir, "pyproject.toml"), "flask = '^3.0'", "utf8");
    expect(detectProject(testDir).framework).toBe("Flask");
  });

  it("defaults to plain Python when pyproject.toml has no known framework", async () => {
    await fs.writeFile(path.join(testDir, "pyproject.toml"), "[project]\nname='x'", "utf8");
    expect(detectProject(testDir).framework).toBe("Python");
  });

  it("detects Django via requirements.txt (case-insensitive)", async () => {
    await fs.writeFile(path.join(testDir, "requirements.txt"), "Django==5.0\n", "utf8");
    const result = detectProject(testDir);
    expect(result).toEqual({ language: "Python", framework: "Django", package_manager: "pip", manifest: "requirements.txt", scripts: {} });
  });

  it("prefers pyproject.toml over requirements.txt when both exist", async () => {
    await fs.writeFile(path.join(testDir, "pyproject.toml"), "flask = '^3.0'", "utf8");
    await fs.writeFile(path.join(testDir, "requirements.txt"), "django==5.0\n", "utf8");
    expect(detectProject(testDir).manifest).toBe("pyproject.toml");
  });
});

describe("detectProject — unknown", () => {
  it("returns unknown fields for an empty directory", () => {
    const result = detectProject(testDir);
    expect(result).toEqual({ language: "unknown", framework: "unknown", package_manager: "unknown", manifest: null, scripts: {} });
  });
});

describe("projectDetect (async wrapper)", () => {
  it("includes repo_path alongside detection results", async () => {
    await writePkg({ react: "^18" });
    const result = await projectDetect({ repo_path: testDir });
    expect(result.repo_path).toBe(testDir);
    expect(result.framework).toBe("React");
  });
});

describe("run{Tests,Lint,Typecheck,Build} — command resolution", () => {
  it("runTests uses `npm run test` when a test script exists", async () => {
    await writePkg({}, {}, { test: "vitest run" });
    runCommand.mockResolvedValueOnce({ stdout: "ok", stderr: "", exit_code: 0 });
    const result = await runTests({ repo_path: testDir });
    expect(runCommand).toHaveBeenCalledWith({ command: "npm run test", cwd: testDir, timeout_ms: undefined });
    expect(result).toEqual({ repo_path: testDir, action: "test", ran: true, command: "npm run test", stdout: "ok", stderr: "", exit_code: 0 });
  });

  it("runLint checks both 'lint' script name candidates in order", async () => {
    await writePkg({}, {}, { lint: "eslint ." });
    runCommand.mockResolvedValueOnce({ stdout: "", stderr: "", exit_code: 0 });
    await runLint({ repo_path: testDir });
    expect(runCommand).toHaveBeenCalledWith({ command: "npm run lint", cwd: testDir, timeout_ms: undefined });
  });

  it("runTypecheck falls back to 'type-check' script name when 'typecheck' is absent", async () => {
    await writePkg({}, {}, { "type-check": "tsc --noEmit" });
    runCommand.mockResolvedValueOnce({ stdout: "", stderr: "", exit_code: 0 });
    await runTypecheck({ repo_path: testDir });
    expect(runCommand).toHaveBeenCalledWith({ command: "npm run type-check", cwd: testDir, timeout_ms: undefined });
  });

  it("uses the detected package manager as the script runner (pnpm)", async () => {
    await writePkg({}, {}, { build: "vite build" });
    await fs.writeFile(path.join(testDir, "pnpm-lock.yaml"), "", "utf8");
    runCommand.mockResolvedValueOnce({ stdout: "", stderr: "", exit_code: 0 });
    await runBuild({ repo_path: testDir });
    expect(runCommand).toHaveBeenCalledWith({ command: "pnpm build", cwd: testDir, timeout_ms: undefined });
  });

  it("returns ran:false with a reason when no matching script/command can be found", async () => {
    await writePkg(); // no scripts at all
    const result = await runBuild({ repo_path: testDir });
    expect(result.ran).toBe(false);
    expect(result.reason).toMatch(/Could not detect a 'build' command/);
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("uses Python defaults (pytest) when the project is Python", async () => {
    await fs.writeFile(path.join(testDir, "pyproject.toml"), "fastapi='^0.1'", "utf8");
    runCommand.mockResolvedValueOnce({ stdout: "", stderr: "", exit_code: 0 });
    await runTests({ repo_path: testDir });
    expect(runCommand).toHaveBeenCalledWith({ command: "pytest", cwd: testDir, timeout_ms: undefined });
  });

  it("passes timeout_ms through to runCommand", async () => {
    await writePkg({}, {}, { test: "vitest run" });
    runCommand.mockResolvedValueOnce({ stdout: "", stderr: "", exit_code: 0 });
    await runTests({ repo_path: testDir, timeout_ms: 5000 });
    expect(runCommand).toHaveBeenCalledWith({ command: "npm run test", cwd: testDir, timeout_ms: 5000 });
  });
});

describe("projectInfo", () => {
  it("combines detection, resolved commands, and git info", async () => {
    await writePkg({}, {}, { test: "vitest run", build: "tsc" });
    mockGit.branch.mockResolvedValue({ current: "main" });
    mockGit.getRemotes.mockResolvedValue([{ name: "origin", refs: { fetch: "https://x.git" } }]);

    const result = await projectInfo({ repo_path: testDir });
    expect(result.test_command).toBe("npm run test");
    expect(result.build_command).toBe("npm run build"); // wait, script name is 'build'
    expect(result.lint_command).toBeNull();
    expect(result.git).toEqual({ current_branch: "main", remotes: [{ name: "origin", url: "https://x.git" }] });
  });

  it("reports a git error object when the repo is not a git repository", async () => {
    await writePkg();
    mockGit.branch.mockRejectedValue(new Error("not a git repo"));
    const result = await projectInfo({ repo_path: testDir });
    expect(result.git).toEqual({ error: "not a git repository or git not available" });
  });
});

describe("projectHealth", () => {
  it("reports dependencies_installed true when node_modules exists", async () => {
    await writePkg();
    await fs.mkdir(path.join(testDir, "node_modules"));
    mockGit.status.mockResolvedValue({ isClean: () => true, current: "main", ahead: 0, behind: 0 });
    const result = await projectHealth({ repo_path: testDir });
    expect(result.dependencies_installed).toBe(true);
    expect(result.git_status).toEqual({ is_clean: true, current_branch: "main", ahead: 0, behind: 0 });
  });

  it("reports dependencies_installed false when node_modules is missing", async () => {
    await writePkg();
    mockGit.status.mockResolvedValue({ isClean: () => false, current: "main", ahead: 1, behind: 0 });
    const result = await projectHealth({ repo_path: testDir });
    expect(result.dependencies_installed).toBe(false);
  });

  it("checks for .venv/venv for Python projects instead of node_modules", async () => {
    await fs.writeFile(path.join(testDir, "requirements.txt"), "flask\n", "utf8");
    await fs.mkdir(path.join(testDir, ".venv"));
    mockGit.status.mockResolvedValue({ isClean: () => true, current: "main", ahead: 0, behind: 0 });
    const result = await projectHealth({ repo_path: testDir });
    expect(result.dependencies_installed).toBe(true);
  });

  it("lists present env files", async () => {
    await writePkg();
    await fs.writeFile(path.join(testDir, ".env"), "", "utf8");
    await fs.writeFile(path.join(testDir, ".env.example"), "", "utf8");
    mockGit.status.mockResolvedValue({ isClean: () => true, current: "main", ahead: 0, behind: 0 });
    const result = await projectHealth({ repo_path: testDir });
    expect(result.env_files_present.sort()).toEqual([".env", ".env.example"]);
  });

  it("reports a git_status error object when not a git repo", async () => {
    await writePkg();
    mockGit.status.mockRejectedValue(new Error("not a repo"));
    const result = await projectHealth({ repo_path: testDir });
    expect(result.git_status).toEqual({ error: "not a git repository or git not available" });
  });
});
