// SEER · Mantic Think — © 2026 Colton Williams. All rights reserved.
// SEER · Mantic Think — Cloudflare Worker (bring-your-own-key)
// Serves the SEER-styled chat UI and proxies chat to an Ollama-compatible
// backend using a key supplied by each visitor. The key travels in the
// Authorization header from the browser and is forwarded upstream; it is never
// stored or logged server-side.
//
// Config (wrangler.toml [vars]):
//   OLLAMA_BASE_URL  upstream base, default https://ollama.com
//   CHAT_MODELS      comma-separated model list shown in the picker
//   DEFAULT_MODEL    model used when a request omits one

import { sanitizeOptions, isBlockedHost } from "./worker-lib.mjs";

const FALLBACK_MODELS = "gpt-oss:120b-cloud,qwen3-coder:480b-cloud,deepseek-v3.1:671b-cloud";

// Cross-origin isolation — required so the page can use SharedArrayBuffer /
// Atomics (used for interactive stdin in the sandboxed Python runner).
const COI_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...COI_HEADERS },
  });
}

// Aggregate event counter (Analytics Engine). Records only an event name, a
// coarse outcome/detail, and the model — never the API key or any message
// content.
function track(env, event, outcome, model) {
  try {
    if (env.AE && typeof env.AE.writeDataPoint === "function") {
      env.AE.writeDataPoint({ indexes: [event], blobs: [event, outcome || "", model || ""], doubles: [1] });
    }
  } catch (e) { /* never let telemetry affect the request */ }
}

function modelList(env) {
  return (env.CHAT_MODELS || FALLBACK_MODELS)
    .split(",").map((m) => m.trim()).filter(Boolean);
}

function bearer(request) {
  const auth = request.headers.get("authorization") || "";
  return /^bearer\s+\S+/i.test(auth) ? auth : null;
}

function upstreamBase(env) {
  return (env.OLLAMA_BASE_URL || "https://ollama.com").replace(/\/+$/, "");
}

// Check a visitor's key against the backend, with a short edge-cache so the
// fetch_url tool doesn't hit upstream on every call. Only a hash of the key is
// used as the cache key; the verdict ("1"/"0") is all that's stored.
async function keyIsValid(auth, env) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(auth));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const cache = (typeof caches !== "undefined" && caches.default) ? caches.default : null;
  const cacheKey = cache ? new Request("https://key-check.internal/" + hex) : null;
  if (cache) {
    const hit = await cache.match(cacheKey).catch(() => null);
    if (hit) return (await hit.text()) === "1";
  }
  let ok = false;
  try {
    const r = await fetch(upstreamBase(env) + "/api/me", {
      method: "POST",
      headers: { authorization: auth },
      signal: AbortSignal.timeout(10000),
    });
    ok = r.ok;
  } catch {
    return false;   // transient failure: deny but don't cache the verdict
  }
  if (cache) {
    try { await cache.put(cacheKey, new Response(ok ? "1" : "0", { headers: { "cache-control": "max-age=300" } })); } catch (e) {}
  }
  return ok;
}

// Confirm a visitor's key is accepted by the backend. Uses the authenticated
// /api/me endpoint, which returns 401 for an invalid key (unlike /api/tags,
// which is unauthenticated on Ollama Cloud).
async function handleValidate(request, env) {
  const auth = bearer(request);
  if (!auth) { track(env, "validate", "missing"); return json({ ok: false, error: "Enter your Ollama API key." }, 200); }
  try {
    const r = await fetch(upstreamBase(env) + "/api/me", {
      method: "POST",
      headers: { authorization: auth },
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) { track(env, "validate", "ok"); return json({ ok: true }, 200); }
    if (r.status === 401 || r.status === 403) {
      track(env, "validate", "rejected");
      return json({ ok: false, error: "That key was rejected." }, 200);
    }
    track(env, "validate", "error");
    return json({ ok: false, error: `Could not verify key (${r.status}).` }, 200);
  } catch {
    track(env, "validate", "unreachable");
    return json({ ok: false, error: "Could not reach the model backend." }, 200);
  }
}

// The list of models available on the Ollama backend (its public catalog),
// so the UI can let users add any of them to their personal picker.
async function handleCatalog(request, env) {
  const auth = bearer(request);
  try {
    const r = await fetch(upstreamBase(env) + "/v1/models", {
      headers: auth ? { authorization: auth } : {},
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return json({ models: [] }, 200);
    const data = await r.json().catch(() => ({}));
    const ids = Array.isArray(data.data) ? data.data.map((m) => m.id).filter(Boolean) : [];
    ids.sort((a, b) => a.localeCompare(b));
    return json({ models: ids }, 200);
  } catch {
    return json({ models: [] }, 200);
  }
}

async function handleChat(request, env) {
  const auth = bearer(request);
  if (!auth) return json({ error: "Missing API key." }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: "`messages` array is required." }, 400);
  }

  // Forward whatever model the client picked (users curate their own list and
  // may add any model the backend offers). The backend validates the name and
  // the visitor's key — no server-side whitelist. Fall back to the default
  // only when no model was supplied.
  // Normalize a trailing ":cloud" tag: that suffix is only meaningful to a local
  // Ollama daemon (CLI passthrough). ollama.com's hosted API uses bare names and
  // has no ":cloud" variants, so an unstripped suffix → unknown model → 500/502.
  const requested = (typeof body.model === "string" ? body.model.trim() : "").replace(/:cloud$/, "");
  const model = requested || env.DEFAULT_MODEL || modelList(env)[0];
  const options = sanitizeOptions(body.options);
  const tools = Array.isArray(body.tools) && body.tools.length ? body.tools : undefined;
  track(env, "chat_attempt", "", model);

  let upstream;
  // Connect-timeout only: the timer is cleared as soon as headers arrive, so
  // the stream itself stays unbounded.
  const connectCtrl = new AbortController();
  const connectTimer = setTimeout(() => connectCtrl.abort(), 15000);
  try {
    upstream = await fetch(upstreamBase(env) + "/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: JSON.stringify({ model, messages, stream: true, ...(options ? { options } : {}), ...(tools ? { tools } : {}) }),
      signal: connectCtrl.signal,
    });
  } catch {
    track(env, "chat_backend_error", "unreachable", model);
    return json({ error: "Could not reach the model backend." }, 502);
  } finally {
    clearTimeout(connectTimer);
  }

  if (upstream.status === 401 || upstream.status === 403) {
    track(env, "chat_rejected", String(upstream.status), model);
    return json({ error: "Your API key was rejected. Reconnect with a valid key." }, 401);
  }
  if (!upstream.ok || !upstream.body) {
    track(env, "chat_backend_error", String(upstream.status), model);
    const detail = await upstream.text().catch(() => "");
    const hint = upstream.status >= 500 ? ` The model "${model}" may not be available on your account.` : "";
    return json({ error: `Backend error (${upstream.status}).${hint}`, detail: detail.slice(0, 300) }, 502);
  }
  track(env, "chat_success", "", model);

  return new Response(upstream.body, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", ...COI_HEADERS },
  });
}

// Server-side fetch for the `fetch_url` tool — avoids browser CORS and keeps a
// few safety limits (auth required, http(s) only, internal hosts blocked).
async function handleFetch(request, env) {
  // Require a key that the backend actually accepts — a format check alone
  // would leave this as an open GET relay.
  const auth = bearer(request);
  if (!auth) return json({ error: "Unauthorized" }, 401);
  if (!(await keyIsValid(auth, env))) return json({ error: "Unauthorized" }, 401);
  let target;
  try { target = new URL(new URL(request.url).searchParams.get("url") || ""); } catch { return json({ error: "Invalid URL" }, 400); }
  if (!/^https?:$/.test(target.protocol)) return json({ error: "Only http(s) URLs are allowed." }, 400);
  if (isBlockedHost(target.hostname)) return json({ error: "That host is blocked." }, 400);
  try {
    const r = await fetch(target.toString(), {
      headers: { "user-agent": "manticthink-tool/1.0", accept: "text/*, application/json, */*" },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    // Re-check the final URL after any redirects.
    try { if (isBlockedHost(new URL(r.url).hostname)) return json({ error: "Redirected to a blocked host." }, 400); } catch (e) {}
    // Bounded read: pull at most ~64 KB from the stream rather than buffering the whole body.
    const CAP = 64 * 1024;
    let text = "", total = 0;
    if (r.body) {
      const reader = r.body.getReader();
      const dec = new TextDecoder("utf-8", { fatal: false });
      while (total < CAP) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        text += dec.decode(value, { stream: true });
      }
      try { await reader.cancel(); } catch (e) {}
    }
    const ct = r.headers.get("content-type") || "";
    if (/html/i.test(ct)) {
      text = text.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
    }
    return json({ url: target.toString(), status: r.status, text: text.slice(0, 8000) }, 200);
  } catch {
    return json({ error: "Could not fetch that URL." }, 502);
  }
}

// ---- Shared debates (KV-backed short links) ----
function debateShortId() {
  const bytes = new Uint8Array(7);
  crypto.getRandomValues(bytes);
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let s = "";
  for (const b of bytes) s += alphabet[b % 36];
  return s;
}

// Store a debate the user explicitly shared. Validated + size-capped so this
// can't be used as a general-purpose data store.
async function handleDebateStore(request, env) {
  if (!env.DEBATES) return json({ error: "Sharing is not configured." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
  if (!body || typeof body.topic !== "string" || !Array.isArray(body.transcript) || !body.transcript.length) {
    return json({ error: "Invalid debate." }, 400);
  }
  const payload = JSON.stringify(body);
  if (payload.length > 200000) return json({ error: "Debate too large to share." }, 413);
  let id = debateShortId();
  if (await env.DEBATES.get(id)) id = debateShortId() + debateShortId().slice(0, 2);
  await env.DEBATES.put(id, payload, { expirationTtl: 60 * 60 * 24 * 365 });
  track(env, "debate_share", "store");
  return json({ id }, 200);
}

async function handleDebateGet(env, id) {
  if (!env.DEBATES || !/^[a-z0-9]{5,18}$/.test(id)) return json({ error: "Not found." }, 404);
  const val = await env.DEBATES.get(id);
  if (!val) return json({ error: "This shared debate was not found or has expired." }, 404);
  return new Response(val, { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
}

// Social-unfurl meta (title/description) for a shared debate. HTMLRewriter
// escapes the values, so a user-supplied topic is safe to inject.
function debateMeta(rec, pageUrl) {
  const topic = String(rec.topic || "AI Debate").replace(/\s+/g, " ").trim().slice(0, 140) || "AI Debate";
  const a = rec.modelA || "Model A", b = rec.modelB || "Model B";
  const verb = rec.mode === "discuss" ? "discuss" : "debate";
  return {
    title: ("AI Debate: " + topic).slice(0, 180),
    desc: (`${a} vs ${b} ${verb} this on Mantic Think — read the full exchange, then start your own free AI debate.`).slice(0, 240),
    url: pageUrl,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/models") return json({ models: modelList(env) });
    if (url.pathname === "/api/catalog") {
      if (request.method !== "GET") return json({ error: "Use GET." }, 405);
      return handleCatalog(request, env);
    }
    if (url.pathname === "/api/fetch") {
      if (request.method !== "GET") return json({ error: "Use GET." }, 405);
      return handleFetch(request, env);
    }
    if (url.pathname === "/api/validate") {
      if (request.method !== "POST") return json({ error: "Use POST." }, 405);
      return handleValidate(request, env);
    }
    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") return json({ error: "Use POST." }, 405);
      return handleChat(request, env);
    }
    if (url.pathname === "/api/debate") {
      if (request.method !== "POST") return json({ error: "Use POST." }, 405);
      return handleDebateStore(request, env);
    }
    if (url.pathname.startsWith("/api/debate/")) {
      if (request.method !== "GET") return json({ error: "Use GET." }, 405);
      return handleDebateGet(env, decodeURIComponent(url.pathname.slice("/api/debate/".length)));
    }
    // Short debate share links — serve the SPA (so the client renders the debate)
    // and rewrite the OG/Twitter meta so the link unfurls nicely on social.
    if (/^\/d\/[A-Za-z0-9_-]+$/.test(url.pathname)) {
      const spa = await env.ASSETS.fetch(new Request(new URL("/", url)));
      const sh = new Headers(spa.headers);
      sh.set("Cross-Origin-Opener-Policy", "same-origin");
      sh.set("Cross-Origin-Embedder-Policy", "require-corp");
      sh.delete("content-length");
      let rec = null;
      const id = url.pathname.slice(3);
      if (env.DEBATES && /^[a-z0-9]{5,18}$/.test(id)) {
        const v = await env.DEBATES.get(id);
        if (v) { try { rec = JSON.parse(v); } catch (e) {} }
      }
      const base = new Response(spa.body, { status: spa.status, statusText: spa.statusText, headers: sh });
      if (!rec) return base;
      const meta = debateMeta(rec, url.origin + url.pathname);
      return new HTMLRewriter()
        .on("title", { element(e) { e.setInnerContent(meta.title); } })
        .on('meta[name="description"]', { element(e) { e.setAttribute("content", meta.desc); } })
        .on('meta[property="og:title"]', { element(e) { e.setAttribute("content", meta.title); } })
        .on('meta[property="og:description"]', { element(e) { e.setAttribute("content", meta.desc); } })
        .on('meta[property="og:url"]', { element(e) { e.setAttribute("content", meta.url); } })
        .on('meta[property="og:image:alt"]', { element(e) { e.setAttribute("content", meta.title); } })
        .on('meta[name="twitter:title"]', { element(e) { e.setAttribute("content", meta.title); } })
        .on('meta[name="twitter:description"]', { element(e) { e.setAttribute("content", meta.desc); } })
        .transform(base);
    }
    const assetRes = await env.ASSETS.fetch(request);
    const h = new Headers(assetRes.headers);
    h.set("Cross-Origin-Opener-Policy", "same-origin");
    h.set("Cross-Origin-Embedder-Policy", "require-corp");
    return new Response(assetRes.body, { status: assetRes.status, statusText: assetRes.statusText, headers: h });
  },
};
