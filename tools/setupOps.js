// Logic behind `causly-server setup`, `keys` and `doctor --test`.
// Keys go into one settings file; they are never printed in full, logged, or sent anywhere
// except to the service they belong to (for the live check).
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import os from "os";
import { SERVICES, findService, serviceState, checkService, allNames } from "./services.js";
import { setEnvValue, unsetEnvValue, readEnvValues, describeSecret, isValidName, checkValue } from "./envFile.js";
import { envWritePath } from "./paths.js";

// ---------------------------------------------------------------- setup wizard

async function findTelegramChats(token, fetchFn) {
  const res = await fetchFn(`https://api.telegram.org/bot${token}/getUpdates?limit=50`, { signal: AbortSignal.timeout(10_000) });
  const body = await res.json().catch(() => ({}));
  const seen = new Map();
  for (const u of body.result || []) {
    const chat = u.message?.chat || u.my_chat_member?.chat;
    if (chat?.type === "private") seen.set(chat.id, [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || String(chat.id));
  }
  return [...seen].map(([id, name]) => ({ id: String(id), name }));
}

/**
 * Walk the user through adding keys. Each service: show where to get the key, ask for it
 * (hidden), test it live, and save it only when the test passes (or the user insists).
 */
export async function runSetup({ service, term, env = process.env, file = envWritePath(), fetch: fetchFn = globalThis.fetch, services = SERVICES } = {}) {
  const say = (t = "") => term.write(`${t}\n`);
  const result = { saved: [], saved_untested: [], skipped: [] };

  async function ask(v) {
    const label = v.optional ? `${v.name} (optional${v.note ? `, ${v.note}` : ""}; Enter to skip)` : v.name;
    for (;;) {
      const raw = (await (v.secret ? term.secret(`${label}: `) : term.line(`${label}: `))).trim();
      if (!raw) return "";
      try {
        return checkValue(raw);
      } catch (err) {
        say(`${err.message} Try again.`);
      }
    }
  }

  async function pickChat(token) {
    say("Open Telegram, find your bot and press Start (or send it any message).");
    for (let attempt = 0; attempt < 5; attempt++) {
      await term.line("Press Enter when you have done that: ");
      const chats = await findTelegramChats(token, fetchFn).catch(() => []);
      if (chats.length === 1) {
        if (await term.confirm(`Send alerts to the chat with ${chats[0].name} (id ${chats[0].id})?`)) return chats[0].id;
        return "";
      }
      if (chats.length > 1) {
        chats.forEach((c, i) => say(`  ${i + 1}. ${c.name} (id ${c.id})`));
        const n = Number((await term.line("Which chat? Number, or Enter to skip: ")).trim());
        return chats[n - 1]?.id || "";
      }
      say("The bot has not seen a message yet.");
    }
    return "";
  }

  async function configure(svc) {
    say(`\n== ${svc.name} ==`);
    svc.steps.forEach((s, i) => say(`  ${i + 1}. ${s}`));
    say(`  Link: ${svc.url}\n`);

    const pending = {};
    for (const v of svc.env) {
      if (v.discover) continue;
      if (env[v.name]) {
        const shown = v.secret ? describeSecret(env[v.name]) : `set (${env[v.name]})`;
        if (!(await term.confirm(`${v.name} is already ${shown}. Replace it?`, false))) continue;
      }
      const val = await ask(v);
      if (!val) {
        if (!v.optional) {
          say("Skipped.");
          result.skipped.push(svc.id);
          return;
        }
        continue;
      }
      pending[v.name] = val;
    }

    const merged = { ...env, ...pending };
    // A setting that is found automatically after the key works (Telegram's chat id) is not needed to test the key.
    const missing = serviceState(svc, merged).missing.filter((n) => !svc.env.find((v) => v.name === n)?.discover);
    if (missing.length) {
      say(`Still missing: ${missing.join(", ")}. Nothing saved.`);
      result.skipped.push(svc.id);
      return;
    }

    let untested = false;
    say("Testing...");
    const r = await checkService(svc, merged, { fetch: fetchFn });
    if (r.ok) say(`ok  ${r.detail}`);
    else {
      say(`FAILED: ${r.detail}`);
      const choice = (await term.line("Save anyway (s), enter again (r), or skip (Enter)? ")).trim().toLowerCase();
      if (choice === "r") return configure(svc);
      if (choice !== "s") {
        say("Nothing saved.");
        result.skipped.push(svc.id);
        return;
      }
      untested = true;
    }

    const discoverVar = svc.env.find((v) => v.discover);
    if (r.ok && discoverVar && !merged[discoverVar.name] && svc.id === "telegram") {
      const id = await pickChat(merged.TELEGRAM_BOT_TOKEN);
      if (id) pending[discoverVar.name] = id;
      else say(`No chat chosen. Alerts need ${discoverVar.name}; add it later with: causly-server keys set ${discoverVar.name}`);
    }

    for (const [name, value] of Object.entries(pending)) {
      setEnvValue(file, name, value);
      env[name] = value;
    }
    say(`Saved to ${file}. Running tools pick it up on their next call.`);
    (untested ? result.saved_untested : result.saved).push(svc.id);
  }

  if (service) {
    const svc = findService(service, services);
    if (!svc) throw new Error(`Unknown service "${service}". Choose from: ${services.map((s) => s.id).join(", ")}.`);
    await configure(svc);
    return result;
  }

  say(`Settings file: ${file}`);
  for (;;) {
    say("\nServices:");
    services.forEach((s, i) => {
      const st = serviceState(s, env);
      say(`  ${String(i + 1).padStart(2)}. ${s.name.padEnd(30)} ${st.configured ? "set up" : st.incomplete ? `incomplete (missing ${st.missing.join(", ")})` : "-"}`);
    });
    const answer = (await term.line("\nWhich ones? Numbers separated by commas, or Enter to finish: ")).trim();
    if (!answer) break;
    const picks = [...new Set(answer.split(/[,\s]+/).map(Number))].filter((n) => Number.isInteger(n) && n >= 1 && n <= services.length);
    if (!picks.length) {
      say("Type the numbers from the list, for example: 1,3");
      continue;
    }
    for (const n of picks) await configure(services[n - 1]);
  }
  return result;
}

// ---------------------------------------------------------------- keys

export function keysList({ env = process.env, file = envWritePath(), services = SERVICES } = {}) {
  const known = new Set(allNames(services));
  const rows = [];
  for (const s of services) {
    for (const v of s.env) {
      const value = env[v.name];
      rows.push({
        service: s.id,
        name: v.name,
        optional: Boolean(v.optional),
        secret: Boolean(v.secret),
        status: value ? (v.secret ? describeSecret(value) : `set (${value})`) : v.optional ? "-" : "missing",
      });
    }
  }
  const other = Object.keys(readEnvValues(file)).filter((n) => !known.has(n));
  return { file, rows, other };
}

export function formatKeysList({ file, rows, other }) {
  const lines = [`Settings file: ${file}`, ""];
  let current = "";
  for (const r of rows) {
    if (r.service !== current) {
      current = r.service;
      lines.push(`${current}`);
    }
    lines.push(`  ${r.name.padEnd(26)} ${r.status}${r.optional ? "  (optional)" : ""}`);
  }
  if (other.length) lines.push("", `Other settings in the file: ${other.join(", ")}`);
  return lines.join("\n");
}

export async function keysSet({ name, term, file = envWritePath(), env = process.env, value, launchEnv = {}, services = SERVICES } = {}) {
  if (!name || !isValidName(name)) throw new Error("Give a setting name in capital letters, for example: causly-server keys set TELEGRAM_BOT_TOKEN");
  let v = value;
  if (v === undefined) v = term.interactive ? await term.secret(`${name}: `) : await term.readPipedLine();
  v = checkValue(v);
  const r = setEnvValue(file, name, v);
  env[name] = v;
  const notes = [];
  if (!allNames(services).includes(name) && !name.startsWith("CAUSLY_")) notes.push(`${name} is not a setting this server knows; saved anyway.`);
  if (launchEnv[name] !== undefined && launchEnv[name] !== v) notes.push(`${name} is also set in the environment your editor or terminal starts with, and that value takes priority over this file.`);
  return { name, file, created: r.created, replaced: r.replaced, notes };
}

export function keysUnset({ name, file = envWritePath(), env = process.env, launchEnv = {} } = {}) {
  if (!name || !isValidName(name)) throw new Error("Give a setting name in capital letters, for example: causly-server keys unset TELEGRAM_BOT_TOKEN");
  const removed = unsetEnvValue(file, name);
  if (removed && launchEnv[name] === undefined) delete env[name];
  const notes = launchEnv[name] !== undefined ? [`${name} is still set in the environment your editor or terminal starts with.`] : [];
  return { name, file, removed, notes };
}

/** Open the settings file in an editor, creating it first if needed. */
export function keysOpen({ file = envWritePath(), platform = os.platform(), exec = execFile } = {}) {
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, "# causly-server settings: NAME=value, one per line\n", { mode: 0o600 });
  }
  const [cmd, args] = platform === "win32" ? ["notepad.exe", [file]] : platform === "darwin" ? ["open", ["-t", file]] : ["xdg-open", [file]];
  exec(cmd, args, { windowsHide: false }, () => {});
  return { file, opened_with: cmd };
}

// ---------------------------------------------------------------- doctor --test

/** Live-check every service that has its settings. Incomplete ones are reported, unconfigured ones skipped. */
export async function testConfigured({ env = process.env, fetch: fetchFn = globalThis.fetch, services = SERVICES } = {}) {
  const jobs = [];
  const results = [];
  for (const s of services) {
    const st = serviceState(s, env);
    if (st.configured) jobs.push(checkService(s, env, { fetch: fetchFn }));
    else if (st.incomplete) results.push({ id: s.id, name: s.name, ok: false, detail: `incomplete: missing ${st.missing.join(", ")}` });
  }
  return [...(await Promise.all(jobs)), ...results];
}
