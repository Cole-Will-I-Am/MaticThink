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
// coarse outcome, and the model — never the API key or any message content.
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

// Whitelist + clamp client-supplied sampling options before forwarding upstream.
const OPTION_BOUNDS = {
  temperature: [0, 2], top_p: [0, 1], top_k: [0, 200],
  min_p: [0, 1], repeat_penalty: [0, 2],
};
function sanitizeOptions(raw) {
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

function upstreamBase(env) {
  return (env.OLLAMA_BASE_URL || "https://ollama.com").replace(/\/+$/, "");
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
  const requested = typeof body.model === "string" ? body.model.trim() : "";
  const model = requested || env.DEFAULT_MODEL || modelList(env)[0];
  const options = sanitizeOptions(body.options);
  const tools = Array.isArray(body.tools) && body.tools.length ? body.tools : undefined;
  track(env, "chat", "sent", model);

  let upstream;
  try {
    upstream = await fetch(upstreamBase(env) + "/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: JSON.stringify({ model, messages, stream: true, ...(options ? { options } : {}), ...(tools ? { tools } : {}) }),
    });
  } catch {
    return json({ error: "Could not reach the model backend." }, 502);
  }

  if (upstream.status === 401 || upstream.status === 403) {
    return json({ error: "Your API key was rejected. Reconnect with a valid key." }, 401);
  }
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return json({ error: `Backend error (${upstream.status}).`, detail: detail.slice(0, 300) }, 502);
  }

  return new Response(upstream.body, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", ...COI_HEADERS },
  });
}

// Server-side fetch for the `fetch_url` tool — avoids browser CORS and keeps a
// few safety limits (auth required, http(s) only, internal hosts blocked).
async function handleFetch(request, env) {
  if (!bearer(request)) return json({ error: "Unauthorized" }, 401);
  let target;
  try { target = new URL(new URL(request.url).searchParams.get("url") || ""); } catch { return json({ error: "Invalid URL" }, 400); }
  if (!/^https?:$/.test(target.protocol)) return json({ error: "Only http(s) URLs are allowed." }, 400);
  const host = target.hostname.toLowerCase();
  if (/^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host.endsWith(".internal") || host.endsWith(".local")) {
    return json({ error: "That host is blocked." }, 400);
  }
  try {
    const r = await fetch(target.toString(), { headers: { "user-agent": "manticthink-tool/1.0", accept: "text/*, application/json, */*" }, redirect: "follow" });
    const ct = r.headers.get("content-type") || "";
    let text = await r.text();
    if (/html/i.test(ct)) {
      text = text.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
    }
    return json({ url: target.toString(), status: r.status, text: text.slice(0, 8000) }, 200);
  } catch {
    return json({ error: "Could not fetch that URL." }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/models") return json({ models: modelList(env) });
    if (url.pathname === "/api/catalog") return handleCatalog(request, env);
    if (url.pathname === "/api/fetch") return handleFetch(request, env);
    if (url.pathname === "/api/validate") {
      if (request.method !== "POST") return json({ error: "Use POST." }, 405);
      return handleValidate(request, env);
    }
    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") return json({ error: "Use POST." }, 405);
      return handleChat(request, env);
    }
    const assetRes = await env.ASSETS.fetch(request);
    const h = new Headers(assetRes.headers);
    h.set("Cross-Origin-Opener-Policy", "same-origin");
    h.set("Cross-Origin-Embedder-Policy", "require-corp");
    return new Response(assetRes.body, { status: assetRes.status, statusText: assetRes.statusText, headers: h });
  },
};
