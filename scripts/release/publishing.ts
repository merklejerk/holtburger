import { z } from "zod";
import { compare } from "semver";
import { digest, type Runner } from "../io.ts";
import { REPOSITORY, type GitHub } from "../github.ts";
import type { FrozenRelease } from "./assembly.ts";
import {
  releaseDescription,
  releaseRecords,
  latestPublishedRelease,
  alreadyPublished,
  validateTag,
} from "./publication.ts";

/** Private upload inspection retains source ownership, byte identities and the release URL. */
const draftSchema = z.object({
  draft: z.boolean(),
  target_commitish: z.string(),
  html_url: z.string(),
  assets: z.array(
    z.object({ name: z.string(), digest: z.string().nullable() }),
  ),
});

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
  let records = releaseRecords(tag, api);
  if (records.length === 0) {
    const remote = api([`repos/${REPOSITORY}/commits/${tag}`, "--jq", ".sha"])
      .toString("utf8")
      .trim();
    if (remote !== identity.commit)
      throw new Error(
        "Remote release tag does not point to the release commit",
      );
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
    records = [JSON.parse(created.toString("utf8"))];
  }
  const [release] = z.tuple([draftSchema]).parse(records);
  if (release.target_commitish !== identity.commit)
    throw new Error("Refusing to modify a release for another source commit");
  if (!release.draft) {
    // A website dispatch may fail after publication. Retrying that job must be safe.
    if (!alreadyPublished(identity, api))
      throw new Error("Published release disappeared during verification");
    console.log(`Already published verified distribution: ${release.html_url}`);
    return;
  }
  const uploaded = new Map(
    release.assets.map((asset) => [asset.name, asset.digest]),
  );
  if (uploaded.size !== release.assets.length)
    throw new Error("Draft contains duplicate release assets");
  const expected = new Set(frozen.files.map((file) => file.name));
  for (const name of uploaded.keys())
    if (!expected.has(name))
      throw new Error("Draft contains unexpected release assets");
  for (const file of frozen.files) {
    if (digest(file.path) !== file.sha256)
      throw new Error(`Release file changed after verification: ${file.name}`);
    if (uploaded.has(file.name)) {
      if (uploaded.get(file.name) !== `sha256:${file.sha256}`)
        throw new Error(
          `Draft asset conflicts with verified release: ${file.name}`,
        );
    } else
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
