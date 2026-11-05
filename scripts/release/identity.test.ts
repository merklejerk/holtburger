import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { compare } from "semver";
import { createSourceFixture } from "./test-fixtures.ts";
import { z } from "zod";
import { ROOT, readJson, run, writeJson } from "../io.ts";
import {
  distribution,
  git,
  prepareSource,
  sourceDistribution,
  validateSourceTag,
} from "./identity.ts";
import {
  checkVersions,
  readChannel,
  validateChannelVersion,
  validateVersion,
} from "./version.ts";

test("strict suite SemVer matches the shared frontend precedence corpus", () => {
  const cases = z
    .object({
      comparisons: z.array(
        z.object({ left: z.string(), right: z.string(), expected: z.number() }),
      ),
      invalidReleaseVersions: z.array(z.string()),
    })
    .parse(readJson(join(ROOT, "release/semver-cases.json")));
  for (const entry of cases.comparisons) {
    validateVersion(entry.left);
    validateVersion(entry.right);
    assert.equal(compare(entry.left, entry.right), entry.expected);
  }
  for (const invalid of [
    ...cases.invalidReleaseVersions,
    "v0.2.0",
    " 0.2.0",
    "0.2.0+build",
  ])
    assert.throws(() => validateVersion(invalid));
  validateChannelVersion("beta", "0.2.0", "release");
  validateChannelVersion("beta", `0.2.0-nightly-${"a".repeat(40)}`, "nightly");
  for (const invalid of ["1.0.0", "0.2.0-beta.1", "0.2.0-nightly-abcdef"])
    assert.throws(() => validateChannelVersion("beta", invalid, "release"));
});

test("audience and standalone app lock versions are required source facts", (t) => {
  const root = createSourceFixture(t);
  assert.equal(readChannel(root), "beta");
  assert.equal(checkVersions(root), "0.2.0");
  for (const value of ["alpha", "stable", { channel: "beta" }, null]) {
    writeJson(join(root, "release/channel.json"), value);
    assert.throws(() => readChannel(root));
  }
  const path = join(root, "apps/holtburger-3d/package-lock.json");
  const lock = z
    .object({
      version: z.string(),
      packages: z.object({ "": z.object({ version: z.string() }) }),
    })
    .parse(readJson(path));
  lock.packages[""].version = "0.2.1";
  writeJson(path, lock);
  assert.throws(() => checkVersions(root), /h3d version/);
});

test("real npm/Cargo nightly preparation preserves source and root tooling on retries", (t) => {
  const root = createSourceFixture(t);
  const rootLock = readFileSync(join(root, "package-lock.json"), "utf8");
  const identity = sourceDistribution(root, "nightly");
  const release = sourceDistribution(root, "release");
  assert.equal(release.tag, "v0.2.0");
  assert.equal(identity.tag, `v0.2.0-nightly-${identity.commit}`);
  prepareSource(root, identity);
  prepareSource(root, identity);
  assert.equal(git(root, "rev-parse", "HEAD"), identity.commit);
  assert.deepEqual(sourceDistribution(root, "nightly"), identity);
  assert.equal(checkVersions(root), identity.version);
  assert.equal(readFileSync(join(root, "package-lock.json"), "utf8"), rootLock);
  assert.throws(
    () => distribution("nightly", identity.version, "b".repeat(40)),
    /full source SHA/,
  );
});

test("prepared source rejects unrelated root changes, dependencies and untracked files", (t) => {
  for (const path of [
    "package-lock.json",
    "apps/holtburger-3d/package.json",
    "unexpected.txt",
  ]) {
    const root = createSourceFixture(t);
    const identity = sourceDistribution(root, "nightly");
    prepareSource(root, identity);
    if (path.endsWith(".json")) {
      const doc = z
        .record(z.string(), z.unknown())
        .parse(readJson(join(root, path)));
      doc.dependencies = { unexpected: "1.0.0" };
      writeJson(join(root, path), doc);
    } else writeFileSync(join(root, path), "unexpected");
    assert.throws(
      () => prepareSource(root, identity),
      /expected version files|more than suite versions|untracked/,
    );
  }
});

test("release source must stay clean and tags bind the original reachable commit", (t) => {
  const root = createSourceFixture(t);
  const identity = sourceDistribution(root, "release");
  prepareSource(root, identity);
  git(root, "tag", "-a", identity.tag, "-m", "Release fixture");
  git(root, "commit", "--allow-empty", "-m", "Later development");
  git(
    root,
    "update-ref",
    "refs/remotes/origin/main",
    git(root, "rev-parse", "HEAD"),
  );
  validateSourceTag(root, identity);
  assert.throws(
    () =>
      validateSourceTag(
        root,
        distribution("release", "0.2.0", git(root, "rev-parse", "HEAD")),
      ),
    /another source/,
  );
  writeFileSync(join(root, "unexpected"), "dirty");
  assert.throws(
    () => prepareSource(root, sourceDistribution(root, "release")),
    /untracked/,
  );
});

test("release tags may name a reachable merge commit", (t) => {
  const root = createSourceFixture(t);
  git(root, "checkout", "-b", "topic");
  git(root, "commit", "--allow-empty", "-m", "Topic");
  git(root, "checkout", "main");
  git(root, "commit", "--allow-empty", "-m", "Main");
  git(root, "merge", "--no-ff", "topic", "-m", "Merge");
  const identity = sourceDistribution(root, "release");
  git(root, "update-ref", "refs/remotes/origin/main", identity.commit);
  git(root, "tag", identity.tag);
  validateSourceTag(root, identity);
  prepareSource(root, identity);
  assert.equal(
    run("git", ["show", "-s", "--format=%P", identity.commit], root).split(" ")
      .length,
    2,
  );
});
