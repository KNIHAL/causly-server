import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { resolveApproval, setOperatorPrompt, createElicitationPrompt } from "../tools/operatorApproval.js";
import { createToolWrapper } from "../tools/toolWrapper.js";

let home;
const saved = { CAUSLY_HOME: process.env.CAUSLY_HOME, CAUSLY_APPROVAL_TIMEOUT_MS: process.env.CAUSLY_APPROVAL_TIMEOUT_MS };

const writePolicy = (value) =>
  fs.writeFileSync(path.join(home, "policy.json"), typeof value === "string" ? value : JSON.stringify(value));

const prompt = (answer, { supported = true } = {}) => ({
  supported: () => supported,
  ask: vi.fn(async () => answer),
});
const silentPrompt = () => ({ supported: () => true, ask: vi.fn(() => new Promise(() => {})) });

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "causly-policy-"));
  process.env.CAUSLY_HOME = home;
  process.env.CAUSLY_APPROVAL_TIMEOUT_MS = "50";
  setOperatorPrompt(null);
});

afterEach(() => {
  setOperatorPrompt(null);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(home, { recursive: true, force: true });
});

describe("client without elicitation (flag fallback)", () => {
  it("blocks HIGH and DESTRUCTIVE without confirm, allows them with confirm: true", async () => {
    expect((await resolveApproval("git_push", {})).allowed).toBe(false);
    expect((await resolveApproval("delete_file", { path: "x" })).allowed).toBe(false);
    expect((await resolveApproval("git_push", { confirm: true })).allowed).toBe(true);
    expect((await resolveApproval("delete_file", { confirm: true })).allowed).toBe(true);
  });

  it("lets READ, LOW and MEDIUM run without confirm", async () => {
    for (const tool of ["read_file", "copy_file", "write_file"]) {
      expect((await resolveApproval(tool, {})).allowed).toBe(true);
    }
  });

  it("uses the flag when the client reports no elicitation support", async () => {
    setOperatorPrompt(prompt("accept", { supported: false }));
    expect((await resolveApproval("git_push", {})).allowed).toBe(false);
    expect((await resolveApproval("git_push", { confirm: true })).allowed).toBe(true);
  });
});

describe("client with elicitation", () => {
  it("stays blocked when the operator never answers, even if the agent passes confirm: true", async () => {
    const p = silentPrompt();
    setOperatorPrompt(p);
    const res = await resolveApproval("run_command", { command: "echo hi", cwd: ".", confirm: true });
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/no answer/i);
    expect(p.ask).toHaveBeenCalledTimes(1);
  });

  it("runs the call when the operator accepts, without needing confirm", async () => {
    setOperatorPrompt(prompt("accept"));
    expect((await resolveApproval("git_push", {})).allowed).toBe(true);
  });

  it("blocks when the operator declines or cancels", async () => {
    setOperatorPrompt(prompt("decline"));
    const declined = await resolveApproval("git_push", { confirm: true });
    expect(declined.allowed).toBe(false);
    expect(declined.reason).toMatch(/declined/i);
    setOperatorPrompt(prompt("cancel"));
    expect((await resolveApproval("git_push", { confirm: true })).allowed).toBe(false);
  });

  it("blocks when the prompt itself fails", async () => {
    setOperatorPrompt({ supported: () => true, ask: async () => { throw new Error("transport closed"); } });
    const res = await resolveApproval("git_push", { confirm: true });
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/prompt failed/i);
  });

  it("does not prompt for READ, LOW or MEDIUM tools", async () => {
    const p = prompt("decline");
    setOperatorPrompt(p);
    expect((await resolveApproval("read_file", {})).allowed).toBe(true);
    expect(p.ask).not.toHaveBeenCalled();
  });

  it("shows the tool, level and arguments, redacts secrets and leaves out confirm", async () => {
    const p = prompt("accept");
    setOperatorPrompt(p);
    await resolveApproval("slack_send_message", { channel: "C1", text: "hi", api_key: "sk-abcdefghijklmnopqrstuvwxyz", confirm: true });
    const message = p.ask.mock.calls[0][0];
    expect(message).toContain("slack_send_message");
    expect(message).toContain("HIGH");
    expect(message).toContain("C1");
    expect(message).not.toContain("sk-abcdefghijklmnop");
    expect(message).not.toContain("confirm");
  });
});

describe("policy file", () => {
  it("deny blocks a tool even with confirm: true or an accepting operator", async () => {
    writePolicy({ tools: { git_push: "deny" } });
    setOperatorPrompt(prompt("accept"));
    const res = await resolveApproval("git_push", { confirm: true });
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/denied/i);
  });

  it("allow lets a HIGH tool run without a prompt or confirm", async () => {
    writePolicy({ tools: { http_check: "allow", run_command: "allow" } });
    const p = prompt("decline");
    setOperatorPrompt(p);
    expect((await resolveApproval("run_command", {})).allowed).toBe(true);
    expect(p.ask).not.toHaveBeenCalled();
  });

  it("a tool rule beats a level rule", async () => {
    writePolicy({ levels: { HIGH: "deny" }, tools: { git_push: "allow" } });
    expect((await resolveApproval("git_push", {})).allowed).toBe(true);
    expect((await resolveApproval("run_command", { confirm: true })).allowed).toBe(false);
  });

  it("ask on a MEDIUM tool prompts the operator, or needs confirm without elicitation", async () => {
    writePolicy({ tools: { write_file: "ask" } });
    expect((await resolveApproval("write_file", {})).allowed).toBe(false);
    expect((await resolveApproval("write_file", { confirm: true })).allowed).toBe(true);
    setOperatorPrompt(prompt("accept"));
    expect((await resolveApproval("write_file", {})).allowed).toBe(true);
  });

  it("fails closed on invalid JSON: HIGH and DESTRUCTIVE are blocked, READ still runs", async () => {
    writePolicy("{ not json");
    setOperatorPrompt(prompt("accept"));
    const blocked = await resolveApproval("git_push", { confirm: true });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toMatch(/invalid/i);
    expect((await resolveApproval("delete_file", { confirm: true })).allowed).toBe(false);
    expect((await resolveApproval("read_file", {})).allowed).toBe(true);
  });

  it("fails closed on a bad decision value or risk level name", async () => {
    writePolicy({ tools: { git_push: "yes" } });
    expect((await resolveApproval("git_push", { confirm: true })).allowed).toBe(false);
    writePolicy({ levels: { SEVERE: "allow" }, tools: {} });
    expect((await resolveApproval("run_command", { confirm: true })).allowed).toBe(false);
  });
});

describe("tool wrapper", () => {
  const stubs = {
    workspaceCheck: () => ({ allowed: true }),
    activityLogger: () => {},
    receiptEmitter: () => {},
    envRefresher: () => {},
  };

  it("does not call the handler when the operator never answers", async () => {
    setOperatorPrompt(silentPrompt());
    const handler = vi.fn(async () => ({ ok: true }));
    const run = createToolWrapper(stubs)("git_push", handler);
    const res = await run({ confirm: true });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/^Blocked:/);
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the handler after the operator accepts", async () => {
    setOperatorPrompt(prompt("accept"));
    const handler = vi.fn(async () => ({ ok: true }));
    const res = await createToolWrapper(stubs)("git_push", handler)({});
    expect(res.isError).toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("elicitation adapter", () => {
  const lowLevel = (caps, action = "accept") => ({
    getClientCapabilities: () => caps,
    elicitInput: vi.fn(async () => ({ action })),
  });

  it("is supported only when the client declares form elicitation", () => {
    expect(createElicitationPrompt(lowLevel(undefined)).supported()).toBe(false);
    expect(createElicitationPrompt(lowLevel({})).supported()).toBe(false);
    expect(createElicitationPrompt(lowLevel({ elicitation: {} })).supported()).toBe(true);
    expect(createElicitationPrompt(lowLevel({ elicitation: { form: {} } })).supported()).toBe(true);
    expect(createElicitationPrompt(lowLevel({ elicitation: { url: {} } })).supported()).toBe(false);
  });

  it("sends an empty-form request and maps the action", async () => {
    const ll = lowLevel({ elicitation: {} }, "decline");
    const answer = await createElicitationPrompt(ll).ask("Allow?", 1234);
    expect(answer).toBe("decline");
    expect(ll.elicitInput).toHaveBeenCalledWith(
      { message: "Allow?", requestedSchema: { type: "object", properties: {} } },
      { timeout: 1234 }
    );
  });
});
