import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { closeDb } from "../tools/store.js";
import { events } from "../tools/scheduler.js";
import { reminderCreate, reminderList, reminderUpdate, checkDueReminders } from "../tools/reminderOps.js";

const hasSqlite = await import("node:sqlite").then(
  () => true,
  () => false
);

const hoursFromNow = (h) => new Date(Date.now() + h * 3_600_000).toISOString();

describe.skipIf(!hasSqlite)("reminders", () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "causly-reminders-"));
    process.env.CAUSLY_DB_PATH = path.join(dir, "test.db");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    closeDb();
    delete process.env.CAUSLY_DB_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
    events.removeAllListeners();
    vi.restoreAllMocks();
  });

  describe("create", () => {
    it("creates a pending reminder from in_hours", async () => {
      const r = await reminderCreate({ title: "  Follow up with Acme  ", in_hours: 2, note: "proposal sent" });
      expect(r.id).toBe(1);
      expect(r.title).toBe("Follow up with Acme");
      expect(r.status).toBe("pending");
      expect(r.note).toBe("proposal sent");
      const diffMs = Date.parse(r.due_at) - Date.now();
      expect(diffMs).toBeGreaterThan(1.9 * 3_600_000);
      expect(diffMs).toBeLessThan(2.1 * 3_600_000);
    });

    it("normalizes due_at to UTC", async () => {
      const r = await reminderCreate({ title: "x", due_at: "2026-10-25T09:00:00+05:30" });
      expect(r.due_at).toBe("2026-10-25T03:30:00.000Z");
    });

    it("rejects bad input", async () => {
      await expect(reminderCreate({ title: "", in_hours: 1 })).rejects.toThrow(/title/);
      await expect(reminderCreate({ title: "x" })).rejects.toThrow(/due_at/);
      await expect(reminderCreate({ title: "x", due_at: "2026-10-25T09:00:00Z", in_hours: 1 })).rejects.toThrow(/not both/);
      await expect(reminderCreate({ title: "x", due_at: "not a date" })).rejects.toThrow(/valid ISO/);
    });
  });

  describe("list", () => {
    it("lists soonest first and filters by due_only and status", async () => {
      await reminderCreate({ title: "later", due_at: hoursFromNow(5) });
      await reminderCreate({ title: "overdue", due_at: hoursFromNow(-3) });
      await reminderCreate({ title: "soon", due_at: hoursFromNow(1) });

      const all = await reminderList({});
      expect(all.reminders.map((r) => r.title)).toEqual(["overdue", "soon", "later"]);

      const due = await reminderList({ due_only: true });
      expect(due.reminders.map((r) => r.title)).toEqual(["overdue"]);

      await reminderUpdate({ id: all.reminders[0].id, status: "done" });
      expect((await reminderList({})).count).toBe(2);
      expect((await reminderList({ status: "done" })).count).toBe(1);
      expect((await reminderList({ status: "all" })).count).toBe(3);
    });

    it("rejects an unknown status", async () => {
      await expect(reminderList({ status: "nope" })).rejects.toThrow(/status/);
    });
  });

  describe("update", () => {
    it("marks done, snoozes and edits", async () => {
      const { id } = await reminderCreate({ title: "a", in_hours: 1 });
      const snoozed = await reminderUpdate({ id, in_hours: 24, title: "renamed", note: "n" });
      expect(snoozed.title).toBe("renamed");
      expect(snoozed.note).toBe("n");
      expect(Date.parse(snoozed.due_at) - Date.now()).toBeGreaterThan(23 * 3_600_000);
      expect((await reminderUpdate({ id, status: "done" })).status).toBe("done");
    });

    it("rejects unknown ids, empty updates and bad status", async () => {
      const { id } = await reminderCreate({ title: "a", in_hours: 1 });
      await expect(reminderUpdate({ id: 999, status: "done" })).rejects.toThrow(/No reminder/);
      await expect(reminderUpdate({ id })).rejects.toThrow(/Nothing to update/);
      await expect(reminderUpdate({ id, status: "nope" })).rejects.toThrow(/status/);
    });
  });

  describe("due check (scheduler job)", () => {
    it("announces a due reminder once, and again after it is snoozed into the past", async () => {
      const seen = [];
      events.on("reminder.due", (r) => seen.push(r.title));

      const { id } = await reminderCreate({ title: "call Sam", due_at: hoursFromNow(-1) });
      await reminderCreate({ title: "not yet", due_at: hoursFromNow(3) });

      expect(await checkDueReminders()).toBe(1);
      expect(await checkDueReminders()).toBe(0); // already announced
      expect(seen).toEqual(["call Sam"]);

      await reminderUpdate({ id, due_at: hoursFromNow(-0.5) }); // re-arms
      expect(await checkDueReminders()).toBe(1);
      expect(seen).toEqual(["call Sam", "call Sam"]);
    });

    it("does not announce done or cancelled reminders", async () => {
      const { id } = await reminderCreate({ title: "old", due_at: hoursFromNow(-1) });
      await reminderUpdate({ id, status: "cancelled" });
      expect(await checkDueReminders()).toBe(0);
    });
  });
});
