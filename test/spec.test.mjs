// Offline checks of spec/x.json against the installed api-anything: no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const dist = new URL("../node_modules/api-anything/dist/", import.meta.url);
const { buildRequest } = await import(new URL("http.js", dist));
const { scanSecrets } = await import(new URL("secrets.js", dist));
const { parseSite } = await import(new URL("spec.js", dist));

const raw = JSON.parse(readFileSync(new URL("../spec/x.json", import.meta.url), "utf8"));
const site = parseSite(raw);
const session = {
  cookies: [
    { name: "ct0", value: "CSRF-VALUE", domain: ".x.com", path: "/", expires: -1, httpOnly: false, secure: true },
    { name: "auth_token", value: "AUTH-VALUE", domain: ".x.com", path: "/", expires: -1, httpOnly: true, secure: true },
  ],
  values: {},
};

const sample = { text: "crossbar test ✓ \"quoted\"", tweetId: "1999999999999999999", userId: "424242", query: "from:nasa moon", conversationId: "111-222", count: 7, cursor: "DAABCgABGc", product: "Latest", screen_name: "jack" };

test("the spec parses and names every op once", () => {
  const names = site.operations.map((o) => o.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.length >= 36);
});

test("no credential is stored in the spec", () => {
  const found = scanSecrets(site, session);
  assert.equal((found.hits ?? found.found ?? []).length, 0, JSON.stringify(found));
});

for (const op of site.operations) {
  test(`${op.name}: every arg lands in the request`, () => {
    const args = Object.fromEntries(op.params.map((p) => [p.name, sample[p.name] ?? p.example]));
    const req = buildRequest(op, args, session, "seed");
    const wire = decodeURIComponent(req.url) + (req.body ?? "") + decodeURIComponent((req.body ?? "").replace(/\+/g, " "));
    for (const [k, v] of Object.entries(args)) {
      const want = typeof v === "string" ? v.replace(/"/g, k === "text" ? '\\"' : '"') : String(v);
      assert.ok(wire.includes(want), `${k}=${v} missing from ${req.method} ${req.url} ${req.body ?? ""}`);
    }
    if (op.learnedLoggedIn) {
      assert.equal(req.headers["x-csrf-token"], "CSRF-VALUE");
      assert.match(req.headers.cookie ?? "", /auth_token=AUTH-VALUE/);
    }
    if (req.body && req.headers["content-type"] === "application/json") JSON.parse(req.body);
  });
}

test("an optional cursor left out stays null", () => {
  const op = site.operations.find((o) => o.name === "homeTimeline");
  const req = buildRequest(op, {}, session, "seed");
  const vars = JSON.parse(new URL(req.url).searchParams.get("variables"));
  assert.equal(vars.cursor, null);
  assert.equal(vars.count, 20);
});

test("every write may run at tier 3 (companions and match recorded)", () => {
  for (const op of site.operations.filter((o) => !o.readOnly)) {
    assert.ok(Array.isArray(op.trigger.companions), op.name);
    assert.ok(Object.keys(op.match).length, op.name);
  }
});
