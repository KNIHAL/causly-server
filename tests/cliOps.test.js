import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { isInstalledPackage, envFiles } from "../tools/paths.js";
import { clientConfigPath, detectClients, serverEntry, upsertServerEntry, removeServerEntry, runInit, runRemove, runDoctor } from "../tools/cliOps.js";

let dir;
let home;
let root;
const saved = { CAUSLY_HOME: process.env.CAUSLY_HOME, CAUSLY_ENV_FILE: process.env.CAUSLY_ENV_FILE };
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const where = () => ({ platform: "win32", home, env: { APPDATA: path.join(home, "AppData", "Roaming") } });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "causly-cli-"));
  home = path.join(dir, "home");
  root = path.join(dir, "pkg");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, ".env.example"), "# template\nGROQ_API_KEY=\n");
  process.env.CAUSLY_HOME = path.join(home, ".causly");
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("paths", () => {
  it("tells an npm install from a checkout", () => {
    expect(isInstalledPackage("C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\causly-server")).toBe(true);
    expect(isInstalledPackage("/usr/lib/node_modules/causly-server")).toBe(true);
    expect(isInstalledPackage("D:\\causly-server")).toBe(false);
  });

  it("reads settings from CAUSLY_ENV_FILE, then ~/.causly, then the package folder", () => {
    process.env.CAUSLY_ENV_FILE = "/x/custom.env";
    const files = envFiles();
    expect(files[0]).toBe("/x/custom.env");
    expect(files[1]).toBe(path.join(home, ".causly", ".env"));
    expect(files).toHaveLength(3);
  });
});

describe("client config paths", () => {
  it("knows where each app keeps its MCP config", () => {
    expect(clientConfigPath("claude", { platform: "win32", home: "C:\\u", env: { APPDATA: "C:\\u\\AppData\\Roaming" } })).toBe(path.join("C:\\u\\AppData\\Roaming", "Claude", "claude_desktop_config.json"));
    expect(clientConfigPath("claude", { platform: "darwin", home: "/h" })).toBe(path.join("/h", "Library", "Application Support", "Claude", "claude_desktop_config.json"));
    expect(clientConfigPath("claude", { platform: "linux", home: "/h" })).toBe(path.join("/h", ".config", "Claude", "claude_desktop_config.json"));
    expect(clientConfigPath("cursor", { home: "/h" })).toBe(path.join("/h", ".cursor", "mcp.json"));
    expect(clientConfigPath("windsurf", { home: "/h" })).toBe(path.join("/h", ".codeium", "windsurf", "mcp_config.json"));
    expect(() => clientConfigPath("vim", {})).toThrow(/Unknown client/);
  });

  it("detects the apps whose config folder exists", () => {
    expect(detectClients(where())).toEqual([]);
    fs.mkdirSync(path.join(home, ".cursor"));
    fs.mkdirSync(path.join(home, ".codeium", "windsurf"), { recursive: true });
    expect(detectClients(where())).toEqual(["cursor", "windsurf"]);
  });
});

describe("serverEntry", () => {
  it("runs the installed index.js with the absolute node path", () => {
    const e = serverEntry({ root: "/opt/node_modules/causly-server", execPath: "/usr/bin/node" });
    expect(e).toEqual({ command: "/usr/bin/node", args: [path.join("/opt/node_modules/causly-server", "index.js")] });
  });

  it("uses npx when run from the temporary npx cache", () => {
    const cache = path.join("C:\\cache", "_npx", "abc", "node_modules", "causly-server");
    expect(serverEntry({ root: cache, platform: "win32" })).toEqual({ command: "cmd", args: ["/c", "npx", "-y", "causly-server"] });
    expect(serverEntry({ root: cache, platform: "linux" })).toEqual({ command: "npx", args: ["-y", "causly-server"] });
  });

  it("passes workspace and toolsets as environment", () => {
    const e = serverEntry({ root, execPath: "node", workspace: "/proj", toolsets: "research,meetings" });
    expect(e.env).toEqual({ CAUSLY_WORKSPACE: path.resolve("/proj"), CAUSLY_TOOLSETS: "research,meetings" });
  });
});

describe("upsert and remove", () => {
  it("creates the file and folders when missing", () => {
    const file = path.join(dir, "new", "deep", "mcp.json");
    const r = upsertServerEntry(file, { command: "node", args: ["x"] });
    expect(r).toMatchObject({ created: true, updated: false, backup: undefined });
    expect(read(file)).toEqual({ mcpServers: { "causly-server": { command: "node", args: ["x"] } } });
  });

  it("keeps other servers and settings, and backs the file up", () => {
    const file = path.join(dir, "cfg.json");
    fs.writeFileSync(file, JSON.stringify({ theme: "dark", mcpServers: { other: { command: "o" } } }));
    const r = upsertServerEntry(file, { command: "node", args: ["x"] });
    expect(read(file)).toEqual({ theme: "dark", mcpServers: { other: { command: "o" }, "causly-server": { command: "node", args: ["x"] } } });
    expect(JSON.parse(fs.readFileSync(r.backup, "utf8")).theme).toBe("dark");
  });

  it("updates an existing entry in place", () => {
    const file = path.join(dir, "cfg.json");
    upsertServerEntry(file, { command: "old" });
    const r = upsertServerEntry(file, { command: "new" });
    expect(r).toMatchObject({ updated: true, created: false });
    expect(read(file).mcpServers["causly-server"].command).toBe("new");
  });

  it("replaces an unreadable file but keeps a backup of it", () => {
    const file = path.join(dir, "cfg.json");
    fs.writeFileSync(file, "{ not json");
    const r = upsertServerEntry(file, { command: "n" });
    expect(r.replacedBrokenFile).toBe(true);
    expect(fs.readFileSync(r.backup, "utf8")).toBe("{ not json");
    expect(read(file).mcpServers["causly-server"].command).toBe("n");
  });

  it("removes only its own entry", () => {
    const file = path.join(dir, "cfg.json");
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: "o" }, "causly-server": { command: "c" } } }));
    expect(removeServerEntry(file).removed).toBe(true);
    expect(read(file)).toEqual({ mcpServers: { other: { command: "o" } } });
    expect(removeServerEntry(file).removed).toBe(false);
    expect(removeServerEntry(path.join(dir, "missing.json")).removed).toBe(false);
  });
});

describe("runInit and runRemove", () => {
  it("sets up detected clients and creates ~/.causly/.env from the template", () => {
    fs.mkdirSync(path.join(home, ".cursor"));
    const r = runInit({ ...where(), root });
    expect(r.clients.map((c) => c.client)).toEqual(["cursor"]);
    const settings = path.join(home, ".causly", ".env");
    expect(fs.readFileSync(settings, "utf8")).toContain("GROQ_API_KEY=");
    const entry = read(path.join(home, ".cursor", "mcp.json")).mcpServers["causly-server"];
    expect(entry.args[0]).toBe(path.join(root, "index.js"));
    expect(r.lines.join("\n")).toMatch(/Restart Cursor/);
    expect(r.lines.join("\n")).toMatch(/claude mcp add causly-server/);
  });

  it("falls back to Claude Desktop when no app is detected, and does not overwrite settings", () => {
    fs.mkdirSync(path.join(home, ".causly"), { recursive: true });
    fs.writeFileSync(path.join(home, ".causly", ".env"), "GROQ_API_KEY=keep-me\n");
    const r = runInit({ ...where(), root });
    expect(r.clients.map((c) => c.client)).toEqual(["claude"]);
    expect(fs.readFileSync(path.join(home, ".causly", ".env"), "utf8")).toContain("keep-me");
  });

  it("supports a client list, all, a workspace and toolsets", () => {
    const ws = path.join(dir, "proj");
    fs.mkdirSync(ws);
    const r = runInit({ ...where(), root, client: "cursor,windsurf", workspace: ws, toolsets: "meetings" });
    expect(r.clients.map((c) => c.client)).toEqual(["cursor", "windsurf"]);
    expect(read(path.join(home, ".cursor", "mcp.json")).mcpServers["causly-server"].env).toEqual({ CAUSLY_WORKSPACE: ws, CAUSLY_TOOLSETS: "meetings" });
    expect(runInit({ ...where(), root, client: "all" }).clients).toHaveLength(3);
    expect(() => runInit({ ...where(), root, client: "emacs" })).toThrow(/Unknown client/);
    expect(() => runInit({ ...where(), root, workspace: path.join(dir, "nope") })).toThrow(/does not exist/);
  });

  it("uses a checkout's own .env instead of creating one", () => {
    fs.writeFileSync(path.join(root, ".env"), "X=1\n");
    const r = runInit({ ...where(), root });
    expect(r.env_file).toBe(path.join(root, ".env"));
    expect(fs.existsSync(path.join(home, ".causly", ".env"))).toBe(false);
  });

  it("removes itself from every client and says when there is nothing to remove", () => {
    runInit({ ...where(), root, client: "all" });
    const r = runRemove(where());
    expect(r.clients.filter((c) => c.removed)).toHaveLength(3);
    expect(runRemove(where()).lines[0]).toMatch(/Nothing to remove/);
  });
});

describe("doctor", () => {
  const ok = (_c, _a, _o, cb) => cb(null, "ffmpeg version 9.0\nmore", "");
  const none = (_c, _a, _o, cb) => cb(new Error("ENOENT"));

  it("reports what is set up and what is missing", async () => {
    runInit({ ...where(), root, client: "cursor" });
    const r = await runDoctor({ ...where(), env: { ...where().env, GROQ_API_KEY: "k", TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "1", CAUSLY_WORKSPACE: "/p" }, exec: ok, nodeVersion: "22.14.0" });
    const by = Object.fromEntries(r.checks.map((c) => [c.name, c]));
    expect(by["Node.js"].ok).toBe(true);
    expect(by["Integrations configured"].detail).toBe("Telegram, Groq (meeting transcription)");
    expect(by["ffmpeg (large recordings)"].ok).toBe(true);
    expect(by["Workspace limit"].ok).toBe(true);
    expect(by["Set up in"].detail).toBe("Cursor");
    expect(r.not_configured).toContain("Linear");
    expect(r.not_configured).not.toContain("Telegram");
  });

  it("warns about old Node, missing ffmpeg and a missing workspace limit without failing", async () => {
    const r = await runDoctor({ ...where(), env: { ...where().env }, exec: none, nodeVersion: "20.11.0" });
    const by = Object.fromEntries(r.checks.map((c) => [c.name, c]));
    expect(by["Node.js"].ok).toBe(true);
    expect(by["Node.js"].detail).toMatch(/22\.13\+/);
    expect(by["ffmpeg (large recordings)"].ok).toBe(false);
    expect(by["Workspace limit"].detail).toMatch(/off/);
    expect(by["Set up in"].ok).toBe(false);
  });

  it("fails on Node older than 20", async () => {
    const r = await runDoctor({ ...where(), env: {}, exec: none, nodeVersion: "18.19.0" });
    expect(r.ok).toBe(false);
  });
});
