// Reading and editing the settings (.env) file without disturbing anything else in it.
// Used by `causly-server keys` and `causly-server setup`. Values are never logged here.
import fs from "fs";
import os from "os";
import path from "path";

const NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
export const isValidName = (n) => NAME.test(String(n));

const stripQuotes = (v) => ((v.startsWith('"') && v.endsWith('"') && v.length > 1) || (v.startsWith("'") && v.endsWith("'") && v.length > 1) ? v.slice(1, -1) : v);

/** { NAME: value } from the active (uncommented) lines of a .env file. Missing file gives {}. */
export function readEnvValues(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key) out[key] = stripQuotes(line.slice(eq + 1).trim());
  }
  return out;
}

/** Trim and validate a pasted value. Throws a plain message if it cannot be stored safely. */
export function checkValue(value) {
  const v = String(value ?? "").trim();
  if (!v) throw new Error("The value is empty.");
  if (/[\r\n]/.test(v)) throw new Error("The value has a line break in it. Paste just the key.");
  if (v.length > 4096) throw new Error("The value is too long (4096 characters at most).");
  if (/^["']|["']$/.test(v)) throw new Error("The value starts or ends with a quote mark. Paste it without quotes.");
  return v;
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
  if (os.platform() !== "win32") fs.chmodSync(file, 0o600); // keys are for the owner only
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Set NAME=value: replace the active line, else fill in a "# NAME=" placeholder, else append. */
export function setEnvValue(file, name, value) {
  if (!isValidName(name)) throw new Error(`"${name}" is not a valid setting name (capital letters, digits and underscores).`);
  const v = checkValue(value);
  const existed = fs.existsSync(file);
  const text = existed ? fs.readFileSync(file, "utf8") : "";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text === "" ? [] : text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop(); // the split leaves one empty item after a final newline
  const active = new RegExp(`^\\s*${escapeRe(name)}\\s*=`);
  const placeholder = new RegExp(`^\\s*#\\s*${escapeRe(name)}\\s*=`);
  let at = lines.findIndex((l) => active.test(l));
  const replaced = at !== -1;
  if (at === -1) at = lines.findIndex((l) => placeholder.test(l));
  const line = `${name}=${v}`;
  if (at !== -1) lines[at] = line;
  else {
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push(line);
  }
  writeAtomic(file, `${lines.join(eol)}${eol}`);
  return { created: !existed, replaced };
}

/** Remove NAME from the file (every active line for it). Returns whether anything was removed. */
export function unsetEnvValue(file, name) {
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const active = new RegExp(`^\\s*${escapeRe(name)}\\s*=`);
  const lines = text.split(/\r?\n/);
  const kept = lines.filter((l) => !active.test(l));
  if (kept.length === lines.length) return false;
  writeAtomic(file, kept.join(eol));
  return true;
}

/** "set (…ab12)" for a secret long enough to hint at, "set" otherwise. Never the whole value. */
export function describeSecret(value) {
  const v = String(value ?? "");
  if (!v) return "missing";
  return v.length >= 12 ? `set (…${v.slice(-4)})` : "set";
}
