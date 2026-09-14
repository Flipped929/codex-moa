import test from "node:test";
import assert from "node:assert/strict";
import { redactText } from "../src/lib/redact.mjs";

test("redacts api keys and bearer tokens", () => {
  const fakeKey = ["sk", "example", "redaction", "value"].join("-");
  const fakeBearer = ["example", "redaction", "token"].join("-");
  const output = redactText(`api_key=${fakeKey} Bearer ${fakeBearer}`);
  assert.doesNotMatch(output, new RegExp(fakeKey));
  assert.doesNotMatch(output, new RegExp(fakeBearer));
});
