import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalJson, readData, sha256Json } from "../src/fs-utils.js";

test("canonical JSON is order-independent and has a frozen cross-implementation vector", () => {
  const first = { b: 1, a: [3, { z: "雪", x: true }], n: -0 };
  const second = { n: 0, a: [3, { x: true, z: "雪" }], b: 1 };
  const encoded = '{"a":[3,{"x":true,"z":"雪"}],"b":1,"n":0}';
  const digest = "54f0fe0b4f3b0a0f8fde478c862a7a0ceb9a410f908391ccc61c58e31365c22d";

  assert.equal(canonicalJson(first), encoded);
  assert.equal(canonicalJson(second), encoded);
  assert.equal(sha256Json(first), digest);
  assert.equal(sha256Json(second), digest);
});

test("canonical JSON rejects values outside the interoperable JSON domain", () => {
  assert.throws(() => canonicalJson(undefined), /cannot encode undefined/);
  assert.throws(() => canonicalJson(Number.NaN), /non-finite/);
  assert.throws(() => canonicalJson(new Date()), /plain JSON objects/);
  assert.throws(() => canonicalJson([, 1]), /sparse arrays/);
  assert.throws(() => canonicalJson("\ud800"), /lone Unicode surrogates/);
});

test("artifact readers reject ambiguous duplicate JSON and YAML keys", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "loop-engineering-canonical-json-"));
  const jsonPath = path.join(directory, "duplicate.json");
  const yamlPath = path.join(directory, "duplicate.yaml");
  fs.writeFileSync(jsonPath, '{"actor":"first","actor":"second"}\n');
  fs.writeFileSync(yamlPath, "actor: first\nactor: second\n");

  assert.throws(() => readData(jsonPath), /keys must be unique/);
  assert.throws(() => readData(yamlPath), /keys must be unique/);
});
