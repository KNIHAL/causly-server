// Small interactive prompts for `causly-server setup` and `keys set`.
// In a real terminal: raw key input, so a pasted secret shows as * and never echoes.
// Piped input (scripts, CI): plain lines, so `echo $KEY | causly-server keys set NAME` works.

export class Cancelled extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "Cancelled";
  }
}

export function createTerminal({ input = process.stdin, output = process.stdout } = {}) {
  const tty = Boolean(input.isTTY && typeof input.setRawMode === "function");

  // ---- non-interactive: queue of lines
  const queue = [];
  const waiters = [];
  let ended = false;
  let pending = "";
  const pushLine = (line) => {
    const w = waiters.shift();
    if (w) w(line);
    else queue.push(line);
  };
  const onData = (chunk) => {
    pending += chunk;
    let i;
    while ((i = pending.search(/\r?\n/)) !== -1) {
      pushLine(pending.slice(0, i));
      pending = pending.slice(pending.indexOf("\n", i) + 1);
    }
  };
  const onEnd = () => {
    ended = true;
    if (pending) pushLine(pending);
    pending = "";
    while (waiters.length) waiters.shift()(null);
  };
  let piped = false;
  const startPiped = () => {
    if (piped) return;
    piped = true;
    input.setEncoding?.("utf8");
    input.on("data", onData);
    input.on("end", onEnd);
    input.resume?.();
  };
  const nextLine = () => {
    startPiped();
    if (queue.length) return Promise.resolve(queue.shift());
    if (ended) return Promise.resolve(null);
    return new Promise((resolve) => waiters.push(resolve));
  };

  // ---- interactive: one raw-mode read
  const readRaw = (secret) =>
    new Promise((resolve, reject) => {
      let value = "";
      input.setRawMode(true);
      input.setEncoding?.("utf8");
      input.resume();
      const finish = (fn, arg) => {
        input.removeListener("data", onKey);
        input.setRawMode(false);
        input.pause?.();
        output.write("\n");
        fn(arg);
      };
      const onKey = (chunk) => {
        const s = String(chunk);
        if (s.startsWith("\u001b")) return; // arrow keys and other escape sequences
        for (const ch of s) {
          if (ch === "\r" || ch === "\n") return finish(resolve, value);
          if (ch === "\u0003") return finish(reject, new Cancelled()); // Ctrl+C
          if (ch === "\u0004" && !value) return finish(reject, new Cancelled()); // Ctrl+D on an empty line
          if (ch === "\u007f" || ch === "\b") {
            if (value) {
              value = value.slice(0, -1);
              output.write("\b \b");
            }
            continue;
          }
          if (ch < " ") continue;
          value += ch;
          output.write(secret ? "*" : ch);
        }
      };
      input.on("data", onKey);
    });

  const ask = async (question, { secret = false } = {}) => {
    output.write(question);
    if (tty) return readRaw(secret);
    const line = await nextLine();
    output.write("\n");
    if (line === null) throw new Cancelled();
    return line;
  };

  return {
    interactive: tty,
    write: (text) => output.write(text),
    line: (question) => ask(question),
    secret: (question) => ask(question, { secret: true }),
    /** Yes/no. Enter picks the default. */
    async confirm(question, defaultYes = true) {
      const a = (await ask(`${question} ${defaultYes ? "(Y/n) " : "(y/N) "}`)).trim().toLowerCase();
      if (!a) return defaultYes;
      return a === "y" || a === "yes";
    },
    /** Reads whatever is piped in (first line), for `keys set` in scripts. */
    async readPipedLine() {
      const line = await nextLine();
      return line === null ? "" : line;
    },
    close() {
      if (piped) {
        input.removeListener("data", onData);
        input.removeListener("end", onEnd);
        input.pause?.();
      }
    },
  };
}
