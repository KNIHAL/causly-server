import { z } from "zod";
import { wrap } from "../tools/toolWrapper.js";
import * as reminderOps from "../tools/reminderOps.js";

export default function register(server) {
  // ---------------- Reminder tools ----------------
  server.registerTool(
    "reminder_create",
    {
      description:
        "Create a reminder or follow-up, saved locally so it survives restarts. Give due_at (ISO 8601) or in_hours.",
      inputSchema: {
        title: z.string().describe("What to remember, e.g. 'Follow up with Acme about the proposal'"),
        due_at: z.string().optional().describe("ISO 8601 date-time, e.g. 2026-10-25T09:00:00+05:30"),
        in_hours: z.number().optional().describe("Alternative to due_at: due this many hours from now"),
        note: z.string().optional(),
      },
    },
    wrap("reminder_create", reminderOps.reminderCreate)
  );

  server.registerTool(
    "reminder_list",
    {
      description:
        "List reminders, soonest first. Use due_only: true to see what needs attention now. Status: pending (default), done, cancelled or all.",
      inputSchema: {
        status: z.string().optional().describe("pending (default), done, cancelled or all"),
        due_only: z.boolean().optional().describe("Only reminders whose time has come"),
        limit: z.number().optional().describe("Max results (default 50, max 200)"),
      },
    },
    wrap("reminder_list", reminderOps.reminderList)
  );

  server.registerTool(
    "reminder_update",
    {
      description:
        "Update a reminder: mark it done or cancelled, snooze it (new due_at or in_hours), or edit its title or note.",
      inputSchema: {
        id: z.number().describe("Reminder id from reminder_list"),
        status: z.string().optional().describe("pending, done or cancelled"),
        due_at: z.string().optional().describe("New ISO 8601 date-time"),
        in_hours: z.number().optional().describe("Snooze: due this many hours from now"),
        title: z.string().optional(),
        note: z.string().optional(),
      },
    },
    wrap("reminder_update", reminderOps.reminderUpdate)
  );

  // Announce reminders when they become due (logs to stderr and emits "reminder.due").
  reminderOps.startReminderJob();
}
