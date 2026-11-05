import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { SemVer, inc } from "semver";
import { z } from "zod";
import { ROOT, readJson, run } from "../io.ts";

/** Distribution policy distinguishes ordinary releases from source-stamped nightlies. */
export const distributionKind = z.enum(["release", "nightly"]);
/** Source-controlled audience; no audience is inferred from a version suffix. */
export const releaseChannel = z.literal("beta");
/** Automation and manual overrides can choose only the next patch or minor. */
export const releaseBump = z.enum(["patch", "minor"]);
/** Nightly versions carry a fixed short prefix; provenance retains the full commit. */
export const NIGHTLY_HASH_LENGTH = 8;

/** Compute the next zero-major release; callers never accept an AI-supplied version. */
export function nextReleaseVersion(current: string, bump: string): string {
  validateChannelVersion("beta", current, "release");
  const next = z.string().parse(inc(current, releaseBump.parse(bump)));
  validateChannelVersion("beta", next, "release");
  return next;
}

/** Enforce exact increments even after a proposed release is edited during review. */
export function validateReleaseIncrement(current: string, next: string): void {
  validateChannelVersion("beta", next, "release");
  if (
    !releaseBump.options.some(
      (bump) => nextReleaseVersion(current, bump) === next,
    )
  )
    throw new Error("Release version must be exactly the next patch or minor");
}
/** Suite workspace metadata retains unrelated TOML fields for exact-delta verification. */
export const cargoWorkspace = z
  .object({
    workspace: z
      .object({
        package: z.object({ version: z.string() }).passthrough(),
        members: z.array(z.string()),
      })
      .passthrough(),
  })
  .passthrough();
/** Cargo lock entries retain dependencies and checksums during identity validation. */
export const cargoLock = z
  .object({
    package: z.array(
      z
        .object({
          name: z.string(),
          version: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
/** App metadata is retained losslessly while checking and stamping its version. */
export const appManifest = z.object({ version: z.string() }).passthrough();
/** The app's independent npm lock is part of the shipped suite's version contract. */
export const appLock = z
  .object({
    version: z.string(),
    packages: z.object({ "": appManifest }).passthrough(),
  })
  .passthrough();

/** Strict SemVer without unordered build metadata, matching the shared case corpus. */
export function validateVersion(version: string): void {
  const parsed = new SemVer(version);
  if (parsed.build.length !== 0)
    throw new Error("Suite release versions cannot contain build metadata");
  if (parsed.version !== version)
    throw new Error(`Invalid suite SemVer: ${version}`);
}

/** Beta accepts unsuffixed zero-major releases or a short source-hash nightly suffix. */
export function validateChannelVersion(
  channel: string,
  version: string,
  kind: string,
): void {
  validateVersion(version);
  releaseChannel.parse(channel);
  const selected = distributionKind.parse(kind);
  const base = "0\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)";
  const pattern =
    selected === "release"
      ? base
      : `${base}-nightly-[0-9a-f]{${NIGHTLY_HASH_LENGTH}}`;
  if (!new RegExp(`^${pattern}$`).test(version))
    throw new Error(
      "Beta distributions require an unsuffixed 0.x.y or source-stamped nightly version",
    );
}

/** Read the explicit source audience. */
export function readChannel(root: string): "beta" {
  return releaseChannel.parse(readJson(join(root, "release/channel.json")));
}

/** Verify Cargo inheritance, locked members and the standalone app's manifest/lock. */
export function checkVersions(root: string): string {
  const workspace = cargoWorkspace.parse(
    parseToml(readFileSync(join(root, "Cargo.toml"), "utf8")),
  ).workspace;
  const version = workspace.package.version;
  validateVersion(version);
  const locked = cargoLock.parse(
    parseToml(readFileSync(join(root, "Cargo.lock"), "utf8")),
  ).package;
  for (const member of workspace.members) {
    const { package: pkg } = z
      .object({
        package: z.object({
          name: z.string(),
          version: z.strictObject({ workspace: z.literal(true) }),
        }),
      })
      .parse(parseToml(readFileSync(join(root, member, "Cargo.toml"), "utf8")));
    const versions = locked
      .filter((entry) => entry.name === pkg.name)
      .map((entry) => entry.version);
    if (versions.length !== 1 || versions[0] !== version)
      throw new Error(
        `Cargo.lock version mismatch for ${pkg.name}: ${versions}, expected ${version}`,
      );
  }
  const app = join(root, "apps/holtburger-3d");
  const manifest = appManifest.parse(readJson(join(app, "package.json")));
  const lock = appLock.parse(readJson(join(app, "package-lock.json")));
  for (const actual of [
    manifest.version,
    lock.version,
    lock.packages[""].version,
  ])
    if (actual !== version)
      throw new Error(`h3d version is ${actual}, expected ${version}`);
  return version;
}

/** Stamp only suite version owners, delegating lock maintenance to npm and Cargo. */
export function bumpVersion(version: string, root: string): void {
  validateVersion(version);
  const path = join(root, "Cargo.toml");
  let matches = 0;
  const updated = readFileSync(path, "utf8").replace(
    /(\[workspace\.package\]\n(?:(?!\[)[\s\S])*?^version\s*=\s*)"[^"]+"/gm,
    (_match, prefix: string) => {
      matches++;
      return `${prefix}"${version}"`;
    },
  );
  if (matches !== 1)
    throw new Error("Expected exactly one workspace package version");
  writeFileSync(path, updated);
  run(
    "npm",
    [
      "--prefix",
      join(root, "apps/holtburger-3d"),
      "version",
      version,
      "--no-git-tag-version",
      "--ignore-scripts",
      "--allow-same-version",
    ],
    root,
  );
  run("cargo", ["update", "--workspace", "--offline"], root);
  checkVersions(root);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const [command, version] = args;
  if (command === "check" && args.length === 1) {
    const current = checkVersions(ROOT);
    validateChannelVersion(readChannel(ROOT), current, "release");
    console.log(current);
  } else if (command === "bump" && version !== undefined && args.length === 2) {
    validateReleaseIncrement(checkVersions(ROOT), version);
    bumpVersion(version, ROOT);
    console.log(checkVersions(ROOT));
  } else throw new Error("Usage: version.ts check|bump VERSION");
}
