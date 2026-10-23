// Meeting notes, stored locally in SQLite (~/.causly/causly.db).
//
//   meeting_transcribe        recording -> transcript, saved as a draft meeting (audio goes to Groq)
//   meeting_save              the agent's summary, decisions and action items (or a pasted/file transcript)
//   meeting_list / _get       browse meetings
//   meeting_search            find what was said, across every meeting
//   meeting_actions           open action items, overdue first
//   meeting_complete_action   tick an action item off
//   meeting_prep              brief before a call: calendar event, pipeline deal, past meetings, open items
//   meeting_delete            remove a meeting and its transcript
//
// The server has no language model: the connected agent reads the transcript and writes the
// summary; this module stores it, makes it searchable, schedules reminders for action items
// with due dates, and links the meeting to a pipeline deal and a calendar event.
import path from "path";
import { getDb, registerMigrations } from "./store.js";
import { reminderCreate, reminderUpdate } from "./reminderOps.js";
import { getDeal, listDeals, logActivity } from "./pipelineOps.js";
import { listEvents, getEvent, zonedToInstant, zonedParts, defaultTimezone } from "./calendarOps.js";
import { transcribeAudio, parseTranscriptFile } from "./transcribeOps.js";
import { UNTRUSTED_NOTICE } from "./webOps.js";

registerMigrations("meetings", [
  `CREATE TABLE meetings (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     title TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'draft',
     started_at TEXT NOT NULL,
     duration_minutes INTEGER,
     attendees TEXT,
     source TEXT NOT NULL,
     source_file TEXT,
     language TEXT,
     transcript TEXT,
     summary TEXT,
     decisions TEXT,
     calendar_event_id TEXT,
     deal_id INTEGER,
     deal_logged_at TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE action_items (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     meeting_id INTEGER NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
     text TEXT NOT NULL,
     owner TEXT,
     due_date TEXT,
     status TEXT NOT NULL DEFAULT 'open',
     reminder_id INTEGER,
     created_at TEXT NOT NULL,
     completed_at TEXT
   )`,
  `CREATE INDEX idx_meetings_started ON meetings (started_at)`,
  `CREATE INDEX idx_meetings_deal ON meetings (deal_id)`,
  `CREATE INDEX idx_actions_status_due ON action_items (status, due_date)`,
]);

const MIN = 60_000;
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const parseJson = (s, fallback) => {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));

// ---------------------------------------------------------------- validation

function cleanText(v, label, max) {
  if (typeof v !== "string") throw new Error(`${label} must be text.`);
  const s = v.trim();
  if (!s) throw new Error(`${label} cannot be empty.`);
  if (s.length > max) throw new Error(`${label} is too long (${max} characters at most).`);
  return s;
}

function cleanList(v, label, maxItems, maxLen) {
  if (!Array.isArray(v)) throw new Error(`${label} must be a list.`);
  if (v.length > maxItems) throw new Error(`${label} has too many items (${maxItems} at most).`);
  return v.map((x, i) => cleanText(x, `${label}[${i + 1}]`, maxLen));
}

function cleanAttendees(v) {
  if (!Array.isArray(v)) throw new Error("attendees must be a list of emails or names.");
  const out = [...new Set(v.map((x) => String(x ?? "").trim()).filter(Boolean).map((x) => (x.includes("@") ? x.toLowerCase() : x)))];
  if (out.length > 50) throw new Error("attendees has too many entries (50 at most).");
  if (out.some((x) => x.length > 200)) throw new Error("An attendee entry is too long.");
  return out;
}

function checkDate(v, label) {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new Error(`${label} must look like 2026-10-31.`);
  return s;
}

function cleanActions(items) {
  if (!Array.isArray(items)) throw new Error("action_items must be a list of { text, owner, due_date }.");
  if (items.length > 50) throw new Error("action_items has too many entries (50 at most).");
  return items.map((it, i) => {
    const o = typeof it === "string" ? { text: it } : it ?? {};
    return {
      text: cleanText(o.text, `action_items[${i + 1}].text`, 500),
      owner: o.owner ? cleanText(o.owner, `action_items[${i + 1}].owner`, 100) : null,
      due_date: o.due_date ? checkDate(o.due_date, `action_items[${i + 1}].due_date`) : null,
    };
  });
}

function checkInt(v, label) {
  if (!Number.isInteger(v)) throw new Error(`${label} must be a whole number.`);
  return v;
}

const parseDate = (v, label) => {
  const ms = Date.parse(String(v));
  if (Number.isNaN(ms)) throw new Error(`${label} must be a date-time like 2026-10-23T15:00:00+05:30.`);
  return ms;
};

const todayIn = (tz, now = Date.now()) => {
  const p = zonedParts(now, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
};

/** 09:00 on the due date, in the user's timezone, as a UTC timestamp. */
function dueAtFor(dueDate, tz) {
  const [y, m, d] = dueDate.split("-").map(Number);
  return new Date(zonedToInstant({ y, m, d, hh: 9, mm: 0 }, tz)).toISOString();
}

// ---------------------------------------------------------------- shaping

function itemsFor(db, meetingId, tz) {
  const today = todayIn(tz);
  return db
    .prepare("SELECT id, text, owner, due_date, status, completed_at FROM action_items WHERE meeting_id = ? ORDER BY id")
    .all(meetingId)
    .map((a) => compact({ ...a, overdue: a.status === "open" && a.due_date && a.due_date < today ? true : undefined }));
}

function view(row) {
  return compact({
    id: row.id,
    title: row.title,
    status: row.status,
    started_at: row.started_at,
    duration_minutes: row.duration_minutes,
    attendees: parseJson(row.attendees, []),
    source: row.source,
    source_file: row.source_file,
    language: row.language,
    summary: row.summary,
    decisions: parseJson(row.decisions, []),
    calendar_event_id: row.calendar_event_id,
    deal_id: row.deal_id,
    transcript_chars: row.transcript ? row.transcript.length : 0,
  });
}

const titleFromFile = (file) =>
  path
    .basename(file, path.extname(file))
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Meeting";

// ---------------------------------------------------------------- calendar matching

/** Events that overlap the recording window by at least half of the shorter of the two. */
export function bestEventMatches(events, startMs, endMs) {
  const win = endMs - startMs;
  return events
    .filter((e) => !e.all_day && e.status !== "cancelled" && e.start && e.end)
    .map((e) => {
      const s = Date.parse(e.start);
      const en = Date.parse(e.end);
      const overlap = Math.min(en, endMs) - Math.max(s, startMs);
      const shorter = Math.min(en - s, win);
      return { e, score: shorter > 0 ? overlap / shorter : 0 };
    })
    .filter((x) => x.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ e }) => ({
      event_id: e.id,
      title: e.title,
      start: e.start,
      end: e.end,
      attendees: (e.attendees || []).filter((a) => !a.self).map((a) => a.email),
    }));
}

async function calendarMatches(startMs, endMs, deps) {
  if (!process.env.CALENDAR_REFRESH_TOKEN) return {};
  try {
    const find = deps.listEvents ?? listEvents;
    const data = await find({ from: iso(startMs - 30 * MIN), to: iso(endMs + 30 * MIN), limit: 25 });
    return { calendar_matches: bestEventMatches(data.events || [], startMs, endMs) };
  } catch (err) {
    return { calendar_note: `Could not check the calendar: ${err.message}` };
  }
}

// ---------------------------------------------------------------- meeting_transcribe

/** Transcribe a recording and keep the transcript as a draft meeting, so the agent only has to send the summary back. */
export async function transcribeMeeting({ path: file, title, language, vocabulary, started_at, deal_id, confirm } = {}, deps = {}) {
  if (!file) throw new Error("path is required: the recording to transcribe.");
  const name = title !== undefined ? cleanText(title, "title", 200) : undefined;
  const given = started_at !== undefined ? parseDate(started_at, "started_at") : undefined;
  if (deal_id !== undefined) {
    checkInt(deal_id, "deal_id");
    await getDeal({ deal_id });
  }
  const tr = await (deps.transcribeAudio ?? transcribeAudio)({ path: file, language, vocabulary }, deps.transcribeDeps);

  const durationMs = tr.duration_seconds * 1000;
  // A recording's file time is when it stopped, so the meeting began one duration earlier.
  const startMs = given ?? tr.recorded_at_ms - durationMs;
  const db = await getDb();
  const ts = iso();
  const r = db
    .prepare(
      `INSERT INTO meetings (title, status, started_at, duration_minutes, attendees, source, source_file, language, transcript, deal_id, created_at, updated_at)
       VALUES (?, 'draft', ?, ?, '[]', 'audio', ?, ?, ?, ?, ?, ?)`
    )
    .run(name ?? titleFromFile(file), iso(startMs), Math.max(1, Math.round(tr.duration_seconds / 60)), tr.file, tr.language, tr.transcript, deal_id ?? null, ts, ts);
  const id = Number(r.lastInsertRowid);

  const cal = await calendarMatches(startMs, startMs + durationMs, deps);
  return {
    meeting_id: id,
    status: "draft",
    title: name ?? titleFromFile(file),
    started_at: iso(startMs),
    duration_minutes: Math.max(1, Math.round(tr.duration_seconds / 60)),
    language: tr.language,
    words: tr.text.split(/\s+/).length,
    ...(tr.converted ? { converted_with_ffmpeg: true } : {}),
    transcript: tr.transcript,
    ...cal,
    next: "Read the transcript, then call meeting_save with this meeting_id: a short summary, the decisions, and the action items (owner and due date when stated). Whisper does not identify speakers, so use context to work out who said what. If one calendar_matches entry is clearly this meeting, pass its event_id as calendar_event_id.",
    notice: UNTRUSTED_NOTICE,
  };
}

// ---------------------------------------------------------------- meeting_save

export async function saveMeeting(input = {}, deps = {}) {
  const { meeting_id, log_to_deal = true } = input;
  const tz = defaultTimezone();
  const db = await getDb();

  let existing = null;
  if (meeting_id !== undefined) {
    checkInt(meeting_id, "meeting_id");
    existing = db.prepare("SELECT * FROM meetings WHERE id = ?").get(meeting_id);
    if (!existing) throw new Error(`No meeting with id ${meeting_id}.`);
  }

  const title = input.title !== undefined ? cleanText(input.title, "title", 200) : undefined;
  const summary = input.summary !== undefined ? cleanText(input.summary, "summary", 20_000) : undefined;
  const decisions = input.decisions !== undefined ? cleanList(input.decisions, "decisions", 50, 500) : undefined;
  const actions = input.action_items !== undefined ? cleanActions(input.action_items) : undefined;
  let attendees = input.attendees !== undefined ? cleanAttendees(input.attendees) : undefined;
  const eventId = input.calendar_event_id !== undefined ? cleanText(input.calendar_event_id, "calendar_event_id", 200) : undefined;
  let startedMs = input.started_at !== undefined ? parseDate(input.started_at, "started_at") : undefined;
  let duration = input.duration_minutes !== undefined ? clamp(checkInt(input.duration_minutes, "duration_minutes"), 1, 1440) : undefined;
  let dealId = existing?.deal_id ?? null;
  if (input.deal_id !== undefined) {
    checkInt(input.deal_id, "deal_id");
    await getDeal({ deal_id: input.deal_id }); // throws if the deal does not exist
    dealId = input.deal_id;
  }

  if (input.transcript !== undefined && input.transcript_file !== undefined) throw new Error("Pass transcript or transcript_file, not both.");
  let transcript;
  let source;
  let sourceFile;
  if (input.transcript_file !== undefined) {
    transcript = parseTranscriptFile(input.transcript_file);
    source = "file";
    sourceFile = path.basename(input.transcript_file);
  } else if (input.transcript !== undefined) {
    transcript = cleanText(input.transcript, "transcript", 2_000_000);
    source = "text";
  }

  const notes = [];
  let event;
  if (eventId) {
    try {
      const got = await (deps.getEvent ?? getEvent)({ event_id: eventId });
      event = got.event;
    } catch (err) {
      notes.push(`Linked the calendar event id, but could not read the event: ${err.message}`);
    }
  }
  if (event) {
    const emails = (event.attendees || []).filter((a) => !a.self).map((a) => String(a.email).toLowerCase());
    if (attendees === undefined && !parseJson(existing?.attendees, []).length) attendees = emails;
    if (startedMs === undefined && !event.all_day && event.start) startedMs = Date.parse(event.start);
    if (duration === undefined && !event.all_day && event.start && event.end) duration = Math.max(1, Math.round((Date.parse(event.end) - Date.parse(event.start)) / MIN));
  }
  const newTitle = title ?? (existing ? undefined : event?.title);

  if (!existing) {
    if (!newTitle) throw new Error("title is required for a new meeting (or pass calendar_event_id to take it from the calendar).");
    if (summary === undefined && transcript === undefined) throw new Error("Give a summary, or a transcript / transcript_file.");
  }

  const ts = iso();
  const finalSummary = summary ?? existing?.summary ?? null;
  const status = finalSummary ? "saved" : "draft";
  const staleReminders = [];
  const added = [];
  let id;

  db.exec("BEGIN");
  try {
    if (!existing) {
      const r = db
        .prepare(
          `INSERT INTO meetings (title, status, started_at, duration_minutes, attendees, source, source_file, language, transcript, summary, decisions, calendar_event_id, deal_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          newTitle,
          status,
          iso(startedMs ?? Date.now()),
          duration ?? null,
          JSON.stringify(attendees ?? []),
          source ?? "manual",
          sourceFile ?? null,
          input.language ? String(input.language).slice(0, 40) : null,
          transcript ?? null,
          finalSummary,
          JSON.stringify(decisions ?? []),
          eventId ?? null,
          dealId,
          ts,
          ts
        );
      id = Number(r.lastInsertRowid);
    } else {
      id = existing.id;
      db.prepare(
        `UPDATE meetings SET title = ?, status = ?, started_at = ?, duration_minutes = ?, attendees = ?, source = ?, source_file = ?,
           transcript = ?, summary = ?, decisions = ?, calendar_event_id = ?, deal_id = ?, updated_at = ? WHERE id = ?`
      ).run(
        newTitle ?? existing.title,
        status,
        startedMs !== undefined ? iso(startedMs) : existing.started_at,
        duration ?? existing.duration_minutes,
        attendees !== undefined ? JSON.stringify(attendees) : existing.attendees,
        source ?? existing.source,
        sourceFile ?? existing.source_file,
        transcript ?? existing.transcript,
        finalSummary,
        decisions !== undefined ? JSON.stringify(decisions) : existing.decisions,
        eventId ?? existing.calendar_event_id,
        dealId,
        ts,
        id
      );
    }
    if (actions !== undefined) {
      // Re-saving replaces the open items; finished ones are kept as history.
      for (const old of db.prepare("SELECT id, reminder_id FROM action_items WHERE meeting_id = ? AND status = 'open'").all(id)) {
        if (old.reminder_id) staleReminders.push(old.reminder_id);
      }
      db.prepare("DELETE FROM action_items WHERE meeting_id = ? AND status = 'open'").run(id);
      const insert = db.prepare("INSERT INTO action_items (meeting_id, text, owner, due_date, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)");
      for (const a of actions) added.push({ ...a, id: Number(insert.run(id, a.text, a.owner, a.due_date, ts).lastInsertRowid) });
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  for (const reminderId of staleReminders) await reminderUpdate({ id: reminderId, status: "cancelled" }).catch(() => {});

  const meetingTitle = newTitle ?? existing.title;
  let remindersCreated = 0;
  for (const a of added.filter((x) => x.due_date)) {
    try {
      const rem = await reminderCreate({
        title: `Action: ${a.text}`.slice(0, 200),
        due_at: dueAtFor(a.due_date, tz),
        note: [`From meeting: ${meetingTitle}`, a.owner ? `Owner: ${a.owner}` : null].filter(Boolean).join(". "),
        deal_id: dealId ?? undefined,
      });
      db.prepare("UPDATE action_items SET reminder_id = ? WHERE id = ?").run(rem.id, a.id);
      remindersCreated++;
    } catch (err) {
      notes.push(`Could not set a reminder for "${a.text.slice(0, 40)}": ${err.message}`);
    }
  }

  let dealLogged = false;
  const row = db.prepare("SELECT * FROM meetings WHERE id = ?").get(id);
  if (dealId && log_to_deal !== false && row.summary && !row.deal_logged_at) {
    const open = db.prepare("SELECT COUNT(*) AS n FROM action_items WHERE meeting_id = ? AND status = 'open'").get(id).n;
    try {
      await logActivity({
        deal_id: dealId,
        type: "meeting",
        summary: `Meeting "${row.title}" (${row.started_at.slice(0, 10)}): ${row.summary.slice(0, 500)}${open ? ` [${open} open action item${open === 1 ? "" : "s"}]` : ""}`,
      });
      db.prepare("UPDATE meetings SET deal_logged_at = ? WHERE id = ?").run(iso(), id);
      dealLogged = true;
    } catch (err) {
      notes.push(`Saved, but could not log it on the deal: ${err.message}`);
    }
  }

  return {
    saved: true,
    meeting: view(db.prepare("SELECT * FROM meetings WHERE id = ?").get(id)),
    action_items: itemsFor(db, id, tz),
    reminders_created: remindersCreated,
    ...(dealId ? { deal_id: dealId, deal_logged: dealLogged || Boolean(row.deal_logged_at) } : {}),
    ...(notes.length ? { notes } : {}),
    ...(status === "draft" ? { warning: "No summary yet, so this is still a draft." } : {}),
  };
}

// ---------------------------------------------------------------- list / get / search

export async function listMeetings({ deal_id, since, status = "all", limit = 20 } = {}) {
  if (!["all", "saved", "draft"].includes(status)) throw new Error("status must be all, saved or draft.");
  const clauses = [];
  const params = [];
  if (status !== "all") {
    clauses.push("m.status = ?");
    params.push(status);
  }
  if (deal_id !== undefined) {
    clauses.push("m.deal_id = ?");
    params.push(checkInt(deal_id, "deal_id"));
  }
  if (since !== undefined) {
    clauses.push("m.started_at >= ?");
    params.push(iso(parseDate(since, "since")));
  }
  const db = await getDb();
  const rows = db
    .prepare(
      `SELECT m.*, (SELECT COUNT(*) FROM action_items a WHERE a.meeting_id = m.id AND a.status = 'open') AS open_actions
       FROM meetings m ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY m.started_at DESC LIMIT ?`
    )
    .all(...params, clamp(Math.trunc(limit) || 20, 1, 100));
  return {
    count: rows.length,
    meetings: rows.map((r) => ({ ...view(r), summary: r.summary ? (r.summary.length > 200 ? `${r.summary.slice(0, 200)}...` : r.summary) : undefined, open_actions: r.open_actions })),
    notice: UNTRUSTED_NOTICE,
  };
}

export async function getMeeting({ meeting_id, include_transcript = false, transcript_from = 0, transcript_chars = 30_000 } = {}) {
  checkInt(meeting_id, "meeting_id");
  const db = await getDb();
  const row = db.prepare("SELECT * FROM meetings WHERE id = ?").get(meeting_id);
  if (!row) throw new Error(`No meeting with id ${meeting_id}.`);
  const out = { meeting: view(row), action_items: itemsFor(db, row.id, defaultTimezone()) };
  if (include_transcript && row.transcript) {
    const from = clamp(Math.trunc(transcript_from) || 0, 0, row.transcript.length);
    const size = clamp(Math.trunc(transcript_chars) || 30_000, 1000, 100_000);
    const end = Math.min(from + size, row.transcript.length);
    out.transcript = row.transcript.slice(from, end);
    if (end < row.transcript.length) out.transcript_next_from = end;
  }
  out.notice = UNTRUSTED_NOTICE;
  return out;
}

const likePattern = (term) => `%${term.replace(/[\\%_]/g, "\\$&")}%`;

function snippet(text, terms, width = 240) {
  const lines = String(text).split("\n");
  const line = lines.find((l) => terms.some((t) => l.toLowerCase().includes(t))) ?? "";
  if (line.length <= width) return line;
  const at = Math.max(0, terms.map((t) => line.toLowerCase().indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] - 80);
  return `${at ? "..." : ""}${line.slice(at, at + width)}...`;
}

export async function searchMeetings({ query, limit = 10 } = {}) {
  const terms = [
    ...new Set(
      String(query ?? "")
        .toLowerCase()
        .split(/\s+/)
        .map((t) => t.replace(/^["']+|["']+$/g, ""))
        .filter((t) => t.length >= 2)
    ),
  ].slice(0, 8);
  if (!terms.length) throw new Error("query is required: at least one word of 2 or more letters.");
  const clause = `(lower(coalesce(m.title,'') || ' ' || coalesce(m.summary,'') || ' ' || coalesce(m.decisions,'') || ' ' || coalesce(m.attendees,'') || ' ' || coalesce(m.transcript,'')) LIKE ? ESCAPE '\\'
    OR EXISTS (SELECT 1 FROM action_items a WHERE a.meeting_id = m.id AND lower(a.text || ' ' || coalesce(a.owner,'')) LIKE ? ESCAPE '\\'))`;
  const params = terms.flatMap((t) => [likePattern(t), likePattern(t)]);
  const db = await getDb();
  const rows = db
    .prepare(
      `SELECT m.*, (SELECT group_concat(text, ' | ') FROM action_items WHERE meeting_id = m.id) AS action_text
       FROM meetings m WHERE ${terms.map(() => clause).join(" AND ")} ORDER BY m.started_at DESC LIMIT ?`
    )
    .all(...params, clamp(Math.trunc(limit) || 10, 1, 50));

  const has = (text) => text && terms.some((t) => String(text).toLowerCase().includes(t));
  const results = rows.map((r) => {
    const where = [
      has(r.title) && "title",
      has(r.summary) && "summary",
      has(r.decisions) && "decisions",
      has(r.action_text) && "action items",
      has(r.attendees) && "attendees",
      has(r.transcript) && "transcript",
    ].filter(Boolean);
    const source = has(r.summary) ? r.summary : has(r.decisions) ? parseJson(r.decisions, []).join("\n") : has(r.action_text) ? r.action_text : r.transcript ?? "";
    return { id: r.id, title: r.title, date: r.started_at.slice(0, 10), deal_id: r.deal_id ?? undefined, matched_in: where, snippet: snippet(source, terms) };
  });
  return { query, count: results.length, results, notice: UNTRUSTED_NOTICE };
}

// ---------------------------------------------------------------- action items

export async function listActions({ status = "open", owner, meeting_id, due_before, limit = 50 } = {}) {
  if (!["open", "done", "all"].includes(status)) throw new Error("status must be open, done or all.");
  const clauses = [];
  const params = [];
  if (status !== "all") {
    clauses.push("a.status = ?");
    params.push(status);
  }
  if (owner) {
    clauses.push("lower(a.owner) LIKE ? ESCAPE '\\'");
    params.push(likePattern(String(owner).toLowerCase().trim()));
  }
  if (meeting_id !== undefined) {
    clauses.push("a.meeting_id = ?");
    params.push(checkInt(meeting_id, "meeting_id"));
  }
  if (due_before) {
    clauses.push("a.due_date IS NOT NULL AND a.due_date <= ?");
    params.push(checkDate(due_before, "due_before"));
  }
  const tz = defaultTimezone();
  const today = todayIn(tz);
  const db = await getDb();
  const rows = db
    .prepare(
      `SELECT a.*, m.title AS meeting_title, m.started_at AS meeting_date, m.deal_id AS deal_id
       FROM action_items a JOIN meetings m ON m.id = a.meeting_id
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY (a.due_date IS NULL), a.due_date ASC, a.id ASC LIMIT ?`
    )
    .all(...params, clamp(Math.trunc(limit) || 50, 1, 200));
  const actions = rows.map((a) =>
    compact({
      id: a.id,
      text: a.text,
      owner: a.owner,
      due_date: a.due_date,
      status: a.status,
      overdue: a.status === "open" && a.due_date && a.due_date < today ? true : undefined,
      meeting_id: a.meeting_id,
      meeting: a.meeting_title,
      meeting_date: a.meeting_date.slice(0, 10),
      deal_id: a.deal_id,
    })
  );
  return { today, count: actions.length, overdue: actions.filter((a) => a.overdue).length, actions, notice: UNTRUSTED_NOTICE };
}

export async function completeAction({ action_id, status = "done" } = {}) {
  checkInt(action_id, "action_id");
  if (!["done", "open"].includes(status)) throw new Error("status must be done or open.");
  const db = await getDb();
  const a = db.prepare("SELECT * FROM action_items WHERE id = ?").get(action_id);
  if (!a) throw new Error(`No action item with id ${action_id}.`);
  db.prepare("UPDATE action_items SET status = ?, completed_at = ? WHERE id = ?").run(status, status === "done" ? iso() : null, action_id);
  if (status === "done" && a.reminder_id) await reminderUpdate({ id: a.reminder_id, status: "done" }).catch(() => {});
  const left = db.prepare("SELECT COUNT(*) AS n FROM action_items WHERE meeting_id = ? AND status = 'open'").get(a.meeting_id).n;
  return { id: action_id, text: a.text, status, open_in_meeting: left };
}

// ---------------------------------------------------------------- prep

export async function prepMeeting({ event_id, deal_id, attendees, query } = {}, deps = {}) {
  if (event_id === undefined && deal_id === undefined && !attendees?.length && !query) {
    throw new Error("Give at least one of: event_id (calendar), deal_id, attendees (emails) or query (company or topic).");
  }
  const notes = [];
  let event;
  if (event_id) {
    try {
      event = (await (deps.getEvent ?? getEvent)({ event_id: cleanText(event_id, "event_id", 200) })).event;
    } catch (err) {
      notes.push(`Could not read the calendar event: ${err.message}`);
    }
  }
  const emails = [
    ...new Set([...(attendees ? cleanAttendees(attendees) : []), ...((event?.attendees || []).filter((a) => !a.self).map((a) => String(a.email).toLowerCase()))].filter((x) => x.includes("@"))),
  ].slice(0, 10);

  const dealIds = new Set();
  if (deal_id !== undefined) dealIds.add(checkInt(deal_id, "deal_id"));
  for (const email of emails) {
    const found = await listDeals({ query: email, status: "all", limit: 3 });
    for (const d of found.deals) dealIds.add(d.id);
  }
  if (!dealIds.size && query) {
    const found = await listDeals({ query: String(query), status: "all", limit: 3 });
    for (const d of found.deals) dealIds.add(d.id);
  }
  const deals = [];
  for (const id of [...dealIds].slice(0, 3)) {
    const g = await getDeal({ deal_id: id });
    const d = g.deal;
    deals.push(
      compact({
        id: d.id,
        company: d.company,
        title: d.title,
        stage: d.stage,
        value: d.value ?? undefined,
        currency: d.value != null ? d.currency : undefined,
        next_step: d.next_step,
        days_since_activity: d.days_since_activity,
        primary_contact: d.contact_name ? `${d.contact_name}${d.contact_email ? ` <${d.contact_email}>` : ""}` : d.contact_email,
        recent_activity: g.activities.slice(0, 5).map((a) => ({ type: a.type, summary: a.summary, at: a.occurred_at })),
        pending_follow_ups: g.follow_ups.map((f) => ({ title: f.title, due_at: f.due_at })),
      })
    );
  }

  const db = await getDb();
  const conds = [];
  const params = [];
  if (dealIds.size) {
    conds.push(`deal_id IN (${[...dealIds].map(() => "?").join(",")})`);
    params.push(...dealIds);
  }
  for (const email of emails) {
    conds.push("attendees LIKE ? ESCAPE '\\'");
    params.push(likePattern(`"${email}"`));
  }
  for (const text of [query, event?.title]) {
    if (text && String(text).trim().length >= 3) {
      conds.push("lower(title) LIKE ? ESCAPE '\\'");
      params.push(likePattern(String(text).toLowerCase().trim()));
    }
  }
  const past = conds.length
    ? db.prepare(`SELECT * FROM meetings WHERE status = 'saved' AND (${conds.join(" OR ")}) ORDER BY started_at DESC LIMIT 5`).all(...params)
    : [];
  const tz = defaultTimezone();
  const openActions = [];
  const pastMeetings = past.map((m) => {
    const items = itemsFor(db, m.id, tz);
    for (const a of items.filter((i) => i.status === "open")) openActions.push({ ...a, meeting: m.title, meeting_id: m.id });
    return { id: m.id, title: m.title, date: m.started_at.slice(0, 10), summary: m.summary, decisions: parseJson(m.decisions, []) };
  });

  return {
    ...(event ? { event: compact({ title: event.title, start: event.start, end: event.end, location: event.location, meet_link: event.meet_link, description: event.description }) } : {}),
    people: emails,
    deals,
    past_meetings: pastMeetings,
    open_actions: openActions,
    ...(notes.length ? { notes } : {}),
    ...(!deals.length && !pastMeetings.length ? { note: "Nothing on file for these people yet: no pipeline deal and no past meeting." } : {}),
    notice: UNTRUSTED_NOTICE,
  };
}

// ---------------------------------------------------------------- delete

export async function deleteMeeting({ meeting_id, confirm } = {}) {
  checkInt(meeting_id, "meeting_id");
  const db = await getDb();
  const row = db.prepare("SELECT id, title FROM meetings WHERE id = ?").get(meeting_id);
  if (!row) throw new Error(`No meeting with id ${meeting_id}.`);
  const items = db.prepare("SELECT reminder_id FROM action_items WHERE meeting_id = ? AND status = 'open' AND reminder_id IS NOT NULL").all(meeting_id);
  const count = db.prepare("SELECT COUNT(*) AS n FROM action_items WHERE meeting_id = ?").get(meeting_id).n;
  db.prepare("DELETE FROM meetings WHERE id = ?").run(meeting_id); // action items go with it
  for (const i of items) await reminderUpdate({ id: i.reminder_id, status: "cancelled" }).catch(() => {});
  return { deleted: true, title: row.title, action_items_deleted: count, reminders_cancelled: items.length, note: "Any note already logged on a pipeline deal stays there." };
}
