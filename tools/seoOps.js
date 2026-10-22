// SEO and content tools built on free sources. No new dependencies.
//
//   seo_keyword_ideas   keyword ideas from search autocomplete (Google, Bing, DuckDuckGo)
//   seo_page_audit      on-page SEO audit of a live URL
//   seo_content_check   readability and SEO check of a draft (markdown or plain text)
//   seo_search_console  your own site's real queries, clicks and rankings (Google Search Console)
//
// Autocomplete shows what people really type, but it carries NO search volume.
import { fetchRaw, htmlToText, decodeEntities, metaContent, cleanInline, UNTRUSTED_NOTICE } from "./webOps.js";
import { googleCredentials, getAccessToken } from "./googleAuth.js";

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const round1 = (n) => Math.round(n * 10) / 10;
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- text helpers

export const wordsOf = (text) => String(text).match(/[\p{L}\p{N}][\p{L}\p{N}'\u2019-]*/gu) || [];

/** Occurrences of a word or phrase, ignoring case and matching whole words only. */
export function countKeyword(text, keyword) {
  const phrase = wordsOf(keyword).map(escapeRegExp).join("\\s+");
  if (!phrase) return 0;
  return (String(text).match(new RegExp(`(?<![\\p{L}\\p{N}])${phrase}(?![\\p{L}\\p{N}])`, "giu")) || []).length;
}

function countSyllables(word) {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = w.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

function splitSentences(plain) {
  return plain
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter((s) => wordsOf(s).length > 0);
}

/** Flesch reading ease (approximate, English only). */
export function readingEase(plain) {
  const words = wordsOf(plain);
  const sentences = splitSentences(plain);
  if (!words.length || !sentences.length) return null;
  const syllables = words.reduce((n, w) => n + countSyllables(w), 0);
  const score = 206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syllables / words.length);
  const rounded = round1(clamp(score, 0, 100));
  const level = rounded >= 70 ? "easy" : rounded >= 50 ? "standard" : rounded >= 30 ? "difficult" : "very difficult";
  return { score: rounded, level };
}

export function markdownToText(md) {
  return String(md)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "")
    .replace(/[*_~]{1,3}/g, "");
}

function keywordReport(keyword, { title, meta, h1s = [], headings = [], body, url }) {
  const words = wordsOf(body);
  const occurrences = countKeyword(body, keyword);
  const keywordWords = wordsOf(keyword).length || 1;
  const has = (text) => (text ? countKeyword(text, keyword) > 0 : false);
  const report = {
    keyword,
    occurrences,
    density_percent: words.length ? Math.round(((occurrences * keywordWords) / words.length) * 10000) / 100 : 0,
    in_title: has(title),
    in_meta_description: has(meta),
    in_h1: h1s.some(has),
    in_any_heading: headings.some((h) => has(h.text)),
    in_first_100_words: has(words.slice(0, 100).join(" ")),
  };
  if (url) {
    const slug = keyword.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, "-");
    let path = url;
    try {
      path = decodeURIComponent(new URL(url).pathname).toLowerCase();
    } catch {
      // keep the raw value
    }
    report.in_url = path.includes(slug);
  }
  return report;
}

function keywordIssues(r, { hasTitle, hasMeta }) {
  const issues = [];
  if (r.occurrences === 0) issues.push({ level: "warning", message: `The keyword "${r.keyword}" does not appear in the text.` });
  if (hasTitle && !r.in_title) issues.push({ level: "warning", message: "The keyword is not in the title." });
  if (!r.in_h1 && r.occurrences > 0) issues.push({ level: "info", message: "The keyword is not in the H1 heading." });
  if (!r.in_first_100_words && r.occurrences > 0) issues.push({ level: "info", message: "The keyword is not in the first 100 words." });
  if (hasMeta && !r.in_meta_description) issues.push({ level: "info", message: "The keyword is not in the meta description." });
  if (r.density_percent > 3) issues.push({ level: "warning", message: `Keyword density is ${r.density_percent}%, which looks like stuffing. Aim for roughly 0.5-2%.` });
  else if (r.occurrences > 0 && r.occurrences < 3 && r.density_percent < 0.3) {
    issues.push({ level: "info", message: "The keyword appears only a few times. Work it in naturally where it fits." });
  }
  return issues;
}

const lengthIssue = (label, text, min, max) => {
  if (!text) return { level: "warning", message: `${label} is missing.` };
  if (text.length > max) return { level: "warning", message: `${label} is ${text.length} characters (aim for ${min}-${max}); it may be cut off in results.` };
  if (text.length < min) return { level: "info", message: `${label} is only ${text.length} characters (aim for ${min}-${max}).` };
  return null;
};

const summarize = (issues) => {
  const warnings = issues.filter((i) => i.level === "warning").length;
  const tips = issues.length - warnings;
  return `${warnings} warning${warnings === 1 ? "" : "s"}, ${tips} tip${tips === 1 ? "" : "s"}`;
};

// ---------------------------------------------------------------- seo_content_check

/** Readability and SEO check of a draft written in markdown or plain text. */
export function contentCheck({ text, keyword, title, meta_description } = {}) {
  const md = String(text ?? "");
  if (!md.trim()) throw new Error("text is required.");
  const kw = keyword ? String(keyword).trim() : "";

  const headings = [...md.matchAll(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/gm)].map((m) => ({ level: m[1].length, text: m[2].trim() }));
  const h1s = headings.filter((h) => h.level === 1).map((h) => h.text);
  const plain = markdownToText(md);
  const words = wordsOf(plain);
  const sentences = splitSentences(plain);
  const sentenceLengths = sentences.map((s) => wordsOf(s).length);
  const headingLines = new Set(headings.map((h) => h.text));
  const paragraphs = markdownToText(md.replace(/^ {0,3}#{1,6}\s+.*$/gm, ""))
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const paragraphLengths = paragraphs.map((p) => wordsOf(p).length);
  const links = [...md.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)].map((m) => m[1]);
  const images = [...md.matchAll(/!\[([^\]]*)\]\([^)]*\)/g)];

  const metrics = {
    words: words.length,
    reading_minutes: words.length ? Math.max(1, Math.round(words.length / 200)) : 0,
    sentences: sentences.length,
    avg_sentence_words: sentences.length ? round1(words.length / sentences.length) : 0,
    longest_sentence_words: Math.max(0, ...sentenceLengths),
    long_sentences: sentenceLengths.filter((n) => n > 30).length,
    paragraphs: paragraphs.length,
    longest_paragraph_words: Math.max(0, ...paragraphLengths),
    reading_ease: readingEase(plain),
    headings: { count: headings.length, h1: h1s, outline: headings.slice(0, 40) },
    links: { total: links.length, external: links.filter((l) => /^https?:\/\//i.test(l)).length },
    images: { total: images.length, missing_alt: images.filter((m) => !m[1].trim()).length },
  };

  const issues = [];
  if (metrics.words < 300) issues.push({ level: "warning", message: `Only ${metrics.words} words. Short pages are often too thin to rank.` });
  if (metrics.words > 300 && headings.length === 0) issues.push({ level: "warning", message: "No headings. Break the text up with H2/H3 headings." });
  if (h1s.length > 1) issues.push({ level: "warning", message: `${h1s.length} H1 headings. Use exactly one.` });
  if (metrics.avg_sentence_words > 25) issues.push({ level: "warning", message: `Sentences average ${metrics.avg_sentence_words} words. Shorter sentences read better.` });
  if (metrics.long_sentences > 0) issues.push({ level: "info", message: `${metrics.long_sentences} sentence(s) over 30 words.` });
  if (metrics.reading_ease && metrics.reading_ease.score < 50) {
    issues.push({ level: "info", message: `Reading ease is ${metrics.reading_ease.score} (${metrics.reading_ease.level}). Simpler words and shorter sentences would help.` });
  }
  if (metrics.longest_paragraph_words > 120) issues.push({ level: "info", message: `A paragraph runs ${metrics.longest_paragraph_words} words. Split long paragraphs.` });
  if (metrics.images.missing_alt > 0) issues.push({ level: "warning", message: `${metrics.images.missing_alt} image(s) without alt text.` });
  if (metrics.words > 300 && metrics.links.total === 0) issues.push({ level: "info", message: "No links. Add links to related pages and sources." });
  if (title !== undefined) {
    const t = lengthIssue("The title", String(title).trim(), 30, 60);
    if (t) issues.push(t);
  }
  if (meta_description !== undefined) {
    const m = lengthIssue("The meta description", String(meta_description).trim(), 70, 160);
    if (m) issues.push(m);
  }

  let keywordResult;
  if (kw) {
    keywordResult = keywordReport(kw, {
      title: title === undefined ? undefined : String(title),
      meta: meta_description === undefined ? undefined : String(meta_description),
      h1s,
      headings: headings.filter((h) => headingLines.has(h.text)),
      body: plain,
    });
    issues.push(...keywordIssues(keywordResult, { hasTitle: title !== undefined, hasMeta: meta_description !== undefined }));
  }

  return { metrics, ...(keywordResult ? { keyword: keywordResult } : {}), issues, summary: summarize(issues), note: "Reading ease is approximate and tuned for English." };
}

// ---------------------------------------------------------------- seo_page_audit

const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? "") : undefined;
};

/** On-page SEO analysis of an HTML document. */
export function analyzeHtml(html, pageUrl, keyword) {
  const url = new URL(pageUrl);
  const host = url.hostname.replace(/^www\./, "");
  const clean = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ");
  const parsed = htmlToText(html, pageUrl);

  const headings = [...clean.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map((m) => ({ level: Number(m[1]), text: cleanInline(m[2]) }))
    .filter((h) => h.text);
  const h1s = headings.filter((h) => h.level === 1).map((h) => h.text);

  const canonicalTag = /<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/i.exec(clean)?.[0];
  const canonical = canonicalTag ? attr(canonicalTag, "href") : undefined;
  const robots = metaContent(html, "robots") || undefined;
  const lang = /<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i.exec(html)?.[1];
  const description = parsed.description;

  const imgTags = clean.match(/<img\b[^>]*>/gi) || [];
  const images = {
    total: imgTags.length,
    missing_alt: imgTags.filter((t) => attr(t, "alt") === undefined).length,
    empty_alt: imgTags.filter((t) => attr(t, "alt") === "").length,
  };

  let internal = 0;
  let external = 0;
  for (const m of clean.matchAll(/<a\b[^>]*>/gi)) {
    const href = attr(m[0], "href");
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;
    try {
      const link = new URL(href, pageUrl);
      if (!/^https?:$/.test(link.protocol)) continue;
      if (link.hostname.replace(/^www\./, "") === host) internal++;
      else external++;
    } catch {
      // skip malformed links
    }
  }

  const structuredTypes = [];
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (n) => {
        if (Array.isArray(n)) n.forEach(walk);
        else if (n && typeof n === "object") {
          for (const t of [].concat(n["@type"] ?? [])) if (typeof t === "string" && !structuredTypes.includes(t)) structuredTypes.push(t);
          if (n["@graph"]) walk(n["@graph"]);
        }
      };
      walk(JSON.parse(m[1]));
    } catch {
      // ignore invalid JSON-LD
    }
  }

  const bodyWords = wordsOf(parsed.text);
  const result = {
    title: { text: parsed.title, length: parsed.title.length },
    meta_description: { text: description, length: description.length },
    canonical,
    robots,
    lang,
    viewport: metaContent(html, "viewport") || undefined,
    headings: { h1: h1s, count: headings.length, outline: headings.slice(0, 40) },
    words: bodyWords.length,
    reading_minutes: bodyWords.length ? Math.max(1, Math.round(bodyWords.length / 200)) : 0,
    images,
    links: { internal, external },
    structured_data: structuredTypes,
    social: {
      og_title: metaContent(html, "og:title") || undefined,
      og_description: metaContent(html, "og:description") || undefined,
      og_image: metaContent(html, "og:image") || undefined,
      twitter_card: metaContent(html, "twitter:card") || undefined,
    },
  };

  const issues = [];
  const t = lengthIssue("The title", parsed.title, 30, 60);
  if (t) issues.push(t);
  const d = lengthIssue("The meta description", description, 70, 160);
  if (d) issues.push(d);
  if (h1s.length === 0) issues.push({ level: "warning", message: "No H1 heading." });
  if (h1s.length > 1) issues.push({ level: "warning", message: `${h1s.length} H1 headings. Use exactly one.` });
  if (/noindex/i.test(robots || "")) issues.push({ level: "warning", message: "The page is set to noindex, so search engines will not list it." });
  if (!canonical) issues.push({ level: "info", message: "No canonical link." });
  if (!lang) issues.push({ level: "info", message: "The <html> tag has no lang attribute." });
  if (!result.viewport) issues.push({ level: "warning", message: "No viewport meta tag, so the page may not be mobile friendly." });
  if (images.missing_alt > 0) issues.push({ level: "warning", message: `${images.missing_alt} image(s) without an alt attribute.` });
  if (result.words < 300) issues.push({ level: "warning", message: `Only ${result.words} words of text. Short pages are often too thin to rank.` });
  if (!result.social.og_title && !result.social.og_image) issues.push({ level: "info", message: "No Open Graph tags, so link previews on social sites will be plain." });
  if (internal === 0) issues.push({ level: "info", message: "No internal links." });

  let keywordResult;
  if (keyword) {
    keywordResult = keywordReport(String(keyword).trim(), {
      title: parsed.title,
      meta: description,
      h1s,
      headings,
      body: parsed.text,
      url: pageUrl,
    });
    issues.push(...keywordIssues(keywordResult, { hasTitle: true, hasMeta: true }));
  }

  return { ...result, ...(keywordResult ? { keyword: keywordResult } : {}), issues, summary: summarize(issues) };
}

/** Fetch a live page and audit its on-page SEO. */
export async function pageAudit({ url, keyword } = {}, deps = {}) {
  const get = deps.fetchRaw ?? fetchRaw;
  if (!url) throw new Error("url is required.");
  const started = Date.now();
  const page = await get(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
  const responseMs = Date.now() - started;
  if (page.kind !== "html") throw new Error(`${url} did not return a web page (HTTP ${page.status}).`);
  const audit = analyzeHtml(page.raw, page.final_url, keyword);
  if (page.status >= 400) audit.issues.unshift({ level: "warning", message: `The page answered HTTP ${page.status}.` });
  return {
    url,
    final_url: page.final_url,
    status: page.status,
    response_ms: responseMs,
    ...audit,
    summary: summarize(audit.issues),
    notice: UNTRUSTED_NOTICE,
  };
}

// ---------------------------------------------------------------- seo_keyword_ideas

const QUESTION_PREFIXES = ["how to", "what is", "why", "can", "is", "best"];
const MODIFIER_SUFFIXES = ["vs", "for", "with", "near me", "cost", "tools", "template", "examples"];
const ALPHABET = "abcdefghijklmnopqrstuvwxyz".split("");

export function buildQueries(seed, expand) {
  const s = seed.trim();
  const queries = [s];
  if (expand === "questions" || expand === "all") {
    for (const p of QUESTION_PREFIXES) queries.push(`${p} ${s}`);
    for (const m of MODIFIER_SUFFIXES) queries.push(`${s} ${m}`);
  }
  if (expand === "alphabet" || expand === "all") for (const l of ALPHABET) queries.push(`${s} ${l}`);
  return queries;
}

/** Parse an OpenSearch-style suggestion response: [query, [suggestions], ..., { "google:suggestrelevance": [...] }]. */
export function parseSuggest(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(data?.[1]) ? data[1] : [];
  const relevance = data?.[4]?.["google:suggestrelevance"];
  return list
    .map((phrase, i) => ({ phrase, rank: i + 1, relevance: Array.isArray(relevance) ? relevance[i] : undefined }))
    .filter((s) => typeof s.phrase === "string" && s.phrase.trim());
}

const enc = encodeURIComponent;
const SUGGEST_SOURCES = {
  google: (q, { country, language }) => `https://suggestqueries.google.com/complete/search?client=chrome&q=${enc(q)}&hl=${language}&gl=${country}`,
  bing: (q) => `https://api.bing.com/osjson.aspx?query=${enc(q)}`,
  duckduckgo: (q) => `https://duckduckgo.com/ac/?q=${enc(q)}&type=list`,
};

export function classifyIntent(keyword) {
  if (/^(how|what|why|when|where|who|which|can|is|are|does|do|should|will)\b/i.test(keyword)) return "question";
  if (/\b(vs\.?|versus|alternatives?|compare|comparison)\b/i.test(keyword)) return "comparison";
  if (/\b(best|top|review|reviews|pricing|price|cost|cheap|buy|hire|hiring|service|services|agency|near me|rates?|quote)\b/i.test(keyword)) return "commercial";
  return "general";
}

/** Keyword ideas from search autocomplete. No search volume: rank and agreement between sources are the signals. */
export async function keywordIdeas({ seed, expand = "questions", sources = ["google", "bing"], country = "us", language = "en", limit = 50 } = {}, deps = {}) {
  const get = deps.fetchRaw ?? fetchRaw;
  const wait = deps.sleep ?? sleep;
  const seedText = String(seed ?? "").trim();
  if (!seedText) throw new Error("seed is required.");
  if (seedText.length > 100) throw new Error("seed is too long (100 characters max).");
  if (!["none", "questions", "alphabet", "all"].includes(expand)) throw new Error("expand must be none, questions, alphabet or all.");
  const chosen = [...new Set(sources.map((s) => String(s).toLowerCase()))];
  const unknown = chosen.filter((s) => !SUGGEST_SOURCES[s]);
  if (unknown.length || !chosen.length) throw new Error(`sources must be from: ${Object.keys(SUGGEST_SOURCES).join(", ")}.`);
  if (!/^[a-z]{2}$/i.test(country) || !/^[a-z]{2}(-[a-z]{2})?$/i.test(language)) throw new Error("country and language must be codes like us and en.");
  const max = clamp(Math.trunc(limit) || 50, 1, 200);

  const queries = buildQueries(seedText, expand);
  const jobs = queries.flatMap((query) => chosen.map((source) => ({ query, source })));
  const found = new Map(); // lowercase phrase -> aggregate
  const errors = [];
  let succeeded = 0;

  for (let i = 0; i < jobs.length; i += 4) {
    const batch = jobs.slice(i, i + 4);
    await Promise.all(
      batch.map(async ({ query, source }) => {
        try {
          const res = await get(SUGGEST_SOURCES[source](query, { country: country.toLowerCase(), language: language.toLowerCase() }));
          if (res.status !== 200 || res.kind === "binary") throw new Error(`HTTP ${res.status}`);
          succeeded++;
          for (const s of parseSuggest(res.raw)) {
            const key = s.phrase.toLowerCase().trim();
            if (key === query.toLowerCase()) continue;
            const entry = found.get(key) ?? { keyword: s.phrase.trim(), sources: new Set(), best_rank: Infinity, google_relevance: undefined };
            entry.sources.add(source);
            entry.best_rank = Math.min(entry.best_rank, s.rank);
            if (source === "google" && typeof s.relevance === "number") {
              entry.google_relevance = Math.max(entry.google_relevance ?? 0, s.relevance);
            }
            found.set(key, entry);
          }
        } catch (err) {
          errors.push({ source, query, error: err.message });
        }
      })
    );
    if (i + 4 < jobs.length) await wait(150);
  }
  if (!succeeded) throw new Error(`No suggestions could be fetched (${errors[0]?.error ?? "unknown error"}).`);

  const all = [...found.values()]
    .map((e) => ({
      keyword: e.keyword,
      intent: classifyIntent(e.keyword),
      words: wordsOf(e.keyword).length,
      sources: [...e.sources].sort(),
      best_rank: e.best_rank,
      ...(e.google_relevance !== undefined ? { google_relevance: e.google_relevance } : {}),
    }))
    .sort(
      (a, b) =>
        b.sources.length - a.sources.length ||
        (b.google_relevance ?? -1) - (a.google_relevance ?? -1) ||
        a.best_rank - b.best_rank ||
        a.keyword.localeCompare(b.keyword)
    );

  const byIntent = {};
  for (const k of all) byIntent[k.intent] = (byIntent[k.intent] ?? 0) + 1;
  return {
    seed: seedText,
    expand,
    sources: chosen,
    requests: jobs.length,
    failed_requests: errors.length,
    total_found: all.length,
    by_intent: byIntent,
    keywords: all.slice(0, max),
    note: "Autocomplete shows what people really type, but there is no search volume here. Treat best_rank (1 is most popular) and how many sources agree as rough demand signals.",
  };
}

// ---------------------------------------------------------------- seo_search_console

const GSC_API = "https://www.googleapis.com/webmasters/v3";
const GSC_DIMENSIONS = ["query", "page", "country", "device", "date"];
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Real search performance of your own site from Google Search Console.
 * Without `site`, lists the properties this account can read.
 * Needs GSC_REFRESH_TOKEN (scope webmasters.readonly) and GSC_CLIENT_ID/GSC_CLIENT_SECRET
 * (or the GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET of the same OAuth client).
 */
export async function searchConsole(
  { site, days = 28, dimensions, limit = 25, query_contains, page_contains, quick_wins = false, min_impressions } = {},
  deps = {}
) {
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? Date.now;
  const creds = googleCredentials({
    refreshTokenEnv: "GSC_REFRESH_TOKEN",
    clientIdEnvs: ["GSC_CLIENT_ID", "GMAIL_CLIENT_ID"],
    clientSecretEnvs: ["GSC_CLIENT_SECRET", "GMAIL_CLIENT_SECRET"],
  });
  const token = await getAccessToken(creds, { fetch: fetchFn, now });
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  const call = async (url, init) => {
    const res = await fetchFn(url, { ...init, headers, signal: AbortSignal.timeout(20_000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = data?.error?.message || `HTTP ${res.status}`;
      if (res.status === 401) throw new Error("Google rejected the access token. Check GSC_REFRESH_TOKEN.");
      if (res.status === 403) {
        throw new Error(`Search Console refused the request: ${message}. The refresh token needs the webmasters.readonly scope, and this Google account needs access to the property.`);
      }
      throw new Error(`Search Console error: ${message}`);
    }
    return data;
  };

  if (!site) {
    const data = await call(`${GSC_API}/sites`, { method: "GET" });
    const sites = (data.siteEntry || []).map((s) => ({ site: s.siteUrl, permission: s.permissionLevel }));
    return { sites, hint: "Pass one of these as `site` (for example sc-domain:example.com or https://example.com/)." };
  }

  const dims = dimensions?.length ? dimensions : quick_wins ? ["query", "page"] : ["query"];
  const badDim = dims.find((d) => !GSC_DIMENSIONS.includes(d));
  if (badDim) throw new Error(`Unknown dimension "${badDim}". Use: ${GSC_DIMENSIONS.join(", ")}.`);
  if (quick_wins && !dims.includes("query")) throw new Error("quick_wins needs the query dimension.");

  const span = clamp(Math.trunc(days) || 28, 1, 90);
  const end = now() - 2 * 86_400_000; // Search Console data lags by a couple of days
  const start = end - (span - 1) * 86_400_000;
  const filters = [];
  if (query_contains) filters.push({ dimension: "query", operator: "contains", expression: String(query_contains) });
  if (page_contains) filters.push({ dimension: "page", operator: "contains", expression: String(page_contains) });
  const max = clamp(Math.trunc(limit) || 25, 1, 1000);

  const data = await call(`${GSC_API}/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
    method: "POST",
    body: JSON.stringify({
      startDate: isoDay(start),
      endDate: isoDay(end),
      dimensions: dims,
      rowLimit: quick_wins ? 1000 : max,
      startRow: 0,
      ...(filters.length ? { dimensionFilterGroups: [{ groupType: "and", filters }] } : {}),
    }),
  });

  let rows = (data.rows || []).map((row) => ({
    ...Object.fromEntries(dims.map((d, i) => [d, row.keys?.[i]])),
    clicks: row.clicks,
    impressions: row.impressions,
    ctr_percent: round1((row.ctr || 0) * 100),
    position: round1(row.position || 0),
  }));
  let mode = "top rows";
  if (quick_wins) {
    const floor = Number.isFinite(min_impressions) ? min_impressions : 20;
    rows = rows
      .filter((r) => r.position >= 4 && r.position <= 20 && r.impressions >= floor)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, max);
    mode = `quick wins: positions 4-20 with at least ${floor} impressions, most impressions first`;
  }
  return {
    site,
    period: { start: isoDay(start), end: isoDay(end) },
    dimensions: dims,
    mode,
    count: rows.length,
    totals: { clicks: rows.reduce((n, r) => n + r.clicks, 0), impressions: rows.reduce((n, r) => n + r.impressions, 0) },
    rows,
    note: "Google returns its top rows, not necessarily every query. Positions are averages. Dates are in Pacific time.",
  };
}
