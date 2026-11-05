import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { github } from "./github.ts";
import { run, runBytes, sha256, writeJson } from "./io.ts";

test("subprocess capture preserves argument boundaries, binary output, cwd and failures", () => {
  const argument = "space, $literal, `backticks` and\na newline";
  assert.equal(
    run(
      process.execPath,
      ["-e", "process.stdout.write(process.argv[1])", argument],
      tmpdir(),
    ),
    argument,
  );
  assert.equal(
    run(
      process.execPath,
      ["-e", "process.stdout.write(process.cwd())"],
      tmpdir(),
    ),
    tmpdir(),
  );
  assert.deepEqual(
    runBytes(
      process.execPath,
      ["-e", "process.stdout.write(Buffer.from([0,255,10]))"],
      tmpdir(),
    ),
    Buffer.from([0, 255, 10]),
  );
  assert.throws(
    () =>
      run(
        process.execPath,
        ["-e", 'process.stderr.write("native failure"); process.exit(19)'],
        tmpdir(),
      ),
    /exited 19: native failure/,
  );
  assert.throws(
    () =>
      run(
        process.execPath,
        [
          "-e",
          'process.stdout.write("installer log: "); process.stderr.write("failed"); process.exit(19)',
        ],
        tmpdir(),
      ),
    /exited 19: installer log: failed/,
  );
  assert.throws(
    () =>
      runBytes(
        process.execPath,
        ["-e", "setInterval(()=>{},1000)"],
        tmpdir(),
        50,
      ),
    /ETIMEDOUT/,
  );
});

test("authenticated GitHub adapter rejects foreign endpoints before execution", () => {
  for (const args of [
    [],
    ["repos/another/repository/releases"],
    ["https://example.invalid/releases"],
  ])
    assert.throws(() => github(args), /must address this repository/);
});

test("receipt serialization sorts nested keys and hashes original UTF-8 bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "holtburger-io-"));
  try {
    const path = join(root, "receipt.json");
    writeJson(path, { z: { b: 2, A: 1 }, a: "雪" });
    assert.equal(
      readFileSync(path, "utf8"),
      '{\n  "a": "雪",\n  "z": {\n    "A": 1,\n    "b": 2\n  }\n}\n',
    );
    assert.equal(
      sha256(Buffer.from("abc")),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
