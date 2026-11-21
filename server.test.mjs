import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./server.mjs";

const MANUAL_REVIEW = { status: "manual_review", topic: null, draft: null };

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

async function post(baseUrl, body) {
  const response = await fetch(`${baseUrl}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

let server;
let baseUrl;

before(async () => {
  server = createApp();
  baseUrl = await listen(server);
});

after(() => server.close());

test("ready: valid model output is returned", async () => {
  const res = await post(baseUrl, { text: "Какая цена у вашего тарифа?" });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "ready");
  assert.equal(res.body.topic, "pricing");
  assert.ok(res.body.draft.length > 0);
});

for (const [name, body] of [
  ["missing text", {}],
  ["empty text", { text: "" }],
  ["whitespace text", { text: "   " }],
  ["non-string text", { text: 42 }],
  ["null body", "null"],
  ["array body", "[]"],
  ["broken JSON", "{text:"],
]) {
  test(`invalid_input: ${name}`, async () => {
    const res = await post(baseUrl, body);
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { status: "invalid_input" });
  });
}

for (const marker of ["[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
  test(`manual_review: model failure ${marker}`, async () => {
    const res = await post(baseUrl, { text: `Где доставка? ${marker}` });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, MANUAL_REVIEW);
  });
}

test("manual_review: model timeout is cut at ~300 ms", async () => {
  const started = Date.now();
  const res = await post(baseUrl, { text: "Где доставка? [timeout]" });
  const elapsed = Date.now() - started;
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, MANUAL_REVIEW);
  assert.ok(elapsed < 800, `expected response well before the 1200 ms mock delay, got ${elapsed} ms`);
});

test("manual_review: model that ignores abort signal still times out", async () => {
  const hanging = createApp({ classify: () => new Promise(() => {}), timeoutMs: 50 });
  const url = await listen(hanging);
  try {
    const res = await post(url, { text: "Привет" });
    assert.deepEqual(res.body, MANUAL_REVIEW);
  } finally {
    hanging.close();
  }
});
