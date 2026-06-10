# SEER · Mantic Think

A minimal, SEER-styled chat website for Ollama models, deployed as a single
Cloudflare Worker. **Bring your own key** — each visitor enters their own
Ollama API key, which is stored only in their browser and never persisted on
the server.

Live: https://manticthink.com

## How it works

- **`public/index.html`** — the SEER-styled single-page chat UI (key-entry gate,
  streaming responses, model picker). Served as a Cloudflare static asset.
- **`worker.js`** — a Cloudflare Worker that:
  - `POST /api/validate` — verifies a visitor's key against the backend's
    authenticated `/api/me` endpoint.
  - `POST /api/chat` — proxies the chat request to the Ollama backend using the
    visitor's key (`Authorization: Bearer …`), streaming the NDJSON response
    straight back. Returns `401` without a key.
  - `GET /api/models` — the model list shown in the picker (from config).
  - `GET /api/catalog` — the backend's full model catalog (for the model manager).
  - `GET /api/fetch?url=…` — server-side fetch proxy for the `fetch_url` tool
    (auth-gated, http(s) only, loopback/private hosts blocked, ~64 KB read cap).
  - Everything else — the static SEER site, served with
    `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` headers (via
    `public/_headers`) so the page is cross-origin isolated — required for
    `SharedArrayBuffer`, which powers interactive Python.

The visitor's key travels in the `Authorization` header from the browser and is
forwarded upstream per request. It is never stored or logged server-side.

## Features

Beyond basic chat, the UI includes:

- **Conversations** — local history with rename/delete and sidebar search.
- **Models** — pick any backend model; add by name or browse the catalog.
- **Generation settings** — system prompt and sampling params (temperature,
  top_p, top_k, min_p, repeat penalty, max tokens, seed, stop).
- **Reasoning scaffolds** — reusable, structured system-prompt templates (with
  built-ins) compiled into a system message.
- **Projects** — per-project instructions + context files injected into every
  chat in the project.
- **Saved code** — save code blocks to a searchable library; run or copy them.
- **GitHub** — connect a read-only token, browse repos/branches, and pull files
  in as context (entirely client-side; GitHub's API is CORS-open).
- **Attachments** — PDFs (text-extracted via pdf.js) and text/code files as
  per-message context.
- **Visuals** — model output rendered as Mermaid diagrams, Chart.js charts, and
  Markdown tables.
- **Code execution** — run JavaScript (Web Worker) and Python (Pyodide/WASM)
  from code blocks, with interactive `input()` support.
- **Tools (function calling)** — opt-in; the model can call `run_javascript`,
  `run_python`, `calculator`, and `fetch_url`, executed in the sandboxes.

## Data & privacy

**Everything is stored in the visitor's browser; the server stores nothing
per-user.** No accounts, no cross-device sync.

- **In the browser** (`localStorage` / `sessionStorage`): the Ollama key, an
  optional GitHub token, conversations, projects, scaffolds, saved snippets,
  the model list, and settings. The API key is **session-only by default**
  unless *"Keep me signed in"* is checked (then it persists in `localStorage`).
- **Sent to Ollama** (per request): your messages, system prompt, any injected
  project / scaffold / attachment / GitHub-file context, and sampling options —
  under *your* key, forwarded by the Worker, never stored or logged.
- **Sent to GitHub** (if connected): calls go directly from your browser to
  `api.github.com` with your token.
- **Server-side:** only aggregate, anonymous counters (Cloudflare Analytics
  Engine) — event name, outcome, and model — **never keys or message content.**

Privacy policy: <https://manticthink.com/privacy>.

## Tool execution & security

- **JS** runs in a throwaway **Web Worker** (no DOM, no `localStorage`, so no
  access to your keys), with captured output and a 10s timeout.
- **Python** runs via **Pyodide** in a persistent worker; interactive `input()`
  uses `SharedArrayBuffer` + `Atomics` (hence the COOP/COEP headers).
- **`fetch_url`** is proxied by `/api/fetch`: auth-gated, http(s) only, with
  loopback/private/link-local hosts and alternate IP encodings blocked, the host
  re-checked after redirects, and the response capped at ~64 KB.
- The Worker **whitelists and clamps** all sampling options before forwarding.
- Model-generated Markdown is sanitized with **DOMPurify**; Mermaid runs at
  `securityLevel: 'strict'`.

## External runtime dependency

Loaded on demand, only when first used: **Pyodide** (for Python execution) from
`cdn.jsdelivr.net`, pinned to `v0.26.2`. This is the one runtime dependency not
self-hosted; everything else (Mermaid, Chart.js, pdf.js, marked, DOMPurify,
highlight.js) is vendored under `public/vendor/`.

## Limits

- Attachments: PDF ≤ 15 MB (first 80 pages), text/code ≤ 1 MB; each capped to
  ~200k characters.
- GitHub: up to 40 files per attach; text files only.
- Tool loop: up to 8 iterations per turn.
- `fetch_url`: ~64 KB read, ~8k characters returned.
- Code execution: 10s (JS) / 30s (Python) timeouts.

## Configuration

Edit `wrangler.toml` `[vars]`:

| Var | Purpose |
|-----|---------|
| `OLLAMA_BASE_URL` | Upstream base (default `https://ollama.com`) |
| `CHAT_MODELS` | Comma-separated model list shown in the picker |
| `DEFAULT_MODEL` | Model used when a request omits one |

There is no server-side API key — by design.

## Develop & deploy

```bash
npm install

# Local dev (point at any Ollama backend via .dev.vars)
npx wrangler dev

# Deploy (requires a Cloudflare API token with Workers access)
CLOUDFLARE_API_TOKEN=… npx wrangler deploy
```

Custom domains (`manticthink.com`, `www.manticthink.com`) are attached via the
`[[routes]]` entries in `wrangler.toml`.

## Tests

Pure Worker logic (option clamping, SSRF host-blocking, routing) lives in
`worker-lib.mjs` and is covered by `test/worker.test.mjs` — no external deps:

```bash
npm test    # node --test
```

## Author & license

Created and owned by **Colton Williams** — [LinkedIn](https://www.linkedin.com/in/colton-williams).

© 2026 Colton Williams. All rights reserved. This project is proprietary; see
[`LICENSE`](./LICENSE). No use, copying, or distribution without written
permission.
