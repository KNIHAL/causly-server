const { execFile } = await import("child_process");
const { promisify } = await import("util");
const execFileAsync = promisify(execFile);

/** Converts a Windows path (D:\foo\bar) to its WSL equivalent (/mnt/d/foo/bar). Leaves non-Windows-style paths untouched. */
function toWslPath(p) {
  if (typeof p !== "string" || !/^[a-zA-Z]:\\/.test(p)) return p;
  const drive = p[0].toLowerCase();
  const rest = p.slice(2).replace(/\\/g, "/");
  return `/mnt/${drive}${rest}`;
}

/** Applies toWslPath to a "HOST:CONTAINER" volume string's host side only. */
function toWslVolume(v) {
  if (typeof v !== "string") return v;
  const idx = v.indexOf(":", 2); // skip past "D:" drive-letter colon
  if (v.length > 1 && v[1] === ":" ) {
    const rest = v.slice(2);
    const sep = rest.indexOf(":");
    if (sep === -1) return v;
    const hostPart = v.slice(0, 2) + rest.slice(0, sep);
    const containerPart = rest.slice(sep);
    return toWslPath(hostPart) + containerPart;
  }
  return v;
}

/**
 * Cross-platform Docker runner. Tries `docker` directly first — this covers
 * macOS, Linux, and Windows with Docker Desktop (which puts docker.exe on PATH).
 * If that fails with a "command not found" style error AND we're on Windows,
 * falls back to `wsl docker ...` — this covers Windows setups where Docker
 * only exists inside WSL (no Docker Desktop installed). When falling back,
 * pass `wslArgs`/`wslCwd` (WSL-path versions) if the direct args contain
 * Windows-style paths that WSL's docker can't resolve.
 */
async function runDocker(args, { timeout_ms = 60000, cwd, wslArgs, wslCwd } = {}) {
  const attempt = async (cmd, cmdArgs, cmdCwd) => {
    try {
      const { stdout, stderr } = await execFileAsync(cmd, cmdArgs, {
        cwd: cmdCwd,
        timeout: timeout_ms,
        maxBuffer: 1024 * 1024 * 20,
      });
      return { stdout, stderr, exit_code: 0 };
    } catch (err) {
      return {
        stdout: err.stdout || "",
        stderr: err.stderr || err.message,
        exit_code: err.code ?? 1,
        notFound: err.code === "ENOENT" || /is not recognized|command not found/i.test(err.message || ""),
      };
    }
  };

  const direct = await attempt("docker", args, cwd);
  if (direct.exit_code === 0 || !direct.notFound) return direct;

  if (process.platform === "win32") {
    return attempt("wsl", ["docker", ...(wslArgs || args)], wslCwd || cwd);
  }
  return direct;
}

/** Get Docker client/server version info — connectivity check. */
export async function dockerVersion() {
  return runDocker(["version"]);
}

/** List containers. Set all=true to include stopped ones (defaults to running only). */
export async function dockerPs({ all = false }) {
  const args = ["ps", "--format", "{{json .}}"];
  if (all) args.push("-a");
  const result = await runDocker(args);
  if (result.exit_code !== 0) return result;
  const containers = result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { containers };
}

/** List images. */
export async function dockerImages() {
  const result = await runDocker(["images", "--format", "{{json .}}"]);
  if (result.exit_code !== 0) return result;
  const images = result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { images };
}

/** Build an image from a Dockerfile. HIGH risk — requires confirm: true. */
export async function dockerBuild({ context_dir, tag, dockerfile, build_args, confirm }) {
  const buildArgsFlags = [];
  if (build_args) {
    for (const [k, v] of Object.entries(build_args)) {
      buildArgsFlags.push("--build-arg", `${k}=${v}`);
    }
  }

  const args = ["build", "-t", tag, ...(dockerfile ? ["-f", dockerfile] : []), ...buildArgsFlags, context_dir];
  const wslArgs = [
    "build",
    "-t",
    tag,
    ...(dockerfile ? ["-f", toWslPath(dockerfile)] : []),
    ...buildArgsFlags,
    toWslPath(context_dir),
  ];

  return runDocker(args, { timeout_ms: 600000, wslArgs });
}

/** Run a new container from an image. HIGH risk — requires confirm: true. */
export async function dockerRun({ image, name, ports, env, volumes, detach = true, command, confirm }) {
  const base = [];
  if (detach) base.push("-d");
  if (name) base.push("--name", name);
  if (ports) for (const p of ports) base.push("-p", p);
  if (env) for (const [k, v] of Object.entries(env)) base.push("-e", `${k}=${v}`);

  const args = ["run", ...base];
  const wslArgs = ["run", ...base];
  if (volumes) {
    for (const v of volumes) {
      args.push("-v", v);
      wslArgs.push("-v", toWslVolume(v));
    }
  }
  args.push(image);
  wslArgs.push(image);
  if (command) {
    const cmdParts = command.split(" ");
    args.push(...cmdParts);
    wslArgs.push(...cmdParts);
  }

  return runDocker(args, { timeout_ms: 120000, wslArgs });
}

/** Stop a running container. HIGH risk — requires confirm: true. */
export async function dockerStop({ container, confirm }) {
  return runDocker(["stop", container]);
}

/** Start a stopped container. */
export async function dockerStart({ container }) {
  return runDocker(["start", container]);
}

/** Restart a container. HIGH risk — requires confirm: true. */
export async function dockerRestart({ container, confirm }) {
  return runDocker(["restart", container]);
}

/** Remove a container. DESTRUCTIVE — requires confirm: true. */
export async function dockerRemove({ container, force = false, confirm }) {
  const args = ["rm"];
  if (force) args.push("-f");
  args.push(container);
  return runDocker(args);
}

/** Remove an image. DESTRUCTIVE — requires confirm: true. */
export async function dockerRemoveImage({ image, force = false, confirm }) {
  const args = ["rmi"];
  if (force) args.push("-f");
  args.push(image);
  return runDocker(args);
}

/** Get logs from a container. */
export async function dockerLogs({ container, tail = 100, since }) {
  const args = ["logs", "--tail", String(tail)];
  if (since) args.push("--since", since);
  args.push(container);
  return runDocker(args);
}

/** Inspect a container or image — full JSON metadata. */
export async function dockerInspect({ target }) {
  const result = await runDocker(["inspect", target]);
  if (result.exit_code !== 0) return result;
  try {
    return { data: JSON.parse(result.stdout) };
  } catch {
    return result;
  }
}

/** Execute a command inside a running container. */
export async function dockerExec({ container, command }) {
  const args = ["exec", container, ...command.split(" ")];
  return runDocker(args);
}

/** Show live resource usage stats (CPU, memory) for running containers — one-shot snapshot, not streaming. */
export async function dockerStats() {
  const result = await runDocker(["stats", "--no-stream", "--format", "{{json .}}"]);
  if (result.exit_code !== 0) return result;
  const stats = result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { stats };
}

/** Push an image to a registry. HIGH risk — requires confirm: true. */
export async function dockerPush({ image, confirm }) {
  return runDocker(["push", image], { timeout_ms: 300000 });
}

/** Pull an image from a registry. */
export async function dockerPull({ image }) {
  return runDocker(["pull", image], { timeout_ms: 300000 });
}

/** Run docker compose up for a project directory. HIGH risk — requires confirm: true. */
export async function dockerComposeUp({ project_dir, detach = true, confirm }) {
  const args = ["compose", "up"];
  if (detach) args.push("-d");
  const direct = await runDocker(args, { cwd: project_dir, timeout_ms: 300000 });
  if (direct.exit_code === 0 || !direct.notFound || process.platform !== "win32") return direct;

  const wslDir = toWslPath(project_dir);
  const composeCmd = `cd '${wslDir}' && docker compose up${detach ? " -d" : ""}`;
  try {
    const { stdout, stderr } = await execFileAsync("wsl", ["bash", "-lc", composeCmd], {
      timeout: 300000,
      maxBuffer: 1024 * 1024 * 20,
    });
    return { stdout, stderr, exit_code: 0 };
  } catch (err) {
    return { stdout: err.stdout || "", stderr: err.stderr || err.message, exit_code: err.code ?? 1 };
  }
}

/** Run docker compose down for a project directory. HIGH risk — requires confirm: true. */
export async function dockerComposeDown({ project_dir, confirm }) {
  const direct = await runDocker(["compose", "down"], { cwd: project_dir, timeout_ms: 120000 });
  if (direct.exit_code === 0 || !direct.notFound || process.platform !== "win32") return direct;

  const wslDir = toWslPath(project_dir);
  const composeCmd = `cd '${wslDir}' && docker compose down`;
  try {
    const { stdout, stderr } = await execFileAsync("wsl", ["bash", "-lc", composeCmd], {
      timeout: 120000,
      maxBuffer: 1024 * 1024 * 20,
    });
    return { stdout, stderr, exit_code: 0 };
  } catch (err) {
    return { stdout: err.stdout || "", stderr: err.stderr || err.message, exit_code: err.code ?? 1 };
  }
}
