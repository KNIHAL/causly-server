import { describe, it, expect, beforeEach } from "vitest";
import * as stripe from "../tools/stripeOps.js";

const KEY = "sk_test_SECRET123";

/** fetch stub: handler gets { method, path, params } (query or form fields); return a Stripe object or { __error }. */
function stub(handler) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || "GET";
    const raw = method === "GET" ? u.searchParams : new URLSearchParams(init.body || "");
    const call = { method, path: u.pathname.replace("/v1", ""), params: Object.fromEntries(raw), headers: init.headers };
    calls.push(call);
    const out = await handler(call);
    if (out instanceof Error) throw out;
    if (out?.__error) return { ok: false, status: out.__error, json: async () => ({ error: { message: out.message || "x" } }) };
    return { ok: true, status: 200, json: async () => out };
  };
  return { deps: { fetch }, calls };
}

const invoice = (extra = {}) => ({ id: "in_1", status: "draft", customer: "cus_1", customer_email: "a@x.com", currency: "usd", total: 150000, amount_due: 150000, amount_paid: 0, due_date: null, created: 1_792_000_000, hosted_invoice_url: null, ...extra });

beforeEach(() => {
  process.env.STRIPE_API_KEY = KEY;
  delete process.env.STRIPE_ALLOW_LIVE;
  delete process.env.STRIPE_DEFAULT_CURRENCY;
});

describe("stripeOps — money", () => {
  it("converts normal units to the smallest unit and back", () => {
    expect(stripe.toMinor(500, "usd")).toBe(50000);
    expect(stripe.toMinor(19.99, "usd")).toBe(1999);
    expect(stripe.toMinor(0.1 + 0.2, "usd")).toBe(30);
    expect(stripe.toMinor(500, "jpy")).toBe(500);
    expect(stripe.toMinor(1.5, "kwd")).toBe(1500);
    expect(stripe.toMajor(1999, "usd")).toBe(19.99);
    expect(stripe.toMajor(500, "jpy")).toBe(500);
  });

  it("rejects zero, negatives, junk, extra decimals and huge amounts", () => {
    expect(() => stripe.toMinor(0, "usd")).toThrow(/positive/);
    expect(() => stripe.toMinor(-5, "usd")).toThrow(/positive/);
    expect(() => stripe.toMinor("abc", "usd")).toThrow(/positive/);
    expect(() => stripe.toMinor(10.005, "usd")).toThrow(/too many decimals/);
    expect(() => stripe.toMinor(10.5, "jpy")).toThrow(/too many decimals/);
    expect(() => stripe.toMinor(1_000_000, "usd")).toThrow(/maximum/);
  });

  it("picks a default currency and validates codes", () => {
    expect(stripe.checkCurrency(undefined, {})).toBe("usd");
    expect(stripe.checkCurrency(undefined, { STRIPE_DEFAULT_CURRENCY: "INR" })).toBe("inr");
    expect(stripe.checkCurrency("EUR")).toBe("eur");
    expect(() => stripe.checkCurrency("dollars")).toThrow(/3-letter/);
  });

  it("encodes nested objects and arrays in Stripe's bracket form", () => {
    const s = stripe.encode({ a: 1, line_items: [{ price: "price_1", quantity: 2 }], product_data: { name: "X y" }, skip: undefined, none: null, flag: false }).toString();
    expect(decodeURIComponent(s.replace(/\+/g, " "))).toBe("a=1&line_items[0][price]=price_1&line_items[0][quantity]=2&product_data[name]=X y&flag=false");
  });
});

describe("stripeOps — safety and errors", () => {
  it("explains a missing key", async () => {
    delete process.env.STRIPE_API_KEY;
    await expect(stripe.getAccount({}, stub(() => ({})).deps)).rejects.toThrow(/STRIPE_API_KEY/);
  });

  it("refuses a live key unless explicitly allowed, without calling Stripe", async () => {
    process.env.STRIPE_API_KEY = "sk_live_abc";
    const { deps, calls } = stub(() => ({ available: [], pending: [] }));
    await expect(stripe.getAccount({}, deps)).rejects.toThrow(/LIVE key/);
    process.env.STRIPE_API_KEY = "rk_live_abc";
    await expect(stripe.listCustomers({}, deps)).rejects.toThrow(/LIVE key/);
    expect(calls).toHaveLength(0);

    process.env.STRIPE_ALLOW_LIVE = "true";
    process.env.STRIPE_API_KEY = "sk_live_abc";
    expect((await stripe.getAccount({}, deps)).mode).toBe("live");
  });

  it("reports test mode and uses bearer auth", async () => {
    const { deps, calls } = stub(() => ({ available: [{ currency: "usd", amount: 123456 }], pending: [{ currency: "jpy", amount: 900 }] }));
    const r = await stripe.getAccount({}, deps);
    expect(calls[0].headers.authorization).toBe(`Bearer ${KEY}`);
    expect(r).toEqual({ mode: "test", available: [{ currency: "USD", amount: 1234.56 }], pending: [{ currency: "JPY", amount: 900 }] });
  });

  it("adds an idempotency key to POSTs only", async () => {
    const { deps, calls } = stub(() => ({ id: "cus_9", email: "n@x.com" }));
    await stripe.createCustomer({ email: "N@x.com", name: "New" }, deps);
    expect(calls[0].headers["idempotency-key"]).toBeTruthy();
    expect(calls[0].params).toEqual({ email: "n@x.com", name: "New" });
    const g = stub(() => ({ data: [] }));
    await stripe.listCustomers({}, g.deps);
    expect(g.calls[0].headers["idempotency-key"]).toBeUndefined();
  });

  it("maps 401, 403, 429 and API errors, and never leaks the key", async () => {
    await expect(stripe.getAccount({}, stub(() => ({ __error: 401 })).deps)).rejects.toThrow(/rejected the API key/);
    await expect(stripe.getAccount({}, stub(() => ({ __error: 403, message: "no perm" })).deps)).rejects.toThrow(/restricted key/);
    await expect(stripe.getAccount({}, stub(() => ({ __error: 429 })).deps)).rejects.toThrow(/rate limit/);
    await expect(stripe.getAccount({}, stub(() => ({ __error: 400, message: `Invalid ${KEY}` })).deps)).rejects.toThrow(/\[REDACTED\]/);
    const leak = stub(() => new Error(`boom ${KEY}`));
    await stripe.getAccount({}, leak.deps).catch((e) => {
      expect(e.message).toMatch(/Could not reach Stripe/);
      expect(e.message).not.toContain("SECRET123");
    });
  });
});

describe("stripeOps — customers", () => {
  it("lists by email, and searches by name with quotes escaped", async () => {
    const { deps, calls } = stub((c) => ({ data: [{ id: "cus_1", name: "Asha", email: "a@x.com", created: 1_792_000_000 }] }));
    const r = await stripe.listCustomers({ email: "A@X.com" }, deps);
    expect(calls[0].path).toBe("/customers");
    expect(calls[0].params).toMatchObject({ email: "a@x.com", limit: "10" });
    expect(r.customers[0]).toMatchObject({ id: "cus_1", name: "Asha" });
    await stripe.listCustomers({ query: 'O"Brien' }, deps);
    expect(calls[1].path).toBe("/customers/search");
    expect(calls[1].params.query).toBe('name~"O\\"Brien"');
  });

  it("validates emails and requires something to create", async () => {
    const { deps, calls } = stub(() => ({}));
    await expect(stripe.listCustomers({ email: "nope" }, deps)).rejects.toThrow(/valid email/);
    await expect(stripe.createCustomer({}, deps)).rejects.toThrow(/email or a name/);
    expect(calls).toHaveLength(0);
  });
});

describe("stripeOps — invoices", () => {
  const route = (c) => {
    if (c.method === "GET" && c.path === "/customers") return { data: [] };
    if (c.method === "POST" && c.path === "/customers") return { id: "cus_new" };
    if (c.method === "POST" && c.path === "/invoices") return { id: "in_1" };
    if (c.method === "POST" && c.path === "/invoiceitems") return { id: "ii_1" };
    if (c.method === "GET" && c.path === "/invoices/in_1") return invoice({ customer: "cus_new" });
    return {};
  };

  it("builds a draft: creates the customer, then the invoice, then its items", async () => {
    const { deps, calls } = stub(route);
    const r = await stripe.createInvoice(
      { customer: "New@Client.com", customer_name: "Client Co", currency: "USD", items: [{ description: "Website build", amount: 1000 }, { description: "Hosting", amount: 25.5, quantity: 2 }], memo: "Thanks!" },
      deps
    );
    const seq = calls.map((c) => `${c.method} ${c.path}`);
    expect(seq).toEqual(["GET /customers", "POST /customers", "POST /invoices", "POST /invoiceitems", "POST /invoiceitems", "GET /invoices/in_1"]);
    expect(calls[1].params).toEqual({ email: "new@client.com", name: "Client Co" });
    expect(calls[2].params).toEqual({ customer: "cus_new", currency: "usd", collection_method: "send_invoice", days_until_due: "14", auto_advance: "false", pending_invoice_items_behavior: "exclude", description: "Thanks!" });
    expect(calls[3].params).toEqual({ customer: "cus_new", invoice: "in_1", currency: "usd", description: "Website build", quantity: "1", unit_amount: "100000" });
    expect(calls[4].params).toMatchObject({ description: "Hosting", quantity: "2", unit_amount: "2550" });
    expect(r).toMatchObject({ created: true, mode: "test", customer_created: true, invoice: { id: "in_1", status: "draft", total: 1500, currency: "USD" } });
    expect(r.next).toMatch(/nothing was sent/i);
  });

  it("reuses an existing customer id without any customer calls", async () => {
    const { deps, calls } = stub(route);
    await stripe.createInvoice({ customer: "cus_1", items: [{ description: "Retainer", amount: 500 }] }, deps);
    expect(calls.some((c) => c.path === "/customers")).toBe(false);
  });

  it("deletes the half-built draft if a line item fails", async () => {
    const { deps, calls } = stub((c) => (c.path === "/invoiceitems" ? { __error: 400, message: "bad item" } : c.method === "DELETE" ? { deleted: true } : route(c)));
    await expect(stripe.createInvoice({ customer: "cus_1", items: [{ description: "x", amount: 5 }] }, deps)).rejects.toThrow(/bad item/);
    expect(calls.some((c) => c.method === "DELETE" && c.path === "/invoices/in_1")).toBe(true);
  });

  it("validates items before any call", async () => {
    const { deps, calls } = stub(route);
    await expect(stripe.createInvoice({ customer: "cus_1", items: [] }, deps)).rejects.toThrow(/items is required/);
    await expect(stripe.createInvoice({ customer: "cus_1", items: [{ description: " ", amount: 5 }] }, deps)).rejects.toThrow(/needs a description/);
    await expect(stripe.createInvoice({ customer: "cus_1", items: [{ description: "x", amount: 0 }] }, deps)).rejects.toThrow(/positive/);
    await expect(stripe.createInvoice({ customer: "cus_1", items: [{ description: "x", amount: 5, quantity: 1.5 }] }, deps)).rejects.toThrow(/quantity/);
    await expect(stripe.createInvoice({ customer: "not a customer", items: [{ description: "x", amount: 5 }] }, deps)).rejects.toThrow(/customer id/);
    expect(calls).toHaveLength(0);
  });

  it("finalizes a draft, then sends it", async () => {
    const { deps, calls } = stub((c) => {
      if (c.method === "GET") return invoice();
      if (c.path.endsWith("/finalize")) return invoice({ status: "open", number: "ABC-0001", hosted_invoice_url: "https://pay.stripe.com/i/1", due_date: 1_793_000_000 });
      if (c.path.endsWith("/send")) return invoice({ status: "open", number: "ABC-0001", hosted_invoice_url: "https://pay.stripe.com/i/1", due_date: 1_793_000_000 });
      return {};
    });
    const r = await stripe.sendInvoice({ invoice: "in_1", confirm: true }, deps);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /invoices/in_1", "POST /invoices/in_1/finalize", "POST /invoices/in_1/send"]);
    expect(r).toMatchObject({ sent: true, invoice: { number: "ABC-0001", status: "open", hosted_invoice_url: "https://pay.stripe.com/i/1" } });
  });

  it("only sends an already-open invoice, and refuses paid, void or empty ones", async () => {
    const open = stub((c) => (c.method === "GET" ? invoice({ status: "open" }) : invoice({ status: "open" })));
    await stripe.sendInvoice({ invoice: "in_1", confirm: true }, open.deps);
    expect(open.calls.map((c) => c.path)).toEqual(["/invoices/in_1", "/invoices/in_1/send"]);

    await expect(stripe.sendInvoice({ invoice: "in_1", confirm: true }, stub(() => invoice({ status: "paid" })).deps)).rejects.toThrow(/is paid/);
    await expect(stripe.sendInvoice({ invoice: "in_1", confirm: true }, stub(() => invoice({ status: "void" })).deps)).rejects.toThrow(/is void/);
    await expect(stripe.sendInvoice({ invoice: "in_1", confirm: true }, stub(() => invoice({ total: 0 })).deps)).rejects.toThrow(/no amount/);
    await expect(stripe.sendInvoice({ invoice: "abc", confirm: true }, stub(() => ({})).deps)).rejects.toThrow(/in_/);
  });

  it("lists invoices with filters and major-unit amounts", async () => {
    const { deps, calls } = stub(() => ({ data: [invoice({ status: "open", amount_due: 5000, total: 5000, due_date: 1_793_000_000 })] }));
    const r = await stripe.listInvoices({ customer: "cus_1", status: "open", limit: 500 }, deps);
    expect(calls[0].params).toEqual({ customer: "cus_1", status: "open", limit: "100" });
    expect(r.invoices[0]).toMatchObject({ id: "in_1", status: "open", total: 50, amount_due: 50, currency: "USD", customer: "a@x.com" });
    await expect(stripe.listInvoices({ status: "weird" }, deps)).rejects.toThrow(/status must be/);
  });
});

describe("stripeOps — payment links and payments", () => {
  it("creates a price, then a link, and returns the url", async () => {
    const { deps, calls } = stub((c) => (c.path === "/prices" ? { id: "price_1" } : { id: "plink_1", url: "https://buy.stripe.com/test_abc" }));
    const r = await stripe.createPaymentLink({ name: "Strategy call", amount: 99.5, currency: "eur", confirm: true }, deps);
    expect(calls[0].params).toEqual({ currency: "eur", unit_amount: "9950", "product_data[name]": "Strategy call" });
    expect(calls[1].params).toEqual({ "line_items[0][price]": "price_1", "line_items[0][quantity]": "1" });
    expect(r).toEqual({ created: true, mode: "test", url: "https://buy.stripe.com/test_abc", id: "plink_1", name: "Strategy call", amount: 99.5, currency: "EUR" });
  });

  it("validates before creating anything", async () => {
    const { deps, calls } = stub(() => ({}));
    await expect(stripe.createPaymentLink({ amount: 5 }, deps)).rejects.toThrow(/name is required/);
    await expect(stripe.createPaymentLink({ name: "x", amount: -5 }, deps)).rejects.toThrow(/positive/);
    expect(calls).toHaveLength(0);
  });

  it("lists payments in normal units", async () => {
    const { deps } = stub(() => ({ data: [{ id: "pi_1", status: "succeeded", amount: 5000, amount_received: 5000, currency: "usd", customer: "cus_1", created: 1_792_000_000 }] }));
    const r = await stripe.listPayments({}, deps);
    expect(r.payments[0]).toMatchObject({ id: "pi_1", status: "succeeded", amount: 50, received: 50, currency: "USD", customer: "cus_1" });
  });
});

describe("stripeOps — refund", () => {
  const pi = { id: "pi_1", status: "succeeded", amount: 10000, amount_received: 10000, currency: "usd" };

  it("refunds in full when no amount is given", async () => {
    const { deps, calls } = stub((c) => (c.method === "GET" ? pi : { id: "re_1", status: "succeeded", amount: 10000, currency: "usd" }));
    const r = await stripe.refund({ payment: "pi_1", reason: "requested_by_customer", confirm: true }, deps);
    expect(calls[1].params).toEqual({ payment_intent: "pi_1", reason: "requested_by_customer" });
    expect(r).toMatchObject({ refunded: true, amount: 100, currency: "USD", full_refund: true });
  });

  it("refunds part, converting with the payment's own currency", async () => {
    const { deps, calls } = stub((c) => (c.method === "GET" ? pi : { id: "re_2", status: "succeeded", amount: 2550, currency: "usd" }));
    const r = await stripe.refund({ payment: "pi_1", amount: 25.5, confirm: true }, deps);
    expect(calls[1].params.amount).toBe("2550");
    expect(r).toMatchObject({ amount: 25.5, full_refund: false });
  });

  it("refuses to refund more than was received or an unpaid payment, and posts nothing", async () => {
    const over = stub(() => pi);
    await expect(stripe.refund({ payment: "pi_1", amount: 150, confirm: true }, over.deps)).rejects.toThrow(/more than the 100/);
    const unpaid = stub(() => ({ ...pi, status: "requires_payment_method", amount_received: 0 }));
    await expect(stripe.refund({ payment: "pi_1", confirm: true }, unpaid.deps)).rejects.toThrow(/nothing to refund/);
    expect([...over.calls, ...unpaid.calls].some((c) => c.method === "POST")).toBe(false);
  });

  it("validates the payment id and reason first", async () => {
    const { deps, calls } = stub(() => ({}));
    await expect(stripe.refund({ payment: "ch_1", confirm: true }, deps)).rejects.toThrow(/pi_/);
    await expect(stripe.refund({ payment: "pi_1", reason: "because", confirm: true }, deps)).rejects.toThrow(/reason must be/);
    expect(calls).toHaveLength(0);
  });
});
