import { describe, it, expect, afterEach, vi } from "vitest";
import {
  wordsOf,
  countKeyword,
  readingEase,
  markdownToText,
  contentCheck,
  analyzeHtml,
  pageAudit,
  buildQueries,
  parseSuggest,
  classifyIntent,
  keywordIdeas,
  searchConsole,
} from "../tools/seoOps.js";
import { clearTokenCache } from "../tools/googleAuth.js";

afterEach(() => {
  vi.unstubAllEnvs();
  clearTokenCache();
});

const messages = (issues) => issues.map((i) => i.message);

describe("text helpers", () => {
  it("counts whole-word keyword matches only", () => {
    expect(countKeyword("A web developer and web developers. Web  Developer!", "web developer")).toBe(2);
    expect(countKeyword("anything", "")).toBe(0);
  });

  it("splits words, including accents and apostrophes", () => {
    expect(wordsOf("Don't panic: caf\u00e9 \u2014 42 things")).toEqual(["Don't", "panic", "caf\u00e9", "42", "things"]);
  });

  it("scores plain text as easier than dense text", () => {
    const easy = readingEase("The cat sat on the mat. It was warm. The dog ran in.");
    const hard = readingEase(
      "Notwithstanding considerable organisational heterogeneity, interdisciplinary collaboration necessitates comprehensive methodological standardisation."
    );
    expect(easy.level).toBe("easy");
    expect(hard.score).toBeLessThan(easy.score);
    expect(readingEase("")).toBeNull();
  });

  it("strips markdown to plain text", () => {
    const md = "# Title\n\nSome **bold** and `code` with a [link](https://x.test) and ![alt](a.png).\n\n- item one\n1. item two\n```js\nconst hidden = 1;\n```";
    const text = markdownToText(md);
    expect(text).toContain("Some bold and code with a link and");
    expect(text).toContain("item one");
    expect(text).not.toContain("hidden");
    expect(text).not.toContain("](");
  });
});

describe("seo_content_check", () => {
  const draft = `# How to Pick a Freelance Web Developer

Hiring a freelance web developer can feel risky. You want someone reliable, and you want a fair price.

## Check their portfolio

Look at real projects. Ask what they built. See [our checklist](/checklist) and [this guide](https://example.com/guide).

![](diagram.png)
![A chart](chart.png)
`;

  it("reports metrics, links, images and keyword placement", () => {
    const r = contentCheck({ text: draft, keyword: "freelance web developer", title: "How to Pick a Freelance Web Developer in 2026", meta_description: "Short" });
    expect(r.metrics.headings).toMatchObject({ count: 2, h1: ["How to Pick a Freelance Web Developer"] });
    expect(r.metrics.links).toEqual({ total: 2, external: 1 });
    expect(r.metrics.images).toEqual({ total: 2, missing_alt: 1 });
    expect(r.metrics.reading_ease.level).toBe("easy");
    expect(r.keyword).toMatchObject({ occurrences: 2, in_title: true, in_h1: true, in_first_100_words: true, in_meta_description: false });
    const text = messages(r.issues).join("\n");
    expect(text).toMatch(/Only \d+ words/);
    expect(text).toMatch(/1 image\(s\) without alt/);
    expect(text).toMatch(/meta description is only 5 characters/);
    expect(r.summary).toMatch(/warning/);
  });

  it("flags keyword stuffing, missing keyword, and multiple H1s", () => {
    const stuffed = contentCheck({ text: "# One\n\n# Two\n\n" + "buy shoes now. ".repeat(40), keyword: "buy shoes" });
    expect(messages(stuffed.issues).join("\n")).toMatch(/H1 headings/);
    expect(messages(stuffed.issues).join("\n")).toMatch(/looks like stuffing/);
    const absent = contentCheck({ text: "Nothing relevant here at all.", keyword: "kubernetes" });
    expect(messages(absent.issues).join("\n")).toMatch(/does not appear in the text/);
  });

  it("warns about long text without headings and about long titles", () => {
    const long = contentCheck({ text: "Plain sentence number one here. ".repeat(80), title: "T".repeat(80) });
    const text = messages(long.issues).join("\n");
    expect(text).toMatch(/No headings/);
    expect(text).toMatch(/title is 80 characters/);
  });

  it("requires text", () => {
    expect(() => contentCheck({ text: "   " })).toThrow(/text is required/);
    expect(() => contentCheck({})).toThrow(/text is required/);
  });
});

describe("analyzeHtml / seo_page_audit", () => {
  const good = `<!doctype html><html lang="en"><head><title>Freelance Web Developer Guide for Small Teams</title>
    <meta name="description" content="A practical guide to hiring a freelance web developer: scope, pricing, contracts and red flags for small teams.">
    <meta name="viewport" content="width=device-width"><link rel="canonical" href="https://acme.test/blog/freelance-web-developer-guide">
    <meta property="og:title" content="Guide"><meta property="og:image" content="https://acme.test/og.png"><meta name="twitter:card" content="summary">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Article"},{"@type":"Organization"}]}</script></head>
    <body><nav><a href="/">Home</a></nav><h1>Freelance Web Developer Guide</h1>
    <p>${"Hire a freelance web developer with care. ".repeat(60)}</p><h2>Scope</h2><p>Write it down.</p>
    <img src="a.png" alt="Diagram"><img src="b.png"><img src="c.png" alt="">
    <a href="/blog">Blog</a> <a href="https://www.acme.test/contact">Contact</a> <a href="https://other.test/">Other</a>
    <a href="mailto:hi@acme.test">mail</a> <a href="#top">top</a></body></html>`;

  it("extracts page facts", () => {
    const r = analyzeHtml(good, "https://acme.test/blog/freelance-web-developer-guide", "freelance web developer");
    expect(r.title.text).toBe("Freelance Web Developer Guide for Small Teams");
    expect(r.canonical).toBe("https://acme.test/blog/freelance-web-developer-guide");
    expect(r.lang).toBe("en");
    expect(r.headings.h1).toEqual(["Freelance Web Developer Guide"]);
    expect(r.headings.outline.map((h) => h.level)).toEqual([1, 2]);
    expect(r.images).toEqual({ total: 3, missing_alt: 1, empty_alt: 1 });
    expect(r.links).toEqual({ internal: 3, external: 1 });
    expect(r.structured_data).toEqual(["Article", "Organization"]);
    expect(r.social).toMatchObject({ og_title: "Guide", twitter_card: "summary" });
    expect(r.words).toBeGreaterThan(300);
    expect(r.keyword).toMatchObject({ in_title: true, in_meta_description: true, in_h1: true, in_first_100_words: true, in_url: true });
    expect(messages(r.issues)).toContain("1 image(s) without an alt attribute.");
  });

  it("flags problems", () => {
    const bad = `<html><head><title>${"Very long title ".repeat(8)}</title><meta name="robots" content="noindex, follow"></head><body><p>Thin page.</p><img src="x.png"></body></html>`;
    const text = messages(analyzeHtml(bad, "https://acme.test/", "widgets").issues).join("\n");
    expect(text).toMatch(/title is \d+ characters/);
    expect(text).toMatch(/meta description is missing/);
    expect(text).toMatch(/No H1/);
    expect(text).toMatch(/noindex/);
    expect(text).toMatch(/No canonical/);
    expect(text).toMatch(/lang attribute/);
    expect(text).toMatch(/viewport/);
    expect(text).toMatch(/without an alt/);
    expect(text).toMatch(/Only \d+ words/);
    expect(text).toMatch(/Open Graph/);
    expect(text).toMatch(/does not appear in the text/);
  });

  it("audits a fetched page, adds the scheme, and reports HTTP errors and non-pages", async () => {
    const get = vi.fn(async (url) => ({ final_url: url, status: 404, kind: "html", raw: good }));
    const out = await pageAudit({ url: "acme.test/blog" }, { fetchRaw: get });
    expect(get).toHaveBeenCalledWith("https://acme.test/blog");
    expect(out.status).toBe(404);
    expect(typeof out.response_ms).toBe("number");
    expect(messages(out.issues)[0]).toMatch(/HTTP 404/);
    expect(out.notice).toMatch(/untrusted/i);

    await expect(pageAudit({}, { fetchRaw: get })).rejects.toThrow(/url is required/);
    await expect(pageAudit({ url: "https://x.test/a.pdf" }, { fetchRaw: async () => ({ kind: "binary", status: 200 }) })).rejects.toThrow(/did not return a web page/);
  });
});

describe("keyword helpers", () => {
  it("builds query sets", () => {
    expect(buildQueries("  crm ", "none")).toEqual(["crm"]);
    const questions = buildQueries("crm", "questions");
    expect(questions).toHaveLength(15);
    expect(questions).toContain("how to crm");
    expect(questions).toContain("crm near me");
    expect(buildQueries("crm", "alphabet")).toHaveLength(27);
    expect(buildQueries("crm", "all")).toHaveLength(41);
  });

  it("parses suggestion payloads, with and without relevance", () => {
    const withRel = JSON.stringify(["q", ["a", "b"], [], [], { "google:suggestrelevance": [900, 800] }]);
    expect(parseSuggest(withRel)).toEqual([
      { phrase: "a", rank: 1, relevance: 900 },
      { phrase: "b", rank: 2, relevance: 800 },
    ]);
    expect(parseSuggest(JSON.stringify(["q", ["x", "", 5]]))).toEqual([{ phrase: "x", rank: 1, relevance: undefined }]);
    expect(parseSuggest("not json")).toEqual([]);
  });

  it("classifies intent", () => {
    expect(classifyIntent("how to hire a developer")).toBe("question");
    expect(classifyIntent("hubspot vs pipedrive")).toBe("comparison");
    expect(classifyIntent("best crm for agencies")).toBe("commercial");
    expect(classifyIntent("crm software near me")).toBe("commercial");
    expect(classifyIntent("crm definition")).toBe("general");
  });
});

describe("seo_keyword_ideas", () => {
  const noWait = { sleep: async () => {} };
  const google = JSON.stringify(["q", ["crm jobs", "crm salary", "how to crm", "crm"], [], [], { "google:suggestrelevance": [1250, 600, 500, 400] }]);
  const bing = JSON.stringify(["q", ["crm jobs", "crm near me", "hubspot vs crm"]]);

  function fakeGet() {
    const urls = [];
    const get = vi.fn(async (url) => {
      urls.push(url);
      const raw = url.includes("suggestqueries.google.com") ? google : url.includes("api.bing.com") ? bing : JSON.stringify(["q", ["crm tools"]]);
      return { status: 200, kind: "text", raw };
    });
    get.urls = urls;
    return get;
  }

  it("merges sources, ranks by agreement and relevance, and tags intent", async () => {
    const get = fakeGet();
    const out = await keywordIdeas({ seed: "crm", expand: "none", limit: 10 }, { fetchRaw: get, ...noWait });
    expect(out.requests).toBe(2);
    expect(out.keywords[0]).toEqual({ keyword: "crm jobs", intent: "general", words: 2, sources: ["bing", "google"], best_rank: 1, google_relevance: 1250 });
    expect(out.keywords.map((k) => k.keyword)).not.toContain("crm"); // the seed echoed back is dropped
    const byName = Object.fromEntries(out.keywords.map((k) => [k.keyword, k]));
    expect(byName["how to crm"].intent).toBe("question");
    expect(byName["hubspot vs crm"].intent).toBe("comparison");
    expect(byName["crm near me"].intent).toBe("commercial");
    expect(byName["crm near me"].sources).toEqual(["bing"]);
    expect(out.by_intent).toMatchObject({ general: 2, question: 1, comparison: 1, commercial: 1 });
    expect(out.note).toMatch(/no search volume/i);
  });

  it("sends one request per query and source, with country and language for Google", async () => {
    const get = fakeGet();
    const out = await keywordIdeas({ seed: "crm", sources: ["google", "bing", "duckduckgo"], country: "IN", language: "hi" }, { fetchRaw: get, ...noWait });
    expect(out.requests).toBe(15 * 3);
    expect(get).toHaveBeenCalledTimes(45);
    const googleUrl = get.urls.find((u) => u.includes("suggestqueries.google.com"));
    expect(googleUrl).toContain("gl=in");
    expect(googleUrl).toContain("hl=hi");
    expect(get.urls.some((u) => u.includes("duckduckgo.com/ac/"))).toBe(true);
  });

  it("respects limit, and tolerates failures unless everything fails", async () => {
    const partial = vi.fn(async (url) => {
      if (url.includes("api.bing.com")) throw new Error("blocked");
      return { status: 200, kind: "text", raw: google };
    });
    const out = await keywordIdeas({ seed: "crm", expand: "none", limit: 1 }, { fetchRaw: partial, ...noWait });
    expect(out.keywords).toHaveLength(1);
    expect(out.failed_requests).toBe(1);

    const dead = vi.fn(async () => ({ status: 429, kind: "text", raw: "" }));
    await expect(keywordIdeas({ seed: "crm", expand: "none" }, { fetchRaw: dead, ...noWait })).rejects.toThrow(/No suggestions could be fetched/);
  });

  it("validates input", async () => {
    const d = { fetchRaw: fakeGet(), ...noWait };
    await expect(keywordIdeas({}, d)).rejects.toThrow(/seed is required/);
    await expect(keywordIdeas({ seed: "x".repeat(101) }, d)).rejects.toThrow(/too long/);
    await expect(keywordIdeas({ seed: "crm", expand: "everything" }, d)).rejects.toThrow(/expand must be/);
    await expect(keywordIdeas({ seed: "crm", sources: ["altavista"] }, d)).rejects.toThrow(/sources must be/);
    await expect(keywordIdeas({ seed: "crm", country: "usa" }, d)).rejects.toThrow(/country and language/);
  });
});

describe("seo_search_console", () => {
  const NOW = Date.UTC(2026, 9, 21, 12, 0, 0); // 2026-10-21
  const setCreds = () => {
    vi.stubEnv("GSC_REFRESH_TOKEN", "refresh-1");
    vi.stubEnv("GSC_CLIENT_ID", "client-1");
    vi.stubEnv("GSC_CLIENT_SECRET", "secret-1");
  };

  function fakeFetch({ query = { rows: [] }, sites = { siteEntry: [] }, queryStatus = 200, sitesStatus = 200 } = {}) {
    const calls = [];
    const fetchFn = vi.fn(async (url, init = {}) => {
      calls.push({ url, init });
      if (url === "https://oauth2.googleapis.com/token") {
        return { ok: true, status: 200, json: async () => ({ access_token: "tok-1", expires_in: 3600 }) };
      }
      if (url.endsWith("/webmasters/v3/sites")) return { ok: sitesStatus === 200, status: sitesStatus, json: async () => sites };
      if (url.includes("/searchAnalytics/query")) return { ok: queryStatus === 200, status: queryStatus, json: async () => query };
      throw new Error("unexpected " + url);
    });
    fetchFn.calls = calls;
    return fetchFn;
  }

  it("tells you what is missing when Google access is not set up", async () => {
    for (const name of ["GSC_REFRESH_TOKEN", "GSC_CLIENT_ID", "GSC_CLIENT_SECRET", "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET"]) vi.stubEnv(name, "");
    await expect(searchConsole({}, { fetch: fakeFetch(), now: () => NOW })).rejects.toThrow(/Missing: .*GSC_REFRESH_TOKEN/);
  });

  it("can borrow the Gmail OAuth client", async () => {
    vi.stubEnv("GSC_REFRESH_TOKEN", "refresh-1");
    vi.stubEnv("GSC_CLIENT_ID", "");
    vi.stubEnv("GSC_CLIENT_SECRET", "");
    vi.stubEnv("GMAIL_CLIENT_ID", "gmail-client");
    vi.stubEnv("GMAIL_CLIENT_SECRET", "gmail-secret");
    const f = fakeFetch({ sites: { siteEntry: [{ siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" }] } });
    const out = await searchConsole({}, { fetch: f, now: () => NOW });
    expect(f.calls[0].init.body.get("client_id")).toBe("gmail-client");
    expect(f.calls[0].init.body.get("grant_type")).toBe("refresh_token");
    expect(out.sites).toEqual([{ site: "sc-domain:example.com", permission: "siteOwner" }]);
  });

  it("queries search analytics with the right dates, filters and auth, and shapes rows", async () => {
    setCreds();
    const f = fakeFetch({
      query: {
        rows: [
          { keys: ["freelance web developer", "https://example.com/a"], clicks: 12, impressions: 480, ctr: 0.025, position: 7.349 },
          { keys: ["web dev rates", "https://example.com/b"], clicks: 3, impressions: 100, ctr: 0.03, position: 2.04 },
        ],
      },
    });
    const out = await searchConsole(
      { site: "sc-domain:example.com", days: 28, dimensions: ["query", "page"], limit: 10, query_contains: "web", page_contains: "/blog" },
      { fetch: f, now: () => NOW }
    );
    const call = f.calls.find((c) => c.url.includes("searchAnalytics"));
    expect(call.url).toBe("https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query");
    expect(call.init.headers.authorization).toBe("Bearer tok-1");
    expect(JSON.parse(call.init.body)).toEqual({
      startDate: "2026-09-22",
      endDate: "2026-10-19",
      dimensions: ["query", "page"],
      rowLimit: 10,
      startRow: 0,
      dimensionFilterGroups: [
        {
          groupType: "and",
          filters: [
            { dimension: "query", operator: "contains", expression: "web" },
            { dimension: "page", operator: "contains", expression: "/blog" },
          ],
        },
      ],
    });
    expect(out.period).toEqual({ start: "2026-09-22", end: "2026-10-19" });
    expect(out.rows[0]).toEqual({ query: "freelance web developer", page: "https://example.com/a", clicks: 12, impressions: 480, ctr_percent: 2.5, position: 7.3 });
    expect(out.totals).toEqual({ clicks: 15, impressions: 580 });
  });

  it("finds quick wins: positions 4-20, enough impressions, most impressions first", async () => {
    setCreds();
    const row = (q, impressions, position) => ({ keys: [q, "https://example.com/p"], clicks: 1, impressions, ctr: 0.01, position });
    const f = fakeFetch({ query: { rows: [row("top rank", 900, 1.5), row("small", 5, 9), row("striking a", 300, 8.2), row("striking b", 700, 14), row("too deep", 800, 35)] } });
    const out = await searchConsole({ site: "https://example.com/", quick_wins: true, limit: 5 }, { fetch: f, now: () => NOW });
    expect(out.rows.map((r) => r.query)).toEqual(["striking b", "striking a"]);
    expect(out.dimensions).toEqual(["query", "page"]);
    expect(out.mode).toMatch(/quick wins/);
    expect(JSON.parse(f.calls.find((c) => c.url.includes("searchAnalytics")).init.body).rowLimit).toBe(1000);
  });

  it("reuses the access token between calls", async () => {
    setCreds();
    const f = fakeFetch();
    await searchConsole({ site: "https://example.com/" }, { fetch: f, now: () => NOW });
    await searchConsole({ site: "https://example.com/" }, { fetch: f, now: () => NOW });
    expect(f.calls.filter((c) => c.url === "https://oauth2.googleapis.com/token")).toHaveLength(1);
  });

  it("explains permission errors and validates input", async () => {
    setCreds();
    const denied = fakeFetch({ queryStatus: 403, query: { error: { message: "User does not have sufficient permission for site" } } });
    await expect(searchConsole({ site: "https://example.com/" }, { fetch: denied, now: () => NOW })).rejects.toThrow(/webmasters\.readonly/);
    await expect(searchConsole({ site: "x", dimensions: ["keyword"] }, { fetch: fakeFetch(), now: () => NOW })).rejects.toThrow(/Unknown dimension/);
    await expect(searchConsole({ site: "x", quick_wins: true, dimensions: ["page"] }, { fetch: fakeFetch(), now: () => NOW })).rejects.toThrow(/query dimension/);
  });
});
