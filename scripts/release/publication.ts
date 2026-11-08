import { appendFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { compare } from "semver";
import { z } from "zod";
import { commandLine, requiredString, runCli } from "../cli.ts";
import { sha256, writeJson, type Runner } from "../io.ts";
import { validateManifest, type ReleaseInventory } from "./artifacts.ts";
import { PRODUCTS, TARGETS, targetNamed } from "./contracts.ts";
import {
  RELEASE_BRANCH,
  sourceDistribution,
  validateReleasePullRequest,
  type Distribution,
} from "./identity.ts";
import { sourceFacts } from "./source.ts";
import { REPOSITORY, github, type GitHub } from "../github.ts";
import {
  RELEASE_HISTORY_LIMIT,
  releaseHistoryFeedSchema,
} from "../../apps/holtburger-3d/src/app/release-history-contract.ts";

/** Public asset facts used for complete inventory and byte-identity admission. */
const assetSchema = z.object({
  name: z.string(),
  state: z.string(),
  size: z.number(),
  digest: z.string().nullable().optional(),
  id: z.number().optional(),
});
/** A release is fully admitted only after draft/tag filtering. */
const releaseSchema = z
  .object({
    draft: z.boolean(),
    tag_name: z.string(),
    assets: z.array(assetSchema),
  })
  .passthrough();
/** Minimal records permit old/nightly tags to be ignored without downloading assets. */
const summarySchema = z.object({ draft: z.boolean(), tag_name: z.string() });

/** The immutable tag must describe exactly the admitted manifest identity. */
export function validateTag(tag: string, identity: Distribution): void {
  if (tag !== identity.tag)
    throw new Error(
      "Release tag must equal v followed by the distribution version",
    );
}

/** Include drafts so retries distinguish incomplete staging from publication. */
export function releaseRecords(tag: string, api: GitHub): readonly unknown[] {
  const text = api([
    `repos/${REPOSITORY}/releases`,
    "--paginate",
    "--jq",
    `.[] | select(.tag_name == ${JSON.stringify(tag)}) | @json`,
  ])
    .toString("utf8")
    .trim();
  const records: unknown[] = text
    ? text.split("\n").map((line) => JSON.parse(line))
    : [];
  if (records.length > 1)
    throw new Error("Expected at most one release for the immutable tag");
  return records;
}

/** Admit one public manifest and exact ready asset inventory, with optional legacy digests. */
function publishedInventory(
  document: unknown,
  api: GitHub,
  requireDigests: boolean,
): ReleaseInventory {
  const release = releaseSchema.parse(document);
  const [manifest] = z
    .tuple([assetSchema.extend({ id: z.number() })])
    .parse(
      release.assets.filter((asset) => asset.name === "release-manifest.json"),
    );
  const data = api([
    `repos/${REPOSITORY}/releases/assets/${manifest.id}`,
    "--header",
    "Accept: application/octet-stream",
  ]);
  const inventory = validateManifest(JSON.parse(data.toString("utf8")));
  validateTag(release.tag_name, inventory.identity);
  const expected = new Map(inventory.assets);
  expected.set("release-manifest.json", sha256(data));
  const names = [...expected.keys(), "SHA256SUMS"].sort();
  if (
    !isDeepStrictEqual(release.assets.map((asset) => asset.name).sort(), names)
  )
    throw new Error(
      "Published release asset inventory is incomplete or unexpected",
    );
  for (const asset of release.assets) {
    if (asset.state !== "uploaded" || asset.size <= 0)
      throw new Error(`Published release asset is not ready: ${asset.name}`);
    const expectedDigest = expected.get(asset.name);
    if (asset.digest !== null && asset.digest !== undefined) {
      if (!/^sha256:[0-9a-f]{64}$/.test(asset.digest))
        throw new Error(`Unsupported published asset digest: ${asset.name}`);
      if (
        expectedDigest !== undefined &&
        asset.digest !== `sha256:${expectedDigest}`
      )
        throw new Error(
          `Published asset digest differs from its manifest: ${asset.name}`,
        );
    } else if (requireDigests && expectedDigest !== undefined)
      throw new Error(`Published release asset has no digest: ${asset.name}`);
  }
  return inventory;
}

/** Skip builds only for a complete published distribution bound to this source and kind. */
export function alreadyPublished(identity: Distribution, api: GitHub): boolean {
  const records = releaseRecords(identity.tag, api);
  if (records.length === 0) return false;
  const release = releaseSchema
    .extend({ target_commitish: z.string(), prerelease: z.boolean() })
    .parse(records[0]);
  if (release.draft) return false;
  if (release.target_commitish !== identity.commit)
    throw new Error("Existing release belongs to another source commit");
  if (release.prerelease !== (identity.kind === "nightly"))
    throw new Error("Published release has conflicting distribution policy");
  const inventory = publishedInventory(release, api, true);
  if (!isDeepStrictEqual(inventory.identity, identity))
    throw new Error(
      "Published manifest differs from the requested distribution",
    );
  const taggedCommit = api([
    `repos/${REPOSITORY}/commits/${identity.tag}`,
    "--jq",
    ".sha",
  ])
    .toString("utf8")
    .trim();
  if (taggedCommit !== identity.commit)
    throw new Error("Published release tag points to another source commit");
  return true;
}

/** Admit published beta inventories once, retaining their verified asset names for consumers. */
function publishedInventories(
  releases: readonly unknown[],
  api: GitHub,
): ReleaseInventory[] {
  const versions = new Set<string>();
  const inventories: ReleaseInventory[] = [];
  for (const document of releases) {
    const summary = summarySchema.parse(document);
    if (
      summary.draft ||
      !/^v0\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(summary.tag_name)
    )
      continue;
    const inventory = publishedInventory(document, api, false);
    if (versions.has(inventory.identity.version))
      throw new Error(
        `Multiple published distributions claim suite version ${inventory.identity.version}`,
      );
    versions.add(inventory.identity.version);
    inventories.push(inventory);
  }
  return inventories.sort((a, b) =>
    compare(b.identity.version, a.identity.version),
  );
}

/** Read all pages before selecting a published beta; API ordering is not version ordering. */
export function latestPublishedRelease(api: GitHub): Distribution | null {
  const pages = z
    .array(z.array(z.unknown()))
    .parse(
      JSON.parse(
        api([`repos/${REPOSITORY}/releases`, "--paginate", "--slurp"]).toString(
          "utf8",
        ),
      ),
    );
  return publishedInventories(pages.flat(), api)[0]?.identity ?? null;
}

/** Publish bounded verified history alongside the latest release's download and compatibility documents. */
export function generateFeeds(
  releases: readonly unknown[],
  api: GitHub,
  output: string,
): void {
  // Validate every advertised release before touching any existing output.
  const inventories = publishedInventories(releases, api);
  const [newest] = inventories;
  // Resolve every retained changelog before modifying any existing published output.
  const history =
    newest === undefined
      ? null
      : releaseHistoryFeedSchema.parse({
          schemaVersion: 2,
          releases: inventories
            .slice(0, RELEASE_HISTORY_LIMIT)
            .map(({ identity }) => ({
              version: identity.version,
              tag: identity.tag,
              notes: api([
                `repos/${REPOSITORY}/contents/release/RELEASE_NOTES.md?ref=${identity.commit}`,
                "--header",
                "Accept: application/vnd.github.raw+json",
              ]).toString("utf8"),
            })),
          omittedVersion:
            inventories[RELEASE_HISTORY_LIMIT]?.identity.version ?? null,
        });
  const updates = join(output, "updates");
  mkdirSync(join(updates, "v2"), { recursive: true });
  if (history === null) rmSync(join(updates, "v2/beta.json"), { force: true });
  else writeJson(join(updates, "v2/beta.json"), history);
  if (newest === undefined) rmSync(join(updates, "beta.json"), { force: true });
  else
    writeJson(join(updates, "beta.json"), {
      schemaVersion: 1,
      version: newest.identity.version,
      tag: newest.identity.tag,
    });
  writeJson(
    join(updates, "downloads.json"),
    newest === undefined
      ? null
      : {
          version: newest.identity.version,
          url: `https://github.com/${REPOSITORY}/releases/tag/${newest.identity.tag}`,
          assets: Object.fromEntries(
            [...newest.assets.keys()].map((name) => [
              name,
              `https://github.com/${REPOSITORY}/releases/download/${newest.identity.tag}/${name}`,
            ]),
          ),
        },
  );
  for (const retired of ["alpha.json", "nightly.json"])
    rmSync(join(updates, retired), { force: true });
}

/** Select matrices independently of publication, preserving partial diagnostic builds. */
export function selectTargets(
  product: string,
  target: string,
  purpose: string,
): readonly (typeof TARGETS)[number][] {
  z.enum(["both", ...PRODUCTS]).parse(product);
  z.enum(["release", "nightly", "diagnostic"]).parse(purpose);
  if (purpose !== "diagnostic" && (product !== "both" || target !== "all"))
    throw new Error(
      "Releases require both products and every supported native target",
    );
  return target === "all" ? TARGETS : [targetNamed(target)];
}

/** Resolve immutable source, permitted tags and native matrices for a workflow run. */
export function planRelease(
  root: string,
  selection: { product: string; target: string; purpose: string },
  env: Readonly<NodeJS.ProcessEnv>,
  api: GitHub,
  command: Runner,
): void {
  const selected = selectTargets(
    selection.product,
    selection.target,
    selection.purpose,
  );
  const source = sourceFacts(root, env);
  if (source.modified)
    throw new Error("Release planning requires a clean source checkout");
  const kind = selection.purpose === "nightly" ? "nightly" : "release";
  const identity = sourceDistribution(root, kind);
  let tag = "";
  if (selection.purpose === "release") {
    if (env.GITHUB_EVENT_NAME === "workflow_dispatch") {
      if (
        command("git", ["rev-parse", `origin/${RELEASE_BRANCH}`], root) !==
        identity.commit
      )
        throw new Error(
          "Manual beta publication requires the current main head",
        );
    } else if (env.GITHUB_EVENT_NAME !== "pull_request")
      throw new Error(
        "Beta publication requires a merged release PR or manual dispatch",
      );
    else if (
      !validateReleasePullRequest(
        root,
        JSON.parse(
          readFileSync(z.string().parse(env.GITHUB_EVENT_PATH), "utf8"),
        ),
        true,
      )
    )
      throw new Error("Beta publication requires a release preparation branch");
  }
  if (selection.purpose !== "diagnostic") {
    if (env.GITHUB_REF !== `refs/heads/${RELEASE_BRANCH}`)
      throw new Error(`Run release builds on the ${RELEASE_BRANCH} branch`);
    command(
      "git",
      [
        "merge-base",
        "--is-ancestor",
        identity.commit,
        `origin/${RELEASE_BRANCH}`,
      ],
      root,
    );
    tag = identity.tag;
  }
  const published = tag !== "" && alreadyPublished(identity, api);
  const result = {
    version: identity.version,
    commit: identity.commit,
    kind,
    product: selection.product,
    tag,
    skip: String(published),
    linux_enabled: String(selected.some((entry) => entry.platform === "linux")),
    desktop_enabled: String(
      selected.some((entry) => entry.platform !== "linux"),
    ),
    linux_matrix: {
      include: selected.filter((entry) => entry.platform === "linux"),
    },
    desktop_matrix: {
      include: selected.filter((entry) => entry.platform !== "linux"),
    },
  };
  if (env.GITHUB_OUTPUT !== undefined)
    for (const [key, value] of Object.entries(result))
      appendFileSync(
        env.GITHUB_OUTPUT,
        `${key}=${typeof value === "string" ? value : JSON.stringify(value)}\n`,
      );
  console.log(JSON.stringify(result));
}

/** User-facing release instructions always link to the immutable original source. */
export function releaseDescription(
  root: string,
  identity: Distribution,
): string {
  const repository = `https://github.com/${REPOSITORY}`,
    source = `${repository}/blob/${identity.commit}/release/quickstarts`;
  const notes =
    identity.kind === "nightly"
      ? `Development build from [${identity.commit.slice(0, 8)}](${repository}/commit/${identity.commit}). It may contain unfinished changes.\n\nNightlies replace an installed beta and share its saved settings. They do not check for updates.`
      : readFileSync(join(root, "release/RELEASE_NOTES.md"), "utf8").trim();
  return `${notes}\n\n## Install\n\nChoose a download from Assets below. Installation instructions:\n\n| Platform | 3D client | Terminal client (CLI) |\n| --- | --- | --- |\n| Windows x86-64 | [Setup or ZIP](${source}/3d/win32.md) | [ZIP](${source}/cli/win32.md) |\n| macOS Apple Silicon | [DMG or ZIP](${source}/3d/darwin.md) | [ZIP](${source}/cli/darwin.md) |\n| Linux x86-64 | [Flatpak or tar.gz](${source}/3d/linux.md) | [Flatpak or tar.gz](${source}/cli/linux.md) |\n\nEach bundle includes its instructions as \`QUICKSTART.md\`. The 3D client requires your own Asheron's Call game files; CLI game data is included.\n`;
}

if (import.meta.main) {
  await runCli(
    commandLine("npm run feeds:generate --").command(
      "$0 <output>",
      "Generate website download data and verified update feeds",
      (builder) =>
        builder.positional("output", {
          ...requiredString,
          describe: "Website static output directory",
        }),
      (args) => {
        const pages = z
          .array(z.array(z.unknown()))
          .parse(
            JSON.parse(
              github([
                `repos/${REPOSITORY}/releases`,
                "--paginate",
                "--slurp",
              ]).toString("utf8"),
            ),
          );
        generateFeeds(pages.flat(), github, args.output);
      },
    ),
  );
}
