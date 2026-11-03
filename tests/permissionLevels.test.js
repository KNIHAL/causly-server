import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { PACKS } from "../packs/registry.js";
import { PERMISSION_LEVELS, checkApproval, getPermissionLevel } from "../tools/security.js";

// P0-08: every tool has an explicit permission level, risky tools are gated, and a gated tool can
// actually be confirmed (its input schema accepts `confirm`).
const manifest = JSON.parse(fs.readFileSync(new URL("../packs/manifest.json", import.meta.url), "utf8")).packs;
const manifestTools = Object.values(manifest).flatMap((p) => p.tools.map((t) => t.name));
const META_TOOLS = ["search_tools", "load_toolset", "use_tool"]; // always registered, not in a pack
const GATED = new Set(["HIGH", "DESTRUCTIVE"]);

describe("explicit levels", () => {
  it("every tool in the manifest has an explicit level (the MEDIUM fallback must never be used)", () => {
    const missing = manifestTools.filter((name) => !Object.hasOwn(PERMISSION_LEVELS, name));
    expect(missing).toEqual([]);
  });

  it("every meta tool has an explicit level", () => {
    for (const name of META_TOOLS) expect(Object.hasOwn(PERMISSION_LEVELS, name), name).toBe(true);
  });

  it("there is no level for a tool that does not exist", () => {
    const known = new Set([...manifestTools, ...META_TOOLS]);
    expect(Object.keys(PERMISSION_LEVELS).filter((name) => !known.has(name))).toEqual([]);
  });

  it("every level is a known level", () => {
    for (const [name, level] of Object.entries(PERMISSION_LEVELS)) {
      expect(["READ", "LOW", "MEDIUM", "HIGH", "DESTRUCTIVE"], name).toContain(level);
    }
  });

  it("an unknown tool still falls back to MEDIUM (safe default), which is why the test above exists", () => {
    expect(getPermissionLevel("some_future_tool", {})).toBe("MEDIUM");
  });
});

describe("levels raised in P0-08", () => {
  it.each([
    ["git_push", "HIGH"],
    ["git_merge", "HIGH"],
    ["secrets_get", "HIGH"],
    ["git_stash", "MEDIUM"],
    ["git_tag", "MEDIUM"],
    ["supabase_create_project", "HIGH"],
    ["vercel_cancel_deployment", "HIGH"],
  ])("%s is %s", (tool, level) => {
    expect(PERMISSION_LEVELS[tool]).toBe(level);
  });

  it.each(["git_push", "git_merge", "secrets_get", "supabase_create_project", "vercel_cancel_deployment"])(
    "%s needs confirm: true",
    (tool) => {
      expect(checkApproval(tool, {}).allowed).toBe(false);
      expect(checkApproval(tool, { confirm: false }).allowed).toBe(false);
      expect(checkApproval(tool, { confirm: "true" }).allowed).toBe(false);
      expect(checkApproval(tool, { confirm: true }).allowed).toBe(true);
    }
  );
});

describe("per-action levels: confirm only for the destructive action", () => {
  it.each([
    ["git_stash", { action: "drop" }],
    ["git_stash", { action: "DROP" }],
    ["git_stash", { action: " drop " }],
    ["git_tag", { action: "delete" }],
    ["git_tag", { action: "Delete" }],
  ])("%s %j needs confirm: true", (tool, input) => {
    expect(getPermissionLevel(tool, input)).toBe("HIGH");
    expect(checkApproval(tool, input).allowed).toBe(false);
    expect(checkApproval(tool, { ...input, confirm: true }).allowed).toBe(true);
  });

  it.each([
    ["git_stash", {}],
    ["git_stash", { action: "save" }],
    ["git_stash", { action: "pop" }],
    ["git_stash", { action: "apply" }],
    ["git_stash", { action: "list" }],
    ["git_tag", {}],
    ["git_tag", { action: "list" }],
    ["git_tag", { action: "create", tag_name: "v1" }],
  ])("%s %j runs without confirm", (tool, input) => {
    expect(checkApproval(tool, input).allowed).toBe(true);
    expect(checkApproval(tool, input).level).toBe("MEDIUM");
  });

  it("a missing or odd input does not crash", () => {
    expect(getPermissionLevel("git_stash", undefined)).toBe("MEDIUM");
    expect(getPermissionLevel("git_stash", null)).toBe("MEDIUM");
    expect(getPermissionLevel("git_stash", { action: 5 })).toBe("MEDIUM");
  });
});

describe("a gated tool can be confirmed", () => {
  // Registers every pack against a stub server and reads each tool's input schema.
  async function collectSchemas() {
    const schemas = new Map();
    for (const pack of Object.values(PACKS)) {
      const stub = {
        registerTool(name, config) {
          schemas.set(name, config);
        },
      };
      (await pack.load()).default(stub);
    }
    return schemas;
  }

  it("every HIGH or DESTRUCTIVE tool accepts `confirm` in its input schema", async () => {
    const schemas = await collectSchemas();
    const unconfirmable = [];
    for (const [name, config] of schemas) {
      const needsConfirm = GATED.has(PERMISSION_LEVELS[name]) || name === "git_stash" || name === "git_tag";
      if (needsConfirm && !(config.inputSchema && "confirm" in config.inputSchema)) unconfirmable.push(name);
    }
    expect(unconfirmable).toEqual([]);
  });

  it("every HIGH or DESTRUCTIVE tool tells the agent about confirm in its description", async () => {
    const schemas = await collectSchemas();
    const silent = [];
    for (const [name, config] of schemas) {
      if (GATED.has(PERMISSION_LEVELS[name]) && !/confirm/i.test(String(config.description))) silent.push(name);
    }
    expect(silent).toEqual([]);
  });
});
