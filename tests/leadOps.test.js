import { describe, it, expect, vi } from "vitest";
import {
  extractEmails,
  extractPhones,
  extractSocial,
  parseJsonLd,
  parseRss,
  fixMojibake,
  hnHiring,
  remoteJobs,
  companyContacts,
} from "../tools/leadOps.js";

// A fake fetchRaw that answers from a table of URL -> response (or error).
function fakeGet(routes) {
  const calls = [];
  const get = vi.fn(async (url) => {
    calls.push(url);
    const hit = Object.entries(routes).find(([key]) => url.includes(key));
    if (!hit) throw new Error(`unexpected request: ${url}`);
    const value = typeof hit[1] === "function" ? hit[1](url) : hit[1];
    if (value instanceof Error) throw value;
    return { final_url: url, content_type: "text/html", kind: "text", status: 200, ...value };
  });
  get.calls = calls;
  return get;
}

const json = (data, extra = {}) => ({ raw: JSON.stringify(data), content_type: "application/json", ...extra });
const html = (raw, extra = {}) => ({ raw, kind: "html", ...extra });

describe("extractEmails", () => {
  it("finds emails, flags shared mailboxes, and ignores junk", () => {
    const text = `Write jane.doe@acme.test or Sales@Acme.test. Placeholder: name@example.com, logo@2x.png,
      tracking c3ab8514873549d5b3785ebc7fb83c80@o1069899.ingest.sentry.io, dupe jane.doe@acme.test`;
    expect(extractEmails(text)).toEqual([
      { email: "jane.doe@acme.test", role: false },
      { email: "sales@acme.test", role: true },
    ]);
  });
});

describe("extractPhones", () => {
  it("reads tel: links, international and US-style numbers, de-duplicated by digits", () => {
    const htmlText = `<a href="tel:+1%20415%20555%200100">call</a>`;
    const text = "Office +44 20 7946 0958 or (415) 555-0199. Also +1 415 555 0100 again. Order 2026-10-21 12345.";
    const phones = extractPhones(htmlText, text);
    expect(phones.map((p) => p.replace(/\D/g, ""))).toEqual(["14155550100", "442079460958", "4155550199"]);
  });
});

describe("extractSocial", () => {
  it("keeps profile links and skips share/intent links", () => {
    const page = `<a href="https://www.linkedin.com/company/acme">in</a>
      <a href="https://x.com/acme">x</a><a href="https://twitter.com/share?url=1">share</a>
      <a href="https://github.com/acme">gh</a><a href="https://github.com/acme/repo">repo</a>
      <a href="https://www.youtube.com/@acme">yt</a><a href="https://www.facebook.com/sharer/sharer.php?u=1">fb</a>`;
    expect(extractSocial(page, "https://acme.test/")).toEqual({
      linkedin: "https://www.linkedin.com/company/acme",
      twitter: "https://x.com/acme",
      github: "https://github.com/acme",
      youtube: "https://www.youtube.com/@acme",
    });
  });
});

describe("parseJsonLd", () => {
  it("reads organization details, including inside @graph", () => {
    const page = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
      {"@type":"WebSite","name":"ignored"},
      {"@type":["Organization"],"name":"Acme Ltd","email":"hi@acme.test","address":"1 Main St",
       "sameAs":["https://twitter.com/acme"]}]}</script><script type="application/ld+json">{not json</script>`;
    expect(parseJsonLd(page)).toEqual({
      name: "Acme Ltd",
      email: "hi@acme.test",
      address: "1 Main St",
      sameAs: ["https://twitter.com/acme"],
    });
  });
});

describe("fixMojibake", () => {
  it("repairs double-encoded text and leaves everything else alone", () => {
    expect(fixMojibake("Ciudad de M\u00c3\u00a9xico")).toBe("Ciudad de M\u00e9xico");
    expect(fixMojibake("Plain ASCII")).toBe("Plain ASCII");
    expect(fixMojibake("Already fine: M\u00e9xico")).toBe("Already fine: M\u00e9xico");
    expect(fixMojibake("\u4e2d\u6587 and M\u00c3\u00a9xico")).toBe("\u4e2d\u6587 and M\u00c3\u00a9xico");
    expect(fixMojibake(undefined)).toBe("");
  });
});

describe("lead_hn_hiring", () => {
  const thread = { hits: [{ objectID: "111", title: "Ask HN: Who is hiring? (October 2026)", created_at: "2026-10-01T15:02:07Z" }] };
  const comments = {
    hits: [
      {
        objectID: "201",
        parent_id: 111,
        author: "acme",
        created_at: "2026-10-02T10:00:00Z",
        comment_text:
          'Acme | Senior React Engineer | Remote<p>We build tools. Email <a href="mailto:jobs@acme.test">jobs@acme.test</a> or apply at <a href="https:&#x2F;&#x2F;acme.test&#x2F;careers" rel="nofollow">https:&#x2F;&#x2F;acme.test&#x2F;careers</a>',
      },
      { objectID: "202", parent_id: 201, author: "someone", created_at: "2026-10-02T11:00:00Z", comment_text: "Interested! Is it remote?" },
      { objectID: "203", parent_id: 111, author: "globex", created_at: "2026-10-03T10:00:00Z", comment_text: "Globex | Django developer | Berlin" },
    ],
  };

  it("finds the latest thread and returns top-level posts with contacts", async () => {
    const get = fakeGet({ search_by_date: json(thread), "/search?": json(comments) });
    const out = await hnHiring({ query: "react contract", limit: 5 }, { fetchRaw: get });
    expect(out.thread).toMatchObject({ id: "111", title: "Ask HN: Who is hiring? (October 2026)", url: "https://news.ycombinator.com/item?id=111" });
    expect(out.count).toBe(2); // the reply is dropped
    const [first, second] = out.posts;
    expect(first).toMatchObject({ id: "201", company: "Acme", author: "acme", url: "https://news.ycombinator.com/item?id=201" });
    expect(first.text).toContain("We build tools.");
    expect(first.emails).toEqual(["jobs@acme.test"]);
    expect(first.links).toContain("https://acme.test/careers");
    expect(second.company).toBe("Globex");
    expect(second.emails).toEqual([]);
    expect(out.notice).toMatch(/untrusted/i);
    const searchUrl = get.calls.find((u) => u.includes("/search?"));
    expect(searchUrl).toContain("story_111");
    expect(searchUrl).toContain("query=react%20contract");
  });

  it("uses a given thread_id without looking for the latest", async () => {
    const get = fakeGet({ "/search?": json(comments) });
    const out = await hnHiring({ thread_id: 111 }, { fetchRaw: get });
    expect(out.count).toBe(2);
    expect(get.calls.some((u) => u.includes("search_by_date"))).toBe(false);
  });

  it("respects limit and reports problems clearly", async () => {
    const get = fakeGet({ search_by_date: json(thread), "/search?": json(comments) });
    expect((await hnHiring({ limit: 1 }, { fetchRaw: get })).posts).toHaveLength(1);
    await expect(hnHiring({ thread_id: "abc" }, { fetchRaw: get })).rejects.toThrow(/thread_id/);
    await expect(hnHiring({}, { fetchRaw: fakeGet({ search_by_date: json({ hits: [] }) }) })).rejects.toThrow(/latest/);
    await expect(hnHiring({}, { fetchRaw: fakeGet({ search_by_date: { status: 500, raw: "" } }) })).rejects.toThrow(/HTTP 500/);
  });
});

describe("parseRss", () => {
  it("handles CDATA and entity-escaped descriptions", () => {
    const xml = `<rss><channel>
      <item><title>Stripe: Abuse Research Engineer</title><link>https://wwr.test/1</link>
        <pubDate>Mon, 19 Oct 2026 12:00:00 +0000</pubDate><region>Anywhere</region><category>Full-Stack</category>
        <description>&lt;p&gt;Build &lt;strong&gt;safe&lt;/strong&gt; payments&lt;/p&gt;</description></item>
      <item><title><![CDATA[Globex: React Native Developer]]></title><link>https://wwr.test/2</link>
        <description><![CDATA[<p>Ship <b>mobile</b> apps</p>]]></description></item>
    </channel></rss>`;
    const items = parseRss(xml);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: "Stripe: Abuse Research Engineer", link: "https://wwr.test/1", region: "Anywhere", category: "Full-Stack", published: "2026-10-19T12:00:00.000Z" });
    expect(items[0].description).toBe("Build safe payments");
    expect(items[1].title).toBe("Globex: React Native Developer");
    expect(items[1].description).toBe("Ship mobile apps");
    expect(items[1].published).toBeUndefined();
  });
});

describe("lead_remote_jobs", () => {
  const remoteok = [
    { legal: "API Terms of Service: Please link back to the URL on Remote OK" },
    {
      company: "Acme",
      position: "Senior React Developer",
      tags: ["react", "javascript"],
      location: "Worldwide",
      date: "2026-10-19T16:00:04+00:00",
      url: "https://remoteOK.com/remote-jobs/1",
      apply_url: "https://remoteOK.com/apply/1",
      salary_min: 100000,
      salary_max: 140000,
      description: "<p>Build <b>React</b> apps</p>",
    },
    {
      company: "DEUNA",
      position: "Account Manager",
      tags: [],
      location: "Ciudad de M\u00c3\u00a9xico, Mexico",
      date: "2026-10-11T00:00:05+00:00",
      url: "https://remoteOK.com/remote-jobs/2",
      description: "",
    },
  ];
  const wwr = `<rss><channel>
    <item><title>Globex: React Native Developer</title><link>https://wwr.test/2</link>
      <pubDate>Tue, 20 Oct 2026 08:00:00 +0000</pubDate><region>Europe</region><category>Front-End</category>
      <description>&lt;p&gt;Ship React Native apps&lt;/p&gt;</description></item>
    <item><title>Initech: Backend Engineer</title><link>https://wwr.test/3</link>
      <pubDate>Mon, 05 Oct 2026 08:00:00 +0000</pubDate><region>Anywhere</region><category>Back-End</category>
      <description>&lt;p&gt;Go services&lt;/p&gt;</description></item>
  </channel></rss>`;
  const routes = () => ({ "remoteok.com/api": json(remoteok), "weworkremotely.com": { raw: wwr, content_type: "application/rss+xml" } });

  it("merges both sources, filters by keywords and sorts newest first", async () => {
    const out = await remoteJobs({ query: "react" }, { fetchRaw: fakeGet(routes()) });
    expect(out.jobs.map((j) => `${j.source}:${j.company}`)).toEqual(["We Work Remotely:Globex", "RemoteOK:Acme"]);
    const acme = out.jobs[1];
    expect(acme).toMatchObject({ position: "Senior React Developer", url: "https://remoteOK.com/remote-jobs/1", apply_url: "https://remoteOK.com/apply/1", salary: { min: 100000, max: 140000 } });
    expect(acme.summary).toBe("Build React apps");
    expect(out.jobs[0]).toMatchObject({ position: "React Native Developer", location: "Europe", tags: ["Front-End"] });
    expect(out.remoteok_terms).toMatch(/link back/);
    expect(out.attribution).toMatch(/Link back/);
    expect(out.errors).toBeUndefined();
  });

  it("returns everything for an empty query, and respects limit", async () => {
    const all = await remoteJobs({}, { fetchRaw: fakeGet(routes()) });
    expect(all.count).toBe(4);
    expect((await remoteJobs({ limit: 2 }, { fetchRaw: fakeGet(routes()) })).jobs).toHaveLength(2);
  });

  it("repairs RemoteOK's double-encoded text and matches accented queries", async () => {
    const out = await remoteJobs({ query: "m\u00e9xico" }, { fetchRaw: fakeGet(routes()) });
    expect(out.jobs).toHaveLength(1);
    expect(out.jobs[0].location).toBe("Ciudad de M\u00e9xico, Mexico");
  });

  it("keeps going when one source fails, and fails when both do", async () => {
    const partial = fakeGet({ "remoteok.com/api": new Error("boom"), "weworkremotely.com": { raw: wwr } });
    const out = await remoteJobs({ query: "react" }, { fetchRaw: partial });
    expect(out.jobs.map((j) => j.source)).toEqual(["We Work Remotely"]);
    expect(out.errors).toEqual([{ source: "RemoteOK", error: "boom" }]);

    const none = fakeGet({ "remoteok.com/api": new Error("boom"), "weworkremotely.com": new Error("bang") });
    await expect(remoteJobs({}, { fetchRaw: none })).rejects.toThrow(/Both job sources failed/);
  });
});

describe("lead_company_contacts", () => {
  const home = `<html><head><title>Acme Studio | Web agency</title>
    <meta property="og:site_name" content="Acme Studio"><meta name="description" content="We build web apps.">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme Studio Ltd","email":"hello@acme.test","telephone":"+1 415 555 0100","address":{"streetAddress":"1 Main St","addressLocality":"Austin","addressRegion":"TX","postalCode":"78701","addressCountry":"US"},"sameAs":["https://www.linkedin.com/company/acme-studio","https://twitter.com/acmestudio"]}</script>
    <script>var dsn="abcdefabcdefabcdefabcdefabcdef12@o1.ingest.sentry.io";</script></head>
    <body><nav><a href="/about">About us</a> <a href="/contact">Contact</a> <a href="/blog">Blog</a>
      <a href="https://other.test/contact">Elsewhere contact</a></nav>
    <p>Write to <a href="mailto:sales@acme.test">sales@acme.test</a> or call <a href="tel:+14155550100">+1 415 555 0100</a>.</p>
    <a href="https://github.com/acme-studio">GitHub</a> <a href="https://x.com/share?url=1">share</a>
    <img src="logo@2x.png"></body></html>`;
  const contact = `<html><body>Reach our founder at <span>jane&#64;acme.test</span> \u2014 office: (415) 555-0199</body></html>`;

  const routes = () => ({
    "https://acme.test/contact": html(contact),
    "https://acme.test/about": html("<h1>Not found</h1>", { status: 404 }),
    "https://acme.test/": html(home),
  });

  it("collects contacts from the homepage and contact pages", async () => {
    const get = fakeGet(routes());
    const out = await companyContacts({ url: "acme.test" }, { fetchRaw: get });

    expect(get.calls[0]).toBe("https://acme.test/"); // scheme added
    expect(get.calls.some((u) => u.includes("other.test"))).toBe(false); // never leaves the site
    expect(out.website).toBe("https://acme.test");
    expect(out.company).toEqual({
      name: "Acme Studio Ltd",
      description: "We build web apps.",
      address: "1 Main St, Austin, TX, 78701, US",
    });

    const byEmail = Object.fromEntries(out.emails.map((e) => [e.email, e]));
    expect(Object.keys(byEmail).sort()).toEqual(["hello@acme.test", "jane@acme.test", "sales@acme.test"]);
    expect(byEmail["sales@acme.test"].role).toBe(true);
    expect(byEmail["jane@acme.test"]).toMatchObject({ role: false, source_page: "https://acme.test/contact" });

    expect(out.phones.map((p) => p.replace(/\D/g, "")).sort()).toEqual(["14155550100", "4155550199"]);
    expect(out.social).toEqual({
      github: "https://github.com/acme-studio",
      linkedin: "https://www.linkedin.com/company/acme-studio",
      twitter: "https://twitter.com/acmestudio",
    });
    expect(out.pages_fetched).toEqual([
      { url: "https://acme.test/", status: 200 },
      { url: "https://acme.test/contact", status: 200 },
      { url: "https://acme.test/about", status: 404 },
    ]);
    expect(out.guidance).toMatch(/GDPR/);
    expect(out.notice).toMatch(/untrusted/i);
  });

  it("reads only the homepage when max_pages is 0", async () => {
    const get = fakeGet(routes());
    await companyContacts({ url: "https://acme.test", max_pages: 0 }, { fetchRaw: get });
    expect(get.calls).toEqual(["https://acme.test/"]);
  });

  it("tries /contact and /about when the homepage has no such links", async () => {
    const get = fakeGet({ "https://acme.test/contact": html(contact), "https://acme.test/about": html("<p>About</p>"), "https://acme.test/": html("<html><body>Hi</body></html>") });
    const out = await companyContacts({ url: "acme.test" }, { fetchRaw: get });
    expect(get.calls).toEqual(["https://acme.test/", "https://acme.test/contact", "https://acme.test/about"]);
    expect(out.emails.map((e) => e.email)).toEqual(["jane@acme.test"]);
  });

  it("survives a failing page and ignores pages that redirect to another site", async () => {
    const get = fakeGet({
      "https://acme.test/contact": new Error("connection reset"),
      "https://acme.test/about": html("<p>stranger@elsewhere.test</p>", { final_url: "https://elsewhere.test/about" }),
      "https://acme.test/": html(home),
    });
    const out = await companyContacts({ url: "acme.test" }, { fetchRaw: get });
    expect(out.pages_fetched).toContainEqual({ url: "https://acme.test/contact", error: "connection reset" });
    expect(out.emails.map((e) => e.email)).not.toContain("stranger@elsewhere.test");
    expect(out.emails.map((e) => e.email)).toContain("sales@acme.test");
  });

  it("rejects bad input and non-web responses", async () => {
    await expect(companyContacts({})).rejects.toThrow(/url is required/);
    await expect(companyContacts({ url: "ftp://acme.test" })).rejects.toThrow(/Only http and https/);
    const get = fakeGet({ "https://acme.test/": { kind: "binary", status: 200, raw: undefined } });
    await expect(companyContacts({ url: "acme.test" }, { fetchRaw: get })).rejects.toThrow(/did not return a web page/);
  });
});
