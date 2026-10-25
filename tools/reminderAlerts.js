// Makes due reminders reach the user.
//
// The reminder job (every minute, while a server process is running) marks a reminder as announced
// and emits "reminder.due". This module starts that job and, when Telegram is set up, sends the
// reminder to the owner's chat. Several processes (Claude, Cursor, a custom agent) can run at once:
// the reminder is claimed atomically in the database, so exactly one of them announces it.
//
// Turn off the Telegram message with CAUSLY_REMINDER_NOTIFY=off.
import { events, runJob } from "./scheduler.js";
import { startReminderJob } from "./reminderOps.js";
import * as telegramOps from "./telegramOps.js";

let started = false;

export const alertsEnabled = (env = process.env) => !/^(off|false|0|no)$/i.test(env.CAUSLY_REMINDER_NOTIFY || "") && Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);

export function reminderText(row) {
  return [`Reminder: ${row.title}`, row.note || null, row.deal_id ? `(deal #${row.deal_id})` : null].filter(Boolean).join("\n");
}

/** Send one due reminder. Never throws: a failed message must not stop the job. */
export async function deliverReminder(row, deps = {}) {
  const env = deps.env ?? process.env;
  if (!alertsEnabled(env)) return false;
  try {
    await (deps.notify ?? telegramOps.notify)({ text: reminderText(row) });
    return true;
  } catch (err) {
    console.error(`causly-server: could not send reminder #${row.id} to Telegram: ${err.message}`);
    return false;
  }
}

/** Start the reminder job once per process, and announce anything already overdue shortly after start. */
export function ensureReminders() {
  if (started) return;
  started = true;
  startReminderJob();
  events.on("reminder.due", (row) => void deliverReminder(row));
  const first = setTimeout(() => void runJob("reminders-due"), 3000);
  first.unref?.();
}

/** For tests. */
export function resetReminderAlerts() {
  started = false;
  events.removeAllListeners("reminder.due");
}
