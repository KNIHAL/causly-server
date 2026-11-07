import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildChildEnv, parsePassthrough, describeChildEnv, PROFILES } from "../tools/childEnv.js";
import { runCommand } from "../tools/commandOps.js";

const SRC = {
  PATH: "/usr/bin",
  HOME: "/home/k",
  LANG: "en_US.UTF-8",
  LC_ALL: "C",
  OPENAI_API_KEY: "sk-secret",
  AWS_SECRET_ACCESS_KEY: "aws-secret",
  TF_VAR_db_password: "pw",
  TF_LOG: "DEBUG",
  DOCKER_HOST: "tcp://x",
  GIT_SSH_COMMAND: "evil",
  CAUSLY_PASSTHROUGH_ENV: "",
};

describe("parsePassthrough", () => {
  it("splits on commas, spaces and semicolons", () => {
    expect(parsePassthrough("A, B;C  D")).toEqual(["A", "B", "C", "D"]);
    expect(parsePassthrough(undefined)).toEqual([]);
  });
});

describe("buildChildEnv", () => {
  it("keeps the base allowlist and drops service keys", () => {
    const env = buildChildEnv({ profile: "command", source: SRC, platform: "linux" });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.LC_ALL).toBe("C");
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.TF_VAR_db_password).toBeUndefined();
  });

  it("profiles add only their own names", () => {
    expect(buildChildEnv({ profile: "docker", source: SRC, platform: "linux" }).DOCKER_HOST).toBe("tcp://x");
    expect(buildChildEnv({ profile: "command", source: SRC, platform: "linux" }).DOCKER_HOST).toBeUndefined();
    expect(buildChildEnv({ profile: "terraform", source: SRC, platform: "linux" }).TF_LOG).toBe("DEBUG");
  });

  it("git profile never carries GIT_*", () => {
    const env = buildChildEnv({ profile: "git", source: SRC, platform: "linux", passthrough: [] });
    expect(Object.keys(env).some((k) => k.startsWith("GIT_"))).toBe(false);
  });

  it("passthrough allows exact names and prefixes", () => {
    const env = buildChildEnv({ profile: "command", source: SRC, platform: "linux", passthrough: "OPENAI_API_KEY,TF_VAR_*" });
    expect(env.OPENAI_API_KEY).toBe("sk-secret");
    expect(env.TF_VAR_db_password).toBe("pw");
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it("* restores the full environment", () => {
    const env = buildChildEnv({ profile: "command", source: SRC, platform: "linux", passthrough: "*" });
    expect(env.AWS_SECRET_ACCESS_KEY).toBe("aws-secret");
  });

  it("matches case-insensitively on Windows only", () => {
    const src = { Path: "C:\\bin", SYSTEMROOT: "C:\\Windows", Secret: "x" };
    const win = buildChildEnv({ profile: "command", source: src, platform: "win32", passthrough: [] });
    expect(win.Path).toBe("C:\\bin");
    expect(win.SYSTEMROOT).toBe("C:\\Windows");
    expect(win.Secret).toBeUndefined();
    const lin = buildChildEnv({ profile: "command", source: { path: "x" }, platform: "linux", passthrough: [] });
    expect(lin.path).toBeUndefined();
  });

  it("reads CAUSLY_PASSTHROUGH_ENV from the source by default", () => {
    const env = buildChildEnv({ profile: "command", source: { ...SRC, CAUSLY_PASSTHROUGH_ENV: "OPENAI_API_KEY" }, platform: "linux" });
    expect(env.OPENAI_API_KEY).toBe("sk-secret");
  });

  it("rejects unknown profiles", () => {
    expect(() => buildChildEnv({ profile: "nope" })).toThrow(/Unknown/);
    expect(Object.keys(PROFILES)).toEqual(["command", "docker", "terraform", "git", "media"]);
  });
});

describe("describeChildEnv", () => {
  it("describes the three modes", () => {
    expect(describeChildEnv({})).toMatch(/^minimal/);
    expect(describeChildEnv({ CAUSLY_PASSTHROUGH_ENV: "A,B" })).toMatch(/2 passthrough/);
    expect(describeChildEnv({ CAUSLY_PASSTHROUGH_ENV: "*" })).toMatch(/full environment/);
  });
});

describe("run_command environment", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.FAKE_SERVICE_KEY = "sk-should-not-leak";
    delete process.env.CAUSLY_PASSTHROUGH_ENV;
  });
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });

  const dump = async () => {
    const r = await runCommand({ command: 'node -p "JSON.stringify(process.env)"' });
    return JSON.parse(r.stdout.trim());
  };

  it("child sees no service keys by default", async () => {
    const env = await dump();
    expect(env.FAKE_SERVICE_KEY).toBeUndefined();
    expect(env.PATH ?? env.Path).toBeTruthy();
  });

  it("passthrough exposes a named key", async () => {
    process.env.CAUSLY_PASSTHROUGH_ENV = "FAKE_SERVICE_KEY";
    expect((await dump()).FAKE_SERVICE_KEY).toBe("sk-should-not-leak");
  });
});
