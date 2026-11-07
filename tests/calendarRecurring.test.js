import { describe, it, expect, beforeEach } from "vitest";
import * as cal from "../tools/calendarOps.js";
import { clearTokenCache } from "../tools/googleAuth.js";

const TZ = "Asia/Kolkata";
const NOW = Date.parse("2026-11-06T02:20:00Z");

// ---------------------------------------------------------------- fetch stub
// A small fake Calendar API: it serves the events below and records every call, so each test can
// check exactly which ids were read, changed or deleted and with what body.

function api(events, { instances = [], failOn } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
    }
    const u = new URL(url);
    const call = {
      method: init.method || "GET",
      path: u.pathname.replace("/calendar/v3", ""),
      query: Object.fromEntries(u.searchParams),
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const reply = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
    const m = /^\/calendars\/[^/]+\/events(?:\/([^/]+)(\/instances)?)?$/.exec(call.path);
    const id = m?.[1] && decodeURIComponent(m[1]);
    if (failOn?.(call)) return { ok: false, status: 500, json: async () => ({ error: { message: "boom" } }), text: async () => '{"error":{"message":"boom"}}' };
    if (call.method === "GET" && m?.[2]) return reply({ items: instances });
    if (call.method === "GET") return events[id] ? reply(events[id]) : { ok: false, status: 404, json: async () => ({ error: { message: "Not Found" } }), text: async () => '{"error":{"message":"Not Found"}}' };
    if (call.method === "POST") return reply({ id: "new1", ...call.body });
    if (call.method === "PATCH") return reply({ ...events[id], ...call.body });
    if (call.method === "DELETE") return { ok: true, status: 204, json: async () => ({}), text: async () => "" };
    throw new Error(`unexpected call ${call.method} ${call.path}`);
  };
  return { deps: { fetch, now: () => NOW }, calls };
}

const ist = (s) => ({ dateTime: `${s}+05:30`, timeZone: TZ });
const pathsOf = (calls) => calls.map((c) => `${c.method} ${c.path.replace("/calendars/primary/events", "")}`);

const MASTER = {
  id: "series1",
  summary: "Standup",
  status: "confirmed",
  start: ist("2026-11-02T10:00:00"),
  end: ist("2026-11-02T10:30:00"),
  recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
};
const occurrence = (date, utc, id = `series1_${date.replace(/-/g, "")}T${utc}Z`) => ({
  id,
  summary: "Standup",
  status: "confirmed",
  recurringEventId: "series1",
  originalStartTime: ist(`${date}T10:00:00`),
  start: ist(`${date}T10:00:00`),
  end: ist(`${date}T10:30:00`),
});
const NOV9 = occurrence("2026-11-09", "043000");
const NOV16 = occurrence("2026-11-16", "043000");
const NOV2 = occurrence("2026-11-02", "043000"); // the first occurrence: its start is the series' start

beforeEach(() => {
  clearTokenCache();
  process.env.CALENDAR_REFRESH_TOKEN = "rt";
  process.env.GMAIL_CLIENT_ID = "cid";
  process.env.GMAIL_CLIENT_SECRET = "cs";
  delete process.env.CAUSLY_TIMEZONE;
});

// ---------------------------------------------------------------- issue #42

describe("parseTime rejects dates that do not exist (issue #42)", () => {
  it.each([
    "2026-02-30",
    "2026-02-30T10:00",
    "2026-02-30T10:00:00+05:30",
    "2026-02-30T10:00:00Z",
    "2026-02-29", // 2026 is not a leap year
    "2100-02-29", // a century that is not a leap year
    "2026-04-31",
    "2026-06-31T09:00",
    "2026-11-31",
    "2026-09-31T09:00:00+0530",
    "2026-11-06T10:00:60",
    "2026-13-01",
    "2026-00-10",
    "2026-10-00",
  ])("%s", (value) => {
    expect(() => cal.parseTime(value, TZ, "start")).toThrow(/start must look like/);
  });

  it.each([
    ["2026-02-28", true],
    ["2028-02-29", true], // leap year
    ["2000-02-29", true], // divisible by 400
    ["2026-12-31", true],
    ["2026-04-30T23:59", false],
    ["2026-11-06T10:00:59", false],
    ["2026-01-31T10:00:00+05:30", false],
  ])("still accepts %s", (value, dateOnly) => {
    const r = cal.parseTime(value, TZ, "start");
    expect(Number.isFinite(r.ms)).toBe(true);
    expect(r.dateOnly).toBe(dateOnly);
  });

  it("the local-time and offset forms now agree: both reject the same impossible date", () => {
    expect(() => cal.parseTime("2026-02-30T10:00", TZ)).toThrow();
    expect(() => cal.parseTime("2026-02-30T10:00:00+05:30", TZ)).toThrow();
  });

  it("calendar_create_event refuses 2026-02-30T10:00 and calls nothing", async () => {
    const { deps, calls } = api({});
    await expect(cal.createEvent({ title: "x", start: "2026-02-30T10:00", timezone: TZ }, deps)).rejects.toThrow(/start must look like/);
    expect(calls).toEqual([]);
  });

  it("a date range with an impossible 'from' or 'to' is refused", () => {
    expect(() => cal.resolveRange({ from: "2026-02-30" }, { tz: TZ, now: NOW })).toThrow(/from must look like/);
    expect(() => cal.resolveRange({ from: "2026-02-01", to: "2026-04-31" }, { tz: TZ, now: NOW })).toThrow(/to must look like/);
  });
});

// ---------------------------------------------------------------- scope: validation

describe("scope", () => {
  it("rejects a value other than this, following or all", async () => {
    const { deps, calls } = api({ [NOV9.id]: NOV9 });
    await expect(cal.updateEvent({ event_id: NOV9.id, title: "x", scope: "everything" }, deps)).rejects.toThrow(/scope must be/);
    await expect(cal.deleteEvent({ event_id: NOV9.id, scope: "future" }, deps)).rejects.toThrow(/scope must be/);
    expect(calls).toEqual([]);
  });

  it("a series id cannot be changed as 'this' or 'following', and nothing is sent", async () => {
    for (const scope of ["this", "following"]) {
      const { deps, calls } = api({ series1: MASTER });
      await expect(cal.updateEvent({ event_id: "series1", title: "x", scope }, deps)).rejects.toThrow(/whole recurring series/);
      await expect(cal.deleteEvent({ event_id: "series1", scope }, deps)).rejects.toThrow(/whole recurring series/);
      expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
    }
  });

  it("is ignored for an event that does not repeat", async () => {
    const single = { id: "one", summary: "Lunch", start: ist("2026-11-10T13:00:00"), end: ist("2026-11-10T14:00:00") };
    const { deps, calls } = api({ one: single });
    const r = await cal.deleteEvent({ event_id: "one", scope: "all" }, deps);
    expect(r.deleted).toBe(true);
    expect(r).not.toHaveProperty("scope");
    expect(pathsOf(calls)).toEqual(["GET /one", "DELETE /one"]);
  });
});

// ---------------------------------------------------------------- calendar_update_event

describe("calendar_update_event: scope this", () => {
  it("is the default for an occurrence id, changes only that id, and says how to change more", async () => {
    const { deps, calls } = api({ [NOV9.id]: NOV9 });
    const r = await cal.updateEvent({ event_id: NOV9.id, title: "Standup (moved)" }, deps);
    expect(pathsOf(calls)).toEqual([`GET /${NOV9.id}`, `PATCH /${NOV9.id}`]);
    expect(calls[1].body).toEqual({ summary: "Standup (moved)" });
    expect(r.scope).toBe("this");
    expect(r.note).toMatch(/scope: "all"/);
  });

  it("explicit scope this gives no hint and never reads the series", async () => {
    const { deps, calls } = api({ [NOV9.id]: NOV9 });
    const r = await cal.updateEvent({ event_id: NOV9.id, title: "x", scope: "this" }, deps);
    expect(pathsOf(calls)).toEqual([`GET /${NOV9.id}`, `PATCH /${NOV9.id}`]);
    expect(r).not.toHaveProperty("note");
  });

  it("a new time applies to that occurrence only", async () => {
    const { deps, calls } = api({ [NOV9.id]: NOV9 });
    await cal.updateEvent({ event_id: NOV9.id, start: "2026-11-09T11:00", scope: "this", timezone: TZ }, deps);
    expect(calls[1].body.start.dateTime).toBe("2026-11-09T05:30:00.000Z");
    expect(calls[1].body.end.dateTime).toBe("2026-11-09T06:00:00.000Z"); // keeps the 30 minute length
  });
});

describe("calendar_update_event: scope all", () => {
  it("changes the series event, not the occurrence", async () => {
    const { deps, calls } = api({ [NOV9.id]: NOV9, series1: MASTER });
    const r = await cal.updateEvent({ event_id: NOV9.id, title: "Daily sync", scope: "all" }, deps);
    expect(pathsOf(calls)).toEqual([`GET /${NOV9.id}`, "GET /series1", "PATCH /series1"]);
    expect(calls[2].body).toEqual({ summary: "Daily sync" });
    expect(r.scope).toBe("all");
    expect(r.event.id).toBe("series1");
  });

  it("is the default for a series id (the old behavior), with no extra reads", async () => {
    const { deps, calls } = api({ series1: MASTER });
    const r = await cal.updateEvent({ event_id: "series1", location: "Room 4" }, deps);
    expect(pathsOf(calls)).toEqual(["GET /series1", "PATCH /series1"]);
    expect(r.scope).toBe("all");
  });

  it("moves the whole series by what the occurrence moved by (10:00 to 11:00 on the 9th)", async () => {
    const { deps, calls } = api({ [NOV9.id]: NOV9, series1: MASTER });
    await cal.updateEvent({ event_id: NOV9.id, start: "2026-11-09T11:00", scope: "all", timezone: TZ }, deps);
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch.path).toBe("/calendars/primary/events/series1");
    // the series keeps its own first date (2 Nov); only the time of day moves
    expect(patch.body.start.dateTime).toBe("2026-11-02T05:30:00.000Z"); // 11:00 IST
    expect(patch.body.end.dateTime).toBe("2026-11-02T06:00:00.000Z");
  });

  it("a new length applies to the series", async () => {
    const { deps, calls } = api({ [NOV9.id]: NOV9, series1: MASTER });
    await cal.updateEvent({ event_id: NOV9.id, duration_minutes: 60, scope: "all", timezone: TZ }, deps);
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch.body.start.dateTime).toBe("2026-11-02T04:30:00.000Z"); // unchanged 10:00 IST
    expect(patch.body.end.dateTime).toBe("2026-11-02T05:30:00.000Z");
  });

  it("shifts an all-day series by whole days", async () => {
    const master = { id: "series1", summary: "Offsite", start: { date: "2026-11-02" }, end: { date: "2026-11-03" }, recurrence: ["RRULE:FREQ=WEEKLY"] };
    const occ = { id: "series1_20261109", summary: "Offsite", recurringEventId: "series1", originalStartTime: { date: "2026-11-09" }, start: { date: "2026-11-09" }, end: { date: "2026-11-10" } };
    const { deps, calls } = api({ [occ.id]: occ, series1: master });
    await cal.updateEvent({ event_id: occ.id, start: "2026-11-10", scope: "all", timezone: TZ }, deps);
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch.body.start).toEqual({ date: "2026-11-03" });
    expect(patch.body.end).toEqual({ date: "2026-11-04" });
  });

  it("will not turn a timed series into an all-day one", async () => {
    const { deps, calls } = api({ [NOV9.id]: NOV9, series1: MASTER });
    await expect(cal.updateEvent({ event_id: NOV9.id, start: "2026-11-09", scope: "all", timezone: TZ }, deps)).rejects.toThrow(/all-day/);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });
});

describe("calendar_update_event: scope following", () => {
  it("starts a new series at this occurrence, then ends the old one just before it", async () => {
    const { deps, calls } = api({ [NOV9.id]: NOV9, series1: MASTER });
    const r = await cal.updateEvent({ event_id: NOV9.id, title: "Standup v2", scope: "following" }, deps);

    expect(pathsOf(calls)).toEqual([`GET /${NOV9.id}`, "GET /series1", "POST ", "PATCH /series1"]); // new series first
    const created = calls[2].body;
    expect(created.summary).toBe("Standup v2");
    expect(created.start).toEqual(NOV9.start);
    expect(created.end).toEqual(NOV9.end);
    expect(created.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO"]);

    // 10:00 IST on 9 Nov is 04:30Z; the old series stops one second earlier
    expect(calls[3].body).toEqual({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261109T042959Z"] });
    expect(r.scope).toBe("following");
    expect(r.event.id).toBe("new1");
    expect(r.previous_series_ended).toBe("20261109T042959Z");
  });

  it("keeps the number of remaining occurrences when the series is limited by COUNT", async () => {
    const master = { ...MASTER, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10"] };
    const { deps, calls } = api({ [NOV16.id]: NOV16, series1: master }, { instances: [{ id: "a" }, { id: "b" }] }); // two came before the 16th
    await cal.updateEvent({ event_id: NOV16.id, location: "Room 9", scope: "following" }, deps);

    const lookup = calls.find((c) => c.path.endsWith("/instances"));
    expect(lookup.query.timeMax).toBe("2026-11-16T04:30:00.000Z");
    expect(lookup.query.showDeleted).toBe("true");
    const created = calls.find((c) => c.method === "POST").body;
    expect(created.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=8"]); // 10 - 2
    expect(created.location).toBe("Room 9");
    const ended = calls.find((c) => c.method === "PATCH").body;
    expect(ended.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261116T042959Z"]); // COUNT replaced, never both
  });

  it("moves the new series to the new time", async () => {
    const { deps, calls } = api({ [NOV9.id]: NOV9, series1: MASTER });
    await cal.updateEvent({ event_id: NOV9.id, start: "2026-11-09T15:00", scope: "following", timezone: TZ }, deps);
    const created = calls.find((c) => c.method === "POST").body;
    expect(created.start.dateTime).toBe("2026-11-09T09:30:00.000Z"); // 15:00 IST
    expect(created.end.dateTime).toBe("2026-11-09T10:00:00.000Z");
    // the old series still ends where the old occurrence started, not at the new time
    expect(calls.find((c) => c.method === "PATCH").body.recurrence[0]).toMatch(/UNTIL=20261109T042959Z$/);
  });

  it("from the first occurrence it is the whole series: one PATCH, no new series", async () => {
    const { deps, calls } = api({ [NOV2.id]: NOV2, series1: MASTER });
    const r = await cal.updateEvent({ event_id: NOV2.id, title: "Renamed", scope: "following" }, deps);
    expect(pathsOf(calls)).toEqual([`GET /${NOV2.id}`, "GET /series1", "PATCH /series1"]);
    expect(r.scope).toBe("all");
  });

  it("removes the new series again if the old one cannot be ended", async () => {
    const { deps, calls } = api({ [NOV9.id]: NOV9, series1: MASTER }, { failOn: (c) => c.method === "PATCH" && c.path.endsWith("/series1") });
    await expect(cal.updateEvent({ event_id: NOV9.id, title: "x", scope: "following" }, deps)).rejects.toThrow();
    expect(pathsOf(calls)).toContain("POST ");
    expect(pathsOf(calls)).toContain("DELETE /new1"); // rolled back: no duplicate occurrences left behind
  });

  it("an all-day series is ended with a date, not a time", async () => {
    const master = { id: "series1", summary: "Offsite", start: { date: "2026-11-02" }, end: { date: "2026-11-03" }, recurrence: ["RRULE:FREQ=WEEKLY"] };
    const occ = { id: "series1_20261109", summary: "Offsite", recurringEventId: "series1", originalStartTime: { date: "2026-11-09" }, start: { date: "2026-11-09" }, end: { date: "2026-11-10" } };
    const { deps, calls } = api({ [occ.id]: occ, series1: master });
    await cal.updateEvent({ event_id: occ.id, title: "Offsite 2", scope: "following" }, deps);
    expect(calls.find((c) => c.method === "PATCH").body.recurrence).toEqual(["RRULE:FREQ=WEEKLY;UNTIL=20261108"]);
  });
});

describe("guests on recurring events", () => {
  const guestMaster = { ...MASTER, attendees: [{ email: "a@example.com", responseStatus: "accepted" }] };
  const guestOcc = { ...NOV9, attendees: [{ email: "a@example.com", responseStatus: "accepted" }] };

  it.each(["this", "following", "all"])("scope %s needs confirm: true when there are guests", async (scope) => {
    const { deps, calls } = api({ [guestOcc.id]: guestOcc, series1: guestMaster });
    await expect(cal.updateEvent({ event_id: guestOcc.id, title: "x", scope }, deps)).rejects.toThrow(/confirm: true/);
    expect(calls.some((c) => c.method !== "GET")).toBe(false);
  });

  it("with confirm, the new series carries the guests and everyone is notified", async () => {
    const { deps, calls } = api({ [guestOcc.id]: guestOcc, series1: guestMaster });
    await cal.updateEvent({ event_id: guestOcc.id, title: "x", scope: "following", confirm: true }, deps);
    const created = calls.find((c) => c.method === "POST");
    expect(created.body.attendees).toEqual([{ email: "a@example.com" }]);
    expect(created.query.sendUpdates).toBe("all");
    expect(calls.find((c) => c.method === "PATCH").query.sendUpdates).toBe("all");
  });
});

// ---------------------------------------------------------------- calendar_delete_event

describe("calendar_delete_event", () => {
  it("default for an occurrence id: deletes that occurrence only and says how to delete more", async () => {
    const { deps, calls } = api({ [NOV9.id]: NOV9 });
    const r = await cal.deleteEvent({ event_id: NOV9.id }, deps);
    expect(pathsOf(calls)).toEqual([`GET /${NOV9.id}`, `DELETE /${NOV9.id}`]);
    expect(r).toMatchObject({ deleted: true, scope: "this", title: "Standup" });
    expect(r.note).toMatch(/scope: "all"/);
  });

  it("scope all deletes the series event, found from the occurrence", async () => {
    const { deps, calls } = api({ [NOV9.id]: NOV9, series1: MASTER });
    const r = await cal.deleteEvent({ event_id: NOV9.id, scope: "all" }, deps);
    expect(pathsOf(calls)).toEqual([`GET /${NOV9.id}`, "GET /series1", "DELETE /series1"]);
    expect(r).toMatchObject({ deleted: true, scope: "all" });
  });

  it("a series id deletes the whole series by default (the old behavior)", async () => {
    const { deps, calls } = api({ series1: MASTER });
    const r = await cal.deleteEvent({ event_id: "series1" }, deps);
    expect(pathsOf(calls)).toEqual(["GET /series1", "DELETE /series1"]);
    expect(r.scope).toBe("all");
  });

  it("scope following ends the series before this occurrence and deletes nothing", async () => {
    const { deps, calls } = api({ [NOV9.id]: NOV9, series1: MASTER });
    const r = await cal.deleteEvent({ event_id: NOV9.id, scope: "following" }, deps);
    expect(pathsOf(calls)).toEqual([`GET /${NOV9.id}`, "GET /series1", "PATCH /series1"]);
    expect(calls[2].body).toEqual({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261109T042959Z"] });
    expect(r).toMatchObject({ deleted: true, scope: "following", series_ended: "20261109T042959Z" });
  });

  it("scope following from the first occurrence deletes the whole series", async () => {
    const { deps, calls } = api({ [NOV2.id]: NOV2, series1: MASTER });
    const r = await cal.deleteEvent({ event_id: NOV2.id, scope: "following" }, deps);
    expect(pathsOf(calls)).toEqual([`GET /${NOV2.id}`, "GET /series1", "DELETE /series1"]);
    expect(r.scope).toBe("all");
  });

  it("notifies the guests of the series, not just of the one occurrence", async () => {
    const guests = [{ email: "a@example.com" }];
    const { deps, calls } = api({ [NOV9.id]: { ...NOV9 }, series1: { ...MASTER, attendees: guests } });
    const r = await cal.deleteEvent({ event_id: NOV9.id, scope: "all" }, deps);
    expect(calls.find((c) => c.method === "DELETE").query.sendUpdates).toBe("all");
    expect(r.guests_notified).toBe(true);
  });
});
