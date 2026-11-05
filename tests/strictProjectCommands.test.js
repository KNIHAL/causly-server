import { describe, it, expect, afterEach } from "vitest";
import { checkApproval, getPermissionLevel, PROJECT_COMMAND_TOOLS, strictProjectCommands } from "../tools/security.js";
import { decide } from "../tools/operatorApproval.js";

const saved = process.env.CAUSLY_STRICT_PROJECT_COMMANDS;
afterEach(() => {
  if (saved === undefined) delete process.env.CAUSLY_STRICT_PROJECT_COMMANDS;
  else process.env.CAUSLY_STRICT_PROJECT_COMMANDS = saved;
});

describe("CAUSLY_STRICT_PROJECT_COMMANDS", () => {
  it.each(PROJECT_COMMAND_TOOLS)("%s is LOW and needs no confirm by default", (tool) => {
    delete process.env.CAUSLY_STRICT_PROJECT_COMMANDS;
    expect(getPermissionLevel(tool, {})).toBe("LOW");
    expect(checkApproval(tool, {}).allowed).toBe(true);
  });

  it.each(PROJECT_COMMAND_TOOLS)("%s needs confirm: true in strict mode", (tool) => {
    process.env.CAUSLY_STRICT_PROJECT_COMMANDS = "true";
    expect(getPermissionLevel(tool, {})).toBe("HIGH");
    expect(checkApproval(tool, {}).allowed).toBe(false);
    expect(checkApproval(tool, { confirm: "true" }).allowed).toBe(false);
    expect(checkApproval(tool, { confirm: true }).allowed).toBe(true);
  });

  it("operator approval treats them as HIGH (ask) in strict mode", () => {
    process.env.CAUSLY_STRICT_PROJECT_COMMANDS = "1";
    expect(decide("run_tests", {}).level).toBe("HIGH");
  });

  it("does not change other tools", () => {
    process.env.CAUSLY_STRICT_PROJECT_COMMANDS = "true";
    expect(getPermissionLevel("project_info", {})).toBe("READ");
  });

  it("only true-ish values turn it on", () => {
    for (const v of ["false", "0", "", "nope"]) expect(strictProjectCommands({ CAUSLY_STRICT_PROJECT_COMMANDS: v })).toBe(false);
    for (const v of ["true", "1", "YES", "on"]) expect(strictProjectCommands({ CAUSLY_STRICT_PROJECT_COMMANDS: v })).toBe(true);
  });
});
