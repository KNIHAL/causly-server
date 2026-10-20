import { describe, it, expect } from "vitest";
import fs from "fs";
import { PACKS } from "../packs/registry.js";
import {
  coreToolsets,
  resolveToolsets,
  loadPack,
  loadToolsets,
  searchTools,
  isLoaded,
} from "../packs/loader.js";
import { collectManifest } from "../scripts/build-manifest.mjs";

function stubServer() {
  const tools = [];
  return {
    tools,
    registerTool(name) {
      tools.push(name);
    },
  };
}

describe("pack manifest", () => {
  it("is up to date (run `npm run build:manifest` if this fails)", async () => {
    const onDisk = JSON.parse(fs.readFileSync(new URL("../packs/manifest.json", import.meta.url), "utf8"));
    expect(await collectManifest()).toEqual(onDisk);
  });

  it("has no duplicate tool names across packs", async () => {
    const manifest = await collectManifest();
    const names = Object.values(manifest.packs).flatMap((p) => p.tools.map((t) => t.name));
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps the default tool set small (core + 2 meta tools)", async () => {
    const manifest = await collectManifest();
    const coreTools = coreToolsets().reduce((n, name) => n + manifest.packs[name].tools.length, 0);
    expect(coreTools + 2).toBeLessThanOrEqual(30);
  });
});

describe("resolveToolsets", () => {
  it("defaults to core packs", () => {
    expect(resolveToolsets("").names).toEqual(coreToolsets());
    expect(resolveToolsets(undefined).names).toEqual(coreToolsets());
  });

  it("adds requested packs on top of core, case-insensitively", () => {
    const { names, unknown } = resolveToolsets("git, GitHub");
    expect(names).toEqual(expect.arrayContaining([...coreToolsets(), "git", "github"]));
    expect(unknown).toEqual([]);
  });

  it("'all' loads every pack", () => {
    expect(resolveToolsets("all").names).toEqual(Object.keys(PACKS));
  });

  it("reports unknown names and ignores them", () => {
    const { names, unknown } = resolveToolsets("git,nope");
    expect(unknown).toEqual(["nope"]);
    expect(names).not.toContain("nope");
  });
});

describe("loading packs", () => {
  it("registers a pack's tools once, even if loaded twice", async () => {
    const server = stubServer();
    await Promise.all([loadPack(server, "slack"), loadPack(server, "slack")]);
    await loadPack(server, "slack");
    expect(isLoaded(server, "slack")).toBe(true);
    expect(server.tools.length).toBe(8);
    expect(new Set(server.tools).size).toBe(8);
  });

  it("load_toolset reports loaded, already loaded and unknown names", async () => {
    const server = stubServer();
    await loadPack(server, "slack");
    const result = await loadToolsets(server, ["slack", "gmail", "nope"]);
    expect(result.loaded).toEqual(["gmail"]);
    expect(result.already_loaded).toEqual(["slack"]);
    expect(result.unknown).toEqual(["nope"]);
    expect(result.tools_added.length).toBe(8);
  });
});

describe("searchTools", () => {
  it("finds tools in packs that are not loaded", () => {
    const server = stubServer();
    const { matches } = searchTools(server, "pull request");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((m) => m.toolset === "github")).toBe(true);
    expect(matches.every((m) => m.loaded === false)).toBe(true);
  });

  it("lists every toolset when the query is empty", () => {
    const { toolsets } = searchTools(stubServer(), "");
    expect(toolsets.map((t) => t.name)).toEqual(Object.keys(PACKS));
  });
});
