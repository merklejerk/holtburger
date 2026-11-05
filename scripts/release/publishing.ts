import { z } from "zod";
import { compare } from "semver";
import { digest, type Runner } from "../io.ts";
import { REPOSITORY, type GitHub } from "../github.ts";
import type { FrozenRelease } from "./assembly.ts";
import { commitSchema, type Distribution } from "./identity.ts";
import {
  releaseDescription,
  releaseRecords,
  latestPublishedRelease,
  alreadyPublished,
  validateTag,
} from "./publication.ts";

/** Private upload inspection retains source ownership, byte identities and the release URL. */
const draftSchema = z.object({
  id: z.number(),
  draft: z.boolean(),
  target_commitish: z.string(),
  html_url: z.string(),
  assets: z.array(
    z.object({ name: z.string(), digest: z.string().nullable() }),
  ),
});

/** Bind only an unpublished tag; legacy beta attempts may have reserved an older source. */
function publishTag(identity: Distribution, api: GitHub): void {
  const ref = `refs/tags/${identity.tag}`;
  const refs = api([
    `repos/${REPOSITORY}/git/matching-refs/tags/${identity.tag}`,
    "--paginate",
    "--jq",
    ".[].ref",
  ])
    .toString("utf8")
    .trim()
    .split("\n");
  if (refs.includes(ref)) {
    const commit = commitSchema.parse(
      api([`repos/${REPOSITORY}/commits/${identity.tag}`, "--jq", ".sha"])
        .toString("utf8")
        .trim(),
    );
    if (commit === identity.commit) return;
    if (identity.kind === "nightly")
      throw new Error("Nightly tag points to another source commit");
    api([
      `repos/${REPOSITORY}/git/refs/tags/${identity.tag}`,
      "--method",
      "PATCH",
      "--raw-field",
      `sha=${identity.commit}`,
      "--field",
      "force=true",
    ]);
  } else
    api([
      `repos/${REPOSITORY}/git/refs`,
      "--method",
      "POST",
      "--raw-field",
      `ref=${ref}`,
      "--raw-field",
      `sha=${identity.commit}`,
    ]);
}

/** Upload a complete verified distribution privately, then publish in the same operation. */
export function publishFrozenRelease(
  root: string,
  frozen: FrozenRelease,
  tag: string,
  api: GitHub,
  command: Runner,
): void {
  const identity = frozen.identity;
  validateTag(tag, identity);
  const latest =
    identity.kind === "release" ? latestPublishedRelease(api) : null;
  // Retrying an older failed release must not replace a newer GitHub latest release.
  const makeLatest =
    identity.kind === "release" &&
    (latest === null || compare(identity.version, latest.version) > 0);
  let release = z
    .array(draftSchema)
    .max(1)
    .parse(releaseRecords(tag, api))
    .at(0);
  if (release !== undefined && !release.draft) {
    // Published versions are immutable, even when a retry selects a newer main head.
    if (!alreadyPublished(identity, api))
      throw new Error("Published release disappeared during verification");
    console.log(`Already published verified distribution: ${release.html_url}`);
    return;
  }
  for (const file of frozen.files)
    if (digest(file.path) !== file.sha256)
      throw new Error(`Release file changed after verification: ${file.name}`);
  const expected = new Map(
    frozen.files.map((file) => [file.name, `sha256:${file.sha256}`]),
  );
  // Bind the tag before creating a draft: GitHub ignores target_commitish for existing tags.
  publishTag(identity, api);
  // Rebuilds can change native signatures or archive bytes even at the same source.
  // Resume matching private uploads; replace the whole draft when any payload differs.
  if (
    release !== undefined &&
    (release.target_commitish !== identity.commit ||
      release.assets.some((asset) => expected.get(asset.name) !== asset.digest))
  ) {
    api([`repos/${REPOSITORY}/releases/${release.id}`, "--method", "DELETE"]);
    release = undefined;
  }
  if (release === undefined) {
    const created = api([
      `repos/${REPOSITORY}/releases`,
      "--method",
      "POST",
      "--raw-field",
      `tag_name=${tag}`,
      "--raw-field",
      `target_commitish=${identity.commit}`,
      "--raw-field",
      `name=Holtburger ${identity.version}`,
      "--field",
      "draft=true",
      "--field",
      `prerelease=${identity.kind === "nightly"}`,
      "--raw-field",
      "make_latest=false",
      "--raw-field",
      `body=${releaseDescription(root, identity)}`,
    ]);
    release = draftSchema.parse(JSON.parse(created.toString("utf8")));
  }
  if (release.target_commitish !== identity.commit)
    throw new Error("Refusing to modify a release for another source commit");
  const uploaded = new Set(release.assets.map((asset) => asset.name));
  if (uploaded.size !== release.assets.length)
    throw new Error("Draft contains duplicate release assets");
  for (const file of frozen.files) {
    if (!uploaded.has(file.name))
      command(
        "gh",
        ["release", "upload", tag, file.path, "--repo", REPOSITORY],
        root,
      );
  }
  // A private upload transaction avoids exposing a partially uploaded distribution.
  command(
    "gh",
    [
      "release",
      "edit",
      tag,
      "--repo",
      REPOSITORY,
      "--notes",
      releaseDescription(root, identity),
      "--draft=false",
      `--prerelease=${identity.kind === "nightly"}`,
      `--latest=${makeLatest}`,
    ],
    root,
  );
  console.log(`Published verified distribution: ${release.html_url}`);
}
