import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { getDb, closeDb } from "../tools/store.js";
import { reminderList } from "../tools/reminderOps.js";
import { addLead, getDeal } from "../tools/pipelineOps.js";
import * as m from "../tools/meetingOps.js";

const hasSqlite = await import("node:sqlite").then(
  () => true,
  () => false
);

const MIN = 60_000;

/** A fake transcribeAudio result; recorded_at_ms is when the file stopped (10:30Z), 30 minutes long. */
const fakeTranscript = (over = {}) => ({
  transcript: "[00:00] We agreed on $5,000.\n[00:30] I will send the proposal by Friday.",
  text: "We agreed on $5,000. I will send the proposal by Friday.",
  duration_seconds: 1800,
  language: "English",
  model: "whisper-large-v3-turbo",
  file: "acme-call.m4a",
  recorded_at_ms: Date.parse("2026-10-23T10:30:00Z"),
  converted: false,
  ...over,
});
const stubTranscribe = (over) => ({ transcribeAudio: vi.fn(async () => fakeTranscript(over)) });

describe.skipIf(!hasSqlite)("meetings", () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "causly-meet-"));
    process.env.CAUSLY_DB_PATH = path.join(dir, "test.db");
    process.env.CAUSLY_TIMEZONE = "Asia/Kolkata";
    delete process.env.CALENDAR_REFRESH_TOKEN;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    closeDb();
    delete process.env.CAUSLY_DB_PATH;
    delete process.env.CAUSLY_TIMEZONE;
    delete process.env.CALENDAR_REFRESH_TOKEN;
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const lead = () => addLead({ company: "Acme Studio", contact_name: "Asha Rao", email: "asha@acme.test", value: 5000, currency: "usd" });

  describe("meeting_transcribe", () => {
    it("stores a draft with the transcript and works out when it began", async () => {
      const deps = stubTranscribe();
      const r = await m.transcribeMeeting({ path: "C:/rec/acme-call.m4a" }, deps);
      expect(r).toMatchObject({ meeting_id: 1, status: "draft", title: "acme call", duration_minutes: 30, language: "English" });
      expect(r.started_at).toBe("2026-10-23T10:00:00.000Z");
      expect(r.transcript).toContain("proposal by Friday");
      expect(r.calendar_matches).toBeUndefined();
      const got = await m.getMeeting({ meeting_id: 1, include_transcript: true });
      expect(got.meeting.status).toBe("draft");
      expect(got.transcript).toContain("$5,000");
    });

    it("uses a given title and start time, and links a deal", async () => {
      const { deal } = await lead();
      const r = await m.transcribeMeeting({ path: "x.m4a", title: "Kickoff", started_at: "2026-10-20T09:00:00Z", deal_id: deal.id }, stubTranscribe());
      expect(r.title).toBe("Kickoff");
      expect(r.started_at).toBe("2026-10-20T09:00:00.000Z");
      expect((await m.getMeeting({ meeting_id: r.meeting_id })).meeting.deal_id).toBe(deal.id);
    });

    it("rejects a missing deal before sending any audio", async () => {
      const deps = stubTranscribe();
      await expect(m.transcribeMeeting({ path: "x.m4a", deal_id: 99 }, deps)).rejects.toThrow(/No deal/);
      expect(deps.transcribeAudio).not.toHaveBeenCalled();
    });

    it("suggests calendar events that overlap the recording", async () => {
      process.env.CALENDAR_REFRESH_TOKEN = "t";
      const events = [
        { id: "e1", title: "Acme sync", start: "2026-10-23T10:00:00Z", end: "2026-10-23T10:30:00Z", attendees: [{ email: "asha@acme.test" }, { email: "me@x.test", self: true }] },
        { id: "e2", title: "Lunch", start: "2026-10-23T12:00:00Z", end: "2026-10-23T13:00:00Z" },
        { id: "e3", title: "Holiday", all_day: true, start: "2026-10-23", end: "2026-10-24" },
      ];
      const r = await m.transcribeMeeting({ path: "x.m4a" }, { ...stubTranscribe(), listEvents: async () => ({ events }) });
      expect(r.calendar_matches).toEqual([{ event_id: "e1", title: "Acme sync", start: "2026-10-23T10:00:00Z", end: "2026-10-23T10:30:00Z", attendees: ["asha@acme.test"] }]);
    });

    it("keeps going when the calendar is unreachable", async () => {
      process.env.CALENDAR_REFRESH_TOKEN = "t";
      const r = await m.transcribeMeeting({ path: "x.m4a" }, { ...stubTranscribe(), listEvents: async () => Promise.reject(new Error("token expired")) });
      expect(r.meeting_id).toBe(1);
      expect(r.calendar_note).toMatch(/token expired/);
    });

    it("passes language and vocabulary to the transcriber", async () => {
      const deps = stubTranscribe();
      await m.transcribeMeeting({ path: "x.m4a", language: "hi", vocabulary: "Causly" }, deps);
      expect(deps.transcribeAudio).toHaveBeenCalledWith({ path: "x.m4a", language: "hi", vocabulary: "Causly" }, undefined);
    });
  });

  describe("bestEventMatches", () => {
    it("ignores cancelled, all-day and barely overlapping events", () => {
      const s = Date.parse("2026-10-23T10:00:00Z");
      const out = m.bestEventMatches(
        [
          { id: "a", title: "A", start: "2026-10-23T10:00:00Z", end: "2026-10-23T11:00:00Z" },
          { id: "b", title: "B", start: "2026-10-23T10:00:00Z", end: "2026-10-23T11:00:00Z", status: "cancelled" },
          { id: "c", title: "C", start: "2026-10-23T10:25:00Z", end: "2026-10-23T11:25:00Z" },
        ],
        s,
        s + 30 * MIN
      );
      expect(out.map((e) => e.event_id)).toEqual(["a"]);
    });
  });

  describe("meeting_save", () => {
    it("creates a saved meeting from a summary", async () => {
      const r = await m.saveMeeting({ title: "Standup", summary: "Short sync.", decisions: ["Ship Friday"], attendees: ["Asha@Acme.test", "asha@acme.test"], started_at: "2026-10-22T04:00:00Z", duration_minutes: 15 });
      expect(r.saved).toBe(true);
      expect(r.meeting).toMatchObject({ id: 1, title: "Standup", status: "saved", source: "manual", decisions: ["Ship Friday"], attendees: ["asha@acme.test"], duration_minutes: 15 });
      expect(r.warning).toBeUndefined();
    });

    it("needs a title and a summary or transcript for a new meeting", async () => {
      await expect(m.saveMeeting({ summary: "x" })).rejects.toThrow(/title is required/);
      await expect(m.saveMeeting({ title: "T" })).rejects.toThrow(/summary, or a transcript/);
      await expect(m.saveMeeting({ meeting_id: 42, summary: "x" })).rejects.toThrow(/No meeting/);
    });

    it("keeps a pasted transcript as a draft until there is a summary", async () => {
      const r = await m.saveMeeting({ title: "Call", transcript: "Asha: hello" });
      expect(r.meeting).toMatchObject({ status: "draft", source: "text", transcript_chars: 11 });
      expect(r.warning).toMatch(/draft/);
      const done = await m.saveMeeting({ meeting_id: r.meeting.id, summary: "Said hello." });
      expect(done.meeting.status).toBe("saved");
      expect(done.meeting.transcript_chars).toBe(11); // transcript survives the update
    });

    it("completes a draft from meeting_transcribe", async () => {
      const t = await m.transcribeMeeting({ path: "x.m4a" }, stubTranscribe());
      const r = await m.saveMeeting({
        meeting_id: t.meeting_id,
        summary: "Agreed $5,000.",
        attendees: ["asha@acme.test"],
        action_items: [{ text: "Send proposal", owner: "me", due_date: "2026-10-30" }, "Share brand assets"],
      });
      expect(r.meeting).toMatchObject({ id: t.meeting_id, status: "saved", source: "audio", language: "English" });
      expect(r.action_items.map((a) => [a.text, a.owner ?? null, a.due_date ?? null])).toEqual([
        ["Send proposal", "me", "2026-10-30"],
        ["Share brand assets", null, null],
      ]);
      expect(r.reminders_created).toBe(1);
    });

    it("reads a transcript file, and refuses both transcript and file", async () => {
      const f = path.join(dir, "notes.vtt");
      fs.writeFileSync(f, "WEBVTT\n\n00:00:02.000 --> 00:00:04.000\n<v Asha>Hi</v>");
      const r = await m.saveMeeting({ title: "From Zoom", transcript_file: f, summary: "Hi." });
      expect(r.meeting).toMatchObject({ source: "file", source_file: "notes.vtt" });
      const got = await m.getMeeting({ meeting_id: r.meeting.id, include_transcript: true });
      expect(got.transcript).toBe("[00:02] Asha: Hi");
      await expect(m.saveMeeting({ title: "X", transcript: "a", transcript_file: f })).rejects.toThrow(/not both/);
    });

    it("validates input", async () => {
      await expect(m.saveMeeting({ title: "T", summary: "s", action_items: [{ text: "x", due_date: "31/10/2026" }] })).rejects.toThrow(/due_date must look like/);
      await expect(m.saveMeeting({ title: "T", summary: "s", action_items: [{ text: "  " }] })).rejects.toThrow(/cannot be empty/);
      await expect(m.saveMeeting({ title: "T", summary: "s", started_at: "nonsense" })).rejects.toThrow(/started_at/);
      await expect(m.saveMeeting({ title: "T", summary: "s", decisions: "one" })).rejects.toThrow(/must be a list/);
      await expect(m.saveMeeting({ title: "T", summary: "s", deal_id: 77 })).rejects.toThrow(/No deal/);
    });

    it("sets a 09:00 local reminder for each dated item", async () => {
      await m.saveMeeting({ title: "Plan", summary: "s", action_items: [{ text: "Send invoice", owner: "me", due_date: "2026-11-02" }] });
      const { reminders } = await reminderList({});
      expect(reminders).toHaveLength(1);
      expect(reminders[0].title).toBe("Action: Send invoice");
      expect(reminders[0].due_at).toBe("2026-11-02T03:30:00.000Z");
      expect(reminders[0].note).toContain("Plan");
    });

    it("replaces open items on re-save, keeps done ones, and cancels old reminders", async () => {
      const first = await m.saveMeeting({ title: "Plan", summary: "s", action_items: [{ text: "A", due_date: "2026-11-02" }, { text: "B", due_date: "2026-11-03" }] });
      await m.completeAction({ action_id: first.action_items[0].id });
      const again = await m.saveMeeting({ meeting_id: first.meeting.id, action_items: [{ text: "C", due_date: "2026-11-04" }] });
      expect(again.action_items.map((a) => `${a.text}:${a.status}`)).toEqual(["A:done", "C:open"]);
      const pending = (await reminderList({})).reminders.map((r) => r.title);
      expect(pending).toEqual(["Action: C"]); // A done, B cancelled
    });

    it("links a deal, logs the meeting on it once, and respects log_to_deal", async () => {
      const { deal } = await lead();
      const r = await m.saveMeeting({ title: "Acme kickoff", summary: "Scope agreed.", deal_id: deal.id, action_items: [{ text: "Send proposal" }] });
      expect(r).toMatchObject({ deal_id: deal.id, deal_logged: true });
      let g = await getDeal({ deal_id: deal.id });
      const logged = g.activities.filter((a) => a.type === "meeting");
      expect(logged).toHaveLength(1);
      expect(logged[0].summary).toContain("Acme kickoff");
      expect(logged[0].summary).toContain("1 open action item");
      await m.saveMeeting({ meeting_id: r.meeting.id, summary: "Scope agreed, updated." });
      g = await getDeal({ deal_id: deal.id });
      expect(g.activities.filter((a) => a.type === "meeting")).toHaveLength(1);

      const quiet = await m.saveMeeting({ title: "Private", summary: "s", deal_id: deal.id, log_to_deal: false });
      expect(quiet.deal_logged).toBe(false);
    });

    it("fills title, guests, time and length from a calendar event", async () => {
      const getEvent = vi.fn(async () => ({
        event: { id: "ev1", title: "Acme sync", start: "2026-10-24T05:00:00Z", end: "2026-10-24T05:45:00Z", attendees: [{ email: "Asha@acme.test" }, { email: "me@x.test", self: true }] },
      }));
      const r = await m.saveMeeting({ calendar_event_id: "ev1", summary: "Went well." }, { getEvent });
      expect(r.meeting).toMatchObject({ title: "Acme sync", started_at: "2026-10-24T05:00:00.000Z", duration_minutes: 45, attendees: ["asha@acme.test"], calendar_event_id: "ev1" });
      expect(getEvent).toHaveBeenCalledWith({ event_id: "ev1" });
    });

    it("renames a file-titled draft after the linked event, but keeps a title the user chose", async () => {
      const getEvent = async () => ({ event: { id: "ev1", title: "Acme Kickoff", start: "2026-10-24T05:00:00Z", end: "2026-10-24T05:30:00Z", attendees: [] } });
      const auto = await m.transcribeMeeting({ path: "x.m4a" }, stubTranscribe({ file: "x.m4a" }));
      expect((await m.saveMeeting({ meeting_id: auto.meeting_id, summary: "s", calendar_event_id: "ev1" }, { getEvent })).meeting.title).toBe("Acme Kickoff");
      const named = await m.transcribeMeeting({ path: "x.m4a", title: "My own title" }, stubTranscribe());
      expect((await m.saveMeeting({ meeting_id: named.meeting_id, summary: "s", calendar_event_id: "ev1" }, { getEvent })).meeting.title).toBe("My own title");
    });

    it("still saves when the calendar event cannot be read", async () => {
      const r = await m.saveMeeting({ title: "Call", summary: "s", calendar_event_id: "gone" }, { getEvent: async () => Promise.reject(new Error("404")) });
      expect(r.saved).toBe(true);
      expect(r.meeting.calendar_event_id).toBe("gone");
      expect(r.notes[0]).toMatch(/could not read the event/);
    });
  });

  describe("list, get and search", () => {
    beforeEach(async () => {
      await m.saveMeeting({ title: "Acme kickoff", summary: "Agreed the website build costs $5,000.", decisions: ["Fixed price"], started_at: "2026-10-20T09:00:00Z", transcript: "Asha: pricing is fine\nMe: great", attendees: ["asha@acme.test"], action_items: [{ text: "Send proposal", owner: "me", due_date: "2026-10-25" }] });
      await m.saveMeeting({ title: "Beta review", summary: "Bugs triaged.", started_at: "2026-10-22T09:00:00Z" });
      await m.saveMeeting({ title: "Raw call", transcript: "Just a transcript", started_at: "2026-10-23T09:00:00Z" });
    });

    it("lists newest first with open action counts, and filters", async () => {
      const all = await m.listMeetings({});
      expect(all.meetings.map((x) => x.title)).toEqual(["Raw call", "Beta review", "Acme kickoff"]);
      expect(all.meetings[2].open_actions).toBe(1);
      expect((await m.listMeetings({ status: "draft" })).meetings.map((x) => x.title)).toEqual(["Raw call"]);
      expect((await m.listMeetings({ since: "2026-10-21" })).count).toBe(2);
      await expect(m.listMeetings({ status: "weird" })).rejects.toThrow(/status/);
    });

    it("gets a meeting and pages the transcript", async () => {
      const g = await m.getMeeting({ meeting_id: 1 });
      expect(g.meeting.summary).toContain("$5,000");
      expect(g.transcript).toBeUndefined();
      const t = await m.getMeeting({ meeting_id: 1, include_transcript: true, transcript_chars: 1000 });
      expect(t.transcript).toContain("pricing is fine");
      await expect(m.getMeeting({ meeting_id: 9 })).rejects.toThrow(/No meeting/);
    });

    it("searches every field, needs all words, and shows where it matched", async () => {
      const a = await m.searchMeetings({ query: "pricing" });
      expect(a.results).toHaveLength(1);
      expect(a.results[0]).toMatchObject({ id: 1, matched_in: ["transcript"] });
      expect(a.results[0].snippet).toContain("pricing is fine");

      const b = await m.searchMeetings({ query: "website 5,000" });
      expect(b.results[0].matched_in).toContain("summary");
      expect((await m.searchMeetings({ query: "website bugs" })).count).toBe(0);
      expect((await m.searchMeetings({ query: "proposal" })).results[0].matched_in).toEqual(["action items"]);
      expect((await m.searchMeetings({ query: "asha@acme.test" })).count).toBe(1);
      expect((await m.searchMeetings({ query: "100%" })).count).toBe(0); // % is literal, not a wildcard
      await expect(m.searchMeetings({ query: " a " })).rejects.toThrow(/query is required/);
    });
  });

  describe("action items", () => {
    let ids;
    beforeEach(async () => {
      const a = await m.saveMeeting({ title: "One", summary: "s", action_items: [{ text: "Old thing", owner: "Asha Rao", due_date: "2020-01-01" }, { text: "Later", owner: "me", due_date: "2099-01-01" }, { text: "Someday" }] });
      const b = await m.saveMeeting({ title: "Two", summary: "s", action_items: [{ text: "Other", owner: "me", due_date: "2098-01-01" }] });
      ids = { a: a.action_items.map((x) => x.id), b: b.action_items.map((x) => x.id), meetingA: a.meeting.id };
    });

    it("orders by due date with undated last and flags overdue", async () => {
      const r = await m.listActions({});
      expect(r.actions.map((x) => x.text)).toEqual(["Old thing", "Other", "Later", "Someday"]);
      expect(r.overdue).toBe(1);
      expect(r.actions[0]).toMatchObject({ overdue: true, meeting: "One" });
    });

    it("filters by owner, meeting and due date", async () => {
      expect((await m.listActions({ owner: "asha" })).actions.map((x) => x.text)).toEqual(["Old thing"]);
      expect((await m.listActions({ meeting_id: ids.meetingA })).count).toBe(3);
      expect((await m.listActions({ due_before: "2050-01-01" })).actions.map((x) => x.text)).toEqual(["Old thing"]);
      await expect(m.listActions({ status: "x" })).rejects.toThrow(/status/);
    });

    it("completes an action, clears its reminder, and can reopen it", async () => {
      const before = (await reminderList({})).reminders.length;
      const r = await m.completeAction({ action_id: ids.a[1] });
      expect(r).toMatchObject({ status: "done", open_in_meeting: 2 });
      expect((await reminderList({})).reminders.length).toBe(before - 1);
      expect((await m.listActions({ status: "done" })).actions.map((x) => x.text)).toEqual(["Later"]);
      expect(await m.completeAction({ action_id: ids.a[1], status: "open" })).toMatchObject({ status: "open", open_in_meeting: 3 });
      await expect(m.completeAction({ action_id: 999 })).rejects.toThrow(/No action item/);
    });
  });

  describe("meeting_prep", () => {
    it("needs something to look up", async () => {
      await expect(m.prepMeeting({})).rejects.toThrow(/at least one of/);
    });

    it("pulls the deal, past meetings and open actions for a guest", async () => {
      const { deal } = await lead();
      await m.saveMeeting({ title: "Acme kickoff", summary: "Scope agreed.", decisions: ["Fixed price"], deal_id: deal.id, attendees: ["asha@acme.test"], action_items: [{ text: "Send proposal", owner: "me", due_date: "2026-10-30" }] });
      const r = await m.prepMeeting({ attendees: ["Asha@Acme.test"] });
      expect(r.people).toEqual(["asha@acme.test"]);
      expect(r.deals[0]).toMatchObject({ id: deal.id, company: "Acme Studio" });
      expect(r.deals[0].recent_activity.some((a) => a.type === "meeting")).toBe(true);
      expect(r.past_meetings[0]).toMatchObject({ title: "Acme kickoff", decisions: ["Fixed price"] });
      expect(r.open_actions[0]).toMatchObject({ text: "Send proposal", meeting: "Acme kickoff" });
    });

    it("uses the calendar event's guests and title", async () => {
      const { deal } = await lead();
      await m.saveMeeting({ title: "Acme sync", summary: "Last time.", deal_id: deal.id });
      const getEvent = async () => ({
        event: { id: "e", title: "Acme sync", start: "2026-10-30T10:00:00Z", end: "2026-10-30T10:30:00Z", meet_link: "https://meet.test/x", attendees: [{ email: "asha@acme.test" }, { email: "me@x.test", self: true }] },
      });
      const r = await m.prepMeeting({ event_id: "e" }, { getEvent });
      expect(r.event).toMatchObject({ title: "Acme sync", meet_link: "https://meet.test/x" });
      expect(r.people).toEqual(["asha@acme.test"]);
      expect(r.deals).toHaveLength(1);
      expect(r.past_meetings).toHaveLength(1);
    });

    it("finds a deal by company name and says so when nothing is on file", async () => {
      await lead();
      expect((await m.prepMeeting({ query: "Acme" })).deals).toHaveLength(1);
      const none = await m.prepMeeting({ attendees: ["stranger@nowhere.test"] });
      expect(none.deals).toEqual([]);
      expect(none.note).toMatch(/Nothing on file/);
    });

    it("reports an unreadable calendar event but still prepares from the rest", async () => {
      const r = await m.prepMeeting({ event_id: "e", attendees: ["x@y.test"] }, { getEvent: async () => Promise.reject(new Error("no access")) });
      expect(r.notes[0]).toMatch(/no access/);
    });
  });

  describe("meeting_delete", () => {
    it("removes the meeting, its items and its pending reminders", async () => {
      const r = await m.saveMeeting({ title: "Gone", summary: "s", action_items: [{ text: "A", due_date: "2026-11-02" }, { text: "B" }] });
      const del = await m.deleteMeeting({ meeting_id: r.meeting.id });
      expect(del).toMatchObject({ deleted: true, action_items_deleted: 2, reminders_cancelled: 1 });
      expect((await m.listMeetings({})).count).toBe(0);
      expect((await reminderList({})).reminders).toHaveLength(0);
      const db = await getDb();
      expect(db.prepare("SELECT COUNT(*) AS n FROM action_items").get().n).toBe(0);
      await expect(m.deleteMeeting({ meeting_id: r.meeting.id })).rejects.toThrow(/No meeting/);
    });
  });
});
