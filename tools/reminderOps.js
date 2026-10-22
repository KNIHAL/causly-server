// Reminders and follow-ups, stored locally in SQLite. First consumer of the
// shared store and scheduler. Times are stored as ISO 8601 UTC strings.
import { getDb, registerMigrations } from "./store.js";
import { events, schedule } from "./scheduler.js";

registerMigrations("reminders", [
  `CREATE TABLE reminders (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     title TEXT NOT NULL,
     note TEXT,
     due_at TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'pending',
     notified_at TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE INDEX idx_reminders_status_due ON reminders (status, due_at)`,
  `ALTER TABLE reminders ADD COLUMN deal_id INTEGER`,
  `CREATE INDEX idx_reminders_deal ON reminders (deal_id)`,
]);

const STATUSES = ["pending", "done", "cancelled"];

const plain = (row) => (row ? { ...row } : row);

function resolveDue({ due_at, in_hours }) {
  if (due_at !== undefined && in_hours !== undefined) {
    throw new Error("Pass either due_at or in_hours, not both.");
  }
  if (in_hours !== undefined) {
    if (!Number.isFinite(in_hours)) throw new Error("in_hours must be a number.");
    return new Date(Date.now() + in_hours * 3_600_000).toISOString();
  }
  if (due_at !== undefined) {
    const ms = Date.parse(due_at);
    if (Number.isNaN(ms)) throw new Error(`due_at "${due_at}" is not a valid ISO 8601 date-time.`);
    return new Date(ms).toISOString();
  }
  return undefined;
}

/** Create a reminder. Give due_at (ISO 8601) or in_hours. */
export async function reminderCreate({ title, due_at, in_hours, note, deal_id }) {
  if (deal_id !== undefined && !Number.isInteger(deal_id)) throw new Error("deal_id must be a whole number.");
  if (!title || !title.trim()) throw new Error("title is required.");
  const due = resolveDue({ due_at, in_hours });
  if (!due) throw new Error("Pass due_at (ISO 8601) or in_hours.");
  const db = await getDb();
  const now = new Date().toISOString();
  const { lastInsertRowid } = db
    .prepare(
      "INSERT INTO reminders (title, note, due_at, status, created_at, updated_at, deal_id) VALUES (?, ?, ?, 'pending', ?, ?, ?)"
    )
    .run(title.trim(), note ?? null, due, now, now, deal_id ?? null);
  return plain(db.prepare("SELECT * FROM reminders WHERE id = ?").get(Number(lastInsertRowid)));
}

/** List reminders, soonest first. due_only returns only those whose time has come. */
export async function reminderList({ status = "pending", due_only = false, limit = 50 } = {}) {
  if (status !== "all" && !STATUSES.includes(status)) {
    throw new Error(`status must be one of: ${[...STATUSES, "all"].join(", ")}.`);
  }
  const db = await getDb();
  const now = new Date().toISOString();
  const clauses = [];
  const params = [];
  if (status !== "all") {
    clauses.push("status = ?");
    params.push(status);
  }
  if (due_only) {
    clauses.push("due_at <= ?");
    params.push(now);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const capped = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200);
  const rows = db.prepare(`SELECT * FROM reminders ${where} ORDER BY due_at ASC LIMIT ?`).all(...params, capped);
  return { now, count: rows.length, reminders: rows.map(plain) };
}

/** Mark done/cancelled, snooze (new due_at or in_hours), or edit title/note. */
export async function reminderUpdate({ id, status, due_at, in_hours, title, note }) {
  const db = await getDb();
  const existing = db.prepare("SELECT * FROM reminders WHERE id = ?").get(id);
  if (!existing) throw new Error(`No reminder with id ${id}.`);
  if (status !== undefined && !STATUSES.includes(status)) {
    throw new Error(`status must be one of: ${STATUSES.join(", ")}.`);
  }
  const due = resolveDue({ due_at, in_hours });
  if (status === undefined && due === undefined && title === undefined && note === undefined) {
    throw new Error("Nothing to update: pass status, due_at/in_hours, title or note.");
  }
  // A new time, or reopening, should be able to fire again.
  const rearm = due !== undefined || status === "pending";
  db.prepare("UPDATE reminders SET title = ?, note = ?, status = ?, due_at = ?, notified_at = ?, updated_at = ? WHERE id = ?").run(
    title !== undefined && title.trim() ? title.trim() : existing.title,
    note !== undefined ? note : existing.note,
    status ?? existing.status,
    due ?? existing.due_at,
    rearm ? null : existing.notified_at,
    new Date().toISOString(),
    id
  );
  return plain(db.prepare("SELECT * FROM reminders WHERE id = ?").get(id));
}

/** Scheduler job: announce each pending reminder once when it becomes due. */
export async function checkDueReminders() {
  const db = await getDb();
  const now = new Date().toISOString();
  const due = db
    .prepare("SELECT * FROM reminders WHERE status = 'pending' AND notified_at IS NULL AND due_at <= ? ORDER BY due_at")
    .all(now);
  for (const row of due) {
    db.prepare("UPDATE reminders SET notified_at = ?, updated_at = ? WHERE id = ?").run(now, now, row.id);
    console.error(`causly-server: reminder due: #${row.id} ${row.title}`);
    events.emit("reminder.due", { ...row, notified_at: now });
  }
  return due.length;
}

export function startReminderJob(intervalMs = 60_000) {
  schedule("reminders-due", intervalMs, checkDueReminders);
}
