// Google Calendar tools. No new dependencies: Calendar REST API v3 over fetch.
//
//   calendar_list_calendars  calendars this account can see
//   calendar_list_events     events in a range (today, tomorrow, next 7 days, or exact dates)
//   calendar_get_event       one event in full
//   calendar_free_busy       busy blocks for one or more calendars
//   calendar_find_slots      free meeting slots inside working hours
//   calendar_create_event    create an event (inviting people needs confirm: true)
//   calendar_update_event    change an event (events with guests need confirm: true)
//   calendar_delete_event    delete an event (DESTRUCTIVE)
//
// Credentials: CALENDAR_REFRESH_TOKEN plus the OAuth client from CALENDAR_CLIENT_ID /
// CALENDAR_CLIENT_SECRET (or the GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET of the same client).
// The refresh token needs the calendar.events and calendar.readonly scopes.
//
// Timezone: pass `timezone` (IANA name, e.g. Asia/Kolkata), or set CAUSLY_TIMEZONE,
// otherwise the machine's timezone is used. Times without an offset are read in that zone.
import crypto from "crypto";
import { googleCredentials, getAccessToken } from "./googleAuth.js";
import { UNTRUSTED_NOTICE } from "./webOps.js";

const API = "https://www.googleapis.com/calendar/v3";
const MIN = 60_000;
const DAY = 86_400_000;
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== undefined && v !== null ? Number(v) : fallback);
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const enc = encodeURIComponent;
const pad = (n) => String(n).padStart(2, "0");

// ---------------------------------------------------------------- time helpers

export function defaultTimezone(env = process.env) {
  return env.CAUSLY_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function checkTimezone(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    throw new Error(`Unknown timezone "${tz}". Use an IANA name such as Asia/Kolkata.`);
  }
}

/** Offset of a timezone from UTC at a moment, in ms (IST is +19,800,000). */
export function tzOffsetMs(tz, ms) {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
      .formatToParts(new Date(ms))
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /([+\-\u2212])(\d{1,2})(?::(\d{2}))?$/.exec(name);
  if (!m) return 0;
  return (m[1] === "+" ? 1 : -1) * (Number(m[2]) * 60 + Number(m[3] || 0)) * MIN;
}

/** Wall-clock parts of a moment in a timezone. */
export function zonedParts(ms, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value])
  );
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hh: Number(p.hour), mm: Number(p.minute) };
}

/** The moment a wall-clock time happens in a timezone. */
export function zonedToInstant({ y, m, d, hh = 0, mm = 0 }, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - tzOffsetMs(tz, guess);
  return guess - tzOffsetMs(tz, first);
}

function ymdPlus(ms, tz, add) {
  const { y, m, d } = zonedParts(ms, tz);
  const t = new Date(Date.UTC(y, m - 1, d + add));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** Midnight (in tz) of the day containing ms, shifted by `add` days. */
export const dayStart = (ms, tz, add = 0) => zonedToInstant(ymdPlus(ms, tz, add), tz);

/** e.g. 2026-10-23T15:00:00+05:30 */
export function toLocalISO(ms, tz) {
  const { y, m, d, hh, mm } = zonedParts(ms, tz);
  const off = tzOffsetMs(tz, ms);
  const a = Math.abs(off) / MIN;
  return `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00${off < 0 ? "-" : "+"}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

const TIME_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i;

/**
 * Accepts 2026-10-23 (whole day), 2026-10-23T15:00 (read in tz) or a full timestamp with
 * Z or an offset. Returns { ms, dateOnly }.
 */
export function parseTime(value, tz, label = "time") {
  const s = String(value ?? "").trim();
  const r = TIME_RE.exec(s);
  const bad = () => new Error(`${label} must look like 2026-10-23, 2026-10-23T15:00 or 2026-10-23T15:00:00+05:30 (got "${s}").`);
  if (!r) throw bad();
  const [, Y, Mo, D, H, Mi, S, off] = r;
  if (Number(Mo) < 1 || Number(Mo) > 12 || Number(D) < 1 || Number(D) > 31) throw bad();
  const dateOnly = H === undefined;
  if (!dateOnly && (Number(H) > 23 || Number(Mi) > 59)) throw bad();
  let ms;
  if (!dateOnly && off) {
    const zone = off.toUpperCase() === "Z" ? "Z" : off.includes(":") ? off : `${off.slice(0, 3)}:${off.slice(3)}`;
    ms = Date.parse(`${Y}-${Mo}-${D}T${H}:${Mi}:${S || "00"}${zone}`);
  } else {
    ms = zonedToInstant({ y: Number(Y), m: Number(Mo), d: Number(D), hh: dateOnly ? 0 : Number(H), mm: dateOnly ? 0 : Number(Mi) }, tz);
  }
  if (!Number.isFinite(ms)) throw bad();
  return { ms, dateOnly };
}

/** Turns when / from / to into [start, end) in ms. */
export function resolveRange({ when, from, to }, { tz, now, defaultWhen = "today" }) {
  let start;
  let end;
  if (from || to) {
    start = from ? parseTime(from, tz, "from").ms : now;
    if (to) {
      const t = parseTime(to, tz, "to");
      end = t.dateOnly ? dayStart(t.ms, tz, 1) : t.ms; // a bare date means "through that day"
    } else {
      end = start + 7 * DAY;
    }
  } else {
    const w = when ?? defaultWhen;
    if (w === "today") [start, end] = [dayStart(now, tz, 0), dayStart(now, tz, 1)];
    else if (w === "tomorrow") [start, end] = [dayStart(now, tz, 1), dayStart(now, tz, 2)];
    else if (w === "next_7_days") [start, end] = [now, now + 7 * DAY];
    else throw new Error("when must be today, tomorrow or next_7_days (or pass from / to).");
  }
  if (!(end > start)) throw new Error("The end of the range must be after its start.");
  return { start, end };
}

// ---------------------------------------------------------------- API client

function client(deps = {}) {
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? Date.now;
  let token;
  return async function call(path, { method = "GET", query, body } = {}) {
    if (!token) {
      const creds = googleCredentials({
        refreshTokenEnv: "CALENDAR_REFRESH_TOKEN",
        clientIdEnvs: ["CALENDAR_CLIENT_ID", "GMAIL_CLIENT_ID"],
        clientSecretEnvs: ["CALENDAR_CLIENT_SECRET", "GMAIL_CLIENT_SECRET"],
      });
      token = await getAccessToken(creds, { fetch: fetchFn, now });
    }
    const pairs = Object.entries(query ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== "");
    const qs = pairs.length ? `?${new URLSearchParams(pairs.map(([k, v]) => [k, String(v)]))}` : "";
    const res = await fetchFn(`${API}${path}${qs}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = data?.error?.message || `HTTP ${res.status}`;
      if (res.status === 401) throw new Error("Google rejected the access token. Check CALENDAR_REFRESH_TOKEN.");
      if (res.status === 403) {
        throw new Error(
          `Google Calendar refused the request: ${message}. The refresh token needs the calendar.events and calendar.readonly scopes, and the Calendar API must be enabled in the Google Cloud project.`
        );
      }
      if (res.status === 404) throw new Error("Not found. Check the event id and calendar id.");
      if (res.status === 410) throw new Error("That event was already deleted.");
      throw new Error(`Google Calendar error: ${message}`);
    }
    return data;
  };
}

// ---------------------------------------------------------------- shaping

function simplify(e) {
  const guests = (e.attendees || []).map((a) => ({
    email: a.email,
    ...(a.displayName ? { name: a.displayName } : {}),
    response: a.responseStatus,
    ...(a.self ? { self: true } : {}),
    ...(a.organizer ? { organizer: true } : {}),
  }));
  return {
    id: e.id,
    title: e.summary || "(no title)",
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    all_day: Boolean(e.start?.date),
    status: e.status,
    ...(e.location ? { location: e.location } : {}),
    ...(e.description ? { description: String(e.description).slice(0, 1000) } : {}),
    ...(guests.length ? { attendees: guests } : {}),
    ...(e.hangoutLink ? { meet_link: e.hangoutLink } : {}),
    organizer: e.organizer?.email,
    recurring: Boolean(e.recurringEventId),
    link: e.htmlLink,
  };
}

const hasGuests = (e) => (e?.attendees || []).some((a) => !a.self);

function cleanEmails(list, label = "attendees") {
  const out = [...new Set((list ?? []).map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
  const bad = out.find((x) => !EMAIL.test(x));
  if (bad) throw new Error(`"${bad}" is not a valid email address (${label}).`);
  if (out.length > 50) throw new Error(`Too many ${label} (50 max).`);
  return out;
}

/** start/end objects for the API. Default length applies when `end` is not given. */
function buildTimes({ start, end, duration_minutes }, tz, defaultMs, defaultDays = 1) {
  const s = parseTime(start, tz, "start");
  if (s.dateOnly) {
    if (end && !parseTime(end, tz, "end").dateOnly) throw new Error("start is a whole day, so end must be a date too (or leave it out).");
    const days = end ? Math.max(1, Math.round((dayStart(parseTime(end, tz, "end").ms, tz, 1) - s.ms) / DAY)) : defaultDays;
    const endDay = ymdPlus(s.ms, tz, days);
    const startDay = ymdPlus(s.ms, tz, 0);
    const iso = ({ y, m, d }) => `${y}-${pad(m)}-${pad(d)}`;
    return { start: { date: iso(startDay) }, end: { date: iso(endDay) }, startMs: s.ms, endMs: s.ms + days * DAY, allDay: true };
  }
  let endMs;
  if (end) {
    const e = parseTime(end, tz, "end");
    if (e.dateOnly) throw new Error("start has a time, so end must have a time too.");
    endMs = e.ms;
  } else {
    endMs = s.ms + clamp(num(duration_minutes, defaultMs / MIN), 5, 24 * 60) * MIN;
  }
  if (endMs <= s.ms) throw new Error("The event must end after it starts.");
  return {
    start: { dateTime: new Date(s.ms).toISOString(), timeZone: tz },
    end: { dateTime: new Date(endMs).toISOString(), timeZone: tz },
    startMs: s.ms,
    endMs,
    allDay: false,
  };
}

const needsConfirm = (what) =>
  new Error(`${what} This emails real people, so ask the user first, then re-call with confirm: true.`);

// ---------------------------------------------------------------- calendar_list_calendars

export async function listCalendars(_input = {}, deps = {}) {
  const call = client(deps);
  const data = await call("/users/me/calendarList", { query: { maxResults: 100, minAccessRole: "reader" } });
  const calendars = (data.items || []).map((c) => ({
    id: c.id,
    name: c.summaryOverride || c.summary,
    ...(c.primary ? { primary: true } : {}),
    access: c.accessRole,
    timezone: c.timeZone,
  }));
  return { count: calendars.length, calendars, default_timezone: defaultTimezone() };
}

// ---------------------------------------------------------------- calendar_list_events

export async function listEvents({ when, from, to, query, calendar_id = "primary", limit = 25, timezone } = {}, deps = {}) {
  const tz = checkTimezone(timezone || defaultTimezone());
  const now = (deps.now ?? Date.now)();
  const range = resolveRange({ when, from, to }, { tz, now, defaultWhen: "today" });
  const call = client(deps);
  const data = await call(`/calendars/${enc(calendar_id)}/events`, {
    query: {
      timeMin: new Date(range.start).toISOString(),
      timeMax: new Date(range.end).toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: clamp(Math.trunc(num(limit, 25)), 1, 100),
      q: query,
      timeZone: tz,
    },
  });
  const events = (data.items || []).filter((e) => e.status !== "cancelled").map(simplify);
  return {
    calendar: calendar_id,
    timezone: tz,
    range: { start: toLocalISO(range.start, tz), end: toLocalISO(range.end, tz) },
    count: events.length,
    events,
    notice: UNTRUSTED_NOTICE,
  };
}

// ---------------------------------------------------------------- calendar_get_event

export async function getEvent({ event_id, calendar_id = "primary" } = {}, deps = {}) {
  if (!event_id) throw new Error("event_id is required.");
  const call = client(deps);
  const e = await call(`/calendars/${enc(calendar_id)}/events/${enc(event_id)}`);
  return { event: simplify(e), notice: UNTRUSTED_NOTICE };
}

// ---------------------------------------------------------------- free / busy

async function fetchBusy(call, { start, end, tz, ids }) {
  const data = await call("/freeBusy", {
    method: "POST",
    body: { timeMin: new Date(start).toISOString(), timeMax: new Date(end).toISOString(), timeZone: tz, items: ids.map((id) => ({ id })) },
  });
  return ids.map((id) => {
    const c = data.calendars?.[id];
    return {
      id,
      busy: (c?.busy || []).map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) })),
      errors: (c?.errors || []).map((x) => x.reason),
    };
  });
}

export async function freeBusy({ from, to, when, calendar_ids, attendees, timezone } = {}, deps = {}) {
  const tz = checkTimezone(timezone || defaultTimezone());
  const now = (deps.now ?? Date.now)();
  const range = resolveRange({ when, from, to }, { tz, now, defaultWhen: "next_7_days" });
  if (range.end - range.start > 31 * DAY) throw new Error("Pick a range of 31 days or less.");
  const ids = [...new Set([...(calendar_ids?.length ? calendar_ids : ["primary"]), ...cleanEmails(attendees)])];
  const call = client(deps);
  const result = await fetchBusy(call, { start: range.start, end: range.end, tz, ids });
  return {
    timezone: tz,
    range: { start: toLocalISO(range.start, tz), end: toLocalISO(range.end, tz) },
    calendars: result.map((r) => ({
      id: r.id,
      busy: r.busy.map((b) => ({ start: toLocalISO(b.start, tz), end: toLocalISO(b.end, tz) })),
      ...(r.errors.length ? { not_readable: r.errors, note: "Their busy times could not be read (calendar not shared or not found)." } : {}),
    })),
  };
}

// ---------------------------------------------------------------- calendar_find_slots

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Free windows of at least minMs inside working hours, given busy intervals. */
export function freeWindows({ busy, start, end, tz, workStart, workEnd, weekdaysOnly = true, minMs }) {
  const merged = busy
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start)
    .reduce((acc, b) => {
      const last = acc[acc.length - 1];
      if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
      else acc.push({ ...b });
      return acc;
    }, []);
  const out = [];
  for (let i = 0; ; i++) {
    const day = ymdPlus(start, tz, i);
    if (zonedToInstant(day, tz) >= end) break;
    const dow = new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay();
    if (weekdaysOnly && (dow === 0 || dow === 6)) continue;
    let cursor = Math.max(zonedToInstant({ ...day, hh: workStart[0], mm: workStart[1] }, tz), start);
    const close = Math.min(zonedToInstant({ ...day, hh: workEnd[0], mm: workEnd[1] }, tz), end);
    for (const b of merged) {
      if (b.end <= cursor) continue;
      if (b.start >= close) break;
      if (b.start - cursor >= minMs) out.push({ start: cursor, end: b.start });
      cursor = Math.max(cursor, b.end);
    }
    if (close - cursor >= minMs) out.push({ start: cursor, end: close });
  }
  return out;
}

export async function findSlots(
  { duration_minutes = 30, when, from, to, timezone, work_start = "09:00", work_end = "18:00", weekdays_only = true, calendar_ids, attendees, limit = 10 } = {},
  deps = {}
) {
  const tz = checkTimezone(timezone || defaultTimezone());
  const now = (deps.now ?? Date.now)();
  const range = resolveRange({ when, from, to }, { tz, now, defaultWhen: "next_7_days" });
  if (range.end - range.start > 31 * DAY) throw new Error("Pick a range of 31 days or less.");
  const ws = HHMM.exec(work_start);
  const we = HHMM.exec(work_end);
  if (!ws || !we) throw new Error("work_start and work_end must look like 09:00.");
  const workStart = [Number(ws[1]), Number(ws[2])];
  const workEnd = [Number(we[1]), Number(we[2])];
  if (workEnd[0] * 60 + workEnd[1] <= workStart[0] * 60 + workStart[1]) throw new Error("work_end must be after work_start.");
  const length = clamp(Math.trunc(num(duration_minutes, 30)), 5, 480);
  const ids = [...new Set([...(calendar_ids?.length ? calendar_ids : ["primary"]), ...cleanEmails(attendees)])];

  const call = client(deps);
  const results = await fetchBusy(call, { start: range.start, end: range.end, tz, ids });
  const unreadable = results.filter((r) => r.errors.length).map((r) => r.id);

  const quarter = 15 * MIN;
  const start = Math.max(range.start, Math.ceil(now / quarter) * quarter); // never offer the past
  const windows = freeWindows({
    busy: results.flatMap((r) => r.busy),
    start,
    end: range.end,
    tz,
    workStart,
    workEnd,
    weekdaysOnly: weekdays_only !== false,
    minMs: length * MIN,
  });
  const dayName = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
  const max = clamp(Math.trunc(num(limit, 10)), 1, 50);
  return {
    timezone: tz,
    duration_minutes: length,
    working_hours: `${work_start}-${work_end}${weekdays_only !== false ? " Mon-Fri" : ""}`,
    checked: ids.filter((id) => !unreadable.includes(id)),
    ...(unreadable.length
      ? { warning: `Could not read the calendar of: ${unreadable.join(", ")}. Their busy times were NOT considered.` }
      : {}),
    total_windows: windows.length,
    free_windows: windows.slice(0, max).map((w) => ({
      day: dayName.format(new Date(w.start)),
      start: toLocalISO(w.start, tz),
      end: toLocalISO(w.end, tz),
      minutes: Math.round((w.end - w.start) / MIN),
    })),
    note: "Each window is free time; any start inside it that leaves room for the duration works.",
  };
}

// ---------------------------------------------------------------- calendar_create_event

export async function createEvent(
  { title, start, end, duration_minutes, timezone, description, location, attendees, add_meet_link, calendar_id = "primary", confirm } = {},
  deps = {}
) {
  if (!title || !String(title).trim()) throw new Error("title is required.");
  if (!start) throw new Error("start is required.");
  const tz = checkTimezone(timezone || defaultTimezone());
  const guests = cleanEmails(attendees);
  if (guests.length && confirm !== true) {
    throw needsConfirm(`Creating this event would invite ${guests.length} ${guests.length === 1 ? "person" : "people"} (${guests.join(", ")}).`);
  }
  const times = buildTimes({ start, end, duration_minutes }, tz, 30 * MIN, 1);
  const call = client(deps);

  let overlaps = [];
  if (!times.allDay) {
    try {
      const near = await call(`/calendars/${enc(calendar_id)}/events`, {
        query: { timeMin: new Date(times.startMs).toISOString(), timeMax: new Date(times.endMs).toISOString(), singleEvents: "true", maxResults: 10, timeZone: tz },
      });
      overlaps = (near.items || [])
        .filter((e) => e.status !== "cancelled" && e.transparency !== "transparent" && e.start?.dateTime)
        .map((e) => ({ title: e.summary || "(no title)", start: e.start.dateTime, end: e.end?.dateTime }));
    } catch {
      // the overlap check is a courtesy; creating the event must not depend on it
    }
  }

  const body = {
    summary: String(title).trim(),
    start: times.start,
    end: times.end,
    ...(description ? { description: String(description) } : {}),
    ...(location ? { location: String(location) } : {}),
    ...(guests.length ? { attendees: guests.map((email) => ({ email })) } : {}),
    ...(add_meet_link
      ? { conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } }
      : {}),
  };
  const data = await call(`/calendars/${enc(calendar_id)}/events`, {
    method: "POST",
    query: { sendUpdates: guests.length ? "all" : "none", ...(add_meet_link ? { conferenceDataVersion: 1 } : {}) },
    body,
  });
  return { created: true, invited: guests.length, event: simplify(data), ...(overlaps.length ? { overlaps_with: overlaps } : {}) };
}

// ---------------------------------------------------------------- calendar_update_event

export async function updateEvent(
  { event_id, title, start, end, duration_minutes, timezone, description, location, add_attendees, add_meet_link, calendar_id = "primary", confirm } = {},
  deps = {}
) {
  if (!event_id) throw new Error("event_id is required.");
  const tz = checkTimezone(timezone || defaultTimezone());
  const newGuests = cleanEmails(add_attendees, "add_attendees");
  const call = client(deps);
  const path = `/calendars/${enc(calendar_id)}/events/${enc(event_id)}`;
  const existing = await call(path);

  const notify = hasGuests(existing) || newGuests.length > 0;
  if (notify && confirm !== true) {
    throw needsConfirm(
      newGuests.length
        ? `This change would invite ${newGuests.join(", ")}${hasGuests(existing) ? " and notify the current guests" : ""}.`
        : "This event has guests, so they would get an update email."
    );
  }

  const body = {};
  if (title !== undefined) body.summary = String(title);
  if (description !== undefined) body.description = String(description);
  if (location !== undefined) body.location = String(location);

  if (start !== undefined || end !== undefined || duration_minutes !== undefined) {
    const oldStart = existing.start?.dateTime || existing.start?.date;
    const oldEnd = existing.end?.dateTime || existing.end?.date;
    const spanMs = Date.parse(oldEnd) - Date.parse(oldStart);
    const newStart = start ?? oldStart;
    // an explicit end or duration wins; moving only the start keeps the old length
    const times = buildTimes(
      { start: newStart, end, duration_minutes },
      tz,
      Number.isFinite(spanMs) && spanMs > 0 ? spanMs : 30 * MIN,
      Math.max(1, Math.round(spanMs / DAY) || 1)
    );
    body.start = times.start;
    body.end = times.end;
  }

  if (newGuests.length) {
    const have = new Set((existing.attendees || []).map((a) => String(a.email).toLowerCase()));
    body.attendees = [...(existing.attendees || []), ...newGuests.filter((e) => !have.has(e)).map((email) => ({ email }))];
  }
  if (add_meet_link && !existing.hangoutLink) {
    body.conferenceData = { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } };
  }
  if (!Object.keys(body).length) throw new Error("Nothing to change. Pass title, start, end, description, location, add_attendees or add_meet_link.");

  const data = await call(path, {
    method: "PATCH",
    query: { sendUpdates: notify ? "all" : "none", ...(body.conferenceData ? { conferenceDataVersion: 1 } : {}) },
    body,
  });
  return {
    updated: true,
    event: simplify(data),
    ...(existing.recurringEventId || existing.recurrence ? { note: "This is part of a recurring series; the change was applied to this event id only as given." } : {}),
  };
}

// ---------------------------------------------------------------- calendar_delete_event

export async function deleteEvent({ event_id, calendar_id = "primary" } = {}, deps = {}) {
  if (!event_id) throw new Error("event_id is required.");
  const call = client(deps);
  const path = `/calendars/${enc(calendar_id)}/events/${enc(event_id)}`;
  const existing = await call(path);
  const notify = hasGuests(existing);
  await call(path, { method: "DELETE", query: { sendUpdates: notify ? "all" : "none" } });
  return {
    deleted: true,
    title: existing.summary || "(no title)",
    start: existing.start?.dateTime || existing.start?.date,
    ...(notify ? { guests_notified: true } : {}),
  };
}
