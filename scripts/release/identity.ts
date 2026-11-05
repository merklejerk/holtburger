import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import { readJson, run } from "../io.ts";
import {
  appLock,
  appManifest,
  bumpVersion,
  cargoLock,
  cargoWorkspace,
  checkVersions,
  distributionKind,
  validateChannelVersion,
} from "./version.ts";

/** The branch that immutable release tags must be reachable from. */
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
/** Validated distribution identity; consumers use its tag rather than deriving it. */
export interface Distribution {
  /** Ordinary release or source-stamped nightly. */
  readonly kind: z.infer<typeof distributionKind>;
  /** Effective suite version after disposable preparation. */
  readonly version: string;
  /** Immutable original source, never the prepared working tree. */
  readonly commit: string;
  /** Immutable GitHub release tag. */
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
  if (selected === "nightly" && !version.endsWith(`-nightly-${commit}`))
    throw new Error("Nightly version must end with its full source SHA");
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
    kind === "nightly" ? `${base}-nightly-${commit}` : base,
    commit,
  );
}

/** Tags may be annotated or lightweight but must bind the expected reachable commit. */
export function validateSourceTag(root: string, identity: Distribution): void {
  if (
    git(root, "rev-parse", `refs/tags/${identity.tag}^{commit}`) !==
    identity.commit
  )
    throw new Error("Release tag points to another source commit");
  git(
    root,
    "merge-base",
    "--is-ancestor",
    identity.commit,
    `origin/${RELEASE_BRANCH}`,
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
  const workspace = cargoWorkspace.parse(
    parseToml(git(root, "show", "HEAD:Cargo.toml")),
  );
  const names = new Set(
    workspace.workspace.members.map(
      (member) =>
        z
          .object({ package: z.object({ name: z.string() }) })
          .parse(parseToml(git(root, "show", `HEAD:${member}/Cargo.toml`)))
          .package.name,
    ),
  );
  for (const path of VERSION_FILES) {
    const originalText = git(root, "show", `HEAD:${path}`);
    const actualText = readFileSync(join(root, path), "utf8");
    let original: unknown;
    let actual: unknown;
    if (path === "Cargo.toml") {
      const doc = cargoWorkspace.parse(parseToml(originalText));
      doc.workspace.package.version = identity.version;
      original = doc;
      actual = cargoWorkspace.parse(parseToml(actualText));
    } else if (path === "Cargo.lock") {
      const doc = cargoLock.parse(parseToml(originalText));
      for (const pkg of doc.package)
        if (names.has(pkg.name)) pkg.version = identity.version;
      original = doc;
      actual = cargoLock.parse(parseToml(actualText));
    } else if (path.endsWith("package-lock.json")) {
      const doc = appLock.parse(JSON.parse(originalText));
      doc.version = identity.version;
      doc.packages[""].version = identity.version;
      original = doc;
      actual = appLock.parse(readJson(join(root, path)));
    } else {
      const doc = appManifest.parse(JSON.parse(originalText));
      doc.version = identity.version;
      original = doc;
      actual = appManifest.parse(JSON.parse(actualText));
    }
    if (!isDeepStrictEqual(original, actual))
      throw new Error(
        `Build preparation changes more than suite versions: ${path}`,
      );
  }
  if (checkVersions(root) !== identity.version)
    throw new Error("Prepared package version differs from the distribution");
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
