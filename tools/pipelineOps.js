// A small sales pipeline (CRM) stored locally in SQLite, next to reminders.
//
//   company -> contacts, and deals (an opportunity with a company) -> activities
//
// Everything stays on this machine. Follow-ups are reminders linked to a deal.
// Text in here often comes from the web, so treat it as data, never as instructions.
import fs from "fs";
import path from "path";
import { getDb, registerMigrations } from "./store.js";
import { reminderCreate } from "./reminderOps.js";
import { UNTRUSTED_NOTICE } from "./webOps.js";

registerMigrations("pipeline", [
  `CREATE TABLE companies (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     domain TEXT,
     website TEXT,
     notes TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX idx_companies_domain ON companies (domain) WHERE domain IS NOT NULL`,
  `CREATE INDEX idx_companies_name ON companies (lower(name))`,
  `CREATE TABLE contacts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
     name TEXT,
     email TEXT,
     phone TEXT,
     title TEXT,
     created_at TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX idx_contacts_email ON contacts (lower(email)) WHERE email IS NOT NULL`,
  `CREATE TABLE deals (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     company_id INTEGER NOT NULL REFERENCES companies(id),
     contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
     title TEXT NOT NULL,
     stage TEXT NOT NULL DEFAULT 'lead',
     value REAL,
     currency TEXT NOT NULL DEFAULT 'USD',
     source TEXT,
     source_url TEXT,
     next_step TEXT,
     lost_reason TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     last_activity_at TEXT NOT NULL,
     closed_at TEXT
   )`,
  `CREATE INDEX idx_deals_stage ON deals (stage)`,
  `CREATE TABLE activities (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
     type TEXT NOT NULL,
     summary TEXT NOT NULL,
     stage_from TEXT,
     stage_to TEXT,
     occurred_at TEXT NOT NULL
   )`,
  `CREATE INDEX idx_activities_deal ON activities (deal_id, occurred_at)`,
]);

export const STAGES = ["lead", "contacted", "replied", "meeting", "proposal", "won", "lost"];
export const ACTIVITY_TYPES = ["note", "email", "call", "meeting", "proposal", "other"];
const CLOSED = new Set(["won", "lost"]);
const DAY_MS = 86_400_000;

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const daysSince = (isoDate) => Math.max(0, Math.floor((Date.now() - Date.parse(isoDate)) / DAY_MS));
const plain = (row) => (row ? { ...row } : row);

function domainOf(website) {
  const raw = text(website);
  if (!raw) return null;
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
    return host.includes(".") ? host.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

function tx(db, fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function checkId(id, label = "deal_id") {
  if (!Number.isInteger(id)) throw new Error(`${label} must be a whole number.`);
  return id;
}

function checkFollowUp(days) {
  if (days === undefined) return undefined;
  if (!Number.isFinite(days) || days < 0 || days > 365) throw new Error("follow_up_in_days must be between 0 and 365.");
  return days;
}

function checkMoney(value, currency) {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error("value must be a positive number.");
  if (currency !== undefined && !/^[A-Za-z]{3}$/.test(currency)) throw new Error("currency must be a 3-letter code such as USD or INR.");
}

const DEAL_SELECT = `
  SELECT d.*, c.name AS company, c.domain AS domain, c.website AS website,
         ct.name AS contact_name, ct.email AS contact_email, ct.phone AS contact_phone,
         (SELECT MIN(r.due_at) FROM reminders r WHERE r.deal_id = d.id AND r.status = 'pending') AS next_follow_up
  FROM deals d
  JOIN companies c ON c.id = d.company_id
  LEFT JOIN contacts ct ON ct.id = d.contact_id`;

const present = (row) => ({ ...row, days_since_activity: daysSince(row.last_activity_at) });

function dealView(db, id) {
  const row = db.prepare(`${DEAL_SELECT} WHERE d.id = ?`).get(id);
  return row ? present(row) : undefined;
}

function requireDeal(db, id) {
  checkId(id);
  const deal = db.prepare("SELECT * FROM deals WHERE id = ?").get(id);
  if (!deal) throw new Error(`No deal with id ${id}.`);
  return deal;
}

function logActivityRow(db, dealId, type, summary, ts, stageFrom = null, stageTo = null) {
  db.prepare("INSERT INTO activities (deal_id, type, summary, stage_from, stage_to, occurred_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    dealId,
    type,
    summary,
    stageFrom,
    stageTo,
    ts
  );
  db.prepare("UPDATE deals SET last_activity_at = ?, updated_at = ? WHERE id = ?").run(ts, ts, dealId);
}

async function scheduleFollowUp(deal, days, company) {
  if (days === undefined || CLOSED.has(deal.stage)) return undefined;
  return reminderCreate({ title: `Follow up: ${company} (${deal.title})`, in_hours: days * 24, deal_id: deal.id });
}

// ---------------------------------------------------------------- add lead

/** Add a prospect: finds or creates the company and contact, and opens a deal unless one is already open. */
export async function addLead({ company, website, contact_name, email, phone, title, source, source_url, value, currency, notes, deal_title, follow_up_in_days } = {}) {
  const companyName = text(company);
  if (!companyName) throw new Error("company is required.");
  const domain = website ? domainOf(website) : null;
  if (website && !domain) throw new Error(`website "${website}" is not a valid URL or domain.`);
  const emailNorm = text(email)?.toLowerCase() ?? null;
  if (emailNorm && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailNorm)) throw new Error(`email "${email}" does not look valid.`);
  checkMoney(value, currency);
  checkFollowUp(follow_up_in_days);

  const db = await getDb();
  const out = tx(db, () => {
    const ts = iso();

    let co = domain ? db.prepare("SELECT * FROM companies WHERE domain = ?").get(domain) : undefined;
    co ??= db.prepare("SELECT * FROM companies WHERE lower(name) = lower(?)").get(companyName);
    let companyCreated = false;
    if (!co) {
      const r = db.prepare("INSERT INTO companies (name, domain, website, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(companyName, domain, text(website), ts, ts);
      co = db.prepare("SELECT * FROM companies WHERE id = ?").get(Number(r.lastInsertRowid));
      companyCreated = true;
    } else if (domain && !co.domain) {
      db.prepare("UPDATE companies SET domain = ?, website = ?, updated_at = ? WHERE id = ?").run(domain, text(website), ts, co.id);
    }

    let contact = emailNorm ? db.prepare("SELECT * FROM contacts WHERE lower(email) = ?").get(emailNorm) : undefined;
    let contactCreated = false;
    if (!contact && (text(contact_name) || emailNorm || text(phone))) {
      const r = db
        .prepare("INSERT INTO contacts (company_id, name, email, phone, title, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(co.id, text(contact_name), emailNorm, text(phone), text(title), ts);
      contact = db.prepare("SELECT * FROM contacts WHERE id = ?").get(Number(r.lastInsertRowid));
      contactCreated = true;
    }

    let deal = db.prepare("SELECT * FROM deals WHERE company_id = ? AND stage NOT IN ('won', 'lost') ORDER BY id DESC LIMIT 1").get(co.id);
    let dealCreated = false;
    if (!deal) {
      const r = db
        .prepare(
          `INSERT INTO deals (company_id, contact_id, title, stage, value, currency, source, source_url, created_at, updated_at, last_activity_at)
           VALUES (?, ?, ?, 'lead', ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(co.id, contact?.id ?? null, text(deal_title) ?? companyName, value ?? null, (currency ?? "USD").toUpperCase(), text(source), text(source_url), ts, ts, ts);
      deal = db.prepare("SELECT * FROM deals WHERE id = ?").get(Number(r.lastInsertRowid));
      dealCreated = true;
      logActivityRow(db, deal.id, "note", `Added to pipeline${text(source) ? ` from ${text(source)}` : ""}${text(notes) ? `: ${text(notes)}` : ""}`, ts);
    } else if (text(notes)) {
      logActivityRow(db, deal.id, "note", text(notes), ts);
    }
    if (!deal.contact_id && contact) db.prepare("UPDATE deals SET contact_id = ?, updated_at = ? WHERE id = ?").run(contact.id, ts, deal.id);

    return { dealId: deal.id, companyCreated, contactCreated, dealCreated };
  });

  const deal = dealView(db, out.dealId);
  const reminder = await scheduleFollowUp(deal, follow_up_in_days, deal.company);
  return {
    deal: dealView(db, out.dealId),
    company_created: out.companyCreated,
    contact_created: out.contactCreated,
    deal_created: out.dealCreated,
    ...(out.dealCreated ? {} : { note: "This company already has an open deal, so no new deal was created. New contact details and notes were added to it." }),
    ...(reminder ? { follow_up: { reminder_id: reminder.id, due_at: reminder.due_at } } : {}),
  };
}

// ---------------------------------------------------------------- list / get

/** List deals, most recently active first. Open deals by default. */
export async function listDeals({ stage, status, query, source, sort = "recent", limit = 25 } = {}) {
  if (stage !== undefined && !STAGES.includes(stage)) throw new Error(`stage must be one of: ${STAGES.join(", ")}.`);
  const effectiveStatus = status ?? (stage ? "all" : "open");
  if (!["open", "won", "lost", "all"].includes(effectiveStatus)) throw new Error("status must be open, won, lost or all.");
  if (!["recent", "stale", "value"].includes(sort)) throw new Error("sort must be recent, stale or value.");

  const clauses = [];
  const params = [];
  if (effectiveStatus === "open") clauses.push("d.stage NOT IN ('won', 'lost')");
  else if (effectiveStatus !== "all") {
    clauses.push("d.stage = ?");
    params.push(effectiveStatus);
  }
  if (stage) {
    clauses.push("d.stage = ?");
    params.push(stage);
  }
  if (text(query)) {
    const like = `%${text(query)}%`;
    clauses.push("(c.name LIKE ? OR c.domain LIKE ? OR ct.name LIKE ? OR ct.email LIKE ? OR d.title LIKE ?)");
    params.push(like, like, like, like, like);
  }
  if (text(source)) {
    clauses.push("lower(d.source) = lower(?)");
    params.push(text(source));
  }
  const order = { recent: "d.last_activity_at DESC", stale: "d.last_activity_at ASC", value: "COALESCE(d.value, 0) DESC, d.last_activity_at DESC" }[sort];

  const db = await getDb();
  const rows = db
    .prepare(`${DEAL_SELECT} ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY ${order} LIMIT ?`)
    .all(...params, clamp(Math.trunc(limit) || 25, 1, 100));
  return { count: rows.length, deals: rows.map(present), notice: UNTRUSTED_NOTICE };
}

/** Everything about one deal: company, contacts, activity timeline and follow-ups. */
export async function getDeal({ deal_id } = {}) {
  const db = await getDb();
  requireDeal(db, deal_id);
  const deal = dealView(db, deal_id);
  const company = plain(db.prepare("SELECT * FROM companies WHERE id = ?").get(deal.company_id));
  const contacts = db.prepare("SELECT * FROM contacts WHERE company_id = ? ORDER BY id").all(deal.company_id).map(plain);
  const activities = db.prepare("SELECT * FROM activities WHERE deal_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 50").all(deal_id).map(plain);
  const follow_ups = db.prepare("SELECT id, title, due_at, status FROM reminders WHERE deal_id = ? AND status = 'pending' ORDER BY due_at").all(deal_id).map(plain);
  return { deal, company, contacts, activities, follow_ups, notice: UNTRUSTED_NOTICE };
}

// ---------------------------------------------------------------- update / activity / contact

/** Move a deal between stages, edit its fields, and optionally schedule a follow-up. */
export async function updateDeal({ deal_id, stage, value, currency, title, next_step, notes, lost_reason, follow_up_in_days } = {}) {
  if (stage !== undefined && !STAGES.includes(stage)) throw new Error(`stage must be one of: ${STAGES.join(", ")}.`);
  checkMoney(value, currency);
  checkFollowUp(follow_up_in_days);
  if ([stage, value, currency, title, next_step, notes, lost_reason, follow_up_in_days].every((v) => v === undefined)) {
    throw new Error("Nothing to update: pass stage, value, title, next_step, notes, lost_reason or follow_up_in_days.");
  }

  const db = await getDb();
  tx(db, () => {
    const deal = requireDeal(db, deal_id);
    const ts = iso();
    const sets = [];
    const params = [];
    if (text(title)) (sets.push("title = ?"), params.push(text(title)));
    if (value !== undefined) (sets.push("value = ?"), params.push(value));
    if (currency !== undefined) (sets.push("currency = ?"), params.push(currency.toUpperCase()));
    if (next_step !== undefined) (sets.push("next_step = ?"), params.push(text(next_step)));
    if (lost_reason !== undefined && (stage === "lost" || (stage === undefined && deal.stage === "lost"))) {
      sets.push("lost_reason = ?");
      params.push(text(lost_reason));
    }
    if (sets.length) db.prepare(`UPDATE deals SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...params, ts, deal.id);

    if (stage !== undefined && stage !== deal.stage) {
      const closed = CLOSED.has(stage);
      db.prepare("UPDATE deals SET stage = ?, closed_at = ?, lost_reason = ? WHERE id = ?").run(
        stage,
        closed ? ts : null,
        stage === "lost" ? text(lost_reason) ?? deal.lost_reason : null,
        deal.id
      );
      logActivityRow(db, deal.id, "stage_change", `${deal.stage} -> ${stage}`, ts, deal.stage, stage);
      if (closed) db.prepare("UPDATE reminders SET status = 'cancelled', updated_at = ? WHERE deal_id = ? AND status = 'pending'").run(ts, deal.id);
    }
    if (text(notes)) logActivityRow(db, deal.id, "note", text(notes), ts);
  });

  const deal = dealView(db, deal_id);
  const reminder = await scheduleFollowUp(deal, follow_up_in_days, deal.company);
  return {
    deal: dealView(db, deal_id),
    ...(reminder ? { follow_up: { reminder_id: reminder.id, due_at: reminder.due_at } } : {}),
    ...(follow_up_in_days !== undefined && !reminder ? { note: "No follow-up was scheduled because the deal is closed." } : {}),
  };
}

/** Record something that happened on a deal (email, call, meeting, note) and optionally schedule a follow-up. */
export async function logActivity({ deal_id, type = "note", summary, follow_up_in_days } = {}) {
  if (!ACTIVITY_TYPES.includes(type)) throw new Error(`type must be one of: ${ACTIVITY_TYPES.join(", ")}.`);
  if (!text(summary)) throw new Error("summary is required.");
  checkFollowUp(follow_up_in_days);
  const db = await getDb();
  tx(db, () => {
    const deal = requireDeal(db, deal_id);
    logActivityRow(db, deal.id, type, text(summary), iso());
  });
  const deal = dealView(db, deal_id);
  const reminder = await scheduleFollowUp(deal, follow_up_in_days, deal.company);
  return { deal, ...(reminder ? { follow_up: { reminder_id: reminder.id, due_at: reminder.due_at } } : {}) };
}

/** Add another person at the deal's company. */
export async function addContact({ deal_id, name, email, phone, title, primary = false } = {}) {
  const emailNorm = text(email)?.toLowerCase() ?? null;
  if (emailNorm && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailNorm)) throw new Error(`email "${email}" does not look valid.`);
  if (!text(name) && !emailNorm && !text(phone)) throw new Error("Pass at least a name, email or phone.");
  const db = await getDb();
  return tx(db, () => {
    const deal = requireDeal(db, deal_id);
    const ts = iso();
    let contact = emailNorm ? db.prepare("SELECT * FROM contacts WHERE lower(email) = ?").get(emailNorm) : undefined;
    const created = !contact;
    if (!contact) {
      const r = db
        .prepare("INSERT INTO contacts (company_id, name, email, phone, title, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(deal.company_id, text(name), emailNorm, text(phone), text(title), ts);
      contact = db.prepare("SELECT * FROM contacts WHERE id = ?").get(Number(r.lastInsertRowid));
    }
    if (primary || !deal.contact_id) db.prepare("UPDATE deals SET contact_id = ?, updated_at = ? WHERE id = ?").run(contact.id, ts, deal.id);
    return { contact: plain(contact), created, primary: primary || !deal.contact_id, deal: dealView(db, deal.id) };
  });
}

/** Delete a deal and its history (the company and contacts stay). */
export async function deleteDeal({ deal_id } = {}) {
  const db = await getDb();
  return tx(db, () => {
    const deal = requireDeal(db, deal_id);
    const view = dealView(db, deal.id);
    db.prepare("DELETE FROM reminders WHERE deal_id = ?").run(deal.id);
    db.prepare("DELETE FROM deals WHERE id = ?").run(deal.id); // activities go with it
    return { deleted: true, deal: { id: view.id, title: view.title, company: view.company, stage: view.stage } };
  });
}

// ---------------------------------------------------------------- report

const sumByCurrency = (rows) => {
  const out = {};
  for (const r of rows) if (r.value > 0) out[r.currency] = (out[r.currency] ?? 0) + r.value;
  return out;
};

/** The pipeline at a glance: what is open, what is stale, what is due, and what is working. */
export async function pipelineReport({ days = 30, stale_days = 7 } = {}) {
  const span = clamp(Math.trunc(days) || 30, 1, 365);
  const staleAfter = clamp(Math.trunc(stale_days) || 7, 1, 90);
  const nowMs = Date.now();
  const nowIso = iso(nowMs);
  const since = iso(nowMs - span * DAY_MS);
  const staleBefore = iso(nowMs - staleAfter * DAY_MS);
  const weekAhead = iso(nowMs + 7 * DAY_MS);
  const db = await getDb();

  const openRows = db
    .prepare("SELECT stage, currency, COUNT(*) AS deals, SUM(COALESCE(value, 0)) AS value FROM deals WHERE stage NOT IN ('won', 'lost') GROUP BY stage, currency")
    .all();
  const open = STAGES.filter((s) => !CLOSED.has(s)).map((stage) => {
    const rows = openRows.filter((r) => r.stage === stage);
    return { stage, deals: rows.reduce((n, r) => n + r.deals, 0), value: sumByCurrency(rows) };
  });

  const stale = db
    .prepare(
      `SELECT d.id AS deal_id, d.title, d.stage, d.last_activity_at, c.name AS company
       FROM deals d JOIN companies c ON c.id = d.company_id
       WHERE d.stage NOT IN ('won', 'lost') AND d.last_activity_at < ?
       ORDER BY d.last_activity_at ASC LIMIT 10`
    )
    .all(staleBefore)
    .map((r) => ({ ...r, days_since_activity: daysSince(r.last_activity_at) }));

  const followUps = db
    .prepare(
      `SELECT r.id AS reminder_id, r.title, r.due_at, d.id AS deal_id, d.stage, c.name AS company
       FROM reminders r JOIN deals d ON d.id = r.deal_id JOIN companies c ON c.id = d.company_id
       WHERE r.status = 'pending' AND r.due_at <= ?
       ORDER BY r.due_at ASC LIMIT 20`
    )
    .all(weekAhead)
    .map((r) => ({ ...r, overdue: r.due_at <= nowIso }));

  const closed = db
    .prepare("SELECT stage, currency, COUNT(*) AS deals, SUM(COALESCE(value, 0)) AS value FROM deals WHERE closed_at >= ? GROUP BY stage, currency")
    .all(since);
  const wonRows = closed.filter((r) => r.stage === "won");
  const won = wonRows.reduce((n, r) => n + r.deals, 0);
  const lost = closed.filter((r) => r.stage === "lost").reduce((n, r) => n + r.deals, 0);
  const avgClose = db
    .prepare("SELECT AVG(julianday(closed_at) - julianday(created_at)) AS d FROM deals WHERE stage = 'won' AND closed_at >= ?")
    .get(since).d;

  const sources = db
    .prepare(
      `SELECT COALESCE(source, 'unknown') AS source, COUNT(*) AS deals,
              SUM(CASE WHEN stage = 'won' THEN 1 ELSE 0 END) AS won, SUM(CASE WHEN stage = 'lost' THEN 1 ELSE 0 END) AS lost
       FROM deals GROUP BY COALESCE(source, 'unknown') ORDER BY deals DESC, source LIMIT 10`
    )
    .all();
  const sourceValue = db
    .prepare("SELECT COALESCE(source, 'unknown') AS source, currency, SUM(COALESCE(value, 0)) AS value FROM deals WHERE stage = 'won' GROUP BY 1, 2")
    .all();
  const by_source = sources.map((s) => ({ ...s, won_value: sumByCurrency(sourceValue.filter((v) => v.source === s.source)) }));

  const totalDeals = db.prepare("SELECT COUNT(*) AS n FROM deals").get().n;
  const reached = db.prepare(
    "SELECT COUNT(*) AS n FROM (SELECT deal_id AS id FROM activities WHERE type = 'stage_change' AND stage_to = ? UNION SELECT id FROM deals WHERE stage = ?)"
  );
  const funnel = STAGES.filter((s) => s !== "lost").map((stage) => ({ stage, reached: stage === "lead" ? totalDeals : reached.get(stage, stage).n }));

  return {
    generated_at: nowIso,
    period_days: span,
    total_deals: totalDeals,
    new_in_period: db.prepare("SELECT COUNT(*) AS n FROM deals WHERE created_at >= ?").get(since).n,
    open,
    stale_after_days: staleAfter,
    stale,
    follow_ups: followUps,
    closed_in_period: {
      won,
      lost,
      win_rate_percent: won + lost ? Math.round((won / (won + lost)) * 100) : null,
      won_value: sumByCurrency(wonRows),
      avg_days_to_close: avgClose == null ? null : Math.round(avgClose * 10) / 10,
    },
    by_source,
    funnel,
    note: "Funnel counts deals that reached each stage through logged stage changes. Skipped stages are not counted.",
  };
}

// ---------------------------------------------------------------- export

// Cells that start with = + - @ can run as formulas when a CSV is opened in a spreadsheet, and the
// text here often comes from the web, so neutralise them.
function csvCell(value) {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // Phone-like values ("+1 415 555 0100") are plain numbers, so leave them alone.
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?[\d ().-]+$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Write deals or contacts to a CSV file you can open in a spreadsheet. */
export async function exportCsv({ path: filePath, what = "deals", overwrite = false } = {}) {
  if (!text(filePath)) throw new Error("path is required.");
  if (!["deals", "contacts"].includes(what)) throw new Error("what must be deals or contacts.");
  const target = path.resolve(filePath);
  if (fs.existsSync(target) && !overwrite) throw new Error(`${target} already exists. Pass overwrite: true to replace it.`);

  const db = await getDb();
  const rows =
    what === "deals"
      ? db
          .prepare(
            `SELECT d.id AS deal_id, c.name AS company, c.website, ct.name AS contact_name, ct.email AS contact_email, ct.phone AS contact_phone,
                    d.title, d.stage, d.value, d.currency, d.source, d.source_url, d.next_step, d.lost_reason,
                    d.created_at, d.last_activity_at, d.closed_at
             FROM deals d JOIN companies c ON c.id = d.company_id LEFT JOIN contacts ct ON ct.id = d.contact_id ORDER BY d.id`
          )
          .all()
      : db
          .prepare(
            `SELECT ct.id AS contact_id, ct.name, ct.email, ct.phone, ct.title, c.name AS company, c.website, ct.created_at
             FROM contacts ct LEFT JOIN companies c ON c.id = ct.company_id ORDER BY ct.id`
          )
          .all();
  const headers = rows.length ? Object.keys(rows[0]) : what === "deals" ? ["deal_id", "company", "stage"] : ["contact_id", "name", "email"];
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(","))].join("\r\n") + "\r\n";
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, csv);
  return { path: target, what, rows: rows.length };
}
