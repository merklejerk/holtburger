import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import spawn from "cross-spawn";
import which from "which";
import { ROOT, readJson } from "./io.ts";

/** Exercise the actual process boundary without allowing any external tool to run. */
function invoke(script: string, args: readonly string[], directory: string) {
  const result = spawnSync(process.execPath, [join(ROOT, script), ...args], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, PATH: directory },
    timeout: 10_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}

const helpCommands: readonly [string, string[]][] = [
  ["scripts/dev.ts", []],
  ...["cli", "client", "explorer", "site"].map(
    (mode) => ["scripts/dev.ts", [mode]] as [string, string[]],
  ),
  ["scripts/dev.ts", ["tool", "dat2hba"]],
  ["scripts/release/suite.ts", []],
  ...[
    "plan",
    "prepare-source",
    "assemble",
    "verify",
    "manifest",
    "publish",
    "flatpak-manifest",
    "prepare-flatpak",
    "record-flatpak",
  ].map(
    (command) => ["scripts/release/suite.ts", [command]] as [string, string[]],
  ),
  ["scripts/release/content.ts", ["fetch"]],
  ["scripts/release/content.ts", ["stage"]],
  ["scripts/release/version.ts", ["bump"]],
  ["scripts/release/preparation.ts", ["open"]],
  ["scripts/release/installers.ts", []],
  ["scripts/release/publication.ts", []],
  ["scripts/release/flatpak-io.ts", []],
  ["scripts/checks/notices.ts", ["generate"]],
  ["scripts/checks/build-changes.ts", []],
  ["scripts/branding/generate.ts", []],
];

test("orchestration help succeeds before required paths, CI environment, or external tools", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "holtburger-cli-help-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const [script, args] of helpCommands) {
    const result = invoke(script, [...args, "--help"], directory);
    assert.equal(
      result.status,
      0,
      `${script} ${args.join(" ")}: ${result.output}`,
    );
    assert.match(result.output, /Show help/);
    assert.doesNotMatch(result.output, /\n\s+at /);
  }
});

test("invalid release arguments fail before filesystem, Git or network operations", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "holtburger-cli-invalid-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const cases: readonly [string, string[], RegExp][] = [
    ["scripts/release/suite.ts", [], /Not enough non-option arguments/],
    [
      "scripts/release/suite.ts",
      ["publish"],
      /Not enough non-option arguments/,
    ],
    [
      "scripts/release/suite.ts",
      ["publish", "", "v1.0.0"],
      /must not be empty/,
    ],
    [
      "scripts/release/suite.ts",
      ["prepare-source", "--kind", "invalid"],
      /Expected one of/,
    ],
    [
      "scripts/release/suite.ts",
      ["assemble", "--product", "cli"],
      /Missing required arguments/,
    ],
    ["scripts/release/suite.ts", ["plan", "--typo"], /Unknown argument/],
    [
      "scripts/release/suite.ts",
      ["plan", "--product", "cli", "--product", "3d"],
      /must be a single string/,
    ],
    [
      "scripts/release/content.ts",
      ["stage", "missing.zip"],
      /Missing required arguments/,
    ],
    ["scripts/release/version.ts", ["bump"], /Not enough non-option arguments/],
    [
      "scripts/release/preparation.ts",
      ["open", "missing.json", "major"],
      /Expected one of/,
    ],
    ["scripts/release/publication.ts", [], /Not enough non-option arguments/],
  ];
  for (const [script, args, message] of cases) {
    const result = invoke(script, args, directory);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, message);
    assert.doesNotMatch(result.output, /\n\s+at |ENOENT/);
  }
});

test(
  "root npm delegates preserve application flags without requiring app dependencies",
  { skip: process.platform === "win32" },
  (t) => {
    const directory = mkdtempSync(join(tmpdir(), "holtburger-npm-delegate-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const npm = which.sync("npm");
    const capture = join(directory, "arguments.json");
    const child = join(directory, "npm");
    // Only the nested npm process is replaced; the real root package scripts still execute.
    writeFileSync(
      child,
      `#!${process.execPath}
const fs = require("node:fs");
fs.writeFileSync(process.env.DELEGATE_CAPTURE, JSON.stringify(process.argv.slice(2)));
`,
    );
    chmodSync(child, 0o755);
    for (const [command, target, args] of [
      [
        "publish:site:media",
        "publish:media",
        ["source directory", "--publish"],
      ],
      ["preview:site", "preview", ["--port", "4179"]],
      ["check:site:media", "check:media", ["--remote"]],
      ["check:site:links", "check:links", ["--help"]],
      ["check:site:browser", "check:browser", ["--help"]],
    ] as const) {
      const result = spawn.sync(npm, ["run", command, "--", ...args], {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          PATH: `${directory}${delimiter}${process.env.PATH}`,
          DELEGATE_CAPTURE: capture,
        },
      });
      if (result.error) throw result.error;
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual(readJson(capture), [
        "--prefix",
        "site",
        "run",
        target,
        "--",
        ...args,
      ]);
    }
  },
);
