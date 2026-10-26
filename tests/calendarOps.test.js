import { describe, it, expect, beforeEach } from "vitest";
import * as cal from "../tools/calendarOps.js";
import { clearTokenCache } from "../tools/googleAuth.js";

const TZ = "Asia/Kolkata";
const NOW = Date.parse("2026-10-23T02:20:00Z"); // Fri 07:50 IST
const ist = (s) => Date.parse(`${s}+05:30`);

/** fetch stub: token endpoint plus a handler for Calendar calls. Records every API call. */
function stub(handler) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
    }
    const u = new URL(url);
    const call = { method: init.method || "GET", path: u.pathname.replace("/calendar/v3", ""), query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const out = await handler(call);
    if (out === null) return { ok: true, status: 204, json: async () => ({}) };
    if (out?.__status) return { ok: false, status: out.__status, json: async () => ({ error: { message: out.message || "x" } }) };
    return { ok: true, status: 200, json: async () => out };
  };
  return { deps: { fetch, now: () => NOW }, calls };
}

beforeEach(() => {
  clearTokenCache();
  process.env.CALENDAR_REFRESH_TOKEN = "rt";
  process.env.GMAIL_CLIENT_ID = "cid";
  process.env.GMAIL_CLIENT_SECRET = "cs";
  delete process.env.CAUSLY_TIMEZONE;
});

describe("calendarOps — time helpers", () => {
  it("knows timezone offsets", () => {
    expect(cal.tzOffsetMs(TZ, NOW)).toBe(19_800_000);
    expect(cal.tzOffsetMs("America/New_York", NOW)).toBe(-4 * 3_600_000);
    expect(cal.tzOffsetMs("UTC", NOW)).toBe(0);
  });

  it("rejects an unknown timezone", () => {
    expect(() => cal.checkTimezone("Mars/Base")).toThrow(/Unknown timezone/);
  });

  it("parses date-only, local and offset times", () => {
    expect(cal.parseTime("2026-10-23", TZ)).toEqual({ ms: ist("2026-10-23T00:00:00"), dateOnly: true });
    expect(cal.parseTime("2026-10-23T15:00", TZ).ms).toBe(ist("2026-10-23T15:00:00"));
    expect(cal.parseTime("2026-10-23T15:00:00Z", TZ).ms).toBe(Date.parse("2026-10-23T15:00:00Z"));
    expect(cal.parseTime("2026-10-23T09:00:00+0100", TZ).ms).toBe(Date.parse("2026-10-23T09:00:00+01:00"));
  });

  it("rejects bad times", () => {
    expect(() => cal.parseTime("tomorrow", TZ)).toThrow(/must look like/);
    expect(() => cal.parseTime("2026-13-01", TZ)).toThrow(/must look like/);
    expect(() => cal.parseTime("2026-10-23T25:00", TZ)).toThrow(/must look like/);
  });

  it("formats local ISO with offset", () => {
    expect(cal.toLocalISO(ist("2026-10-23T15:00:00"), TZ)).toBe("2026-10-23T15:00:00+05:30");
  });

  it("resolves today, tomorrow and next_7_days in the user's zone", () => {
    const today = cal.resolveRange({ when: "today" }, { tz: TZ, now: NOW });
    expect(today.start).toBe(ist("2026-10-23T00:00:00"));
    expect(today.end).toBe(ist("2026-10-24T00:00:00"));
    const tomorrow = cal.resolveRange({ when: "tomorrow" }, { tz: TZ, now: NOW });
    expect(tomorrow.start).toBe(ist("2026-10-24T00:00:00"));
    const week = cal.resolveRange({ when: "next_7_days" }, { tz: TZ, now: NOW });
    expect(week).toEqual({ start: NOW, end: NOW + 7 * 86_400_000 });
  });

  it("treats a bare 'to' date as through the end of that day", () => {
    const r = cal.resolveRange({ from: "2026-10-26", to: "2026-10-27" }, { tz: TZ, now: NOW });
    expect(r.end).toBe(ist("2026-10-28T00:00:00"));
  });

  it("rejects a range that ends before it starts", () => {
    expect(() => cal.resolveRange({ from: "2026-10-27T10:00", to: "2026-10-27T09:00" }, { tz: TZ, now: NOW })).toThrow(/after its start/);
  });
});

describe("calendarOps — freeWindows", () => {
  const base = { tz: TZ, workStart: [9, 0], workEnd: [18, 0], minMs: 30 * 60_000 };

  it("splits the working day around busy blocks and merges overlaps", () => {
    const w = cal.freeWindows({
      ...base,
      start: ist("2026-10-23T00:00:00"),
      end: ist("2026-10-24T00:00:00"),
      busy: [
        { start: ist("2026-10-23T10:00:00"), end: ist("2026-10-23T11:00:00") },
        { start: ist("2026-10-23T10:30:00"), end: ist("2026-10-23T12:00:00") },
      ],
    });
    expect(w).toEqual([
      { start: ist("2026-10-23T09:00:00"), end: ist("2026-10-23T10:00:00") },
      { start: ist("2026-10-23T12:00:00"), end: ist("2026-10-23T18:00:00") },
    ]);
  });

  it("drops gaps shorter than the meeting", () => {
    const w = cal.freeWindows({
      ...base,
      minMs: 60 * 60_000,
      start: ist("2026-10-23T00:00:00"),
      end: ist("2026-10-24T00:00:00"),
      busy: [{ start: ist("2026-10-23T09:30:00"), end: ist("2026-10-23T18:00:00") }],
    });
    expect(w).toEqual([]);
  });

  it("skips weekends unless asked", () => {
    const range = { start: ist("2026-10-24T00:00:00"), end: ist("2026-10-26T00:00:00"), busy: [] }; // Sat+Sun
    expect(cal.freeWindows({ ...base, ...range })).toEqual([]);
    expect(cal.freeWindows({ ...base, ...range, weekdaysOnly: false })).toHaveLength(2);
  });

  it("never starts before the range start", () => {
    const w = cal.freeWindows({ ...base, start: ist("2026-10-23T14:07:00"), end: ist("2026-10-24T00:00:00"), busy: [] });
    expect(w[0].start).toBe(ist("2026-10-23T14:07:00"));
  });
});

describe("calendarOps — credentials", () => {
  it("explains what is missing", async () => {
    delete process.env.CALENDAR_REFRESH_TOKEN;
    const { deps } = stub(() => ({}));
    await expect(cal.listCalendars({}, deps)).rejects.toThrow(/CALENDAR_REFRESH_TOKEN/);
  });

  it("maps a 403 to a scope hint", async () => {
    const { deps } = stub(() => ({ __status: 403, message: "insufficient" }));
    await expect(cal.listCalendars({}, deps)).rejects.toThrow(/calendar\.events and calendar\.readonly/);
  });

  it("maps a 404 to a clear message", async () => {
    const { deps } = stub(() => ({ __status: 404 }));
    await expect(cal.getEvent({ event_id: "nope" }, deps)).rejects.toThrow(/Not found/);
  });
});

describe("calendarOps — reads", () => {
  it("lists calendars", async () => {
    const { deps } = stub(() => ({ items: [{ id: "me@x.com", summary: "Me", primary: true, accessRole: "owner", timeZone: TZ }] }));
    const r = await cal.listCalendars({}, deps);
    expect(r.calendars).toEqual([{ id: "me@x.com", name: "Me", primary: true, access: "owner", timezone: TZ }]);
  });

  it("lists today's events with the right window and drops cancelled ones", async () => {
    const { deps, calls } = stub(() => ({
      items: [
        { id: "a", summary: "Standup", status: "confirmed", start: { dateTime: "2026-10-23T10:00:00+05:30" }, end: { dateTime: "2026-10-23T10:15:00+05:30" } },
        { id: "b", summary: "Gone", status: "cancelled", start: { dateTime: "2026-10-23T11:00:00+05:30" }, end: { dateTime: "2026-10-23T11:30:00+05:30" } },
        { id: "c", summary: "Holiday", status: "confirmed", start: { date: "2026-10-23" }, end: { date: "2026-10-24" } },
      ],
    }));
    const r = await cal.listEvents({ when: "today", timezone: TZ }, deps);
    expect(calls[0].query.timeMin).toBe("2026-10-22T18:30:00.000Z");
    expect(calls[0].query.timeMax).toBe("2026-10-23T18:30:00.000Z");
    expect(calls[0].query.singleEvents).toBe("true");
    expect(r.count).toBe(2);
    expect(r.events[0].title).toBe("Standup");
    expect(r.events[1].all_day).toBe(true);
    expect(r.range.start).toBe("2026-10-23T00:00:00+05:30");
  });

  it("encodes calendar ids in the path", async () => {
    const { deps, calls } = stub(() => ({ items: [] }));
    await cal.listEvents({ calendar_id: "team@group.calendar.google.com", timezone: TZ }, deps);
    expect(calls[0].path).toBe("/calendars/team%40group.calendar.google.com/events");
  });

  it("reports busy times in local ISO and flags unreadable calendars", async () => {
    const { deps, calls } = stub(() => ({
      calendars: {
        primary: { busy: [{ start: "2026-10-23T04:30:00Z", end: "2026-10-23T05:30:00Z" }] },
        "lead@x.com": { errors: [{ reason: "notFound" }] },
      },
    }));
    const r = await cal.freeBusy({ when: "today", attendees: ["Lead@x.com"], timezone: TZ }, deps);
    expect(calls[0].body.items).toEqual([{ id: "primary" }, { id: "lead@x.com" }]);
    expect(r.calendars[0].busy).toEqual([{ start: "2026-10-23T10:00:00+05:30", end: "2026-10-23T11:00:00+05:30" }]);
    expect(r.calendars[1].not_readable).toEqual(["notFound"]);
  });

  it("rejects an invalid attendee email", async () => {
    const { deps } = stub(() => ({}));
    await expect(cal.freeBusy({ attendees: ["not-an-email"], timezone: TZ }, deps)).rejects.toThrow(/not a valid email/);
  });
});

describe("calendarOps — find slots", () => {
  it("offers free windows, never in the past, and warns on unreadable guests", async () => {
    const { deps } = stub(() => ({
      calendars: {
        primary: { busy: [{ start: "2026-10-23T06:30:00Z", end: "2026-10-23T07:30:00Z" }] }, // 12:00-13:00 IST
        "lead@x.com": { errors: [{ reason: "notFound" }] },
      },
    }));
    const r = await cal.findSlots({ when: "today", attendees: ["lead@x.com"], duration_minutes: 60, timezone: TZ }, deps);
    // now = 07:50 IST, rounded up to 08:00; work starts 09:00
    expect(r.free_windows[0].start).toBe("2026-10-23T09:00:00+05:30");
    expect(r.free_windows[0].end).toBe("2026-10-23T12:00:00+05:30");
    expect(r.free_windows[1].start).toBe("2026-10-23T13:00:00+05:30");
    expect(r.warning).toMatch(/lead@x.com/);
    expect(r.checked).toEqual(["primary"]);
  });

  it("validates working hours", async () => {
    const { deps } = stub(() => ({}));
    await expect(cal.findSlots({ work_start: "9am", timezone: TZ }, deps)).rejects.toThrow(/work_start/);
    await expect(cal.findSlots({ work_start: "18:00", work_end: "09:00", timezone: TZ }, deps)).rejects.toThrow(/after work_start/);
  });
});

describe("calendarOps — create", () => {
  it("creates a private event without emailing anyone", async () => {
    const { deps, calls } = stub((c) => (c.method === "GET" ? { items: [] } : { id: "e1", summary: "Focus", start: { dateTime: "x" }, end: { dateTime: "y" } }));
    const r = await cal.createEvent({ title: "Focus", start: "2026-10-23T15:00", duration_minutes: 45, timezone: TZ }, deps);
    const post = calls.find((c) => c.method === "POST");
    expect(post.query.sendUpdates).toBe("none");
    expect(post.body.start).toEqual({ dateTime: "2026-10-23T09:30:00.000Z", timeZone: TZ });
    expect(post.body.end).toEqual({ dateTime: "2026-10-23T10:15:00.000Z", timeZone: TZ });
    expect(r.created).toBe(true);
    expect(r.invited).toBe(0);
  });

  it("refuses to invite people without confirm and makes no API call", async () => {
    const { deps, calls } = stub(() => ({}));
    await expect(cal.createEvent({ title: "Intro", start: "2026-10-23T15:00", attendees: ["lead@x.com"], timezone: TZ }, deps)).rejects.toThrow(/confirm: true/);
    expect(calls).toHaveLength(0);
  });

  it("invites guests and adds Meet when confirmed", async () => {
    const { deps, calls } = stub((c) => (c.method === "GET" ? { items: [] } : { id: "e2", summary: "Intro" }));
    const r = await cal.createEvent(
      { title: "Intro", start: "2026-10-23T15:00", attendees: ["Lead@X.com", "lead@x.com"], add_meet_link: true, timezone: TZ, confirm: true },
      deps
    );
    const post = calls.find((c) => c.method === "POST");
    expect(post.query.sendUpdates).toBe("all");
    expect(post.query.conferenceDataVersion).toBe("1");
    expect(post.body.attendees).toEqual([{ email: "lead@x.com" }]);
    expect(post.body.conferenceData.createRequest.conferenceSolutionKey.type).toBe("hangoutsMeet");
    expect(r.invited).toBe(1);
  });

  it("creates whole-day events with an exclusive end date", async () => {
    const { deps, calls } = stub(() => ({ id: "e3", summary: "Off" }));
    await cal.createEvent({ title: "Off", start: "2026-10-27", end: "2026-10-28", timezone: TZ }, deps);
    const post = calls.find((c) => c.method === "POST");
    expect(post.body.start).toEqual({ date: "2026-10-27" });
    expect(post.body.end).toEqual({ date: "2026-10-29" });
  });

  it("warns about overlaps but still creates", async () => {
    const { deps } = stub((c) =>
      c.method === "GET"
        ? { items: [{ summary: "Existing", status: "confirmed", start: { dateTime: "2026-10-23T15:00:00+05:30" }, end: { dateTime: "2026-10-23T16:00:00+05:30" } }] }
        : { id: "e4", summary: "New" }
    );
    const r = await cal.createEvent({ title: "New", start: "2026-10-23T15:30", timezone: TZ }, deps);
    expect(r.overlaps_with).toEqual([{ title: "Existing", start: "2026-10-23T15:00:00+05:30", end: "2026-10-23T16:00:00+05:30" }]);
  });

  it("validates title, start and ordering", async () => {
    const { deps } = stub(() => ({}));
    await expect(cal.createEvent({ start: "2026-10-23T15:00", timezone: TZ }, deps)).rejects.toThrow(/title/);
    await expect(cal.createEvent({ title: "x", timezone: TZ }, deps)).rejects.toThrow(/start/);
    await expect(cal.createEvent({ title: "x", start: "2026-10-23T15:00", end: "2026-10-23T14:00", timezone: TZ }, deps)).rejects.toThrow(/end after it starts/);
    await expect(cal.createEvent({ title: "x", start: "2026-10-23", end: "2026-10-24T10:00", timezone: TZ }, deps)).rejects.toThrow(/must be a date/);
  });
});

describe("calendarOps — update and delete", () => {
  const solo = { id: "e1", summary: "Focus", start: { dateTime: "2026-10-23T15:00:00+05:30" }, end: { dateTime: "2026-10-23T16:00:00+05:30" } };
  const withGuest = { ...solo, attendees: [{ email: "me@x.com", self: true }, { email: "lead@x.com" }] };

  it("moving only the start keeps the length", async () => {
    const { deps, calls } = stub((c) => (c.method === "GET" ? solo : { ...solo, id: "e1" }));
    await cal.updateEvent({ event_id: "e1", start: "2026-10-23T17:00", timezone: TZ }, deps);
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch.body.start.dateTime).toBe("2026-10-23T11:30:00.000Z");
    expect(patch.body.end.dateTime).toBe("2026-10-23T12:30:00.000Z");
    expect(patch.query.sendUpdates).toBe("none");
  });

  it("changing only the end keeps the start", async () => {
    const { deps, calls } = stub((c) => (c.method === "GET" ? solo : solo));
    await cal.updateEvent({ event_id: "e1", end: "2026-10-23T15:30", timezone: TZ }, deps);
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch.body.start.dateTime).toBe("2026-10-23T09:30:00.000Z");
    expect(patch.body.end.dateTime).toBe("2026-10-23T10:00:00.000Z");
  });

  it("an explicit duration wins over the old length", async () => {
    const { deps, calls } = stub(() => solo);
    await cal.updateEvent({ event_id: "e1", duration_minutes: 15, timezone: TZ }, deps);
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch.body.end.dateTime).toBe("2026-10-23T09:45:00.000Z");
  });

  it("requires confirm when the event has guests, and sends no PATCH", async () => {
    const { deps, calls } = stub(() => withGuest);
    await expect(cal.updateEvent({ event_id: "e1", title: "New title", timezone: TZ }, deps)).rejects.toThrow(/confirm: true/);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("notifies guests when confirmed and merges new attendees without duplicates", async () => {
    const { deps, calls } = stub(() => withGuest);
    await cal.updateEvent({ event_id: "e1", add_attendees: ["lead@x.com", "new@x.com"], timezone: TZ, confirm: true }, deps);
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch.query.sendUpdates).toBe("all");
    expect(patch.body.attendees.map((a) => a.email)).toEqual(["me@x.com", "lead@x.com", "new@x.com"]);
  });

  it("errors when there is nothing to change", async () => {
    const { deps } = stub(() => solo);
    await expect(cal.updateEvent({ event_id: "e1", timezone: TZ }, deps)).rejects.toThrow(/Nothing to change/);
  });

  it("deletes an event and reports guest notification", async () => {
    const { deps, calls } = stub((c) => (c.method === "GET" ? withGuest : null));
    const r = await cal.deleteEvent({ event_id: "e1" }, deps);
    const del = calls.find((c) => c.method === "DELETE");
    expect(del.query.sendUpdates).toBe("all");
    expect(r).toMatchObject({ deleted: true, title: "Focus", guests_notified: true });
  });

  it("deletes a solo event quietly", async () => {
    const { deps, calls } = stub((c) => (c.method === "GET" ? solo : null));
    const r = await cal.deleteEvent({ event_id: "e1" }, deps);
    expect(calls.find((c) => c.method === "DELETE").query.sendUpdates).toBe("none");
    expect(r.guests_notified).toBeUndefined();
  });
});
