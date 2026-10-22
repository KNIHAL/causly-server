import { z } from "zod";
import { wrap } from "../tools/toolWrapper.js";
import * as seoOps from "../tools/seoOps.js";

export default function register(server) {
  // ---------------- SEO and content tools ----------------
  server.registerTool(
    "seo_keyword_ideas",
    {
      description:
        "Keyword ideas for a topic from search autocomplete (Google, Bing, DuckDuckGo; free, no key). Returns long-tail phrases, questions and comparisons, each tagged with intent. There is NO search volume: best_rank (1 = most popular) and how many sources agree are rough demand signals. Higher expand levels send more requests.",
      inputSchema: {
        seed: z.string().describe("Topic or head keyword, e.g. 'freelance web developer'"),
        expand: z.enum(["none", "questions", "alphabet", "all"]).optional().describe("none = just the seed; questions (default) = how/what/best and for/vs/cost variants; alphabet = seed + a..z; all = both"),
        sources: z.array(z.enum(["google", "bing", "duckduckgo"])).optional().describe("Default ['google','bing']"),
        country: z.string().optional().describe("2-letter country for Google, default us"),
        language: z.string().optional().describe("Language code for Google, default en"),
        limit: z.number().optional().describe("Max keywords returned (1-200, default 50)"),
      },
    },
    wrap("seo_keyword_ideas", seoOps.keywordIdeas)
  );

  server.registerTool(
    "seo_page_audit",
    {
      description:
        "On-page SEO audit of a live URL: title and meta description length, headings, canonical, robots, word count, images without alt, internal/external links, structured data, Open Graph. Pass a target keyword to check where it appears. Returns a list of warnings and tips.",
      inputSchema: {
        url: z.string().describe("Page URL"),
        keyword: z.string().optional().describe("Target keyword to check for"),
      },
    },
    wrap("seo_page_audit", seoOps.pageAudit)
  );

  server.registerTool(
    "seo_content_check",
    {
      description:
        "Check a draft (markdown or plain text) before publishing: word count, reading time and ease, sentence and paragraph length, headings, links, image alt text, and where the target keyword appears. Optionally check a planned title and meta description. Works locally; nothing is sent anywhere.",
      inputSchema: {
        text: z.string().describe("The draft"),
        keyword: z.string().optional().describe("Target keyword"),
        title: z.string().optional().describe("Planned page title"),
        meta_description: z.string().optional().describe("Planned meta description"),
      },
    },
    wrap("seo_content_check", seoOps.contentCheck)
  );

  server.registerTool(
    "seo_search_console",
    {
      description:
        "Your own site's real search performance from Google Search Console: queries, pages, clicks, impressions, CTR and average position. Call without `site` to list your properties. Use quick_wins: true to find queries ranking at positions 4-20 that could move up. Needs GSC_REFRESH_TOKEN (webmasters.readonly scope) plus GSC_CLIENT_ID/GSC_CLIENT_SECRET or the Gmail OAuth client.",
      inputSchema: {
        site: z.string().optional().describe("Property, e.g. 'sc-domain:example.com' or 'https://example.com/'. Omit to list properties."),
        days: z.number().optional().describe("Days to look back (1-90, default 28; data lags about 2 days)"),
        dimensions: z.array(z.enum(["query", "page", "country", "device", "date"])).optional().describe("Group rows by these (default ['query'])"),
        limit: z.number().optional().describe("Max rows (1-1000, default 25)"),
        query_contains: z.string().optional().describe("Only queries containing this text"),
        page_contains: z.string().optional().describe("Only pages whose URL contains this text"),
        quick_wins: z.boolean().optional().describe("Only positions 4-20 with enough impressions, most impressions first"),
        min_impressions: z.number().optional().describe("Impressions floor for quick_wins (default 20)"),
      },
    },
    wrap("seo_search_console", seoOps.searchConsole)
  );
}
