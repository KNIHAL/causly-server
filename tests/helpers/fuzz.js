// P0-10: shared helper for feeding hostile values to every tool argument that reaches a path or a
// shell. Use it when you add a tool that takes a path, a name or a command argument:
//
//   const box = await makeSandbox();
//   for (const { label, value } of FUZZ_VALUES) { ... call the tool with value ... }
//   await expectNoEvaluation(box);
//
// Each tool must, for every value: not evaluate it (the sentinel file is never created), not touch
// anything outside the sandbox workspace, and either succeed or fail with an Error (never crash or
// throw a non-Error).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect } from "vitest";

const isWin = process.platform === "win32";

/** The values every path and command argument is tested with. */
export const FUZZ_VALUES = [
  { label: "single quote", value: "'" },
  { label: "double quote", value: '"' },
  { label: "semicolon", value: ";" },
  { label: "ampersand", value: "&" },
  { label: "pipe", value: "|" },
  { label: "command substitution", value: "$(x)" },
  { label: "backtick", value: "`x`" },
  { label: "percent variable", value: "%PATH%" },
  { label: "newline", value: "a\nb" },
  { label: "very long name", value: "x".repeat(300) },
  { label: "empty string", value: "" },
  { label: "Hindi", value: "नमस्ते" },
  { label: "emoji", value: "🙂" },
  { label: "space inside", value: "two words" },
  { label: "trailing space", value: "trail " },
  { label: "trailing dot", value: "trail." },
  { label: "parent traversal", value: "..\\.." },
  { label: "parent traversal (slash)", value: "../.." },
  { label: "UNC path", value: "\\\\server\\share\\x" },
];

/**
 * Strings that would create `sentinel` if any shell evaluated them (sh, PowerShell and cmd.exe forms).
 * A tool that is safe never creates the file.
 */
export function injectionPayloads(sentinel) {
  const make = `echo x>"${sentinel}"`;
  return [
    { label: "semicolon injection", value: `;${make}` },
    { label: "ampersand injection", value: `&${make}` },
    { label: "pipe injection", value: `|${make}` },
    { label: "substitution injection", value: `$(${make})` },
    { label: "backtick injection", value: `\`${make}\`` },
    { label: "newline injection", value: `\n${make}` },
    { label: "quote break-out (single)", value: `' ; ${make} ; '` },
    { label: "quote break-out (double)", value: `" ; ${make} ; "` },
  ];
}

/** The value if it can be used as a single file name on this OS, otherwise null. */
export function asFileName(value) {
  if (!value || value.length > 200 || value.includes("\0") || /[\\/]/.test(value)) return null;
  if (isWin && (/[<>:"|?*\x00-\x1f]/.test(value) || /[ .]$/.test(value))) return null;
  return value;
}

/** A sandbox: base/ws (the workspace), base/outside (must never change) and base/sentinel (must never appear). */
export async function makeSandbox() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "causly-fuzz-"));
  const ws = path.join(base, "ws");
  const outside = path.join(base, "outside");
  await fs.mkdir(ws);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "keep.txt"), "keep");
  const sentinel = path.join(base, "SENTINEL-evaluated.txt");
  const before = await snapshot(outside);
  return {
    base,
    ws,
    outside,
    sentinel,
    before,
    cleanup: () => fs.rm(base, { recursive: true, force: true }),
  };
}

/** A sorted list of every path under dir, with file sizes. */
export async function snapshot(dir) {
  const out = [];
  async function walk(d, rel) {
    for (const entry of await fs.readdir(d, { withFileTypes: true })) {
      const r = path.join(rel, entry.name);
      if (entry.isDirectory()) {
        out.push(`${r}/`);
        await walk(path.join(d, entry.name), r);
      } else {
        out.push(`${r}:${(await fs.stat(path.join(d, entry.name))).size}`);
      }
    }
  }
  await walk(dir, "");
  return out.sort();
}

/** Runs fn. Returns { ok, value } or { ok: false, error }. Anything thrown that is not an Error fails the test. */
export async function attempt(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    expect(err instanceof Error, `a non-Error was thrown: ${String(err)}`).toBe(true);
    return { ok: false, error: err };
  }
}

/** Nothing was evaluated and nothing outside the workspace changed. */
export async function expectNoEvaluation(box) {
  const evaluated = await fs.access(box.sentinel).then(() => true, () => false);
  expect(evaluated, "a value was evaluated by a shell (sentinel file exists)").toBe(false);
  expect(await snapshot(box.outside), "something outside the workspace changed").toEqual(box.before);
}
