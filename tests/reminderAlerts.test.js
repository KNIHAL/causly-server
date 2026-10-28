import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { alertsEnabled, reminderText, deliverReminder, ensureReminders, resetReminderAlerts } from "../tools/reminderAlerts.js";
import { events, listJobs, stopScheduler } from "../tools/scheduler.js";
import { getDb, closeDb } from "../tools/store.js";
import { checkDueReminders } from "../tools/reminderOps.js";

const run = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const hasSqlite = await import("node:sqlite").then(
  () => true,
  () => false
);

describe("alert settings and text", () => {
  const on = { TELEGRAM_BOT_TOKEN: "1:abcdef", TELEGRAM_CHAT_ID: "42" };

  it("needs Telegram to be set up, and can be switched off", () => {
    expect(alertsEnabled({})).toBe(false);
    expect(alertsEnabled({ TELEGRAM_BOT_TOKEN: "1:abcdef" })).toBe(false);
    expect(alertsEnabled(on)).toBe(true);
    for (const off of ["off", "false", "0", "NO"]) expect(alertsEnabled({ ...on, CAUSLY_REMINDER_NOTIFY: off })).toBe(false);
    expect(alertsEnabled({ ...on, CAUSLY_REMINDER_NOTIFY: "on" })).toBe(true);
  });

  it("writes a short message with the note and deal when there are any", () => {
    expect(reminderText({ title: "Call Asha" })).toBe("Reminder: Call Asha");
    expect(reminderText({ title: "Send proposal", note: "From meeting: Kickoff", deal_id: 7 })).toBe("Reminder: Send proposal\nFrom meeting: Kickoff\n(deal #7)");
  });
});

describe("deliverReminder", () => {
  const env = { TELEGRAM_BOT_TOKEN: "1:abcdef", TELEGRAM_CHAT_ID: "42" };

  it("sends through Telegram", async () => {
    const notify = vi.fn(async () => ({ sent: true }));
    expect(await deliverReminder({ id: 1, title: "T" }, { env, notify })).toBe(true);
    expect(notify).toHaveBeenCalledWith({ text: "Reminder: T" });
  });

  it("does nothing when alerts are off", async () => {
    const notify = vi.fn();
    expect(await deliverReminder({ id: 1, title: "T" }, { env: {}, notify })).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it("logs and carries on when Telegram fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const notify = async () => {
      throw new Error("network down");
    };
    expect(await deliverReminder({ id: 9, title: "T" }, { env, notify })).toBe(false);
    expect(spy.mock.calls[0][0]).toMatch(/reminder #9.*network down/);
    spy.mockRestore();
  });
});

describe("ensureReminders", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    stopScheduler();
    resetReminderAlerts();
    vi.useRealTimers();
  });

  it("starts the job and the listener once, however many packs ask", () => {
    ensureReminders();
    ensureReminders();
    ensureReminders();
    expect(listJobs()).toEqual(["reminders-due"]);
    expect(events.listenerCount("reminder.due")).toBe(1);
  });
});

describe.skipIf(!hasSqlite)("several processes, one database", () => {
  let dir;
  let db;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "causly-multi-"));
    db = path.join(dir, "shared.db");
    process.env.CAUSLY_DB_PATH = db;
  });
  afterEach(() => {
    closeDb();
    delete process.env.CAUSLY_DB_PATH;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("claims a due reminder once in-process", async () => {
    const d = await getDb();
    d.prepare("INSERT INTO reminders (title, due_at, status, created_at, updated_at) VALUES ('A', '2020-01-01T00:00:00.000Z', 'pending', 'x', 'x')").run();
    const seen = [];
    events.on("reminder.due", (r) => seen.push(r.title));
    expect(await checkDueReminders()).toBe(1);
    expect(await checkDueReminders()).toBe(0);
    events.removeAllListeners("reminder.due");
    expect(seen).toEqual(["A"]);
  });

  it("four real processes racing for 40 due reminders announce each exactly once, with no database-busy errors", async () => {
    const d = await getDb();
    const ins = d.prepare("INSERT INTO reminders (title, due_at, status, created_at, updated_at) VALUES (?, '2020-01-01T00:00:00.000Z', 'pending', 'x', 'x')");
    for (let i = 0; i < 40; i++) ins.run(`R${i}`);
    closeDb();

    const child = `
      import { checkDueReminders } from "./tools/reminderOps.js";
      import { events } from "./tools/scheduler.js";
      import { getDb } from "./tools/store.js";
      const mine = [];
      events.on("reminder.due", (r) => mine.push(r.id));
      const dbh = await getDb();
      // keep writing from this process too, to contend for the write lock
      const noise = dbh.prepare("INSERT INTO reminders (title, due_at, status, created_at, updated_at) VALUES ('noise', '2999-01-01T00:00:00.000Z', 'pending', 'x', 'x')");
      for (let i = 0; i < 25; i++) { noise.run(); await checkDueReminders(); }
      console.log(JSON.stringify(mine));
    `;
    const results = await Promise.all(
      Array.from({ length: 4 }, () => run(process.execPath, ["--input-type=module", "-e", child], { cwd: root, env: { ...process.env, CAUSLY_DB_PATH: db } }))
    );
    const ids = results.flatMap((r) => JSON.parse(r.stdout.trim().split("\n").pop()));
    expect(ids).toHaveLength(40);
    expect(new Set(ids).size).toBe(40);
  }, 60_000);
});
