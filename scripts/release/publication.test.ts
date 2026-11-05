import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test, type TestContext } from "node:test";
import { type GitHub } from "../github.ts";
import { readJson, run, sha256, type Runner } from "../io.ts";
import {
  distribution,
  git,
  sourceDistribution,
  type Distribution,
} from "./identity.ts";
import {
  alreadyPublished,
  generateFeeds,
  planRelease,
  releaseDescription,
  selectTargets,
} from "./publication.ts";
import { stageFrozenRelease } from "./staging.ts";
import { createManifestFixture, createSourceFixture } from "./test-fixtures.ts";
import { TARGETS } from "./contracts.ts";

/** Complete synthetic GitHub inventory over an independently constructed release manifest. */
function publicRelease(identity: Distribution, id: number) {
  const manifest = createManifestFixture(identity),
    data = Buffer.from(JSON.stringify(manifest));
  return {
    data,
    release: {
      draft: false,
      tag_name: identity.tag,
      target_commitish: identity.commit,
      prerelease: identity.kind === "nightly",
      assets: [
        ...manifest.assets.map((asset) => ({
          name: asset.name,
          digest: `sha256:${asset.sha256}`,
          state: "uploaded",
          size: 1,
        })),
        {
          id,
          name: "release-manifest.json",
          digest: `sha256:${sha256(data)}`,
          size: data.length,
          state: "uploaded",
        },
        { name: "SHA256SUMS", digest: null, size: 1, state: "uploaded" },
      ],
    },
  };
}

/** Owned output is outside the repository so source-cleanliness checks remain meaningful. */
function scratch(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "holtburger-publication-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("beta reconciliation selects SemVer, supports withdrawal and preserves website bytes", (t) => {
  const root = scratch(t),
    output = join(root, "site");
  mkdirSync(output);
  writeFileSync(join(output, "index.html"), "existing website");
  const older = publicRelease(
      distribution("release", "0.2.0", "a".repeat(40)),
      1,
    ),
    newer = publicRelease(distribution("release", "0.2.1", "b".repeat(40)), 2);
  const api: GitHub = (args) => {
    const id = basename(args[0]);
    assert.equal(args[1], "--header");
    return id === "1" ? older.data : newer.data;
  };
  for (const releases of [
    [newer.release, older.release],
    [older.release, newer.release],
  ]) {
    generateFeeds(releases, api, output);
    assert.deepEqual(readJson(join(output, "updates/beta.json")), {
      schemaVersion: 1,
      version: "0.2.1",
      tag: "v0.2.1",
    });
  }
  generateFeeds([older.release], api, output);
  assert.equal(
    JSON.parse(readFileSync(join(output, "updates/beta.json"), "utf8")).version,
    "0.2.0",
  );
  generateFeeds([], api, output);
  assert.equal(existsSync(join(output, "updates/beta.json")), false);
  assert.equal(
    readFileSync(join(output, "index.html"), "utf8"),
    "existing website",
  );
});

test("draft and historical/nightly tags never request manifests", (t) => {
  const root = scratch(t);
  generateFeeds(
    [
      { draft: true, tag_name: "v0.2.0" },
      ...[
        "nightly",
        "candidate-20261103-abcdef123",
        "alpha-20261103-abcdef123",
        `v0.2.0-nightly-${"a".repeat(40)}`,
      ].map((tag_name) => ({ draft: false, tag_name })),
    ],
    () => {
      assert.fail("Ignored release requested a manifest");
    },
    root,
  );
  assert.equal(existsSync(join(root, "updates/beta.json")), false);
});

test("bad public asset inventories and duplicate versions leave prior feed intact", (t) => {
  const output = scratch(t),
    identity = distribution("release", "0.2.0", "a".repeat(40)),
    fixture = publicRelease(identity, 1);
  const api: GitHub = () => fixture.data;
  generateFeeds([fixture.release], api, output);
  const prior = readFileSync(join(output, "updates/beta.json"));
  for (const mutate of [
    (release: typeof fixture.release) => {
      release.assets.pop();
    },
    (release: typeof fixture.release) => {
      release.assets[0].size = 0;
    },
    (release: typeof fixture.release) => {
      release.assets[0].digest = `sha256:${"c".repeat(64)}`;
    },
    (release: typeof fixture.release) => {
      release.tag_name = "v0.2.1";
    },
  ]) {
    const release = structuredClone(fixture.release);
    mutate(release);
    assert.throws(() => generateFeeds([release], api, output));
    assert.deepEqual(readFileSync(join(output, "updates/beta.json")), prior);
  }
  assert.throws(
    () => generateFeeds([fixture.release, fixture.release], api, output),
    /Multiple published distributions/,
  );
});

test("published build skipping requires source, audience, manifest and ready digest inventory", () => {
  const identity = distribution("release", "0.2.0", "a".repeat(40)),
    fixture = publicRelease(identity, 1);
  const api: GitHub = (args) =>
    Buffer.from(
      args.includes("--jq") ? JSON.stringify(fixture.release) : fixture.data,
    );
  assert.equal(alreadyPublished(identity, api), true);
  assert.equal(
    alreadyPublished(identity, () => Buffer.alloc(0)),
    false,
  );
  fixture.release.draft = true;
  assert.equal(alreadyPublished(identity, api), false);
  fixture.release.draft = false;
  fixture.release.target_commitish = "b".repeat(40);
  assert.throws(() => alreadyPublished(identity, api), /another source commit/);
  fixture.release.target_commitish = identity.commit;
  fixture.release.prerelease = true;
  assert.throws(() => alreadyPublished(identity, api), /distribution policy/);
  fixture.release.prerelease = false;
  fixture.release.assets[0].digest = null;
  assert.throws(() => alreadyPublished(identity, api), /no digest/);
});

test("partial selections stay diagnostic and tag events bind the full release", (t) => {
  for (const product of ["cli", "3d", "both"])
    for (const target of ["all", ...TARGETS.map((target) => target.triple)])
      assert.ok(selectTargets(product, target, "diagnostic").length > 0);
  for (const purpose of ["release", "nightly"])
    assert.throws(() => selectTargets("cli", "all", purpose), /both products/);
  const root = createSourceFixture(t),
    identity = sourceDistribution(root, "release");
  git(root, "tag", identity.tag);
  const noMutation: Runner = () => {
    assert.fail("Tagged plan mutated a Git ref");
  };
  planRelease(
    root,
    { product: "both", target: "all", purpose: "release" },
    { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: identity.tag },
    () => Buffer.alloc(0),
    noMutation,
  );
  assert.throws(
    () =>
      planRelease(
        root,
        { product: "both", target: "all", purpose: "release" },
        { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v0.2.1" },
        () => Buffer.alloc(0),
        noMutation,
      ),
    /must equal/,
  );
  assert.throws(
    () =>
      planRelease(
        root,
        { product: "both", target: "all", purpose: "release" },
        { GITHUB_REF: "refs/heads/topic" },
        () => Buffer.alloc(0),
        noMutation,
      ),
    /main branch/,
  );
  writeFileSync(join(root, "dirty"), "unexpected");
  assert.throws(
    () =>
      planRelease(
        root,
        { product: "both", target: "all", purpose: "release" },
        {},
        () => Buffer.alloc(0),
        run,
      ),
    /clean source/,
  );
});

test("draft creation uses its POST response and refuses published, conflicting or substituted files", (t) => {
  const root = scratch(t);
  mkdirSync(join(root, "release"));
  writeFileSync(
    join(root, "release/RELEASE_NOTES.md"),
    "Current release notes",
  );
  const path = join(root, "payload.zip");
  writeFileSync(path, "verified bytes");
  const identity = distribution("release", "0.2.0", "a".repeat(40));
  const frozen = {
    identity,
    files: [
      {
        path,
        name: "payload.zip",
        sha256: sha256(Buffer.from("verified bytes")),
      },
    ],
  };
  const draft = {
    draft: true,
    target_commitish: identity.commit,
    html_url: "https://example.invalid/draft",
    assets: [] as { name: string; digest: string | null }[],
  };
  const commands: string[][] = [];
  const command: Runner = (program, args) => {
    assert.equal(program, "gh");
    commands.push([...args]);
    return "";
  };
  let lists = 0;
  const api: GitHub = (args) => {
    if (args.includes("--paginate")) {
      lists++;
      return Buffer.alloc(0);
    }
    if (args.includes("--jq")) return Buffer.from(identity.commit);
    assert.ok(args.includes("POST"));
    assert.ok(args.includes("make_latest=false"));
    assert.ok(args.includes("prerelease=false"));
    assert.ok(
      args.some((value) => value.startsWith("body=Current release notes\n")),
    );
    return Buffer.from(JSON.stringify(draft));
  };
  stageFrozenRelease(root, frozen, identity.tag, api, command);
  assert.equal(lists, 1);
  assert.deepEqual(commands, [
    [
      "release",
      "upload",
      identity.tag,
      path,
      "--repo",
      "merklejerk/holtburger",
    ],
  ]);
  const existing: GitHub = () => Buffer.from(JSON.stringify(draft));
  draft.assets = [
    { name: "payload.zip", digest: `sha256:${frozen.files[0].sha256}` },
  ];
  commands.length = 0;
  stageFrozenRelease(root, frozen, identity.tag, existing, command);
  assert.equal(commands.length, 0);
  draft.assets[0].digest = `sha256:${"b".repeat(64)}`;
  assert.throws(
    () => stageFrozenRelease(root, frozen, identity.tag, existing, command),
    /conflicts/,
  );
  draft.draft = false;
  assert.throws(
    () => stageFrozenRelease(root, frozen, identity.tag, existing, command),
    /published release/,
  );
  draft.draft = true;
  draft.assets = [];
  writeFileSync(path, "substituted");
  assert.throws(
    () => stageFrozenRelease(root, frozen, identity.tag, existing, command),
    /changed after verification/,
  );
  assert.ok(
    releaseDescription(
      root,
      distribution(
        "nightly",
        `0.2.0-nightly-${identity.commit}`,
        identity.commit,
      ),
    ).includes("They do not check for updates"),
  );
});
