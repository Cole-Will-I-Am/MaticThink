// Pure, testable helpers shared by the Worker (no runtime/IO dependencies).

// Whitelist + clamp client-supplied sampling options before forwarding upstream.
export const OPTION_BOUNDS = {
  temperature: [0, 2], top_p: [0, 1], top_k: [0, 200],
  min_p: [0, 1], repeat_penalty: [0, 2],
};

export function sanitizeOptions(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(OPTION_BOUNDS)) {
    const v = raw[k];
    if (typeof v === "number" && isFinite(v)) out[k] = Math.min(hi, Math.max(lo, v));
  }
  // num_predict: -1 means "until context fills"; otherwise clamp to a generous ceiling.
  if (typeof raw.num_predict === "number" && isFinite(raw.num_predict)) {
    const n = Math.trunc(raw.num_predict);
    if (n === -1) out.num_predict = -1;
    else if (n >= 1) out.num_predict = Math.min(131072, n);
  }
  // seed: any non-negative integer, for reproducible sampling.
  if (typeof raw.seed === "number" && isFinite(raw.seed)) {
    out.seed = Math.max(0, Math.trunc(raw.seed));
  }
  // stop: up to 8 non-empty strings (<=64 chars each) that halt generation.
  if (Array.isArray(raw.stop)) {
    const stop = raw.stop
      .filter((s) => typeof s === "string" && s.length)
      .slice(0, 8)
      .map((s) => s.slice(0, 64));
    if (stop.length) out.stop = stop;
  }
  return Object.keys(out).length ? out : undefined;
}

// SSRF guard for /api/fetch — returns true if the host must be blocked.
// Covers loopback/private/link-local in IPv4 AND IPv6, plus decimal/hex/octal
// IP encodings. (DNS rebinding to a private IP is moot on Cloudflare Workers,
// which can't route to RFC1918 addresses anyway.)
export function isBlockedHost(rawHost) {
  if (!rawHost) return true;
  const host = String(rawHost).toLowerCase().replace(/^\[|\]$/g, "").trim();
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return true;
  }
  // IPv6
  if (host.includes(":")) {
    if (host === "::1" || host === "::" || host === "0:0:0:0:0:0:0:1") return true;
    if (/^f[cd][0-9a-f]*:/.test(host)) return true;       // unique-local fc00::/7
    if (/^fe[89ab][0-9a-f]*:/.test(host)) return true;    // link-local fe80::/10
    if (/^::ffff:/.test(host)) return true;               // IPv4-mapped
    return false;
  }
  // Bare decimal (2130706433 == 127.0.0.1) or hex (0x7f000001) integer host.
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/.test(host)) return true;
  // Dotted IPv4, possibly with octal/hex octets.
  const parts = host.split(".");
  if (parts.length === 4 && parts.every((p) => /^(0x[0-9a-f]+|\d+)$/.test(p))) {
    const nums = parts.map((p) =>
      p.startsWith("0x") ? parseInt(p, 16) : (/^0\d+$/.test(p) ? parseInt(p, 8) : parseInt(p, 10))
    );
    if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // malformed → block
    const [a, b] = nums;
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    return false; // public IPv4
  }
  return false; // ordinary domain name
}
