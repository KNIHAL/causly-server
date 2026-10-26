import { describe, it, expect, vi } from "vitest";
import { PassThrough } from "stream";
import { createTerminal, Cancelled } from "../tools/terminal.js";

const sink = () => {
  const chunks = [];
  return { write: (t) => chunks.push(String(t)), text: () => chunks.join("") };
};

/** A fake keyboard: a stream that claims to be a TTY. */
function keyboard() {
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = vi.fn();
  return input;
}
const type = (input, ...parts) => parts.forEach((p) => input.write(p));
const tick = () => new Promise((r) => setImmediate(r));

describe("piped input", () => {
  it("reads one line per question, across several questions", async () => {
    const input = new PassThrough();
    const out = sink();
    const term = createTerminal({ input, output: out });
    input.write("first\nsecond\r\nthird");
    input.end();
    expect(term.interactive).toBe(false);
    expect(await term.line("a: ")).toBe("first");
    expect(await term.secret("b: ")).toBe("second");
    expect(await term.line("c: ")).toBe("third");
    await expect(term.line("d: ")).rejects.toBeInstanceOf(Cancelled);
    expect(out.text()).toContain("a: ");
    term.close();
  });

  it("waits for a line that arrives later", async () => {
    const input = new PassThrough();
    const term = createTerminal({ input, output: sink() });
    const p = term.line("x: ");
    await tick();
    input.write("late\n");
    expect(await p).toBe("late");
    term.close();
  });

  it("confirm uses the default on Enter and understands y and yes", async () => {
    const input = new PassThrough();
    const term = createTerminal({ input, output: sink() });
    input.write("\ny\nYES\nn\n");
    expect(await term.confirm("ok?", true)).toBe(true);
    expect(await term.confirm("ok?", false)).toBe(true);
    expect(await term.confirm("ok?", false)).toBe(true);
    expect(await term.confirm("ok?", true)).toBe(false);
    term.close();
  });

  it("readPipedLine returns an empty string when nothing was piped", async () => {
    const input = new PassThrough();
    const term = createTerminal({ input, output: sink() });
    input.end();
    expect(await term.readPipedLine()).toBe("");
    term.close();
  });
});

describe("interactive input", () => {
  it("shows stars for a secret and never echoes it", async () => {
    const input = keyboard();
    const out = sink();
    const term = createTerminal({ input, output: out });
    const p = term.secret("Key: ");
    await tick();
    type(input, "sk-secret-123", "\r");
    expect(await p).toBe("sk-secret-123");
    expect(out.text()).not.toContain("secret");
    expect(out.text()).toContain("*************");
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it("echoes normal answers and handles backspace and paste", async () => {
    const input = keyboard();
    const out = sink();
    const term = createTerminal({ input, output: out });
    const p = term.line("Name: ");
    await tick();
    type(input, "abc", "\u007f", "d", "\r");
    expect(await p).toBe("abd");
    const q = term.secret("Pasted: ");
    await tick();
    type(input, "PASTEDVALUE\n");
    expect(await q).toBe("PASTEDVALUE");
  });

  it("ignores arrow keys and control characters", async () => {
    const input = keyboard();
    const term = createTerminal({ input, output: sink() });
    const p = term.line("x: ");
    await tick();
    type(input, "a", "\u001b[A", "\u0001", "b", "\r");
    expect(await p).toBe("ab");
  });

  it("Ctrl+C cancels and restores the terminal", async () => {
    const input = keyboard();
    const term = createTerminal({ input, output: sink() });
    const p = term.secret("Key: ");
    await tick();
    type(input, "abc", "\u0003");
    await expect(p).rejects.toBeInstanceOf(Cancelled);
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it("Ctrl+D cancels only on an empty line", async () => {
    const input = keyboard();
    const term = createTerminal({ input, output: sink() });
    const p = term.line("x: ");
    await tick();
    type(input, "a", "\u0004", "\r");
    expect(await p).toBe("a");
    const q = term.line("y: ");
    await tick();
    type(input, "\u0004");
    await expect(q).rejects.toBeInstanceOf(Cancelled);
  });
});
