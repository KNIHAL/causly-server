import fs from "fs";
import path from "path";
import { simpleGit } from "simple-git";
import { runCommand } from "./commandOps.js";

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Inspect a directory and identify the project type: language, framework,
 * and package manager. Used by other project_* / run_* tools to decide
 * which commands to run.
 */
export function detectProject(repo_path) {
  const pkgPath = path.join(repo_path, "package.json");
  if (exists(pkgPath)) {
    const pkg = readJson(pkgPath) || {};
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    let framework = "Node.js";
    if (deps.next) framework = "Next.js";
    else if (deps.react) framework = "React";
    else if (deps.vue) framework = "Vue";
    else if (deps.express) framework = "Express";
    else if (deps["@nestjs/core"]) framework = "NestJS";

    let package_manager = "npm";
    if (exists(path.join(repo_path, "pnpm-lock.yaml"))) package_manager = "pnpm";
    else if (exists(path.join(repo_path, "yarn.lock"))) package_manager = "yarn";
    else if (exists(path.join(repo_path, "bun.lockb"))) package_manager = "bun";

    return { language: "JavaScript/TypeScript", framework, package_manager, manifest: "package.json", scripts: pkg.scripts || {} };
  }

  if (exists(path.join(repo_path, "pyproject.toml"))) {
    const content = fs.readFileSync(path.join(repo_path, "pyproject.toml"), "utf8");
    let framework = "Python";
    if (content.includes("fastapi")) framework = "FastAPI";
    else if (content.includes("django")) framework = "Django";
    else if (content.includes("flask")) framework = "Flask";
    return { language: "Python", framework, package_manager: "pip/poetry", manifest: "pyproject.toml", scripts: {} };
  }

  if (exists(path.join(repo_path, "requirements.txt"))) {
    const content = fs.readFileSync(path.join(repo_path, "requirements.txt"), "utf8").toLowerCase();
    let framework = "Python";
    if (content.includes("django")) framework = "Django";
    else if (content.includes("fastapi")) framework = "FastAPI";
    else if (content.includes("flask")) framework = "Flask";
    return { language: "Python", framework, package_manager: "pip", manifest: "requirements.txt", scripts: {} };
  }

  return { language: "unknown", framework: "unknown", package_manager: "unknown", manifest: null, scripts: {} };
}

export async function projectDetect({ repo_path }) {
  return { repo_path, ...detectProject(repo_path) };
}

/** Resolve the concrete command to run for a semantic action (test/lint/typecheck/build). */
function resolveCommand(repo_path, action) {
  const info = detectProject(repo_path);

  if (info.manifest === "package.json") {
    const scriptMap = {
      test: ["test"],
      lint: ["lint"],
      typecheck: ["typecheck", "type-check"],
      build: ["build"],
    };
    const candidates = scriptMap[action] || [];
    const found = candidates.find((name) => info.scripts[name]);
    if (found) {
      const runner = info.package_manager === "npm" ? "npm run" : info.package_manager;
      return `${runner} ${found}`;
    }
    return null;
  }

  if (info.language === "Python") {
    const pyDefaults = {
      test: "pytest",
      lint: "ruff check .",
      typecheck: "mypy .",
      build: "python -m build",
    };
    return pyDefaults[action] || null;
  }

  return null;
}

async function runSemantic({ repo_path, action, timeout_ms }) {
  const command = resolveCommand(repo_path, action);
  if (!command) {
    return {
      repo_path,
      action,
      ran: false,
      reason: `Could not detect a '${action}' command for this project. Add a matching script to package.json (or the relevant config) and retry.`,
    };
  }
  const result = await runCommand({ command, cwd: repo_path, timeout_ms });
  return { repo_path, action, ran: true, command, ...result };
}

export async function runTests({ repo_path, timeout_ms }) {
  return runSemantic({ repo_path, action: "test", timeout_ms });
}

export async function runLint({ repo_path, timeout_ms }) {
  return runSemantic({ repo_path, action: "lint", timeout_ms });
}

export async function runTypecheck({ repo_path, timeout_ms }) {
  return runSemantic({ repo_path, action: "typecheck", timeout_ms });
}

export async function runBuild({ repo_path, timeout_ms }) {
  return runSemantic({ repo_path, action: "build", timeout_ms });
}

/** Structured project info: detection + git branch/remote + resolved commands. */
export async function projectInfo({ repo_path }) {
  const detection = detectProject(repo_path);
  let git = null;
  try {
    const g = simpleGit({ baseDir: repo_path });
    const branchSummary = await g.branch();
    const remotes = await g.getRemotes(true);
    git = { current_branch: branchSummary.current, remotes: remotes.map((r) => ({ name: r.name, url: r.refs?.fetch })) };
  } catch {
    git = { error: "not a git repository or git not available" };
  }

  return {
    repo_path,
    ...detection,
    test_command: resolveCommand(repo_path, "test"),
    lint_command: resolveCommand(repo_path, "lint"),
    typecheck_command: resolveCommand(repo_path, "typecheck"),
    build_command: resolveCommand(repo_path, "build"),
    git,
  };
}

/** High-level health snapshot: git cleanliness, dependency install status, config presence. */
export async function projectHealth({ repo_path }) {
  const detection = detectProject(repo_path);

  let git_status = null;
  try {
    const g = simpleGit({ baseDir: repo_path });
    const status = await g.status();
    git_status = { is_clean: status.isClean(), current_branch: status.current, ahead: status.ahead, behind: status.behind };
  } catch {
    git_status = { error: "not a git repository or git not available" };
  }

  let dependencies_installed = null;
  if (detection.manifest === "package.json") {
    dependencies_installed = exists(path.join(repo_path, "node_modules"));
  } else if (detection.language === "Python") {
    dependencies_installed = exists(path.join(repo_path, ".venv")) || exists(path.join(repo_path, "venv"));
  }

  const env_files = ["env", "example"]
    .map((suffix) => `.env${suffix === "example" ? ".example" : ""}`)
    .filter((f) => exists(path.join(repo_path, f)));

  return {
    repo_path,
    language: detection.language,
    framework: detection.framework,
    package_manager: detection.package_manager,
    dependencies_installed,
    env_files_present: env_files,
    git_status,
  };
}
