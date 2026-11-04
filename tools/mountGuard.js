// Workspace limit for Docker mounts and Compose files (P1-03).
//
// checkWorkspace() (workspace.js) looks at path arguments. A Docker volume is a string such as
// "/etc:/host:ro" and a Compose file is a document, so neither shows up as a path argument. With
// CAUSLY_WORKSPACE on, this module also checks:
//   - docker_run `volumes`: every host folder must be inside the workspace
//   - docker_compose_up: the Compose project as Docker itself resolves it (`docker compose config`):
//     bind mounts, volumes backed by a host folder, build contexts, and secret and config files
//
// Named volumes and anonymous volumes have no host folder and always pass. Shell command text is
// still not inspected (see Security > What is not protected).
import os from "os";
import path from "path";
import { checkWorkspace, isInsideRoot, workspaceRoots } from "./workspace.js";
import { redactSecretsInString } from "./security.js";

const NAMED_VOLUME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/;
const HAS_VARIABLE = /\$[{A-Za-z_(]|%[^%\s]+%/;
// Windows drive as Docker and WSL spell it: /c/x, /mnt/c/x, /host_mnt/c/x, /run/desktop/mnt/host/c/x
const WINDOWS_DRIVE_MOUNT = /^\/(?!\/)(?:run\/desktop\/mnt\/host\/|host_mnt\/|mnt\/)?([a-zA-Z])(?:\/(.*))?$/;
const REMOTE_CONTEXT = /^[a-z][a-z0-9+.-]*:\/\/|^git@|^github\.com\//i;

/** The source of a `-v` / Compose short-syntax volume ("SOURCE:TARGET[:OPTIONS]"), or null when it has none (anonymous volume). */
export function volumeSource(spec) {
  const s = String(spec).trim();
  const start = WINDOWS_DRIVE.test(s) ? 2 : 0; // skip the colon of "D:\"
  const i = s.indexOf(":", start);
  return i === -1 ? null : s.slice(0, i);
}

/** A source that is a plain name is a named volume; anything else is a folder on this computer. */
export const isNamedVolume = (source) => NAMED_VOLUME.test(source);

/**
 * Turn a host path from a mount into a path on this computer, the way Docker would read it.
 * Returns { local } or { problem } (the path cannot be placed inside any local folder).
 */
export function resolveHostPath(raw, { platform = process.platform, cwd = process.cwd(), home = os.homedir() } = {}) {
  let p = String(raw).trim();
  if (!p) return { problem: "is empty" };
  if (HAS_VARIABLE.test(p)) return { problem: "uses a variable that cannot be resolved here, so it cannot be checked" };
  if (p === "~" || /^~[\\/]/.test(p)) p = path.join(home, p.slice(1));
  else if (p.startsWith("~")) return { problem: "uses ~user, which cannot be resolved here, so it cannot be checked" };

  if (platform === "win32") {
    const drive = WINDOWS_DRIVE_MOUNT.exec(p.replace(/\\/g, "/"));
    if (drive) return { local: `${drive[1].toUpperCase()}:\\${(drive[2] || "").replace(/\//g, "\\")}` };
    if (/^[\\/](?![\\/])/.test(p)) return { problem: "is a Linux path that is not on one of your drives, so it is outside the allowed workspace (CAUSLY_WORKSPACE)" };
  }
  return { local: path.resolve(cwd, p) };
}

/** Is this host path inside one of the workspace folders? Returns { ok: true } or { ok: false, problem }. */
export function checkHostPath(raw, roots, context) {
  const r = resolveHostPath(raw, context);
  if (r.problem) return { ok: false, problem: r.problem };
  if (roots.some((root) => isInsideRoot(root, r.local))) return { ok: true };
  return { ok: false, problem: "is outside the allowed workspace (CAUSLY_WORKSPACE)" };
}

/** docker_run `volumes`: { ok: true } or { ok: false, reason }. */
export function checkVolumeSpecs(volumes, roots, context) {
  for (const spec of volumes) {
    if (typeof spec !== "string") continue;
    const source = volumeSource(spec);
    if (source === null || source === "" || isNamedVolume(source)) continue;
    const res = checkHostPath(source, roots, context);
    if (!res.ok) return { ok: false, reason: `volume "${spec}" mounts host path "${source}", which ${res.problem}.` };
  }
  return { ok: true };
}

const entries = (value) => (value && typeof value === "object" ? Object.entries(value) : []);
const refName = (ref) => (typeof ref === "string" ? ref : ref?.source);
const isLocalContext = (c) => typeof c === "string" && c !== "" && !REMOTE_CONTEXT.test(c);

/**
 * A resolved Compose project (the JSON of `docker compose config`): { ok: true } or { ok: false, reason }.
 * Checks bind mounts, volumes backed by a host folder, build contexts, and secret and config files.
 */
export function checkComposeModel(model, roots, context) {
  const fail = (where, raw, problem) => ({ ok: false, reason: `Compose ${where} uses host path "${raw}", which ${problem}.` });
  const check = (where, raw) => {
    const res = checkHostPath(raw, roots, context);
    return res.ok ? null : fail(where, raw, res.problem);
  };

  const usedVolumes = new Set();
  const usedSecrets = new Set();
  const usedConfigs = new Set();

  for (const [service, svc] of entries(model?.services)) {
    for (const v of Array.isArray(svc?.volumes) ? svc.volumes : []) {
      if (typeof v === "string") {
        const source = volumeSource(v);
        if (source === null || source === "") continue;
        if (isNamedVolume(source)) usedVolumes.add(source);
        else {
          const bad = check(`service "${service}" volume "${v}"`, source);
          if (bad) return bad;
        }
      } else if (v?.type === "bind" || v?.type === "npipe") {
        if (typeof v.source !== "string") continue;
        const bad = check(`service "${service}" ${v.type} mount`, v.source);
        if (bad) return bad;
      } else if (v?.type === "volume" && typeof v.source === "string") {
        usedVolumes.add(v.source);
      }
    }

    const build = svc?.build;
    const contexts = [];
    if (typeof build === "string") contexts.push(build);
    else if (build && typeof build === "object") {
      contexts.push(build.context);
      const extra = build.additional_contexts;
      if (Array.isArray(extra)) contexts.push(...extra.map((e) => String(e).split("=").slice(1).join("=")));
      else contexts.push(...entries(extra).map(([, value]) => value));
    }
    for (const c of contexts) {
      if (!isLocalContext(c)) continue;
      const bad = check(`service "${service}" build context`, c);
      if (bad) return bad;
    }

    for (const ref of Array.isArray(svc?.secrets) ? svc.secrets : []) if (refName(ref)) usedSecrets.add(refName(ref));
    for (const ref of Array.isArray(svc?.configs) ? svc.configs : []) if (refName(ref)) usedConfigs.add(refName(ref));
  }

  // A named volume can be a host folder in disguise: driver_opts { type: none, o: bind, device: /path }.
  for (const name of usedVolumes) {
    const opts = model?.volumes?.[name]?.driver_opts;
    if (!opts || typeof opts.device !== "string") continue;
    const bindsHostFolder = /(^|,)r?bind(,|$)/.test(String(opts.o ?? "")) || opts.type === "bind";
    if (!bindsHostFolder) continue; // nfs, cifs and other remote devices are not folders on this computer
    const bad = check(`volume "${name}" (bind device)`, opts.device);
    if (bad) return bad;
  }

  for (const [kind, used] of [["secrets", usedSecrets], ["configs", usedConfigs]]) {
    for (const name of used) {
      const file = model?.[kind]?.[name]?.file;
      if (typeof file !== "string") continue; // content, environment and external sources have no host file
      const bad = check(`${kind === "secrets" ? "secret" : "config"} "${name}" file`, file);
      if (bad) return bad;
    }
  }
  return { ok: true };
}

async function loadComposeModel(project_dir) {
  const { dockerComposeConfig } = await import("./dockerOps.js");
  return dockerComposeConfig({ project_dir });
}

/**
 * The workspace check every tool call goes through: path arguments first (workspace.js), then, when a
 * workspace is set, Docker volumes and Compose files. Returns { allowed: true } or { allowed: false, reason }.
 * `deps.loadCompose` replaces the call to Docker in tests.
 */
export async function checkWorkspaceAndMounts(toolName, input, value = process.env.CAUSLY_WORKSPACE, deps = {}) {
  const base = checkWorkspace(toolName, input, value);
  if (!base.allowed) return base;
  const roots = workspaceRoots(value);
  if (!roots.length) return base;

  if (toolName === "docker_run" && Array.isArray(input?.volumes)) {
    const res = checkVolumeSpecs(input.volumes, roots, deps.context);
    if (!res.ok) return { allowed: false, reason: `'${toolName}' ${res.reason}` };
  }

  if (toolName === "docker_compose_up" && typeof input?.project_dir === "string") {
    let model;
    try {
      model = await (deps.loadCompose ?? loadComposeModel)(input.project_dir);
    } catch (err) {
      const why = redactSecretsInString(String(err?.message ?? err)).slice(0, 300);
      return {
        allowed: false,
        reason: `'${toolName}' cannot check the Compose file's mounts against the workspace (CAUSLY_WORKSPACE): ${why}`,
      };
    }
    const res = checkComposeModel(model, roots, deps.context);
    if (!res.ok) return { allowed: false, reason: `'${toolName}': ${res.reason}` };
  }
  return { allowed: true };
}
