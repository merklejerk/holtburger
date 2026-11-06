import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { GitHub } from "../github.ts";
import { readJson, run, type Runner } from "../io.ts";
import {
  git,
  RELEASE_PR_PREFIX,
  sourceDistribution,
  validateReleaseChanges,
  validateReleasePullRequest,
} from "./identity.ts";
import { openReleasePullRequest, proposeRelease } from "./preparation.ts";
import { createSourceFixture } from "./test-fixtures.ts";
import {
  bumpVersion,
  appManifest,
  checkVersions,
  nextReleaseVersion,
  validateReleaseIncrement,
} from "./version.ts";

/** An AI response includes prose only; the writer must calculate the version. */
const recommendation = {
  bump: "patch",
  rationale: "Fixes only",
  notes: "## Changes\n\nCorrected movement.",
};
/** No published betas or PRs exist in this synthetic API. */
const emptyApi: GitHub = (args) =>
  Buffer.from(args.includes("--slurp") ? "[[]]" : "[]");

for (const newline of ["\n", "\r\n"]) {
  test(`version stamping preserves ${newline === "\n" ? "LF" : "CRLF"} manifest line endings`, (t) => {
    const root = createSourceFixture(t);
    const path = join(root, "Cargo.toml");
    const original = readFileSync(path, "utf8").replace(/\r?\n/g, newline);
    writeFileSync(path, original);
    const version = "0.2.1";

    bumpVersion(version, root);

    assert.equal(checkVersions(root), version);
    assert.equal(
      readFileSync(path, "utf8"),
      original.replace('version = "0.2.0"', `version = "${version}"`),
    );
  });
}

test("release increments are exact patch/minor steps with an enforced zero-major ceiling", () => {
  assert.equal(nextReleaseVersion("0.2.7", "patch"), "0.2.8");
  assert.equal(nextReleaseVersion("0.2.7", "minor"), "0.3.0");
  assert.equal(nextReleaseVersion("0.99.99", "minor"), "0.100.0");
  validateReleaseIncrement("0.2.7", "0.2.8");
  validateReleaseIncrement("0.2.7", "0.3.0");
  for (const bump of ["major", "premajor", "prerelease", "0.3.0", ""])
    assert.throws(() => nextReleaseVersion("0.2.7", bump));
  for (const next of [
    "1.0.0",
    "0.2.9",
    "0.4.0",
    "0.3.1",
    "0.2.7",
    "0.2.6",
    "0.2.8-beta.1",
    "0.2.8+build",
    "v0.2.8",
  ])
    assert.throws(() => validateReleaseIncrement("0.2.7", next));
  assert.throws(() => nextReleaseVersion("1.0.0", "patch"));
});

test("Copilot output crosses a strict data boundary and receives read permissions only", (t) => {
  const root = createSourceFixture(t);
  const command: Runner = (program, args) => {
    assert.equal(program, "copilot");
    assert.ok(args.includes("--deny-tool=write"));
    assert.ok(args.includes("--disable-builtin-mcps"));
    assert.ok(args.includes("--no-custom-instructions"));
    const directory = args[args.indexOf("--add-dir") + 1];
    assert.ok(
      readFileSync(join(directory, "context.json"), "utf8").includes(
        "Previous release notes",
      ),
    );
    return JSON.stringify(recommendation);
  };
  const proposal = proposeRelease(root, emptyApi, command);
  assert.equal(proposal.source.version, "0.2.0");
  assert.equal(proposal.baseline, null);
  assert.deepEqual(proposal.recommendation, recommendation);
  for (const response of [
    "not JSON",
    JSON.stringify({ ...recommendation, bump: "major" }),
    JSON.stringify({ ...recommendation, version: "1.0.0" }),
    JSON.stringify({ ...recommendation, notes: " " }),
  ])
    assert.throws(() => proposeRelease(root, emptyApi, () => response));
});

test("the writer rejects invalid recommendations, stale sources/baselines and concurrent release PRs before writing", (t) => {
  const root = createSourceFixture(t);
  const source = sourceDistribution(root, "release");
  const proposal = { source, baseline: null, recommendation };
  const noWrites: Runner = () =>
    assert.fail("Invalid proposal caused a write command");
  assert.throws(() =>
    openReleasePullRequest(root, proposal, "major", emptyApi, noWrites),
  );
  assert.throws(() =>
    openReleasePullRequest(
      root,
      { ...proposal, recommendation: { ...recommendation, bump: "major" } },
      "auto",
      emptyApi,
      noWrites,
    ),
  );
  assert.throws(
    () =>
      openReleasePullRequest(
        root,
        { ...proposal, source: { ...source, commit: "a".repeat(40) } },
        "auto",
        emptyApi,
        noWrites,
      ),
    /another source/,
  );
  assert.throws(
    () =>
      openReleasePullRequest(
        root,
        { ...proposal, baseline: source },
        "auto",
        emptyApi,
        noWrites,
      ),
    /Published beta changed/,
  );
  const openApi: GitHub = (args) =>
    args[0].includes("/pulls?")
      ? Buffer.from(
          JSON.stringify([
            [{ head: { ref: `${RELEASE_PR_PREFIX}${source.commit}` } }],
          ]),
        )
      : Buffer.from("[[]]");
  assert.throws(
    () => openReleasePullRequest(root, proposal, "auto", openApi, noWrites),
    /already open/,
  );
  assert.equal(git(root, "status", "--porcelain"), "");
  git(root, "commit", "--allow-empty", "-m", "Advance remote main");
  git(
    root,
    "update-ref",
    "refs/remotes/origin/main",
    git(root, "rev-parse", "HEAD"),
  );
  git(root, "checkout", source.commit);
  assert.throws(
    () => openReleasePullRequest(root, proposal, "auto", emptyApi, noWrites),
    /Main advanced/,
  );
});

test("preparation writes synchronized versions and opens a publication-authorizing PR", (t) => {
  for (const override of ["auto", "minor"]) {
    const root = createSourceFixture(t);
    const source = sourceDistribution(root, "release");
    const version = nextReleaseVersion(
      source.version,
      override === "auto" ? recommendation.bump : override,
    );
    let pushed = false;
    const command: Runner = (program, args, cwd) => {
      if (program === "git" && args[0] === "push") {
        pushed = true;
        assert.equal(args[1], "origin");
        assert.ok(args[2].startsWith(`HEAD:refs/heads/${RELEASE_PR_PREFIX}`));
        return "";
      }
      return run(program, args, cwd);
    };
    let created = false;
    const api: GitHub = (args) => {
      if (!args.includes("POST")) return emptyApi(args);
      assert.ok(pushed, "PR creation must follow a successful branch push");
      assert.ok(args.includes(`title=Release Holtburger ${version}`));
      assert.ok(
        args.some(
          (arg) =>
            arg.startsWith("body=") &&
            arg.includes("automatically builds, verifies, and publishes"),
        ),
      );
      created = true;
      return Buffer.from(
        JSON.stringify({ html_url: "https://example.invalid/release-pr" }),
      );
    };
    openReleasePullRequest(
      root,
      { source, baseline: null, recommendation },
      override,
      api,
      command,
    );
    assert.ok(created);
    assert.equal(checkVersions(root), version);
    assert.equal(
      readFileSync(join(root, "release/RELEASE_NOTES.md"), "utf8"),
      `${recommendation.notes}\n`,
    );
    assert.equal(git(root, "status", "--porcelain"), "");
  }
});

test("release PR scope admits only exact version fields and nonempty new notes", (t) => {
  const root = createSourceFixture(t);
  const base = git(root, "rev-parse", "HEAD");
  bumpVersion("0.3.0", root);
  assert.throws(
    () => validateReleaseChanges(root, base, false),
    /exactly suite versions/,
  );
  writeFileSync(join(root, "release/RELEASE_NOTES.md"), recommendation.notes);
  assert.equal(validateReleaseChanges(root, base, false), "0.3.0");
  writeFileSync(join(root, "release/RELEASE_NOTES.md"), " ");
  assert.throws(
    () => validateReleaseChanges(root, base, false),
    /cannot be empty/,
  );
  writeFileSync(join(root, "release/RELEASE_NOTES.md"), recommendation.notes);
  const path = join(root, "apps/holtburger-3d/package.json");
  const app = appManifest.parse(readJson(path));
  writeFileSync(
    path,
    JSON.stringify({ ...app, dependencies: { unexpected: "1.0.0" } }),
  );
  assert.throws(
    () => validateReleaseChanges(root, base, false),
    /more than suite versions/,
  );
});

test("reviewed squash, rebase or merge commits publish only the admitted PR payload", (t) => {
  for (const merge of [false, true]) {
    const root = createSourceFixture(t);
    const base = git(root, "rev-parse", "HEAD");
    const branch = `${RELEASE_PR_PREFIX}${base}`;
    git(root, "switch", "-c", branch);
    bumpVersion("0.2.1", root);
    writeFileSync(join(root, "release/RELEASE_NOTES.md"), recommendation.notes);
    git(root, "add", ".");
    git(root, "commit", "-m", "Prepare release");
    git(root, "switch", "main");
    git(
      root,
      "merge",
      ...(merge ? ["--no-ff"] : ["--ff-only"]),
      branch,
      "-m",
      "Merge release",
    );
    const event = {
      pull_request: {
        merged: true,
        merge_commit_sha: git(root, "rev-parse", "HEAD"),
        base: { ref: "main", sha: base },
        head: { ref: branch, repo: { full_name: "merklejerk/holtburger" } },
      },
    };
    assert.equal(validateReleasePullRequest(root, event, true), true);
    assert.equal(
      validateReleasePullRequest(
        root,
        {
          pull_request: {
            ...event.pull_request,
            head: { ...event.pull_request.head, ref: "feature/example" },
          },
        },
        true,
      ),
      false,
    );
    assert.throws(
      () =>
        validateReleasePullRequest(
          root,
          { pull_request: { ...event.pull_request, merged: false } },
          true,
        ),
      /reviewed PR merge/,
    );
    bumpVersion("1.0.0", root);
    git(root, "add", ".");
    git(root, "commit", "-m", "Attempt major version");
    assert.throws(() =>
      validateReleasePullRequest(
        root,
        {
          pull_request: {
            ...event.pull_request,
            merge_commit_sha: git(root, "rev-parse", "HEAD"),
          },
        },
        true,
      ),
    );
  }
});
