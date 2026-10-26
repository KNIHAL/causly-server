import { describe, it, expect, vi } from "vitest";
import { PACKS } from "../packs/registry.js";
import { PERMISSION_LEVELS } from "../tools/security.js";

// These tests import every pack, which is slow when the whole suite runs in parallel.
vi.setConfig({ testTimeout: 30000 });

const META_TOOLS = ["search_tools", "load_toolset", "use_tool"];
const APPROVAL_LEVELS = new Set(["HIGH", "DESTRUCTIVE"]);

// Register every pack on a stub server and record each tool's input fields.
async function collectInputFields() {
  const tools = {};
  for (const pack of Object.values(PACKS)) {
    const mod = await pack.load();
    mod.default({
      registerTool(name, config) {
        tools[name] = Object.keys(config?.inputSchema ?? {});
      },
    });
  }
  return tools;
}

describe("tool risk ratings", () => {
  it("every tool has an explicit risk level (add new tools to PERMISSION_LEVELS)", async () => {
    const tools = await collectInputFields();
    const missing = [...Object.keys(tools), ...META_TOOLS].filter((name) => !PERMISSION_LEVELS[name]);
    expect(missing).toEqual([]);
  });

  it("every HIGH/DESTRUCTIVE tool accepts a `confirm` argument", async () => {
    const tools = await collectInputFields();
    const cannotConfirm = Object.entries(tools)
      .filter(([name]) => APPROVAL_LEVELS.has(PERMISSION_LEVELS[name]))
      .filter(([, fields]) => !fields.includes("confirm"))
      .map(([name]) => name);
    expect(cannotConfirm).toEqual([]);
  });
});
