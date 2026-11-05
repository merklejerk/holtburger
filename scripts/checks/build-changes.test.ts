import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRelevant, documentationOnly } from "./build-changes.ts";

test("only root prose is excluded from build checks", () => {
  assert.equal(documentationOnly("README.md"), true);
  for (const path of [
    "LICENSE.md",
    "apps/holtburger-3d/README.md",
    "release/quickstarts/cli/linux.md",
    "package.json",
  ])
    assert.equal(documentationOnly(path), false);
});

test("explicit verification events do not depend on a push/PR payload", () => {
  assert.equal(buildRelevant({}, "push", "tag"), true);
  assert.equal(buildRelevant({}, "workflow_dispatch", "branch"), true);
  assert.equal(buildRelevant({}, "schedule", "branch"), true);
});
