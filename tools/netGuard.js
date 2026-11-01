// Shared network guard (SSRF). Every tool that fetches a URL on behalf of the agent goes through
// guardedRequest(), so web_fetch, the lead and SEO tools and http_check all share one set of rules:
// only public addresses, checked at connection time (so DNS tricks cannot get around it) and on
// every redirect hop. Set CAUSLY_ALLOW_PRIVATE_HOSTS=true to allow private addresses
// (for example to read a local dev server).
import dns from "dns";
import http from "http";
import https from "https";
import net from "net";

export const allowPrivate = () => /^(1|true|yes)$/i.test(process.env.CAUSLY_ALLOW_PRIVATE_HOSTS || "");

const ipv4ToInt = (ip) => ip.split(".").reduce((n, part) => n * 256 + Number(part), 0);

const V4_BLOCKED = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const inCidr = (ipInt, [base, bits]) => {
  const start = ipv4ToInt(base);
  return ipInt >= start && ipInt < start + 2 ** (32 - bits);
};

/** True only for a globally routable address. Anything unparseable counts as not public. */
export function isPublicAddress(address) {
  const ip = String(address).replace(/^\[|\]$/g, "").split("%")[0];
  const family = net.isIP(ip);
  if (family === 4) return !V4_BLOCKED.some((cidr) => inCidr(ipv4ToInt(ip), cidr));
  if (family === 6) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]);
    const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      return isPublicAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (lower.startsWith("::")) return false; // unspecified, loopback, compatible forms
    const first = parseInt(lower.split(":")[0], 16);
    if ((first & 0xfe00) === 0xfc00) return false; // unique local fc00::/7
    if ((first & 0xffc0) === 0xfe80) return false; // link-local fe80::/10
    if ((first & 0xff00) === 0xff00) return false; // multicast
    if (lower.startsWith("2001:db8:") || lower.startsWith("2001:0db8:")) return false; // documentation
    if (lower.startsWith("64:ff9b:")) return false; // NAT64, blocked conservatively
    return true;
  }
  return false;
}

export function parseHttpUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed.");
  }
  if (url.username || url.password) throw new Error("URLs with embedded credentials are not allowed.");
  return url;
}

// IP-literal hosts skip DNS, so they are checked here; names are checked in guardedLookup.
// (new URL() already turns decimal, octal, hex and short forms such as 2130706433 or 127.1 into dotted form.)
export function assertHostAllowed(url) {
  if (allowPrivate()) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && !isPublicAddress(host)) {
    throw new Error(`Blocked: ${host} is a private or reserved address.`);
  }
}

// Used by the HTTP client for every connection, so the address that is checked
// is the address that is actually connected to.
export function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!allowPrivate()) {
      const bad = addresses.find((a) => !isPublicAddress(a.address));
      if (bad) {
        return callback(new Error(`Blocked: ${hostname} resolves to a private or reserved address (${bad.address}).`));
      }
    }
    if (options && options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

/** One GET request through the guarded DNS lookup. Resolves with the response (body not read). */
export function getOnce(url, timeoutMs, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      { method: "GET", lookup: guardedLookup, signal: AbortSignal.timeout(timeoutMs), headers },
      resolve
    );
    req.on("error", (err) => {
      if (err.name === "TimeoutError" || err.code === "ABORT_ERR") {
        const timeout = new Error(`Request timed out after ${timeoutMs}ms.`);
        timeout.code = "CAUSLY_TIMEOUT";
        reject(timeout);
      } else {
        reject(err);
      }
    });
    req.end();
  });
}

const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

/**
 * GET a URL, following redirects. The URL is validated and the host checked on EVERY hop.
 * Resolves with { res, url }: the final response (body not read) and its URL.
 * `requestOnce` can be replaced in tests.
 */
export async function guardedRequest(rawUrl, { timeoutMs = 15_000, headers = {}, maxRedirects = 5, requestOnce = getOnce } = {}) {
  let url = parseHttpUrl(rawUrl);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    assertHostAllowed(url);
    const res = await requestOnce(url, timeoutMs, headers);
    if (REDIRECT_STATUSES.includes(res.statusCode) && res.headers.location) {
      res.resume();
      url = parseHttpUrl(new URL(res.headers.location, url).toString());
      continue;
    }
    return { res, url };
  }
  throw new Error(`Too many redirects (more than ${maxRedirects}).`);
}
