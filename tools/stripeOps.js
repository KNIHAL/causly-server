// Stripe tools over the REST API. No new dependencies.
//
//   stripe_get_account         balance, and whether the key is test or live
//   stripe_list_customers      find customers by email or name
//   stripe_create_customer     add a customer
//   stripe_list_invoices       invoices, filter by customer and status
//   stripe_create_invoice      DRAFT invoice with line items (nothing is sent or charged)
//   stripe_send_invoice        finalize a draft and email it to the customer (HIGH, confirm)
//   stripe_create_payment_link shareable checkout link for a fixed amount (HIGH, confirm)
//   stripe_list_payments       recent payments
//   stripe_refund              refund a payment, whole or partial (HIGH, confirm)
//
// Credentials: STRIPE_API_KEY. Use a TEST key (sk_test_... or a restricted rk_test_...) first.
// A live key is refused unless STRIPE_ALLOW_LIVE=true, so a live key pasted by mistake does nothing.
// Amounts in and out are in normal units: 500 means $500.00 (JPY: 500 means 500 yen).
import crypto from "crypto";
import { UNTRUSTED_NOTICE } from "./webOps.js";

const API = "https://api.stripe.com/v1";
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const MAX_MINOR = 99_999_999; // Stripe's limit: 8 digits in the smallest unit

// ---------------------------------------------------------------- money

const ZERO_DECIMAL = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);
const THREE_DECIMAL = new Set(["bhd", "iqd", "jod", "kwd", "lyd", "omr", "tnd"]);
const decimals = (cur) => (ZERO_DECIMAL.has(cur) ? 0 : THREE_DECIMAL.has(cur) ? 3 : 2);

export function checkCurrency(value, env = process.env) {
  const c = String(value ?? env.STRIPE_DEFAULT_CURRENCY ?? "usd").trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(c)) throw new Error("currency must be a 3-letter code like usd, eur or inr.");
  return c;
}

/** 500 usd -> 50000. Rejects zero, negatives and more decimals than the currency has. */
export function toMinor(amount, currency, label = "amount") {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} must be a positive number in normal units (500 means 500.00).`);
  const d = decimals(currency);
  const minor = Math.round(n * 10 ** d);
  if (Math.abs(minor / 10 ** d - n) > 1e-9) throw new Error(`${label} ${n} has too many decimals for ${currency.toUpperCase()} (${d} allowed).`);
  if (minor > MAX_MINOR) throw new Error(`${label} is above Stripe's maximum for ${currency.toUpperCase()}.`);
  return minor;
}

export const toMajor = (minor, currency) => (minor == null ? null : Math.round(minor) / 10 ** decimals(currency));

// ---------------------------------------------------------------- client

/** Nested objects and arrays use Stripe's bracket form: line_items[0][price]=... */
export function encode(obj) {
  const out = [];
  const walk = (value, key) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${key}[${i}]`));
    else if (typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, key ? `${key}[${k}]` : k);
    else out.push([key, String(value)]);
  };
  walk(obj, "");
  return new URLSearchParams(out);
}

function client(deps = {}, env = process.env) {
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const key = env.STRIPE_API_KEY;
  if (!key) throw new Error("Stripe is not set up. Missing: STRIPE_API_KEY (use a test key, sk_test_..., from the Stripe dashboard).");
  const live = /^(sk|rk)_live_/.test(key);
  if (live && env.STRIPE_ALLOW_LIVE !== "true") {
    throw new Error("STRIPE_API_KEY is a LIVE key, which is blocked on purpose. Use a test key (sk_test_...). To really work with live money, set STRIPE_ALLOW_LIVE=true.");
  }
  const scrub = (text) => String(text).split(key).join("[REDACTED]");
  const mode = live ? "live" : "test";

  const call = async (method, path, params) => {
    const form = params ? encode(params) : undefined;
    const url = `${API}${path}${method === "GET" && form && [...form].length ? `?${form}` : ""}`;
    let res;
    try {
      res = await fetchFn(url, {
        method,
        headers: {
          authorization: `Bearer ${key}`,
          ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded", "idempotency-key": crypto.randomUUID() } : {}),
        },
        body: method === "POST" ? (form ?? new URLSearchParams()).toString() : undefined,
        signal: AbortSignal.timeout(25_000),
      });
    } catch (err) {
      throw new Error(`Could not reach Stripe: ${scrub(err.message)}`);
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    const e = data.error ?? {};
    if (res.status === 401) throw new Error("Stripe rejected the API key. Check STRIPE_API_KEY.");
    if (res.status === 403) throw new Error(`Stripe refused: ${scrub(e.message || "permission denied")}. A restricted key may be missing a permission for this action.`);
    if (res.status === 429) throw new Error("Stripe rate limit hit. Wait a moment and try again.");
    throw new Error(`Stripe error: ${scrub(e.message || `HTTP ${res.status}`)}`);
  };
  call.mode = mode;
  return call;
}

const iso = (sec) => (sec ? new Date(sec * 1000).toISOString() : null);
const cleanId = (id, prefix, label) => {
  const s = String(id ?? "").trim();
  if (!new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(s)) throw new Error(`${label} must be a Stripe id starting with ${prefix}_.`);
  return s;
};

function invoiceView(i) {
  const cur = i.currency;
  return {
    id: i.id,
    number: i.number ?? null,
    status: i.status,
    customer: i.customer_email || i.customer_name || i.customer,
    customer_id: typeof i.customer === "string" ? i.customer : i.customer?.id,
    total: toMajor(i.total, cur),
    amount_due: toMajor(i.amount_due, cur),
    amount_paid: toMajor(i.amount_paid, cur),
    currency: cur?.toUpperCase(),
    due_date: iso(i.due_date)?.slice(0, 10) ?? null,
    created: iso(i.created),
    hosted_invoice_url: i.hosted_invoice_url ?? null,
  };
}

// ---------------------------------------------------------------- tools

export async function getAccount(_input = {}, deps = {}) {
  const call = client(deps);
  const b = await call("GET", "/balance");
  const side = (list) => (list || []).map((x) => ({ currency: x.currency.toUpperCase(), amount: toMajor(x.amount, x.currency) }));
  return { mode: call.mode, available: side(b.available), pending: side(b.pending) };
}

export async function listCustomers({ email, query, limit = 10 } = {}, deps = {}) {
  const call = client(deps);
  const max = clamp(Math.trunc(Number(limit)) || 10, 1, 100);
  let data;
  if (query && String(query).trim()) {
    const q = String(query).trim().replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    data = await call("GET", "/customers/search", { query: `name~"${q}"`, limit: max });
  } else {
    if (email && !EMAIL.test(String(email).trim())) throw new Error("email is not a valid email address.");
    data = await call("GET", "/customers", { ...(email ? { email: String(email).trim().toLowerCase() } : {}), limit: max });
  }
  const customers = (data.data || []).map((c) => ({ id: c.id, name: c.name ?? null, email: c.email ?? null, created: iso(c.created), ...(c.description ? { description: String(c.description).slice(0, 200) } : {}) }));
  return { mode: call.mode, count: customers.length, customers, notice: UNTRUSTED_NOTICE };
}

export async function createCustomer({ email, name, description } = {}, deps = {}) {
  if (!email && !name) throw new Error("Give at least an email or a name.");
  if (email && !EMAIL.test(String(email).trim())) throw new Error("email is not a valid email address.");
  const call = client(deps);
  const c = await call("POST", "/customers", {
    ...(email ? { email: String(email).trim().toLowerCase() } : {}),
    ...(name ? { name: String(name).trim() } : {}),
    ...(description ? { description: String(description) } : {}),
  });
  return { created: true, mode: call.mode, customer: { id: c.id, name: c.name ?? null, email: c.email ?? null } };
}

export async function listInvoices({ customer, status, limit = 10 } = {}, deps = {}) {
  const call = client(deps);
  if (status && !["draft", "open", "paid", "uncollectible", "void"].includes(status)) throw new Error("status must be draft, open, paid, uncollectible or void.");
  const data = await call("GET", "/invoices", {
    ...(customer ? { customer: cleanId(customer, "cus", "customer") } : {}),
    ...(status ? { status } : {}),
    limit: clamp(Math.trunc(Number(limit)) || 10, 1, 100),
  });
  const invoices = (data.data || []).map(invoiceView);
  return { mode: call.mode, count: invoices.length, invoices, notice: UNTRUSTED_NOTICE };
}

async function resolveCustomer(call, customer, name) {
  const s = String(customer ?? "").trim();
  if (/^cus_[A-Za-z0-9]+$/.test(s)) return { id: s, created: false };
  if (!EMAIL.test(s)) throw new Error("customer must be a Stripe customer id (cus_...) or an email address.");
  const found = await call("GET", "/customers", { email: s.toLowerCase(), limit: 1 });
  if (found.data?.length) return { id: found.data[0].id, created: false };
  const made = await call("POST", "/customers", { email: s.toLowerCase(), ...(name ? { name: String(name).trim() } : {}) });
  return { id: made.id, created: true };
}

export async function createInvoice({ customer, customer_name, items, currency, days_until_due = 14, memo } = {}, deps = {}) {
  if (!Array.isArray(items) || !items.length) throw new Error("items is required: a list like [{ description, amount, quantity }].");
  if (items.length > 20) throw new Error("20 line items at most.");
  const cur = checkCurrency(currency);
  const lines = items.map((it, n) => {
    const description = String(it?.description ?? "").trim();
    if (!description) throw new Error(`Item ${n + 1} needs a description.`);
    if (description.length > 250) throw new Error(`Item ${n + 1}: description is over 250 characters.`);
    const qty = it.quantity === undefined ? 1 : Number(it.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 10_000) throw new Error(`Item ${n + 1}: quantity must be a whole number from 1 to 10000.`);
    return { description, quantity: qty, unit_amount: toMinor(it.amount, cur, `Item ${n + 1} amount`) };
  });
  const days = clamp(Math.trunc(Number(days_until_due)) || 14, 1, 90);

  const call = client(deps);
  const cust = await resolveCustomer(call, customer, customer_name);
  const inv = await call("POST", "/invoices", {
    customer: cust.id,
    currency: cur,
    collection_method: "send_invoice",
    days_until_due: days,
    auto_advance: false,
    pending_invoice_items_behavior: "exclude",
    ...(memo ? { description: String(memo).slice(0, 1000) } : {}),
  });
  try {
    for (const line of lines) {
      await call("POST", "/invoiceitems", { customer: cust.id, invoice: inv.id, currency: cur, ...line });
    }
  } catch (err) {
    await call("DELETE", `/invoices/${inv.id}`).catch(() => {}); // do not leave a half-built draft behind
    throw err;
  }
  const full = await call("GET", `/invoices/${inv.id}`);
  return {
    created: true,
    mode: call.mode,
    customer_created: cust.created,
    invoice: invoiceView(full),
    next: "This is a draft: nothing was sent or charged. Use stripe_send_invoice (needs confirm: true) to email it to the customer.",
  };
}

export async function sendInvoice({ invoice, confirm } = {}, deps = {}) {
  const id = cleanId(invoice, "in", "invoice");
  const call = client(deps);
  const current = await call("GET", `/invoices/${id}`);
  if (current.status === "paid" || current.status === "void" || current.status === "uncollectible") {
    throw new Error(`Invoice ${id} is ${current.status}; it cannot be sent.`);
  }
  if (!current.total) throw new Error(`Invoice ${id} has no amount; add line items first.`);
  let working = current;
  if (current.status === "draft") working = await call("POST", `/invoices/${id}/finalize`, { auto_advance: false });
  const sent = await call("POST", `/invoices/${id}/send`);
  return { sent: true, mode: call.mode, invoice: invoiceView({ ...working, ...sent }) };
}

export async function createPaymentLink({ name, amount, currency, confirm } = {}, deps = {}) {
  const title = String(name ?? "").trim();
  if (!title) throw new Error("name is required (what the customer is paying for).");
  if (title.length > 250) throw new Error("name is over 250 characters.");
  const cur = checkCurrency(currency);
  const minor = toMinor(amount, cur);
  const call = client(deps);
  const price = await call("POST", "/prices", { currency: cur, unit_amount: minor, product_data: { name: title } });
  const link = await call("POST", "/payment_links", { line_items: [{ price: price.id, quantity: 1 }] });
  return { created: true, mode: call.mode, url: link.url, id: link.id, name: title, amount: toMajor(minor, cur), currency: cur.toUpperCase() };
}

export async function listPayments({ customer, limit = 10 } = {}, deps = {}) {
  const call = client(deps);
  const data = await call("GET", "/payment_intents", {
    ...(customer ? { customer: cleanId(customer, "cus", "customer") } : {}),
    limit: clamp(Math.trunc(Number(limit)) || 10, 1, 100),
  });
  const payments = (data.data || []).map((p) => ({
    id: p.id,
    status: p.status,
    amount: toMajor(p.amount, p.currency),
    received: toMajor(p.amount_received, p.currency),
    currency: p.currency?.toUpperCase(),
    customer: typeof p.customer === "string" ? p.customer : p.customer?.id ?? null,
    ...(p.description ? { description: String(p.description).slice(0, 200) } : {}),
    created: iso(p.created),
  }));
  return { mode: call.mode, count: payments.length, payments, notice: UNTRUSTED_NOTICE };
}

export async function refund({ payment, amount, reason, confirm } = {}, deps = {}) {
  const id = cleanId(payment, "pi", "payment");
  if (reason !== undefined && !["duplicate", "fraudulent", "requested_by_customer"].includes(reason)) {
    throw new Error("reason must be duplicate, fraudulent or requested_by_customer.");
  }
  const call = client(deps);
  const pi = await call("GET", `/payment_intents/${id}`);
  const received = pi.amount_received ?? 0;
  if (!received) throw new Error(`Payment ${id} has nothing to refund (status ${pi.status}).`);
  let minor;
  if (amount !== undefined && amount !== null && amount !== "") {
    minor = toMinor(amount, pi.currency, "amount");
    if (minor > received) throw new Error(`amount ${toMajor(minor, pi.currency)} is more than the ${toMajor(received, pi.currency)} ${pi.currency.toUpperCase()} received.`);
  }
  const r = await call("POST", "/refunds", { payment_intent: id, ...(minor ? { amount: minor } : {}), ...(reason ? { reason } : {}) });
  return {
    refunded: true,
    mode: call.mode,
    refund_id: r.id,
    status: r.status,
    amount: toMajor(r.amount, r.currency),
    currency: r.currency?.toUpperCase(),
    full_refund: !minor || minor === received,
  };
}
