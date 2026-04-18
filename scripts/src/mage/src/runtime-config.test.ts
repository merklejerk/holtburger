import assert from "node:assert/strict";
import test from "node:test";

import { loadMageConfig, normalizeMageConfig } from "./runtime-config";

const testGlobal = globalThis as typeof globalThis & {
  HB: {
    loadConfig: () => unknown;
    writeConfig: (contents: unknown) => boolean;
  };
};

test("normalizeMageConfig filters invalid preferred spell ids", () => {
  assert.deepEqual(
    normalizeMageConfig({
      preferredSpellIds: [101, "bad", 202, 101, 0, -1, 303.5],
    }),
    {
      preferredSpellIds: [101, 202],
    },
  );
});

test("normalizeMageConfig defaults missing config to empty preferences", () => {
  assert.deepEqual(normalizeMageConfig(null), {
    preferredSpellIds: [],
  });
});

test("loadMageConfig writes an empty config when none exists", () => {
  const writes: unknown[] = [];
  testGlobal.HB = {
    loadConfig: () => null,
    writeConfig: (contents) => {
      writes.push(contents);
      return true;
    },
  };

  assert.deepEqual(loadMageConfig(), {
    preferredSpellIds: [],
  });
  assert.deepEqual(writes, [{}]);
});