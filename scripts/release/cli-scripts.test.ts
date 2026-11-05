import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT, writeJson } from "../io.ts";
import { cliScripts } from "./cli-scripts.ts";

test("the TUI shipping manifest selects present nonempty exports", () => {
  for (const file of cliScripts(ROOT)) {
    const metadata = statSync(join(ROOT, "apps/holtburger-cli/scripts", file));
    assert.ok(metadata.isFile());
    assert.ok(metadata.size > 0);
  }
});

test("the TUI inventory can change without root policy edits and refuses unsafe or duplicate names", (t) => {
  const root = mkdtempSync(join(tmpdir(), "holtburger-cli-inventory-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "apps/holtburger-cli/scripts/bundle.json");
  mkdirSync(join(root, "apps/holtburger-cli/scripts"), { recursive: true });
  writeJson(path, ["another-script.js", "another-script.data.bin"]);
  assert.deepEqual(cliScripts(root), [
    "another-script.js",
    "another-script.data.bin",
  ]);
  for (const bad of [
    ["../escape"],
    ["/absolute"],
    ["nested/script.js"],
    ["."],
    ["a.js", "a.js"],
  ]) {
    writeJson(path, bad);
    assert.throws(() => cliScripts(root));
  }
});
