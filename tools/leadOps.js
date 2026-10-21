// Lead discovery from free, keyless public sources. No new dependencies.
//
//   lead_hn_hiring        companies hiring in Hacker News "Who is hiring?" threads
//   lead_remote_jobs      remote jobs from RemoteOK and We Work Remotely
//   lead_company_contacts public contact details from a company's own website
//
// All requests go through webOps.fetchRaw, so they share its SSRF guard, size
// limits and timeouts. Everything returned is untrusted third-party content.
import { fetchRaw, htmlToText, decodeEntities, parseHttpUrl, metaContent, cleanInline, UNTRUSTED_NOTICE } from "./webOps.js";

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const GUIDANCE =
  "Public business contact details only. Check local rules (for example GDPR, CAN-SPAM) before cold outreach.";

async function getJson(get, url) {
  const res = await get(url);
  if (res.status !== 200 || res.kind === "binary") throw new Error(`${new URL(url).hostname} answered HTTP ${res.status}.`);
  try {
    return JSON.parse(res.raw);
  } catch {
    throw new Error(`${new URL(url).hostname} did not return valid JSON.`);
  }
}

// ---------------------------------------------------------------- extraction helpers

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const NOT_EMAIL_TLDS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "css", "js", "ico", "woff", "woff2"]);
const PLACEHOLDER_DOMAINS = new Set(["example.com", "example.org", "domain.com", "email.com", "yourdomain.com", "yoursite.com", "sentry.io"]);
const ROLE_NAMES = new Set([
  "info", "hello", "hi", "contact", "sales", "support", "team", "office", "admin", "careers", "jobs", "hr",
  "press", "media", "help", "enquiries", "inquiries", "mail", "marketing", "billing", "accounts", "partnerships", "business",
]);

/** Email addresses found in text or HTML: [{ email, role }]. role = shared mailbox such as info@. */
export function extractEmails(text) {
  const found = new Map();
  for (const m of String(text).matchAll(EMAIL_RE)) {
    const email = m[0].toLowerCase();
    const [local, domain] = email.split("@");
    const blockedDomain = [...PLACEHOLDER_DOMAINS].some((d) => domain === d || domain.endsWith(`.${d}`));
    // Long hex local parts are tracking keys (for example Sentry DSNs), not mailboxes.
    if (NOT_EMAIL_TLDS.has(domain.split(".").pop()) || blockedDomain || /^[a-f0-9]{24,}$/.test(local)) continue;
    if (!found.has(email)) found.set(email, { email, role: ROLE_NAMES.has(local) });
  }
  return [...found.values()];
}

// Keeps one entry per number: "+1 415 555 0100" and "(415) 555-0100" are the same phone,
// so a number that is the tail of another is a duplicate (the fuller form wins).
function addPhone(out, raw) {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return;
  for (const key of out.keys()) {
    if (key.endsWith(digits)) return;
    if (digits.endsWith(key)) {
      out.delete(key);
      break;
    }
  }
  out.set(digits, raw.replace(/\s+/g, " ").trim());
}

/** Phone numbers from tel: links and international (+...) or US-style numbers in text. */
export function extractPhones(html, text) {
  const out = new Map();
  for (const m of String(html).matchAll(/href\s*=\s*["']tel:([^"']+)["']/gi)) {
    try {
      addPhone(out, decodeURIComponent(m[1]));
    } catch {
      addPhone(out, m[1]);
    }
  }
  for (const m of String(text).matchAll(/(?<![\w.])\+\d{1,3}[\s().-]*\d[\d\s().-]{6,16}\d/g)) addPhone(out, m[0]);
  for (const m of String(text).matchAll(/(?<![\w.])\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?!\d)/g)) addPhone(out, m[0]);
  return [...out.values()].slice(0, 5);
}

const SOCIAL_RULES = [
  ["linkedin", (u) => /(^|\.)linkedin\.com$/.test(u.hostname) && /^\/(company|in|school)\/[^/]+/.test(u.pathname)],
  [
    "twitter",
    (u) =>
      /^(www\.)?(twitter|x)\.com$/.test(u.hostname) &&
      /^\/[A-Za-z0-9_]{1,15}\/?$/.test(u.pathname) &&
      !/^\/(share|intent|home|search)\/?$/i.test(u.pathname),
  ],
  ["github", (u) => /^(www\.)?github\.com$/.test(u.hostname) && /^\/[A-Za-z0-9-]+\/?$/.test(u.pathname)],
  ["facebook", (u) => /(^|\.)facebook\.com$/.test(u.hostname) && /^\/[^/]+/.test(u.pathname) && !/^\/(sharer|share|dialog|tr)\b/i.test(u.pathname)],
  ["instagram", (u) => /(^|\.)instagram\.com$/.test(u.hostname) && /^\/[A-Za-z0-9._]+\/?$/.test(u.pathname)],
  ["youtube", (u) => /(^|\.)youtube\.com$/.test(u.hostname) && /^\/(@|channel\/|c\/|user\/)/.test(u.pathname)],
];

function classifySocial(url) {
  for (const [name, test] of SOCIAL_RULES) {
    if (test(url)) return [name, url.origin + url.pathname.replace(/\/$/, "")];
  }
  return null;
}

/** First profile link per platform found in the page's hrefs. */
export function extractSocial(html, baseUrl) {
  const social = {};
  for (const m of String(html).matchAll(/href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    let url;
    try {
      url = new URL(decodeEntities(m[1] ?? m[2] ?? ""), baseUrl);
    } catch {
      continue;
    }
    const hit = classifySocial(url);
    if (hit && !social[hit[0]]) social[hit[0]] = hit[1];
  }
  return social;
}

const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Organization details from schema.org JSON-LD blocks. */
export function parseJsonLd(html) {
  const org = {};
  for (const m of String(html).matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const nodes = [];
    const walk = (n) => {
      if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === "object") {
        nodes.push(n);
        if (n["@graph"]) walk(n["@graph"]);
      }
    };
    walk(data);
    for (const n of nodes) {
      const types = [].concat(n["@type"] ?? []).map(String);
      if (!types.some((t) => /Organization|LocalBusiness|Corporation|ProfessionalService|Company/i.test(t))) continue;
      org.name ??= str(n.name);
      org.email ??= str(n.email);
      org.telephone ??= str(n.telephone);
      org.description ??= str(n.description);
      if (!org.address && n.address) {
        const a = n.address;
        org.address =
          typeof a === "string"
            ? a
            : [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry].filter((x) => typeof x === "string").join(", ") ||
              undefined;
      }
      if (Array.isArray(n.sameAs)) org.sameAs = [...(org.sameAs ?? []), ...n.sameAs.filter((s) => typeof s === "string")];
    }
  }
  return org;
}

// ---------------------------------------------------------------- lead_hn_hiring

const hnLink = (id) => `https://news.ycombinator.com/item?id=${id}`;

/** Companies hiring in Hacker News "Who is hiring?" posts, searched by keyword. */
export async function hnHiring({ query = "", limit = 10, thread_id } = {}, deps = {}) {
  const get = deps.fetchRaw ?? fetchRaw;
  const n = clamp(Math.trunc(limit) || 10, 1, 30);

  let thread;
  if (thread_id !== undefined) {
    if (!/^\d+$/.test(String(thread_id))) throw new Error("thread_id must be a number.");
    thread = { id: String(thread_id) };
  } else {
    const list = await getJson(
      get,
      `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent('"Ask HN: Who is hiring?"')}&tags=story,author_whoishiring&hitsPerPage=5`
    );
    const hit = (list.hits || []).find((h) => /who is hiring\?/i.test(h.title || ""));
    if (!hit) throw new Error('Could not find the latest "Who is hiring?" thread.');
    thread = { id: String(hit.objectID), title: hit.title, posted_at: hit.created_at };
  }

  // Replies to job posts match too, so ask for extra hits and keep only top-level posts.
  const data = await getJson(
    get,
    `https://hn.algolia.com/api/v1/search?tags=comment,story_${thread.id}&query=${encodeURIComponent(String(query).trim())}&hitsPerPage=${Math.min(n * 4, 100)}`
  );
  const posts = [];
  for (const hit of data.hits || []) {
    if (String(hit.parent_id) !== thread.id) continue;
    const html = String(hit.comment_text || "").replace(/<p>/gi, "<br><br>");
    const page = htmlToText(html, "https://news.ycombinator.com/", { includeLinks: true });
    const firstLine = page.text.split("\n").find((l) => l.trim()) || "";
    posts.push({
      id: hit.objectID,
      url: hnLink(hit.objectID),
      author: hit.author,
      posted_at: hit.created_at,
      company: firstLine.split("|")[0].trim().slice(0, 80),
      headline: firstLine.slice(0, 200),
      text: page.text.slice(0, 700),
      emails: extractEmails(`${page.text} ${page.links.map((l) => l.url).join(" ")}`).map((e) => e.email),
      links: page.links.map((l) => l.url).slice(0, 5),
    });
    if (posts.length >= n) break;
  }
  return {
    thread: { ...thread, url: hnLink(thread.id) },
    query: String(query).trim(),
    count: posts.length,
    posts,
    notice: UNTRUSTED_NOTICE,
  };
}

// ---------------------------------------------------------------- lead_remote_jobs

const tokens = (query) => String(query ?? "").toLowerCase().split(/[^\p{L}\p{N}+#.]+/u).filter(Boolean);
const matchesAll = (words, haystack) => words.every((w) => haystack.includes(w));

function toIso(value) {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

const unCdata = (s) => s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");

/** Parse an RSS feed into [{ title, link, published, region, category, description }]. */
export function parseRss(xml) {
  const items = [];
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const field = (name) => {
      const t = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block);
      return t ? t[1] : "";
    };
    const rawDescription = field("description");
    const descriptionHtml = /<!\[CDATA\[/.test(rawDescription) ? unCdata(rawDescription) : decodeEntities(rawDescription);
    const link = (unCdata(field("link")) || unCdata(field("guid"))).trim();
    items.push({
      title: decodeEntities(unCdata(field("title"))).trim(),
      link,
      published: toIso(field("pubDate")),
      region: decodeEntities(unCdata(field("region"))).trim(),
      category: decodeEntities(unCdata(field("category"))).trim(),
      description: htmlToText(descriptionHtml, link || "https://weworkremotely.com/").text,
    });
  }
  return items;
}

// RemoteOK's API double-encodes non-ASCII text (UTF-8 read as Latin-1, then encoded again),
// which turns "México" into "MÃ©xico". Undo that when the text looks affected.
export function fixMojibake(value) {
  const s = typeof value === "string" ? value : "";
  if (!/[\u00c2-\u00f4][\u0080-\u00bf]/.test(s) || [...s].some((c) => c.codePointAt(0) > 0xff)) return s;
  const repaired = Buffer.from(s, "latin1").toString("utf8");
  return repaired.includes("\ufffd") ? s : repaired;
}

async function remoteOk(get, words) {
  const data = await getJson(get, "https://remoteok.com/api");
  const jobs = (Array.isArray(data) ? data : []).filter((j) => j && j.position);
  const terms = Array.isArray(data) && data[0]?.legal ? String(data[0].legal) : undefined;
  const items = [];
  for (const raw of jobs) {
    const j = {
      ...raw,
      company: fixMojibake(raw.company),
      position: fixMojibake(raw.position),
      location: fixMojibake(raw.location),
      description: fixMojibake(raw.description),
      tags: Array.isArray(raw.tags) ? raw.tags.map(fixMojibake) : [],
    };
    const description = htmlToText(String(j.description || ""), "https://remoteok.com/").text;
    const tags = Array.isArray(j.tags) ? j.tags : [];
    const hay = `${j.company} ${j.position} ${tags.join(" ")} ${j.location || ""} ${description}`.toLowerCase();
    if (!matchesAll(words, hay)) continue;
    items.push({
      source: "RemoteOK",
      company: j.company || "",
      position: j.position,
      tags: tags.slice(0, 8),
      location: j.location || "",
      salary: j.salary_min || j.salary_max ? { min: j.salary_min || undefined, max: j.salary_max || undefined } : undefined,
      published: toIso(j.date),
      url: j.url,
      apply_url: j.apply_url || undefined,
      summary: description.slice(0, 400),
    });
  }
  return { items, terms };
}

async function weWorkRemotely(get, words) {
  const res = await get("https://weworkremotely.com/categories/remote-programming-jobs.rss");
  if (res.status !== 200 || res.kind === "binary") throw new Error(`weworkremotely.com answered HTTP ${res.status}.`);
  const items = [];
  for (const item of parseRss(res.raw)) {
    const hay = `${item.title} ${item.region} ${item.category} ${item.description}`.toLowerCase();
    if (!matchesAll(words, hay)) continue;
    const sep = item.title.indexOf(": ");
    items.push({
      source: "We Work Remotely",
      company: sep > 0 ? item.title.slice(0, sep) : "",
      position: sep > 0 ? item.title.slice(sep + 2) : item.title,
      tags: item.category ? [item.category] : [],
      location: item.region,
      published: item.published,
      url: item.link,
      summary: item.description.slice(0, 400),
    });
  }
  return { items };
}

/** Remote jobs from RemoteOK and We Work Remotely (programming), filtered by keywords. */
export async function remoteJobs({ query = "", limit = 10 } = {}, deps = {}) {
  const get = deps.fetchRaw ?? fetchRaw;
  const n = clamp(Math.trunc(limit) || 10, 1, 30);
  const words = tokens(query);

  const [ok, wwr] = await Promise.allSettled([remoteOk(get, words), weWorkRemotely(get, words)]);
  const errors = [];
  const items = [];
  let terms;
  if (ok.status === "fulfilled") {
    items.push(...ok.value.items);
    terms = ok.value.terms;
  } else errors.push({ source: "RemoteOK", error: ok.reason.message });
  if (wwr.status === "fulfilled") items.push(...wwr.value.items);
  else errors.push({ source: "We Work Remotely", error: wwr.reason.message });
  if (errors.length === 2) throw new Error(`Both job sources failed: ${errors.map((e) => `${e.source}: ${e.error}`).join("; ")}`);

  items.sort((a, b) => (b.published || "").localeCompare(a.published || ""));
  return {
    query: String(query).trim(),
    count: Math.min(items.length, n),
    jobs: items.slice(0, n),
    ...(errors.length ? { errors } : {}),
    attribution: "Jobs come from RemoteOK and We Work Remotely. Link back to the job URL when you share them.",
    ...(terms ? { remoteok_terms: terms } : {}),
    notice: UNTRUSTED_NOTICE,
  };
}

// ---------------------------------------------------------------- lead_company_contacts

const CONTACT_HINT = /contact|get[-_ ]in[-_ ]touch|reach[-_ ]us|about|team|company|impressum|imprint|support/i;
const STRONG_HINT = /contact|get[-_ ]in[-_ ]touch|reach[-_ ]us/i;
const SKIP_EXT = /\.(pdf|jpe?g|png|gif|svg|webp|zip|mp4|css|js)$/i;
const stripWww = (host) => host.replace(/^www\./, "");

function pickContactPages(html, baseUrl) {
  const baseHost = stripWww(baseUrl.hostname);
  const found = new Map();
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeEntities(m[1] ?? m[2] ?? "").trim();
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;
    let url;
    try {
      url = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || stripWww(url.hostname) !== baseHost || SKIP_EXT.test(url.pathname)) continue;
    if (url.pathname === baseUrl.pathname) continue;
    url.hash = "";
    const hay = `${url.pathname} ${cleanInline(m[3])}`;
    if (!CONTACT_HINT.test(hay)) continue;
    const score = STRONG_HINT.test(hay) ? 3 : /about|team|company/i.test(hay) ? 2 : 1;
    const key = url.origin + url.pathname;
    if (!found.has(key) || found.get(key).score < score) found.set(key, { url: url.toString(), score });
  }
  return [...found.values()].sort((a, b) => b.score - a.score).map((x) => x.url);
}

/** Public contact details for a company, read from its homepage and contact/about pages. */
export async function companyContacts({ url: input, max_pages = 3 } = {}, deps = {}) {
  const get = deps.fetchRaw ?? fetchRaw;
  const raw = String(input ?? "").trim();
  if (!raw) throw new Error("url is required.");
  const start = parseHttpUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  const extraPages = Number.isFinite(max_pages) ? clamp(Math.trunc(max_pages), 0, 5) : 3;

  const home = await get(start.toString());
  if (home.kind !== "html") throw new Error(`${start.hostname} did not return a web page (HTTP ${home.status}).`);
  const homeUrl = new URL(home.final_url);
  const pages = [{ url: home.final_url, html: home.raw }];
  const fetched = [{ url: home.final_url, status: home.status }];

  const found = pickContactPages(home.raw, homeUrl);
  const queue = found.length ? found : ["/contact", "/about"].map((p) => new URL(p, homeUrl).toString());
  for (const pageUrl of queue.slice(0, extraPages)) {
    try {
      const page = await get(pageUrl);
      fetched.push({ url: page.final_url, status: page.status });
      const sameSite = stripWww(new URL(page.final_url).hostname) === stripWww(homeUrl.hostname);
      if (page.kind === "html" && page.status < 400 && sameSite) pages.push({ url: page.final_url, html: page.raw });
    } catch (err) {
      fetched.push({ url: pageUrl, error: err.message });
    }
  }

  const emails = new Map();
  const phones = new Map();
  const social = {};
  let org = {};
  let siteName = "";
  let metaDescription = "";
  let title = "";
  for (const page of pages) {
    const body = decodeEntities(page.html.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " "));
    for (const e of extractEmails(body)) if (!emails.has(e.email)) emails.set(e.email, { ...e, source_page: page.url });
    const parsed = htmlToText(page.html, page.url);
    for (const phone of extractPhones(page.html, parsed.text)) addPhone(phones, phone);
    for (const [name, link] of Object.entries(extractSocial(page.html, page.url))) social[name] ??= link;
    org = { ...parseJsonLd(page.html), ...org };
    siteName ||= metaContent(page.html, "og:site_name");
    metaDescription ||= parsed.description;
    title ||= parsed.title;
  }
  if (org.email) for (const e of extractEmails(org.email)) if (!emails.has(e.email)) emails.set(e.email, { ...e, source_page: "JSON-LD" });
  if (org.telephone) addPhone(phones, org.telephone);
  for (const same of org.sameAs ?? []) {
    try {
      const hit = classifySocial(new URL(same));
      if (hit) social[hit[0]] ??= hit[1];
    } catch {
      // ignore malformed sameAs entries
    }
  }

  return {
    website: homeUrl.origin,
    company: {
      name: org.name || siteName || title,
      description: org.description || metaDescription || undefined,
      address: org.address,
    },
    emails: [...emails.values()],
    phones: [...phones.values()].slice(0, 5),
    social,
    pages_fetched: fetched,
    guidance: GUIDANCE,
    notice: UNTRUSTED_NOTICE,
  };
}
