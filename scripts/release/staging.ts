import { z } from "zod";
import { digest, type Runner } from "../io.ts";
import { REPOSITORY, type GitHub } from "../github.ts";
import type { FrozenRelease } from "./assembly.ts";
import {
  releaseDescription,
  releaseRecords,
  validateTag,
} from "./publication.ts";

/** Draft inspection needs only source ownership, existing byte identities and final review URL. */
const draftSchema = z.object({
  draft: z.boolean(),
  target_commitish: z.string(),
  html_url: z.string(),
  assets: z.array(
    z.object({ name: z.string(), digest: z.string().nullable() }),
  ),
});

/** Fill only a matching draft; publication remains a separate explicit human action. */
export function stageFrozenRelease(
  root: string,
  frozen: FrozenRelease,
  tag: string,
  api: GitHub,
  command: Runner,
): void {
  const identity = frozen.identity;
  validateTag(tag, identity);
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
  if (!release.draft || release.target_commitish !== identity.commit)
    throw new Error(
      "Refusing to modify a published release or a draft for another commit",
    );
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
  console.log(`Draft staged for final user verification: ${release.html_url}`);
}
