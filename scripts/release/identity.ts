import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import { readJson, run } from "../io.ts";
import { REPOSITORY } from "../github.ts";
import {
  appLock,
  appManifest,
  bumpVersion,
  cargoLock,
  cargoWorkspace,
  checkVersions,
  distributionKind,
  NIGHTLY_HASH_LENGTH,
  validateChannelVersion,
  validateReleaseIncrement,
} from "./version.ts";

/** The branch from which publication selects its source commit. */
export const RELEASE_BRANCH = "main";
/** Exactly these standalone suite owners may change during nightly preparation. */
export const VERSION_FILES = [
  "Cargo.toml",
  "Cargo.lock",
  "apps/holtburger-3d/package.json",
  "apps/holtburger-3d/package-lock.json",
] as const;
/** Source SHA is full-length to distinguish immutable release identities. */
export const commitSchema = z.string().regex(/^[0-9a-f]{40}$/);
/** Reviewable release payload alongside the four suite version owners. */
export const RELEASE_NOTES = "release/RELEASE_NOTES.md";
/** Dedicated branches identify release PRs independently of editable labels/titles. */
export const RELEASE_PR_PREFIX = "release/prepare-";
/** Validated distribution identity; consumers use its tag rather than deriving it. */
export interface Distribution {
  /** Ordinary release or source-stamped nightly. */
  readonly kind: z.infer<typeof distributionKind>;
  /** Effective suite version after disposable preparation. */
  readonly version: string;
  /** Immutable original source, never the prepared working tree. */
  readonly commit: string;
  /** GitHub version tag, immutable once the release is published. */
  readonly tag: string;
}

/** Capture Git output, preserving command failures. */
export function git(root: string, ...args: string[]): string {
  return run("git", args, root);
}

/** Validate identity once and carry the derived tag across release stages. */
export function distribution(
  kind: string,
  version: string,
  commit: string,
): Distribution {
  const selected = distributionKind.parse(kind);
  commitSchema.parse(commit);
  validateChannelVersion("beta", version, selected);
  if (
    selected === "nightly" &&
    !version.endsWith(`-nightly-${commit.slice(0, NIGHTLY_HASH_LENGTH)}`)
  )
    throw new Error("Nightly version must end with its short source SHA");
  return { kind: selected, version, commit, tag: `v${version}` };
}

/** Derive identity from original Git objects, including after local version stamping. */
export function sourceDistribution(root: string, kind: string): Distribution {
  const commit = git(root, "rev-parse", "HEAD");
  const base = cargoWorkspace.parse(
    parseToml(git(root, "show", `${commit}:Cargo.toml`)),
  ).workspace.package.version;
  validateChannelVersion("beta", base, "release");
  return distribution(
    kind,
    kind === "nightly"
      ? `${base}-nightly-${commit.slice(0, NIGHTLY_HASH_LENGTH)}`
      : base,
    commit,
  );
}

/** Only the exact semantic suite-version delta is admissible in a prepared checkout. */
export function validatePreparedSource(
  root: string,
  identity: Distribution,
): void {
  if (!isDeepStrictEqual(sourceDistribution(root, identity.kind), identity))
    throw new Error(
      "Distribution differs from the checked-out source identity",
    );
  if (git(root, "diff", "--cached", "--name-only"))
    throw new Error("Build preparation cannot contain staged changes");
  if (git(root, "ls-files", "--others", "--exclude-standard"))
    throw new Error("Build preparation contains untracked source files");
  if (git(root, "diff", "HEAD", "--summary"))
    throw new Error("Build preparation cannot change file modes or paths");
  const changed = git(root, "diff", "HEAD", "--name-only")
    .split("\n")
    .filter(Boolean)
    .sort();
  const expected = identity.kind === "nightly" ? [...VERSION_FILES].sort() : [];
  if (!isDeepStrictEqual(changed, expected))
    throw new Error(
      "Build preparation differs from the expected version files",
    );
  validateVersionDelta(root, "HEAD", identity.version);
}

/** Verify version-only edits against a Git source without admitting dependency churn. */
export function validateVersionDelta(
  root: string,
  originalRef: string,
  version: string,
): void {
  const workspace = cargoWorkspace.parse(
    parseToml(git(root, "show", `${originalRef}:Cargo.toml`)),
  );
  const names = new Set(
    workspace.workspace.members.map(
      (member) =>
        z
          .object({ package: z.object({ name: z.string() }) })
          .parse(
            parseToml(git(root, "show", `${originalRef}:${member}/Cargo.toml`)),
          ).package.name,
    ),
  );
  for (const path of VERSION_FILES) {
    const originalText = git(root, "show", `${originalRef}:${path}`);
    const actualText = readFileSync(join(root, path), "utf8");
    let original: unknown;
    let actual: unknown;
    if (path === "Cargo.toml") {
      const doc = cargoWorkspace.parse(parseToml(originalText));
      doc.workspace.package.version = version;
      original = doc;
      actual = cargoWorkspace.parse(parseToml(actualText));
    } else if (path === "Cargo.lock") {
      const doc = cargoLock.parse(parseToml(originalText));
      for (const pkg of doc.package)
        if (names.has(pkg.name)) pkg.version = version;
      original = doc;
      actual = cargoLock.parse(parseToml(actualText));
    } else if (path.endsWith("package-lock.json")) {
      const doc = appLock.parse(JSON.parse(originalText));
      doc.version = version;
      doc.packages[""].version = version;
      original = doc;
      actual = appLock.parse(readJson(join(root, path)));
    } else {
      const doc = appManifest.parse(JSON.parse(originalText));
      doc.version = version;
      original = doc;
      actual = appManifest.parse(JSON.parse(actualText));
    }
    if (!isDeepStrictEqual(original, actual))
      throw new Error(
        `Build preparation changes more than suite versions: ${path}`,
      );
  }
  if (checkVersions(root) !== version)
    throw new Error("Prepared package version differs from the distribution");
}

/** Reviewed release PRs change only notes and exact patch/minor suite version fields. */
export function validateReleaseChanges(
  root: string,
  base: string,
  committed: boolean,
): string {
  commitSchema.parse(base);
  const previous = cargoWorkspace.parse(
    parseToml(git(root, "show", `${base}:Cargo.toml`)),
  ).workspace.package.version;
  const version = checkVersions(root);
  validateReleaseIncrement(previous, version);
  const changed = git(
    root,
    "diff",
    "--name-only",
    base,
    ...(committed ? ["HEAD"] : []),
  )
    .split("\n")
    .filter(Boolean)
    .sort();
  if (!isDeepStrictEqual(changed, [...VERSION_FILES, RELEASE_NOTES].sort()))
    throw new Error(
      "Release PR must change exactly suite versions and release notes",
    );
  if (git(root, "diff", "--summary", base, ...(committed ? ["HEAD"] : [])))
    throw new Error("Release PR cannot change file modes or paths");
  if (!readFileSync(join(root, RELEASE_NOTES), "utf8").trim())
    throw new Error("Release notes cannot be empty");
  validateVersionDelta(root, base, version);
  return version;
}

/** Validate both PR checks and publication against the reviewed GitHub event identity. */
export function validateReleasePullRequest(
  root: string,
  document: unknown,
  merged: boolean,
): boolean {
  const { pull_request: pr } = z
    .object({
      pull_request: z.object({
        merged: z.boolean(),
        merge_commit_sha: commitSchema.nullable(),
        base: z.object({ ref: z.literal(RELEASE_BRANCH), sha: commitSchema }),
        head: z.object({
          ref: z.string(),
          repo: z.object({ full_name: z.string() }),
        }),
      }),
    })
    .parse(document);
  if (
    !pr.head.ref.startsWith(RELEASE_PR_PREFIX) ||
    pr.head.repo.full_name !== REPOSITORY
  )
    return false;
  const head = git(root, "rev-parse", "HEAD");
  if (merged && (!pr.merged || head !== pr.merge_commit_sha))
    throw new Error("Release checkout must equal the reviewed PR merge commit");
  validateReleaseChanges(
    root,
    merged ? git(root, "rev-parse", "HEAD^") : pr.base.sha,
    true,
  );
  return true;
}

/** Prepare only clean source, or verify an already prepared retry without rewriting it. */
export function prepareSource(root: string, identity: Distribution): void {
  if (!isDeepStrictEqual(sourceDistribution(root, identity.kind), identity))
    throw new Error(
      "Distribution differs from the checked-out source identity",
    );
  if (git(root, "status", "--porcelain", "--ignore-submodules=none")) {
    validatePreparedSource(root, identity);
    return;
  }
  checkVersions(root);
  if (identity.kind === "nightly") bumpVersion(identity.version, root);
  validatePreparedSource(root, identity);
}
