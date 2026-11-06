import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test, type TestContext } from "node:test";
import { z } from "zod";
import { ROOT, readJson } from "../io.ts";

/** Fake Cargo records the wrapper contract without starting the interactive TUI. */
function launch(
  t: TestContext,
  args: readonly string[],
  overrides: NodeJS.ProcessEnv,
  command: readonly string[] = ["cli"],
) {
  const directory = mkdtempSync(join(tmpdir(), "holtburger-dev-runner-")),
    capture = join(directory, "capture.json"),
    cargo = join(directory, "cargo");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(
    cargo,
    `#!${process.execPath}\nconst fs = require('node:fs'); fs.writeFileSync(process.env.RUNNER_CAPTURE, JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),content:process.env.HOLTBURGER_DEFAULT_CONTENT,scripts:process.env.SCRIPT_DIR,bundle:process.env.SCRIPT_BUNDLE_DIR})); process.exit(19);\n`,
  );
  chmodSync(cargo, 0o755);
  const npm = join(directory, "npm");
  writeFileSync(npm, readFileSync(cargo));
  chmodSync(npm, 0o755);
  const env = { ...process.env };
  for (const key of [
    "HOLTBURGER_DEFAULT_CONTENT",
    "SCRIPT_DIR",
    "SCRIPT_BUNDLE_DIR",
  ])
    delete env[key];
  Object.assign(env, overrides, {
    PATH: `${directory}${delimiter}${env.PATH}`,
    RUNNER_CAPTURE: capture,
  });
  const result = spawnSync(
    process.execPath,
    [join(ROOT, "scripts/dev.ts"), ...command, ...args],
    {
      cwd: directory,
      env,
    },
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 19, result.stderr.toString());
  return z
    .object({
      args: z.array(z.string()),
      cwd: z.string(),
      content: z.string().optional(),
      scripts: z.string().optional(),
      bundle: z.string().optional(),
    })
    .parse(readJson(capture));
}

test(
  "Node CLI runner preserves arguments, exit status and independent working directory",
  { skip: process.platform === "win32" },
  (t) => {
    const captured = launch(
      t,
      [
        "--content",
        "chosen directory",
        "--script-dir",
        "personal directory",
        "--script-bundle-dir",
        "bundled directory",
        "-a",
        "example",
      ],
      {},
    );
    assert.equal(captured.content, join(ROOT, "local/content"));
    assert.equal(captured.scripts, join(ROOT, "local/scripts"));
    assert.equal(captured.bundle, join(ROOT, "apps/holtburger-cli/scripts"));
    assert.deepEqual(captured.args, [
      "run",
      "--manifest-path",
      join(ROOT, "Cargo.toml"),
      "-p",
      "holtburger-cli",
      "--bin",
      "tui",
      "--",
      "--content",
      "chosen directory",
      "--script-dir",
      "personal directory",
      "--script-bundle-dir",
      "bundled directory",
      "-a",
      "example",
    ]);
  },
);

test(
  "Node CLI release runner keeps configured and explicitly empty defaults",
  { skip: process.platform === "win32" },
  (t) => {
    const captured = launch(t, ["--release", "--content", "explicit"], {
      HOLTBURGER_DEFAULT_CONTENT: "configured",
      SCRIPT_DIR: "writable",
      SCRIPT_BUNDLE_DIR: "bundled",
    });
    assert.deepEqual(captured.args.slice(0, 2), ["run", "--release"]);
    assert.deepEqual(captured.args.slice(-3), ["--", "--content", "explicit"]);
    assert.deepEqual(
      [captured.content, captured.scripts, captured.bundle],
      ["configured", "writable", "bundled"],
    );
    assert.equal(launch(t, [], { HOLTBURGER_DEFAULT_CONTENT: "" }).content, "");
  },
);

test(
  "Node launchers forward native tool and Electron arguments without normalization",
  { skip: process.platform === "win32" },
  (t) => {
    const args = [
      "--account",
      "0012",
      "--no-launcher",
      "-h",
      "chosen host",
      "--",
      "--help",
    ];
    for (const mode of ["client", "explorer"]) {
      const captured = launch(t, args, {}, [mode]);
      assert.deepEqual(captured.args, [
        "--prefix",
        join(ROOT, "apps/holtburger-3d"),
        "run",
        `dev:${mode}`,
        "--",
        "--account",
        "0012",
        "--no-launcher",
        "-h",
        "chosen host",
        "--help",
      ]);
    }
    const tool = launch(
      t,
      ["--release", "--input", "path with spaces", "--", "--help"],
      {},
      ["tool", "dat-tool"],
    );
    assert.deepEqual(tool.args, [
      "run",
      "--release",
      "--manifest-path",
      join(ROOT, "Cargo.toml"),
      "-p",
      "holtburger-tools",
      "--bin",
      "dat-tool",
      "--",
      "--input",
      "path with spaces",
      "--help",
    ]);
    const site = launch(t, ["--port", "4179"], {}, ["site"]);
    assert.deepEqual(site.args, [
      "--prefix",
      join(ROOT, "site"),
      "run",
      "dev",
      "--",
      "--port",
      "4179",
    ]);
  },
);
