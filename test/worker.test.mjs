import { test } from "node:test";
import assert from "node:assert/strict";

import { sanitizeOptions, isBlockedHost } from "../worker-lib.mjs";
import worker from "../worker.js";

test("sanitizeOptions clamps sampling params", () => {
  assert.deepEqual(sanitizeOptions({ temperature: 5, top_p: 0.3 }), { temperature: 2, top_p: 0.3 });
  assert.deepEqual(sanitizeOptions({ temperature: -1 }), { temperature: 0 });
});

test("sanitizeOptions handles num_predict (-1, cap, reject 0)", () => {
  assert.deepEqual(sanitizeOptions({ num_predict: -1 }), { num_predict: -1 });
  assert.deepEqual(sanitizeOptions({ num_predict: 9e9 }), { num_predict: 131072 });
  assert.equal(sanitizeOptions({ num_predict: 0 }), undefined);
});

test("sanitizeOptions floors/clamps seed and trims stop list", () => {
  assert.deepEqual(sanitizeOptions({ seed: 42.9 }), { seed: 42 });
  assert.deepEqual(sanitizeOptions({ seed: -5 }), { seed: 0 });
  assert.deepEqual(sanitizeOptions({ stop: ["END", "", "###", 7] }), { stop: ["END", "###"] });
  assert.equal(sanitizeOptions({ stop: [] }), undefined);
});

test("sanitizeOptions drops junk and non-objects", () => {
  assert.equal(sanitizeOptions({ foo: 1, temperature: "x" }), undefined);
  assert.equal(sanitizeOptions(null), undefined);
  assert.equal(sanitizeOptions("nope"), undefined);
});

test("isBlockedHost blocks loopback/private IPv4 and odd encodings", () => {
  for (const h of [
    "localhost", "x.internal", "y.local",
    "127.0.0.1", "127.1.2.3", "10.0.0.5", "192.168.1.1", "172.16.0.1", "172.31.255.255",
    "169.254.169.254", "0.0.0.0",
    "2130706433",        // decimal 127.0.0.1
    "0x7f000001",        // hex 127.0.0.1
    "0177.0.0.1",        // octal 127.0.0.1
    "::1", "fc00::1", "fd12::1", "fe80::1", "::ffff:127.0.0.1",
  ]) {
    assert.equal(isBlockedHost(h), true, `should block ${h}`);
  }
});

test("isBlockedHost allows public hosts", () => {
  for (const h of ["example.com", "api.github.com", "8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "2606:4700:4700::1111"]) {
    assert.equal(isBlockedHost(h), false, `should allow ${h}`);
  }
});

test("isBlockedHost blocks empty/garbage", () => {
  assert.equal(isBlockedHost(""), true);
  assert.equal(isBlockedHost(null), true);
});

const env = { CHAT_MODELS: "a,b,c", DEFAULT_MODEL: "a" };

test("router: /api/chat without auth returns 401", async () => {
  const res = await worker.fetch(new Request("https://x/api/chat", { method: "POST" }), env);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.match(body.error, /API key/i);
});

test("router: /api/validate rejects GET with 405", async () => {
  const res = await worker.fetch(new Request("https://x/api/validate"), env);
  assert.equal(res.status, 405);
});

test("router: /api/models returns the configured model list", async () => {
  const res = await worker.fetch(new Request("https://x/api/models"), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.models, ["a", "b", "c"]);
});

test("router: responses carry cross-origin-isolation headers", async () => {
  const res = await worker.fetch(new Request("https://x/api/models"), env);
  assert.equal(res.headers.get("cross-origin-embedder-policy"), "require-corp");
});
