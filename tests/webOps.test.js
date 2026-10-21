import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import http from "http";
import zlib from "zlib";
import {
  isPublicAddress,
  parseHttpUrl,
  htmlToText,
  decodeEntities,
  parseDuckDuckGo,
  searchWeb,
  fetchPage,
} from "../tools/webOps.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isPublicAddress (SSRF guard)", () => {
  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.255.255", "172.32.0.1", "100.63.255.255", "2606:4700:4700::1111"])(
    "allows public address %s",
    (ip) => expect(isPublicAddress(ip)).toBe(true)
  );

  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fd12:3456::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "ff02::1",
    "2001:db8::1",
    "not-an-ip",
  ])("blocks %s", (ip) => expect(isPublicAddress(ip)).toBe(false));
});

describe("parseHttpUrl", () => {
  it("accepts http and https", () => {
    expect(parseHttpUrl("https://example.com/a?b=1").hostname).toBe("example.com");
  });
  it("rejects other schemes, credentials and garbage", () => {
    expect(() => parseHttpUrl("file:///etc/passwd")).toThrow(/Only http and https/);
    expect(() => parseHttpUrl("ftp://example.com")).toThrow(/Only http and https/);
    expect(() => parseHttpUrl("http://user:pw@example.com/")).toThrow(/credentials/);
    expect(() => parseHttpUrl("not a url")).toThrow(/Not a valid URL/);
  });
});

describe("htmlToText", () => {
  const page = `<html><head><title> Acme &amp; Co | Pricing </title>
    <meta name="description" content="Simple pricing for teams">
    <style>.x{color:red}</style><script>var secret = 1;</script></head>
    <body><nav><a href="/home">Home</a></nav>
    <h1>Pricing</h1><p>Plans start at <b>$10</b> per month.&nbsp;Cancel any time.</p>
    <ul><li>Starter</li><li>Pro</li></ul>
    <a href="/contact">Contact us</a> <a href="mailto:hi@acme.test">Email</a> <a href="#top">Top</a>
    <a href="javascript:void(0)">x</a> <a href="/contact">Contact again</a>
    <!-- hidden comment -->
    </body></html>`;

  it("extracts title, description and readable text", () => {
    const r = htmlToText(page, "https://acme.test/pricing");
    expect(r.title).toBe("Acme & Co | Pricing");
    expect(r.description).toBe("Simple pricing for teams");
    expect(r.text).toContain("# Pricing");
    expect(r.text).toContain("Plans start at $10 per month. Cancel any time.");
    expect(r.text).toContain("- Starter");
    expect(r.text).not.toContain("secret");
    expect(r.text).not.toContain("hidden comment");
    expect(r.text).not.toContain("<");
    expect(r.links).toEqual([]);
  });

  it("returns absolute, de-duplicated links when asked", () => {
    const r = htmlToText(page, "https://acme.test/pricing", { includeLinks: true });
    expect(r.links.map((l) => l.url)).toEqual([
      "https://acme.test/home",
      "https://acme.test/contact",
      "mailto:hi@acme.test",
    ]);
  });

  it("prefers a substantial <main> over page chrome", () => {
    const html = `<body><nav>${"NAVJUNK ".repeat(100)}</nav><main><p>${"Real content here. ".repeat(40)}</p></main></body>`;
    const r = htmlToText(html, "https://x.test/");
    expect(r.text).toContain("Real content here.");
    expect(r.text).not.toContain("NAVJUNK");
  });

  it("decodes entities", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &#65; &#x42; &unknown;")).toBe("a & b <c> A B &unknown;");
  });
});

describe("parseDuckDuckGo", () => {
  // Representative of DuckDuckGo's HTML results markup.
  const fixture = `
  <div class="result results_links results_links_deep web-result ">
    <div class="links_main links_deep result__body">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.hubspot.com%2Fproducts%2Fcrm&amp;rut=abc">HubSpot Free CRM <b>Software</b></a>
      </h2>
      <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.hubspot.com%2Fproducts%2Fcrm&amp;rut=abc">Manage contacts &amp; deals for <b>free</b>.</a>
    </div>
  </div>
  <div class="result result--ad">
    <a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad_domain=x.com&amp;u3=zzz">Sponsored thing</a>
    <a class="result__snippet" href="https://duckduckgo.com/y.js?x=1">Buy now</a>
  </div>
  <div class="result results_links results_links_deep web-result ">
    <a rel="nofollow" class="result__a" href="https://example.org/direct">Direct link</a>
    <a class="result__snippet" href="https://example.org/direct">No tracking redirect here</a>
  </div>`;

  it("extracts titles, real URLs and snippets, and skips ads", () => {
    expect(parseDuckDuckGo(fixture)).toEqual([
      { title: "HubSpot Free CRM Software", url: "https://www.hubspot.com/products/crm", snippet: "Manage contacts & deals for free." },
      { title: "Direct link", url: "https://example.org/direct", snippet: "No tracking redirect here" },
    ]);
  });

  it("respects the limit and returns [] for pages without results", () => {
    expect(parseDuckDuckGo(fixture, 1)).toHaveLength(1);
    expect(parseDuckDuckGo("<html>nothing</html>")).toEqual([]);
  });
});

describe("searchWeb", () => {
  const ddgOk = (html) => vi.fn(async () => ({ ok: true, status: 200, text: async () => html }));

  it("uses Tavily when a key is set", async () => {
    vi.stubEnv("TAVILY_API_KEY", "tvly-test");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [{ title: "A", url: "https://a.test", content: "snip", score: 0.9 }] }),
    }));
    const out = await searchWeb({ query: " crm tools ", max_results: 3, domains: ["g2.com"] }, { fetch: fetchMock });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.tavily.com/search");
    expect(init.headers.authorization).toBe("Bearer tvly-test");
    expect(JSON.parse(init.body)).toEqual({ query: "crm tools", max_results: 3, search_depth: "basic", include_domains: ["g2.com"] });
    expect(out.provider).toBe("tavily");
    expect(out.results).toEqual([{ title: "A", url: "https://a.test", snippet: "snip", score: 0.9 }]);
    expect(out.notice).toMatch(/untrusted/i);
  });

  it("explains Tavily key and limit errors", async () => {
    vi.stubEnv("TAVILY_API_KEY", "bad");
    await expect(searchWeb({ query: "x" }, { fetch: async () => ({ ok: false, status: 401 }) })).rejects.toThrow(/rejected TAVILY_API_KEY/);
    await expect(searchWeb({ query: "x" }, { fetch: async () => ({ ok: false, status: 429 }) })).rejects.toThrow(/limit/);
  });

  it("falls back to DuckDuckGo without a key, adding site: filters", async () => {
    vi.stubEnv("TAVILY_API_KEY", "");
    vi.stubEnv("CAUSLY_SEARCH_PROVIDER", "");
    const fetchMock = ddgOk(`<a class="result__a" href="https://example.org/x">X</a><a class="result__snippet">snippet</a>`);
    const out = await searchWeb({ query: "lead tools", domains: ["github.com", "news.ycombinator.com"] }, { fetch: fetchMock });
    expect(decodeURIComponent(fetchMock.mock.calls[0][0])).toContain("lead tools (site:github.com OR site:news.ycombinator.com)");
    expect(out.provider).toBe("duckduckgo");
    expect(out.results[0].url).toBe("https://example.org/x");
  });

  it("turns DuckDuckGo's bot check into a clear error", async () => {
    vi.stubEnv("TAVILY_API_KEY", "");
    vi.stubEnv("CAUSLY_SEARCH_PROVIDER", "");
    const blocked = vi.fn(async () => ({ ok: true, status: 202, text: async () => "Unfortunately, bots use DuckDuckGo too." }));
    await expect(searchWeb({ query: "x" }, { fetch: blocked })).rejects.toThrow(/TAVILY_API_KEY/);
  });

  it("validates input and forced providers", async () => {
    await expect(searchWeb({ query: "  " })).rejects.toThrow(/query is required/);
    vi.stubEnv("TAVILY_API_KEY", "");
    vi.stubEnv("CAUSLY_SEARCH_PROVIDER", "tavily");
    await expect(searchWeb({ query: "x" }, { fetch: vi.fn() })).rejects.toThrow(/needs TAVILY_API_KEY/);
  });

  it("clamps max_results to 1-20", async () => {
    vi.stubEnv("TAVILY_API_KEY", "k");
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ results: [] }) }));
    await searchWeb({ query: "x", max_results: 500 }, { fetch: fetchMock });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_results).toBe(20);
  });
});

describe("fetchPage", () => {
  let server;
  let base;
  let port;

  const html = `<html><head><title>Local Page</title><meta name="description" content="A local test page"></head>
    <body><h1>Hello</h1><p>Visit <a href="/other">other</a></p></body></html>`;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      switch (req.url) {
        case "/page":
          res.setHeader("content-type", "text/html; charset=utf-8");
          return res.end(html);
        case "/redirect":
          res.writeHead(302, { location: "/page" });
          return res.end();
        case "/loop":
          res.writeHead(302, { location: "/loop" });
          return res.end();
        case "/gzip":
          res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
          return res.end(zlib.gzipSync(html));
        case "/image":
          res.writeHead(200, { "content-type": "image/png" });
          return res.end(Buffer.from([137, 80, 78, 71]));
        case "/big":
          res.writeHead(200, { "content-type": "text/plain" });
          return res.end("a".repeat(3 * 1024 * 1024));
        case "/json":
          res.writeHead(200, { "content-type": "application/json" });
          return res.end('{"ok":true}');
        case "/missing":
          res.writeHead(404, { "content-type": "text/html" });
          return res.end("<h1>Not found</h1>");
        case "/hang":
          return; // never answer
        default:
          res.writeHead(404);
          return res.end();
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  });

  describe("with private hosts allowed (local test server)", () => {
    const allow = () => vi.stubEnv("CAUSLY_ALLOW_PRIVATE_HOSTS", "true");

    it("returns title, description and text", async () => {
      allow();
      const r = await fetchPage({ url: `${base}/page` });
      expect(r.status).toBe(200);
      expect(r.ok).toBe(true);
      expect(r.title).toBe("Local Page");
      expect(r.description).toBe("A local test page");
      expect(r.text).toContain("# Hello");
      expect(r.truncated).toBe(false);
      expect(r.notice).toMatch(/untrusted/i);
      expect(r.links).toBeUndefined();
    });

    it("includes links on request", async () => {
      allow();
      const r = await fetchPage({ url: `${base}/page`, include_links: true });
      expect(r.links).toEqual([{ text: "other", url: `${base}/other` }]);
    });

    it("follows redirects and reports the final URL", async () => {
      allow();
      const r = await fetchPage({ url: `${base}/redirect` });
      expect(r.final_url).toBe(`${base}/page`);
      expect(r.title).toBe("Local Page");
    });

    it("gives up on redirect loops", async () => {
      allow();
      await expect(fetchPage({ url: `${base}/loop` })).rejects.toThrow(/Too many redirects/);
    });

    it("decompresses gzip", async () => {
      allow();
      expect((await fetchPage({ url: `${base}/gzip` })).title).toBe("Local Page");
    });

    it("does not return binary content", async () => {
      allow();
      const r = await fetchPage({ url: `${base}/image` });
      expect(r.text).toBeUndefined();
      expect(r.note).toMatch(/Not a text page/);
    });

    it("returns plain text and JSON as-is", async () => {
      allow();
      expect((await fetchPage({ url: `${base}/json` })).text).toBe('{"ok":true}');
    });

    it("caps downloads and output length", async () => {
      allow();
      const r = await fetchPage({ url: `${base}/big`, max_chars: 1000 });
      expect(r.text).toHaveLength(1000);
      expect(r.truncated).toBe(true);
    });

    it("reports HTTP errors without throwing", async () => {
      allow();
      const r = await fetchPage({ url: `${base}/missing` });
      expect(r.status).toBe(404);
      expect(r.ok).toBe(false);
    });

    it("times out on a server that never answers", async () => {
      allow();
      await expect(fetchPage({ url: `${base}/hang`, timeout_ms: 300 })).rejects.toThrow(/timed out/);
    });
  });

  describe("with the default SSRF guard", () => {
    it("blocks loopback, including via a hostname", async () => {
      vi.stubEnv("CAUSLY_ALLOW_PRIVATE_HOSTS", "");
      await expect(fetchPage({ url: `${base}/page` })).rejects.toThrow(/private or reserved/);
      await expect(fetchPage({ url: `http://localhost:${port}/page` })).rejects.toThrow(/Blocked/);
    });

    it.each(["http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://10.0.0.5/", "http://[::ffff:7f00:1]/", "http://2130706433/"])(
      "blocks %s before connecting",
      async (url) => {
        vi.stubEnv("CAUSLY_ALLOW_PRIVATE_HOSTS", "");
        await expect(fetchPage({ url })).rejects.toThrow(/private or reserved/);
      }
    );

    it("rejects non-http URLs and missing input", async () => {
      await expect(fetchPage({ url: "file:///etc/passwd" })).rejects.toThrow(/Only http and https/);
      await expect(fetchPage({})).rejects.toThrow(/url is required/);
    });
  });
});
