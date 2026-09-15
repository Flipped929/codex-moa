import test from "node:test";
import assert from "node:assert/strict";
import { redactText, redactValue } from "../src/lib/redact.mjs";

test("redacts api keys and bearer tokens", () => {
  const fakeKey = ["sk", "example", "redaction", "value"].join("-");
  const fakeBearer = ["example", "redaction", "token"].join("-");
  const output = redactText(`api_key=${fakeKey} Bearer ${fakeBearer}`);
  assert.doesNotMatch(output, new RegExp(fakeKey));
  assert.doesNotMatch(output, new RegExp(fakeBearer));
});

test("redacts values under secret-looking object keys", () => {
  const output = redactValue({ apiKey: "short-value", nested: { authorization: "Basic abc", safe: "ok" } });
  assert.equal(output.apiKey, "***REDACTED***");
  assert.equal(output.nested.authorization, "***REDACTED***");
  assert.equal(output.nested.safe, "ok");
});
