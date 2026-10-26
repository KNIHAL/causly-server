import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { runInit, DEFAULT_TOOLSETS, clientConfigPath } from "../tools/cliOps.js";
import { runToolsets } from "../tools/toolsetOps.js";

let home;
let where;
const root = path.resolve(import.meta.dirname, "..");
const cursorFile = () => clientConfigPath("cursor", where);
const readEnv = () => JSON.parse(fs.readFileSync(cursorFile(), "utf8")).mcpServers["causly-server"].env;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "causly-toolsets-"));
  where = { platform: "linux", home, env: {} };
  process.env.CAUSLY_HOME = path.join(home, ".causly");
  fs.mkdirSync(path.join(home, ".cursor"), { recursive: true });
  runInit({ ...where, root, client: "cursor" });
});

afterEach(() => {
  delete process.env.CAUSLY_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("causly-server toolsets", () => {
  it("lists packs with the defaults on", () => {
    const r = runToolsets({ ...where, action: "list" });
    const on = r.rows.filter((x) => x.on).map((x) => x.name);
    for (const n of DEFAULT_TOOLSETS.split(",")) expect(on).toContain(n);
    expect(r.rows.find((x) => x.name === "github").on).toBe(false);
    expect(r.changed).toBe(false);
  });

  it("adds packs, keeps the others and the workspace, and backs up the file", () => {
    runInit({ ...where, root, client: "cursor", workspace: home });
    const r = runToolsets({ ...where, action: "add", names: ["github", "calendar"] });
    expect(r.changed).toBe(true);
    const env = readEnv();
    expect(env.CAUSLY_TOOLSETS.split(",")).toEqual([...DEFAULT_TOOLSETS.split(","), "github", "calendar"]);
    expect(env.CAUSLY_WORKSPACE).toBe(home);
    expect(fs.readdirSync(path.dirname(cursorFile())).some((f) => f.includes("backup"))).toBe(true);
    expect(r.rows.find((x) => x.name === "github").on).toBe(true);
  });

  it("adding twice changes nothing the second time", () => {
    runToolsets({ ...where, action: "add", names: ["github"] });
    expect(runToolsets({ ...where, action: "add", names: ["github"] }).changed).toBe(false);
  });

  it("removes packs, and says core packs stay on", () => {
    const r = runToolsets({ ...where, action: "remove", names: ["seo", "files"] });
    expect(r.changed).toBe(true);
    expect(readEnv().CAUSLY_TOOLSETS.split(",")).not.toContain("seo");
    expect(r.lines.join("\n")).toMatch(/files is a core toolset/);
  });

  it("can remove one pack from 'all'", () => {
    runToolsets({ ...where, action: "add", names: ["all"] });
    expect(readEnv().CAUSLY_TOOLSETS).toBe("all");
    runToolsets({ ...where, action: "remove", names: ["docker"] });
    const list = readEnv().CAUSLY_TOOLSETS.split(",");
    expect(list).not.toContain("docker");
    expect(list).toContain("github");
  });

  it("reset goes back to the defaults", () => {
    runToolsets({ ...where, action: "add", names: ["github"] });
    runToolsets({ ...where, action: "reset" });
    expect(readEnv().CAUSLY_TOOLSETS).toBe(DEFAULT_TOOLSETS);
  });

  it("rejects unknown names and empty adds", () => {
    expect(() => runToolsets({ ...where, action: "add", names: ["nope"] })).toThrow(/Unknown toolset: nope/);
    expect(() => runToolsets({ ...where, action: "add", names: [] })).toThrow(/Name at least one/);
    expect(() => runToolsets({ ...where, action: "bogus" })).toThrow(/Unknown toolsets command/);
  });

  it("explains when there is nothing set up", () => {
    fs.rmSync(cursorFile());
    expect(() => runToolsets({ ...where, action: "list" })).toThrow(/Run "causly-server init"/);
  });
});
