import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { registerProjectResources, decodeProjectPath, PROJECT_RESOURCES } from "../tools/projectResources.js";

let base, root, outside;
const savedWorkspace = process.env.CAUSLY_WORKSPACE;

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "causly-res-"));
  root = path.join(base, "project");
  outside = path.join(base, "other");
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  for (const dir of [root, outside]) {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: path.basename(dir), version: "1.0.0" }));
    execFileSync("git", ["init", "-q"], { cwd: dir });
  }
});

afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

afterEach(() => {
  if (savedWorkspace === undefined) delete process.env.CAUSLY_WORKSPACE;
  else process.env.CAUSLY_WORKSPACE = savedWorkspace;
});

function stubServer() {
  const resources = {};
  return {
    resources,
    registerResource(name, template, meta, cb) {
      resources[name] = { template, meta, cb };
    },
  };
}

const read = (res, p, kind) => res.cb(new URL(`causly://project/${encodeURIComponent(p)}/${kind}`), { encodedPath: encodeURIComponent(p) });

describe("project resources", () => {
  const runners = () => ({ health: vi.fn(async () => ({ h: 1 })), info: vi.fn(async () => ({ i: 1 })), git: vi.fn(async () => ({ g: 1 })) });

  it("registers the three resources with the same names and URIs as before", () => {
    const server = stubServer();
    registerProjectResources(server);
    expect(Object.keys(server.resources)).toEqual(["project_health_resource", "project_info_resource", "project_git_resource"]);
    expect(Object.values(server.resources).map((r) => r.template.uriTemplate.toString())).toEqual([
      "causly://project/{encodedPath}/health",
      "causly://project/{encodedPath}/info",
      "causly://project/{encodedPath}/git",
    ]);
    for (const r of Object.values(server.resources)) expect(r.meta.mimeType).toBe("application/json");
  });

  it("reads any folder when no workspace is set", async () => {
    delete process.env.CAUSLY_WORKSPACE;
    const server = stubServer();
    const r = runners();
    registerProjectResources(server, { runners: r, activityLogger: vi.fn() });
    const out = await read(server.resources.project_health_resource, outside, "health");
    expect(r.health).toHaveBeenCalledWith({ repo_path: outside });
    expect(JSON.parse(out.contents[0].text)).toEqual({ h: 1 });
    expect(out.contents[0].mimeType).toBe("application/json");
  });

  it.each(PROJECT_RESOURCES.map((r) => [r.name, r.kind]))("%s: refuses a project outside the workspace, logs it, and reads nothing", async (name, kind) => {
    process.env.CAUSLY_WORKSPACE = root;
    const server = stubServer();
    const r = runners();
    const activityLogger = vi.fn();
    registerProjectResources(server, { runners: r, activityLogger });
    await expect(read(server.resources[name], outside, kind)).rejects.toThrow(/outside the allowed workspace \(CAUSLY_WORKSPACE\)/);
    expect(r[kind]).not.toHaveBeenCalled();
    expect(activityLogger).toHaveBeenCalledWith(name, { repo_path: outside }, "BLOCKED", expect.stringMatching(/outside the allowed workspace/));
  });

  it.each(PROJECT_RESOURCES.map((r) => [r.name, r.kind]))("%s: reads a project inside the workspace", async (name, kind) => {
    process.env.CAUSLY_WORKSPACE = root;
    const server = stubServer();
    const r = runners();
    registerProjectResources(server, { runners: r, activityLogger: vi.fn() });
    await read(server.resources[name], root, kind);
    expect(r[kind]).toHaveBeenCalledWith({ repo_path: root });
  });

  it("refuses a path that climbs out of the workspace with ..", async () => {
    process.env.CAUSLY_WORKSPACE = root;
    const server = stubServer();
    registerProjectResources(server, { runners: runners(), activityLogger: vi.fn() });
    await expect(read(server.resources.project_info_resource, path.join(root, "..", "other"), "info")).rejects.toThrow(/outside the allowed workspace/);
  });

  it("rejects a malformed or non-single path value", () => {
    expect(() => decodeProjectPath("%E0%A4%A")).toThrow(/not valid URL encoding/);
    expect(() => decodeProjectPath(["a", "b"])).toThrow(/exactly one/);
    expect(() => decodeProjectPath(undefined)).toThrow(/exactly one/);
    expect(() => decodeProjectPath("")).toThrow(/exactly one/);
    expect(decodeProjectPath(encodeURIComponent("D:\\my app\\x"))).toBe("D:\\my app\\x");
  });
});

describe("project resources (stdio)", () => {
  it("applies CAUSLY_WORKSPACE to resource reads on the real server", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["index.js"],
      cwd: process.cwd(),
      env: { CAUSLY_TOOLSETS: "", CAUSLY_WORKSPACE: root, CAUSLY_HOME: path.join(base, "home") },
      stderr: "ignore",
    });
    const client = new Client({ name: "resource-test", version: "0.0.0" });
    await client.connect(transport);
    try {
      const uri = (p, kind) => `causly://project/${encodeURIComponent(p)}/${kind}`;
      for (const kind of ["health", "info", "git"]) {
        await expect(client.readResource({ uri: uri(outside, kind) })).rejects.toThrow(/outside the allowed workspace/);
      }
      const inside = await client.readResource({ uri: uri(root, "info") });
      expect(inside.contents[0].mimeType).toBe("application/json");
      expect(JSON.parse(inside.contents[0].text)).toBeTypeOf("object");
    } finally {
      await client.close();
    }
  }, 30000);
});
