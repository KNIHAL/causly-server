import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  volumeSource,
  isNamedVolume,
  resolveHostPath,
  checkVolumeSpecs,
  checkComposeModel,
  checkWorkspaceAndMounts,
} from "../tools/mountGuard.js";
import { createToolWrapper } from "../tools/toolWrapper.js";

const windows = process.platform === "win32";
let base, root, outside, roots;

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "causly-mount-"));
  root = path.join(base, "project");
  outside = path.join(base, "project-evil"); // shares a name prefix with root
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "secret.txt"), "x");
  roots = [root];
});

afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

describe("volumeSource", () => {
  it.each([
    ["/host:/ctr", "/host"],
    ["/host:/ctr:ro", "/host"],
    ["named:/ctr", "named"],
    ["./rel:/ctr", "./rel"],
    ["~/x:/ctr", "~/x"],
    ["D:\\proj:/app:ro", "D:\\proj"],
    ["D:/proj:/app", "D:/proj"],
    [":/ctr", ""],
  ])("%s -> %s", (spec, expected) => expect(volumeSource(spec)).toBe(expected));

  it("is null for an anonymous volume (no host side)", () => {
    expect(volumeSource("/var/lib/data")).toBeNull();
    expect(volumeSource("D:\\only")).toBeNull();
  });
});

describe("isNamedVolume", () => {
  it.each(["pgdata", "my.vol-1_x", "a"])("%s is a named volume", (n) => expect(isNamedVolume(n)).toBe(true));
  it.each(["./x", "../x", "/x", "~/x", "$HOME/x", "D:\\x", ".hidden", ""])("%s is a host path", (n) => expect(isNamedVolume(n)).toBe(false));
});

describe("resolveHostPath", () => {
  it("resolves relative paths against the given folder", () => {
    expect(resolveHostPath("./data", { platform: "linux", cwd: "/work" })).toEqual({ local: path.resolve("/work", "./data") });
    expect(resolveHostPath("../x", { platform: "linux", cwd: "/work/a" })).toEqual({ local: path.resolve("/work/a", "../x") });
  });

  it("expands ~ and refuses ~user", () => {
    expect(resolveHostPath("~/x", { platform: "linux", cwd: "/work", home: "/home/u" })).toEqual({ local: path.resolve("/work", path.join("/home/u", "/x")) });
    expect(resolveHostPath("~", { platform: "linux", cwd: "/work", home: "/home/u" })).toEqual({ local: path.resolve("/home/u") });
    expect(resolveHostPath("~bob/x").problem).toMatch(/~user/);
  });

  it.each(["$HOME/x", "${DATA}/x", "%USERPROFILE%\\x", "/a/$(id)"])("refuses a path with a variable: %s", (p) => {
    expect(resolveHostPath(p).problem).toMatch(/variable/);
  });

  it("refuses an empty path", () => expect(resolveHostPath("  ").problem).toMatch(/empty/));

  describe("on Windows", () => {
    const w = { platform: "win32", cwd: "D:\\work" };
    it.each([
      ["/mnt/d/proj/src", "D:\\proj\\src"],
      ["/d/proj", "D:\\proj"],
      ["/c", "C:\\"],
      ["/host_mnt/c/x", "C:\\x"],
      ["/run/desktop/mnt/host/c/Users/me", "C:\\Users\\me"],
      ["\\mnt\\d\\proj", "D:\\proj"],
    ])("%s is %s", (raw, local) => expect(resolveHostPath(raw, w)).toEqual({ local }));

    it.each(["/etc", "/home/kumar/.ssh", "/var/run/docker.sock", "/mnt", "/mnt/"])("%s is a Linux path outside every drive", (raw) => {
      expect(resolveHostPath(raw, w).problem).toMatch(/Linux path/);
    });

    it("leaves drive paths, relative paths and UNC paths to the normal check", () => {
      for (const raw of ["D:\\proj\\x", "D:/proj/x", ".\\data", "\\\\server\\share\\x"]) {
        expect(resolveHostPath(raw, w).problem).toBeUndefined();
      }
    });
  });
});

describe("checkVolumeSpecs (docker_run volumes)", () => {
  it("allows host folders inside the workspace, with options", () => {
    expect(checkVolumeSpecs([`${root}:/app`, `${path.join(root, "data")}:/data:ro`], roots).ok).toBe(true);
  });

  it("blocks a folder outside, the parent of the workspace, and a sibling that shares its name prefix", () => {
    for (const host of [outside, path.dirname(root), path.parse(root).root]) {
      const res = checkVolumeSpecs([`${host}:/x`], roots);
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(/outside the allowed workspace \(CAUSLY_WORKSPACE\)/);
      expect(res.reason).toContain(`${host}:/x`);
    }
  });

  it("blocks .. that climbs out of the workspace", () => {
    expect(checkVolumeSpecs([`${root}${path.sep}..${path.sep}project-evil:/x`], roots).ok).toBe(false);
  });

  it("stops at the first bad entry even when others are fine", () => {
    const res = checkVolumeSpecs([`${root}:/ok`, `${outside}:/bad`, "pgdata:/db"], roots);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain(outside);
  });

  it("allows named volumes and anonymous volumes", () => {
    expect(checkVolumeSpecs(["pgdata:/var/lib/postgresql", "my.vol-1:/x:ro", "/var/lib/data"], roots).ok).toBe(true);
  });

  it("resolves relative paths against the working folder", () => {
    expect(checkVolumeSpecs(["./data:/d"], roots, { cwd: root }).ok).toBe(true);
    expect(checkVolumeSpecs(["../project-evil:/d"], roots, { cwd: root }).ok).toBe(false);
    expect(checkVolumeSpecs(["./data:/d"], roots, { cwd: outside }).ok).toBe(false);
  });

  it("expands ~ to the home folder before checking", () => {
    expect(checkVolumeSpecs(["~/data:/d"], roots, { home: root }).ok).toBe(true);
    expect(checkVolumeSpecs(["~/data:/d"], roots, { home: outside }).ok).toBe(false);
  });

  it("blocks a path it cannot resolve, with a reason that says why", () => {
    const res = checkVolumeSpecs(["$HOME/.ssh:/ssh"], roots);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/variable/);
  });

  it.skipIf(windows)("blocks a symlink inside the workspace that points outside", () => {
    const link = path.join(root, "escape");
    fs.symlinkSync(outside, link);
    try {
      expect(checkVolumeSpecs([`${link}:/x`], roots).ok).toBe(false);
      expect(checkVolumeSpecs([`${link}/secret.txt:/x`], roots).ok).toBe(false);
    } finally {
      fs.rmSync(link);
    }
  });

  it("blocks the Docker socket and other system folders", () => {
    const sock = windows ? "\\\\.\\pipe\\docker_engine" : "/var/run/docker.sock";
    expect(checkVolumeSpecs([`${sock}:/var/run/docker.sock`], roots).ok).toBe(false);
    expect(checkVolumeSpecs([`${windows ? "C:\\Windows" : "/etc"}:/host`], roots).ok).toBe(false);
  });
});

describe("checkComposeModel (the resolved docker compose config)", () => {
  const bind = (source, type = "bind") => ({ services: { web: { volumes: [{ type, source, target: "/x" }] } } });

  it("accepts an empty or minimal model", () => {
    expect(checkComposeModel(undefined, roots).ok).toBe(true);
    expect(checkComposeModel({}, roots).ok).toBe(true);
    expect(checkComposeModel({ services: { web: { image: "alpine" } } }, roots).ok).toBe(true);
  });

  it("bind mounts: inside passes, outside is blocked and the reason names the service and path", () => {
    expect(checkComposeModel(bind(path.join(root, "data")), roots).ok).toBe(true);
    const res = checkComposeModel(bind(outside), roots);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('service "web" bind mount');
    expect(res.reason).toContain(outside);
    expect(res.reason).toMatch(/outside the allowed workspace/);
  });

  it("named volumes and tmpfs have no host folder", () => {
    const model = {
      services: { web: { volumes: [{ type: "volume", source: "named", target: "/n" }, { type: "tmpfs", target: "/t" }] } },
      volumes: { named: {} },
    };
    expect(checkComposeModel(model, roots).ok).toBe(true);
  });

  it("a Windows named pipe is a host path", () => {
    expect(checkComposeModel(bind("\\\\.\\pipe\\docker_engine", "npipe"), roots, { cwd: outside }).ok).toBe(false);
  });

  it("short-syntax strings are handled too", () => {
    const short = (v) => ({ services: { web: { volumes: v } } });
    expect(checkComposeModel(short(["./data:/d", "named:/n", "/anon"]), roots, { cwd: root }).ok).toBe(true);
    expect(checkComposeModel(short([`${outside}:/x`]), roots).ok).toBe(false);
  });

  describe("a named volume that is really a host folder (driver_opts device)", () => {
    const model = (device, o = "bind", type = "none") => ({
      services: { db: { volumes: [{ type: "volume", source: "dv", target: "/d" }] } },
      volumes: { dv: { driver: "local", driver_opts: { type, o, device } } },
    });

    it("is blocked when the device is outside the workspace", () => {
      const res = checkComposeModel(model(outside), roots);
      expect(res.ok).toBe(false);
      expect(res.reason).toContain('volume "dv" (bind device)');
    });

    it("passes when the device is inside, and for rbind or extra options", () => {
      expect(checkComposeModel(model(path.join(root, "data")), roots).ok).toBe(true);
      expect(checkComposeModel(model(outside, "rbind,ro"), roots).ok).toBe(false);
      expect(checkComposeModel(model(outside, "", "bind"), roots).ok).toBe(false);
    });

    it("ignores remote devices such as NFS", () => {
      expect(checkComposeModel(model(":/export/data", "addr=10.0.0.5,rw", "nfs"), roots).ok).toBe(true);
    });

    it("ignores a volume that no service uses", () => {
      const unused = { services: { web: { image: "alpine" } }, volumes: { dv: { driver_opts: { type: "none", o: "bind", device: outside } } } };
      expect(checkComposeModel(unused, roots).ok).toBe(true);
    });
  });

  describe("build contexts", () => {
    const build = (b) => ({ services: { web: { build: b } } });

    it("blocks a context outside the workspace and allows one inside", () => {
      expect(checkComposeModel(build({ context: root }), roots).ok).toBe(true);
      const res = checkComposeModel(build({ context: outside }), roots);
      expect(res.ok).toBe(false);
      expect(res.reason).toContain('service "web" build context');
    });

    it("handles the string form and additional_contexts (object and list)", () => {
      expect(checkComposeModel(build(outside), roots).ok).toBe(false);
      expect(checkComposeModel(build({ context: root, additional_contexts: { extra: outside } }), roots).ok).toBe(false);
      expect(checkComposeModel(build({ context: root, additional_contexts: [`extra=${outside}`] }), roots).ok).toBe(false);
      expect(checkComposeModel(build({ context: root, additional_contexts: { extra: path.join(root, "data") } }), roots).ok).toBe(true);
    });

    it.each(["https://github.com/acme/app.git", "git@github.com:acme/app.git", "github.com/acme/app", "docker-image://alpine:3"])(
      "does not treat a remote context as a folder: %s",
      (context) => expect(checkComposeModel(build({ context, additional_contexts: { x: context } }), roots).ok).toBe(true)
    );
  });

  describe("secret and config files", () => {
    const withFile = (kind, file, used = true) => ({
      services: { web: { [kind]: used ? [{ source: "s1" }] : [] } },
      [kind]: { s1: { file } },
    });

    it.each(["secrets", "configs"])("%s: a file outside the workspace is blocked, inside is fine", (kind) => {
      expect(checkComposeModel(withFile(kind, path.join(root, "data", "x")), roots).ok).toBe(true);
      const res = checkComposeModel(withFile(kind, path.join(outside, "secret.txt")), roots);
      expect(res.ok).toBe(false);
      expect(res.reason).toContain(kind === "secrets" ? 'secret "s1" file' : 'config "s1" file');
    });

    it("ignores entries no service uses, and ones without a file (environment or content)", () => {
      expect(checkComposeModel(withFile("secrets", outside, false), roots).ok).toBe(true);
      const envSecret = { services: { web: { secrets: ["s1"] } }, secrets: { s1: { environment: "TOKEN" } } };
      expect(checkComposeModel(envSecret, roots).ok).toBe(true);
    });

    it("accepts the short list form", () => {
      const model = { services: { web: { secrets: ["s1"] } }, secrets: { s1: { file: outside } } };
      expect(checkComposeModel(model, roots).ok).toBe(false);
    });
  });
});

describe("checkWorkspaceAndMounts", () => {
  const model = (source) => ({ services: { web: { volumes: [{ type: "bind", source, target: "/x" }] } } });

  it("changes nothing when no workspace is set", async () => {
    const loadCompose = vi.fn();
    expect(await checkWorkspaceAndMounts("docker_run", { image: "a", volumes: ["/etc:/x"] }, "")).toEqual({ allowed: true });
    expect(await checkWorkspaceAndMounts("docker_compose_up", { project_dir: outside }, undefined, { loadCompose })).toEqual({ allowed: true });
    expect(loadCompose).not.toHaveBeenCalled();
  });

  it("docker_run: blocks an outside mount and names the tool", async () => {
    const res = await checkWorkspaceAndMounts("docker_run", { image: "a", volumes: [`${outside}:/x`] }, root);
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/^'docker_run' volume/);
    expect(await checkWorkspaceAndMounts("docker_run", { image: "a", volumes: [`${root}:/x`, "named:/n"] }, root)).toEqual({ allowed: true });
    expect(await checkWorkspaceAndMounts("docker_run", { image: "a" }, root)).toEqual({ allowed: true });
  });

  it("still applies the path-argument check first", async () => {
    const res = await checkWorkspaceAndMounts("read_file", { path: path.join(outside, "secret.txt") }, root);
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/outside the allowed workspace/);
  });

  it("docker_compose_up: reads the resolved model of the project folder and checks it", async () => {
    const loadCompose = vi.fn(async () => model(outside));
    const res = await checkWorkspaceAndMounts("docker_compose_up", { project_dir: root }, root, { loadCompose });
    expect(loadCompose).toHaveBeenCalledWith(root);
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/^'docker_compose_up': Compose service "web" bind mount/);

    const ok = await checkWorkspaceAndMounts("docker_compose_up", { project_dir: root }, root, { loadCompose: async () => model(path.join(root, "data")) });
    expect(ok).toEqual({ allowed: true });
  });

  it("docker_compose_up: blocks when the Compose file cannot be read, without leaking secrets from the message", async () => {
    const loadCompose = async () => {
      throw new Error("invalid compose: token=abc123def456 in service web");
    };
    const res = await checkWorkspaceAndMounts("docker_compose_up", { project_dir: root }, root, { loadCompose });
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/cannot check the Compose file's mounts/);
    expect(res.reason).toContain("invalid compose");
    expect(res.reason).not.toContain("abc123def456");
  });

  it("docker_compose_up: a project folder outside the workspace is refused before Docker is asked", async () => {
    const loadCompose = vi.fn();
    const res = await checkWorkspaceAndMounts("docker_compose_up", { project_dir: outside }, root, { loadCompose });
    expect(res.allowed).toBe(false);
    expect(loadCompose).not.toHaveBeenCalled();
  });

  it("docker_compose_down starts nothing, so it is not inspected", async () => {
    const loadCompose = vi.fn();
    expect(await checkWorkspaceAndMounts("docker_compose_down", { project_dir: root }, root, { loadCompose })).toEqual({ allowed: true });
    expect(loadCompose).not.toHaveBeenCalled();
  });
});

describe("the tool wrapper", () => {
  const saved = process.env.CAUSLY_WORKSPACE;
  afterEach(() => {
    if (saved === undefined) delete process.env.CAUSLY_WORKSPACE;
    else process.env.CAUSLY_WORKSPACE = saved;
  });

  const wrap = () =>
    createToolWrapper({
      approvalCheck: () => ({ allowed: true }),
      activityLogger: vi.fn(),
      receiptEmitter: () => {},
      envRefresher: () => {},
    });

  it("blocks docker_run with a mount outside the workspace and never calls the handler", async () => {
    process.env.CAUSLY_WORKSPACE = root;
    const handler = vi.fn(async () => ({ ok: true }));
    const res = await wrap()("docker_run", handler)({ image: "alpine", volumes: [`${outside}:/x`], confirm: true });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/^Blocked: 'docker_run' volume/);
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs docker_run when every mount is inside the workspace", async () => {
    process.env.CAUSLY_WORKSPACE = root;
    const handler = vi.fn(async () => ({ ok: true }));
    const res = await wrap()("docker_run", handler)({ image: "alpine", volumes: [`${root}:/x`], confirm: true });
    expect(res.isError).toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("still accepts a synchronous workspaceCheck", async () => {
    const handler = vi.fn(async () => ({ ok: true }));
    const run = createToolWrapper({
      workspaceCheck: () => ({ allowed: false, reason: "no" }),
      approvalCheck: () => ({ allowed: true }),
      activityLogger: () => {},
      receiptEmitter: () => {},
      envRefresher: () => {},
    })("x", handler);
    expect((await run({})).content[0].text).toBe("Blocked: no");
    expect(handler).not.toHaveBeenCalled();
  });
});
