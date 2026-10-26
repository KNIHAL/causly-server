import { describe, it, expect } from "vitest";
import { DEFAULT_TOOLSETS } from "../tools/cliOps.js";
import { PACKS } from "../packs/registry.js";

describe("init default toolsets", () => {
  it("only names packs that exist", () => {
    for (const name of DEFAULT_TOOLSETS.split(",")) expect(PACKS[name], name).toBeTruthy();
  });
});
