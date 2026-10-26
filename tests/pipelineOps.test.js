import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { getDb, closeDb } from "../tools/store.js";
import { reminderCreate } from "../tools/reminderOps.js";
import {
  addLead,
  listDeals,
  getDeal,
  updateDeal,
  logActivity,
  addContact,
  deleteDeal,
  pipelineReport,
  exportCsv,
} from "../tools/pipelineOps.js";

const hasSqlite = await import("node:sqlite").then(
  () => true,
  () => false
);

describe.skipIf(!hasSqlite)("pipeline", () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "causly-pipeline-"));
    process.env.CAUSLY_DB_PATH = path.join(dir, "test.db");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    closeDb();
    delete process.env.CAUSLY_DB_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const setLastActivity = async (dealId, daysAgo) => {
    const db = await getDb();
    db.prepare("UPDATE deals SET last_activity_at = ? WHERE id = ?").run(new Date(Date.now() - daysAgo * 86_400_000).toISOString(), dealId);
  };

  describe("pipeline_add_lead", () => {
    it("creates the company, contact and deal", async () => {
      const r = await addLead({
        company: "Acme Studio",
        website: "https://www.Acme.test/about",
        contact_name: "Jane Doe",
        email: "Jane@Acme.test",
        source: "hn-hiring",
        source_url: "https://news.ycombinator.com/item?id=1",
        value: 1500,
        currency: "inr",
        notes: "Hiring a React dev",
      });
      expect(r).toMatchObject({ company_created: true, contact_created: true, deal_created: true });
      expect(r.deal).toMatchObject({
        id: 1,
        company: "Acme Studio",
        domain: "acme.test",
        stage: "lead",
        value: 1500,
        currency: "INR",
        source: "hn-hiring",
        contact_name: "Jane Doe",
        contact_email: "jane@acme.test",
        days_since_activity: 0,
      });
      const detail = await getDeal({ deal_id: 1 });
      expect(detail.activities[0].summary).toBe("Added to pipeline from hn-hiring: Hiring a React dev");
      expect(detail.notice).toMatch(/untrusted/i);
    });

    it("does not duplicate companies or open deals, but keeps the new details", async () => {
      await addLead({ company: "Acme", website: "acme.test", email: "a@acme.test" });
      const again = await addLead({ company: "ACME INC", website: "https://acme.test", contact_name: "Bob", email: "bob@acme.test", notes: "Second contact" });
      expect(again).toMatchObject({ company_created: false, contact_created: true, deal_created: false });
      expect(again.note).toMatch(/already has an open deal/);

      const byName = await addLead({ company: "acme" }); // no website: matched by name
      expect(byName).toMatchObject({ company_created: false, deal_created: false });

      expect((await listDeals({})).count).toBe(1);
      const detail = await getDeal({ deal_id: 1 });
      expect(detail.contacts).toHaveLength(2);
      expect(detail.activities.map((a) => a.summary)).toContain("Second contact");
    });

    it("opens a new deal once the previous one is closed", async () => {
      const first = await addLead({ company: "Acme" });
      await updateDeal({ deal_id: first.deal.id, stage: "won" });
      const second = await addLead({ company: "Acme" });
      expect(second).toMatchObject({ company_created: false, deal_created: true });
      expect(second.deal.id).not.toBe(first.deal.id);
    });

    it("schedules a follow-up reminder linked to the deal", async () => {
      const r = await addLead({ company: "Acme", follow_up_in_days: 3 });
      expect(Date.parse(r.follow_up.due_at) - Date.now()).toBeGreaterThan(71 * 3_600_000);
      const detail = await getDeal({ deal_id: r.deal.id });
      expect(detail.follow_ups).toHaveLength(1);
      expect(detail.deal.next_follow_up).toBe(r.follow_up.due_at);
    });

    it("rejects bad input", async () => {
      await expect(addLead({})).rejects.toThrow(/company is required/);
      await expect(addLead({ company: "A", website: "not a url" })).rejects.toThrow(/website/);
      await expect(addLead({ company: "A", email: "nope" })).rejects.toThrow(/email/);
      await expect(addLead({ company: "A", value: -1 })).rejects.toThrow(/value/);
      await expect(addLead({ company: "A", currency: "US" })).rejects.toThrow(/currency/);
      await expect(addLead({ company: "A", follow_up_in_days: -1 })).rejects.toThrow(/follow_up_in_days/);
      await expect(addLead({ company: "A", follow_up_in_days: 400 })).rejects.toThrow(/follow_up_in_days/);
    });
  });

  describe("pipeline_list / pipeline_get", () => {
    async function seed() {
      const a = (await addLead({ company: "Alpha", website: "alpha.test", contact_name: "Ann", source: "HN", value: 100 })).deal.id;
      const b = (await addLead({ company: "Beta", source: "remoteok", value: 900 })).deal.id;
      const c = (await addLead({ company: "Gamma", source: "website" })).deal.id;
      await updateDeal({ deal_id: b, stage: "contacted" });
      await updateDeal({ deal_id: c, stage: "won" });
      await setLastActivity(a, 5);
      return { a, b, c };
    }

    it("shows open deals by default, and everything for a given stage", async () => {
      const { a, b, c } = await seed();
      expect((await listDeals({})).deals.map((d) => d.id).sort()).toEqual([a, b].sort());
      expect((await listDeals({ status: "all" })).count).toBe(3);
      expect((await listDeals({ stage: "won" })).deals.map((d) => d.id)).toEqual([c]);
      expect((await listDeals({ status: "won" })).deals.map((d) => d.id)).toEqual([c]);
    });

    it("filters by search text and source, and sorts", async () => {
      const { a, b } = await seed();
      expect((await listDeals({ query: "ann" })).deals.map((d) => d.id)).toEqual([a]);
      expect((await listDeals({ query: "alpha.test" })).count).toBe(1);
      expect((await listDeals({ source: "hn" })).deals.map((d) => d.id)).toEqual([a]);
      expect((await listDeals({ sort: "value" })).deals.map((d) => d.id)).toEqual([b, a]);
      expect((await listDeals({ sort: "stale" })).deals.map((d) => d.id)).toEqual([a, b]);
      expect((await listDeals({ sort: "recent" })).deals.map((d) => d.id)).toEqual([b, a]);
      expect((await listDeals({ limit: 1 })).count).toBe(1);
      expect((await listDeals({})).deals.find((d) => d.id === a).days_since_activity).toBe(5);
    });

    it("rejects unknown filters and ids", async () => {
      await expect(listDeals({ stage: "nope" })).rejects.toThrow(/stage must be/);
      await expect(listDeals({ status: "nope" })).rejects.toThrow(/status must be/);
      await expect(listDeals({ sort: "nope" })).rejects.toThrow(/sort must be/);
      await expect(getDeal({ deal_id: 999 })).rejects.toThrow(/No deal with id 999/);
      await expect(getDeal({ deal_id: "1" })).rejects.toThrow(/whole number/);
    });
  });

  describe("pipeline_update", () => {
    it("logs stage changes, ignores a repeated stage, and edits fields", async () => {
      const { deal } = await addLead({ company: "Acme" });
      const moved = await updateDeal({ deal_id: deal.id, stage: "contacted" });
      expect(moved.deal.stage).toBe("contacted");
      const detail = await getDeal({ deal_id: deal.id });
      expect(detail.activities[0]).toMatchObject({ type: "stage_change", stage_from: "lead", stage_to: "contacted", summary: "lead -> contacted" });

      const before = detail.activities.length;
      const edited = await updateDeal({ deal_id: deal.id, stage: "contacted", next_step: "Send proposal", value: 800, title: "Website rebuild", notes: "Wants it by March" });
      expect(edited.deal).toMatchObject({ next_step: "Send proposal", value: 800, title: "Website rebuild" });
      const after = await getDeal({ deal_id: deal.id });
      expect(after.activities.length).toBe(before + 1); // only the note, no repeated stage change
      expect(after.activities[0].summary).toBe("Wants it by March");
    });

    it("closes a deal: sets closed_at and cancels follow-ups", async () => {
      const { deal } = await addLead({ company: "Beta", follow_up_in_days: 2 });
      const won = await updateDeal({ deal_id: deal.id, stage: "won", value: 3000, follow_up_in_days: 5 });
      expect(won.deal.closed_at).toBeTruthy();
      expect(won.follow_up).toBeUndefined();
      expect(won.note).toMatch(/closed/);
      expect((await getDeal({ deal_id: deal.id })).follow_ups).toEqual([]);
      const db = await getDb();
      expect(db.prepare("SELECT status FROM reminders WHERE deal_id = ?").get(deal.id).status).toBe("cancelled");
    });

    it("records a lost reason, and reopening clears the closed state", async () => {
      const { deal } = await addLead({ company: "Gamma" });
      const lost = await updateDeal({ deal_id: deal.id, stage: "lost", lost_reason: "No budget" });
      expect(lost.deal).toMatchObject({ stage: "lost", lost_reason: "No budget" });
      expect(lost.deal.closed_at).toBeTruthy();
      expect((await updateDeal({ deal_id: deal.id, lost_reason: "Budget cut" })).deal.lost_reason).toBe("Budget cut");
      const reopened = await updateDeal({ deal_id: deal.id, stage: "contacted" });
      expect(reopened.deal.closed_at).toBeNull();
      expect(reopened.deal.lost_reason).toBeNull();
    });

    it("schedules a follow-up for an open deal", async () => {
      const { deal } = await addLead({ company: "Delta" });
      const r = await updateDeal({ deal_id: deal.id, stage: "replied", follow_up_in_days: 2 });
      expect(r.follow_up.reminder_id).toBeTruthy();
      expect((await getDeal({ deal_id: deal.id })).follow_ups).toHaveLength(1);
    });

    it("rejects bad updates", async () => {
      const { deal } = await addLead({ company: "Acme" });
      await expect(updateDeal({ deal_id: deal.id })).rejects.toThrow(/Nothing to update/);
      await expect(updateDeal({ deal_id: deal.id, stage: "nope" })).rejects.toThrow(/stage must be/);
      await expect(updateDeal({ deal_id: deal.id, value: -5 })).rejects.toThrow(/value/);
      await expect(updateDeal({ deal_id: 999, stage: "won" })).rejects.toThrow(/No deal with id 999/);
    });
  });

  describe("pipeline_log_activity", () => {
    it("records activity, resets staleness, and can schedule a follow-up", async () => {
      const { deal } = await addLead({ company: "Acme" });
      await setLastActivity(deal.id, 10);
      expect((await getDeal({ deal_id: deal.id })).deal.days_since_activity).toBe(10);

      const r = await logActivity({ deal_id: deal.id, type: "email", summary: "Sent intro email", follow_up_in_days: 3 });
      expect(r.deal.days_since_activity).toBe(0);
      expect(r.follow_up.reminder_id).toBeTruthy();
      expect((await getDeal({ deal_id: deal.id })).activities[0]).toMatchObject({ type: "email", summary: "Sent intro email" });
    });

    it("validates input", async () => {
      const { deal } = await addLead({ company: "Acme" });
      await expect(logActivity({ deal_id: deal.id, type: "tweet", summary: "x" })).rejects.toThrow(/type must be/);
      await expect(logActivity({ deal_id: deal.id, summary: "  " })).rejects.toThrow(/summary is required/);
      await expect(logActivity({ deal_id: 999, summary: "x" })).rejects.toThrow(/No deal/);
    });
  });

  describe("pipeline_add_contact", () => {
    it("adds contacts, de-duplicates by email, and manages the primary contact", async () => {
      const { deal } = await addLead({ company: "Acme" });
      const jane = await addContact({ deal_id: deal.id, name: "Jane", email: "jane@acme.test", title: "CTO" });
      expect(jane).toMatchObject({ created: true, primary: true });
      expect(jane.deal.contact_email).toBe("jane@acme.test");

      const bob = await addContact({ deal_id: deal.id, name: "Bob", email: "bob@acme.test" });
      expect(bob.primary).toBe(false);
      expect(bob.deal.contact_email).toBe("jane@acme.test");

      expect((await addContact({ deal_id: deal.id, email: "JANE@acme.test" })).created).toBe(false);
      expect((await addContact({ deal_id: deal.id, email: "bob@acme.test", primary: true })).deal.contact_email).toBe("bob@acme.test");
      expect((await getDeal({ deal_id: deal.id })).contacts).toHaveLength(2);
    });

    it("validates input", async () => {
      const { deal } = await addLead({ company: "Acme" });
      await expect(addContact({ deal_id: deal.id, email: "bad" })).rejects.toThrow(/valid/);
      await expect(addContact({ deal_id: deal.id })).rejects.toThrow(/at least a name/);
    });
  });

  describe("pipeline_report", () => {
    it("handles an empty pipeline", async () => {
      const r = await pipelineReport({});
      expect(r.total_deals).toBe(0);
      expect(r.open.every((s) => s.deals === 0)).toBe(true);
      expect(r.stale).toEqual([]);
      expect(r.follow_ups).toEqual([]);
      expect(r.closed_in_period).toMatchObject({ won: 0, lost: 0, win_rate_percent: null, avg_days_to_close: null });
      expect(r.by_source).toEqual([]);
    });

    it("summarizes stages, stale deals, follow-ups, results, sources and the funnel", async () => {
      const mk = async (company, source, extra = {}) => (await addLead({ company, source, ...extra })).deal.id;
      const d1 = await mk("One", "hn", { value: 500 });
      const d2 = await mk("Two", "hn", { follow_up_in_days: 0 });
      const d3 = await mk("Three", "website", { follow_up_in_days: 3 });
      const d4 = await mk("Four", "remoteok", { value: 2000 });
      const d5 = await mk("Five", "remoteok");
      await updateDeal({ deal_id: d2, stage: "contacted" });
      await updateDeal({ deal_id: d3, stage: "proposal" });
      await updateDeal({ deal_id: d4, stage: "won" });
      await updateDeal({ deal_id: d5, stage: "lost", lost_reason: "Went elsewhere" });
      await setLastActivity(d1, 10);

      const r = await pipelineReport({});
      expect(r.total_deals).toBe(5);
      expect(r.new_in_period).toBe(5);

      const stage = Object.fromEntries(r.open.map((s) => [s.stage, s]));
      expect(stage.lead).toMatchObject({ deals: 1, value: { USD: 500 } });
      expect(stage.contacted.deals).toBe(1);
      expect(stage.replied.deals).toBe(0);
      expect(stage.proposal.deals).toBe(1);

      expect(r.stale.map((s) => s.deal_id)).toEqual([d1]);
      expect(r.stale[0].days_since_activity).toBe(10);

      expect(r.follow_ups.map((f) => [f.deal_id, f.overdue])).toEqual([
        [d2, true],
        [d3, false],
      ]);

      expect(r.closed_in_period).toMatchObject({ won: 1, lost: 1, win_rate_percent: 50, won_value: { USD: 2000 } });
      expect(r.closed_in_period.avg_days_to_close).toBeGreaterThanOrEqual(0);

      expect(r.by_source).toEqual([
        { source: "hn", deals: 2, won: 0, lost: 0, won_value: {} },
        { source: "remoteok", deals: 2, won: 1, lost: 1, won_value: { USD: 2000 } },
        { source: "website", deals: 1, won: 0, lost: 0, won_value: {} },
      ]);

      expect(Object.fromEntries(r.funnel.map((f) => [f.stage, f.reached]))).toEqual({ lead: 5, contacted: 1, replied: 0, meeting: 0, proposal: 1, won: 1 });
    });
  });

  describe("pipeline_export", () => {
    it("writes a CSV, quoting cells and neutralizing spreadsheet formulas", async () => {
      await addLead({ company: '=HYPERLINK("http://evil")', contact_name: "Smith, Jane", email: "jane@x.test", phone: "+1 415 555 0100", source: "hn" });
      const file = path.join(dir, "out", "deals.csv");
      const r = await exportCsv({ path: file });
      expect(r).toMatchObject({ path: file, what: "deals", rows: 1 });

      const lines = fs.readFileSync(file, "utf8").split("\r\n");
      expect(lines[0]).toBe("deal_id,company,website,contact_name,contact_email,contact_phone,title,stage,value,currency,source,source_url,next_step,lost_reason,created_at,last_activity_at,closed_at");
      expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil"")"`);
      expect(lines[1]).toContain('"Smith, Jane"');
      expect(lines[1]).toContain(",+1 415 555 0100,"); // a phone number is not a formula
      expect(lines[2]).toBe("");
    });

    it("refuses to overwrite unless told to, and can export contacts", async () => {
      await addLead({ company: "Acme", contact_name: "Jane", email: "jane@acme.test" });
      const file = path.join(dir, "c.csv");
      await exportCsv({ path: file, what: "contacts" });
      expect(fs.readFileSync(file, "utf8")).toContain("jane@acme.test");
      await expect(exportCsv({ path: file, what: "contacts" })).rejects.toThrow(/already exists/);
      expect((await exportCsv({ path: file, what: "contacts", overwrite: true })).rows).toBe(1);
    });

    it("writes just a header when there is nothing, and validates input", async () => {
      const file = path.join(dir, "empty.csv");
      expect((await exportCsv({ path: file })).rows).toBe(0);
      await expect(exportCsv({})).rejects.toThrow(/path is required/);
      await expect(exportCsv({ path: path.join(dir, "x.csv"), what: "notes" })).rejects.toThrow(/what must be/);
    });
  });

  describe("pipeline_delete_deal", () => {
    it("removes the deal, its history and follow-ups, but keeps the company and contacts", async () => {
      const { deal } = await addLead({ company: "Acme", contact_name: "Jane", email: "jane@acme.test", follow_up_in_days: 2 });
      await logActivity({ deal_id: deal.id, type: "call", summary: "Intro call" });
      const out = await deleteDeal({ deal_id: deal.id });
      expect(out).toMatchObject({ deleted: true, deal: { id: deal.id, company: "Acme" } });

      await expect(getDeal({ deal_id: deal.id })).rejects.toThrow(/No deal/);
      const db = await getDb();
      expect(db.prepare("SELECT COUNT(*) AS n FROM activities").get().n).toBe(0);
      expect(db.prepare("SELECT COUNT(*) AS n FROM reminders WHERE deal_id = ?").get(deal.id).n).toBe(0);
      expect(db.prepare("SELECT COUNT(*) AS n FROM companies").get().n).toBe(1);
      expect(db.prepare("SELECT COUNT(*) AS n FROM contacts").get().n).toBe(1);
      await expect(deleteDeal({ deal_id: 999 })).rejects.toThrow(/No deal/);
    });
  });

  describe("reminders linked to deals", () => {
    it("stores deal_id and validates it", async () => {
      const r = await reminderCreate({ title: "Call back", in_hours: 1, deal_id: 7 });
      expect(r.deal_id).toBe(7);
      await expect(reminderCreate({ title: "x", in_hours: 1, deal_id: 1.5 })).rejects.toThrow(/whole number/);
    });
  });
});
