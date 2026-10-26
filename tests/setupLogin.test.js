import { describe, it, expect } from "vitest";
import { runSetup } from "../tools/setupOps.js";

const svc = { id: "gmail", name: "Gmail", login: "gmail", env: [{ name: "GMAIL_REFRESH_TOKEN", secret: true }], steps: ["manual step"], url: "https://example.test", check: async () => ({ detail: "ok" }) };

function term({ interactive = true, confirmAnswer = true } = {}) {
  const out = [];
  return { out, interactive, write: (t) => out.push(t), line: async () => "", secret: async () => "", confirm: async () => confirmAnswer };
}

describe("setup offers the browser sign-in for Google services", () => {
  it("uses the sign-in instead of asking for tokens", async () => {
    const t = term();
    let called;
    const r = await runSetup({ service: "gmail", term: t, env: {}, file: "unused", services: [svc], login: async (o) => ((called = o), { saved: ["gmail"] }) });
    expect(called.targets).toEqual(["gmail"]);
    expect(r.saved).toEqual(["gmail"]);
    expect(t.out.join("")).not.toMatch(/manual step/);
  });

  it("reports a failed sign-in without crashing", async () => {
    const t = term();
    const r = await runSetup({ service: "gmail", term: t, env: {}, file: "unused", services: [svc], login: async () => { throw new Error("denied"); } });
    expect(r.skipped).toEqual(["gmail"]);
    expect(t.out.join("")).toMatch(/Sign-in failed: denied/);
  });

  it("falls back to the manual steps when the user declines", async () => {
    const t = term({ confirmAnswer: false });
    let called = false;
    await runSetup({ service: "gmail", term: t, env: {}, file: "unused", services: [svc], login: async () => ((called = true), { saved: [] }) });
    expect(called).toBe(false);
    expect(t.out.join("")).toMatch(/manual step/);
  });
});
