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
  RELEASE_PR_PREFIX,
  type Distribution,
} from "./identity.ts";
import {
  alreadyPublished,
  generateFeeds,
  planRelease,
  releaseDescription,
  selectTargets,
} from "./publication.ts";
import { publishFrozenRelease } from "./publishing.ts";
import { createManifestFixture, createSourceFixture } from "./test-fixtures.ts";
import { NIGHTLY_HASH_LENGTH, bumpVersion } from "./version.ts";
import { TARGETS } from "./contracts.ts";

/** Complete synthetic GitHub inventory over an independently constructed release manifest. */
function publicRelease(identity: Distribution, id: number) {
  const manifest = createManifestFixture(identity),
    data = Buffer.from(JSON.stringify(manifest));
  return {
    manifest,
    data,
    release: {
      id,
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
    assert.deepEqual(readJson(join(output, "updates/downloads.json")), {
      version: "0.2.1",
      url: "https://github.com/merklejerk/holtburger/releases/tag/v0.2.1",
      assets: Object.fromEntries(
        newer.manifest.assets.map((asset: { name: string }) => [
          asset.name,
          `https://github.com/merklejerk/holtburger/releases/download/v0.2.1/${asset.name}`,
        ]),
      ),
    });
  }
  generateFeeds([older.release], api, output);
  assert.equal(
    JSON.parse(readFileSync(join(output, "updates/beta.json"), "utf8")).version,
    "0.2.0",
  );
  generateFeeds([], api, output);
  assert.equal(existsSync(join(output, "updates/beta.json")), false);
  assert.equal(readJson(join(output, "updates/downloads.json")), null);
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
        `v0.2.0-nightly-${"a".repeat(NIGHTLY_HASH_LENGTH)}`,
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
  let taggedCommit = identity.commit;
  const api: GitHub = (args) =>
    args[0].includes("/commits/")
      ? Buffer.from(taggedCommit)
      : Buffer.from(
          args.includes("--jq")
            ? JSON.stringify(fixture.release)
            : fixture.data,
        );
  assert.equal(alreadyPublished(identity, api), true);
  taggedCommit = "b".repeat(40);
  assert.throws(() => alreadyPublished(identity, api), /Published release tag/);
  taggedCommit = identity.commit;
  assert.equal(
    alreadyPublished(identity, () => Buffer.alloc(0)),
    false,
  );
  fixture.release.draft = true;
  assert.equal(alreadyPublished(identity, api), false);
  fixture.release.target_commitish = "b".repeat(40);
  assert.equal(alreadyPublished(identity, api), false);
  fixture.release.draft = false;
  assert.throws(() => alreadyPublished(identity, api), /another source commit/);
  fixture.release.target_commitish = identity.commit;
  fixture.release.prerelease = true;
  assert.throws(() => alreadyPublished(identity, api), /distribution policy/);
  fixture.release.prerelease = false;
  fixture.release.assets[0].digest = null;
  assert.throws(() => alreadyPublished(identity, api), /no digest/);
});

test("beta planning accepts reviewed merges and manual main-head retries without reserving tags", (t) => {
  for (const product of ["cli", "3d", "both"])
    for (const target of ["all", ...TARGETS.map((target) => target.triple)])
      assert.ok(selectTargets(product, target, "diagnostic").length > 0);
  for (const purpose of ["release", "nightly"])
    assert.throws(() => selectTargets("cli", "all", purpose), /both products/);
  const root = createSourceFixture(t);
  const base = git(root, "rev-parse", "HEAD");
  bumpVersion("0.2.1", root);
  writeFileSync(join(root, "release/RELEASE_NOTES.md"), "Reviewed notes");
  git(root, "add", ".");
  git(root, "commit", "-m", "Prepare beta");
  const identity = sourceDistribution(root, "release");
  git(root, "update-ref", "refs/remotes/origin/main", identity.commit);
  const eventPath = join(scratch(t), "event.json");
  writeFileSync(
    eventPath,
    JSON.stringify({
      pull_request: {
        merged: true,
        merge_commit_sha: identity.commit,
        base: { ref: "main", sha: base },
        head: {
          ref: `${RELEASE_PR_PREFIX}${base}`,
          repo: { full_name: "merklejerk/holtburger" },
        },
      },
    }),
  );
  const selection = { product: "both", target: "all", purpose: "release" };
  const env = {
    GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_EVENT_PATH: eventPath,
  };
  planRelease(root, selection, env, () => Buffer.alloc(0), run);
  assert.equal(git(root, "tag", "--list"), "");
  // Legacy attempts may have reserved the version against an older commit.
  git(root, "tag", identity.tag, base);
  const output = join(scratch(t), "output");
  planRelease(
    root,
    selection,
    { ...env, GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_OUTPUT: output },
    () => Buffer.alloc(0),
    run,
  );
  assert.ok(
    readFileSync(output, "utf8").includes(`commit=${identity.commit}\n`),
  );
  assert.equal(git(root, "rev-parse", identity.tag), base);
  assert.throws(
    () =>
      planRelease(
        root,
        selection,
        { ...env, GITHUB_EVENT_NAME: "push" },
        () => Buffer.alloc(0),
        run,
      ),
    /merged release PR or manual dispatch/,
  );
  git(root, "update-ref", "refs/remotes/origin/main", base);
  assert.throws(
    () =>
      planRelease(
        root,
        selection,
        { ...env, GITHUB_EVENT_NAME: "workflow_dispatch" },
        () => Buffer.alloc(0),
        run,
      ),
    /current main head/,
  );
  git(root, "update-ref", "refs/remotes/origin/main", identity.commit);
  assert.throws(
    () =>
      planRelease(
        root,
        selection,
        { ...env, GITHUB_REF: "refs/heads/topic" },
        () => Buffer.alloc(0),
        run,
      ),
    /main branch/,
  );
  writeFileSync(join(root, "dirty"), "unexpected");
  assert.throws(
    () => planRelease(root, selection, env, () => Buffer.alloc(0), run),
    /clean source/,
  );
});

test("publication uploads before making the complete distribution public and rejects conflicts", (t) => {
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
    id: 10,
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
    if (args[0].includes("/commits/")) return Buffer.from(identity.commit);
    if (args.includes("--slurp")) return Buffer.from("[[]]");
    if (args[0].includes("/git/matching-refs/")) return Buffer.alloc(0);
    if (args[0].endsWith("/git/refs")) {
      assert.ok(args.includes(`ref=refs/tags/${identity.tag}`));
      assert.ok(args.includes(`sha=${identity.commit}`));
      assert.equal(commands.length, 0);
      return Buffer.from("{}");
    }
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
  publishFrozenRelease(root, frozen, identity.tag, api, command);
  assert.equal(lists, 1);
  assert.deepEqual(commands[0], [
    "release",
    "upload",
    identity.tag,
    path,
    "--repo",
    "merklejerk/holtburger",
  ]);
  const publication = commands[1];
  assert.deepEqual(publication.slice(0, 5), [
    "release",
    "edit",
    identity.tag,
    "--repo",
    "merklejerk/holtburger",
  ]);
  assert.ok(publication.includes("--draft=false"));
  assert.ok(publication.includes("--prerelease=false"));
  assert.ok(publication.includes("--latest=true"));
  assert.ok(publication.includes(releaseDescription(root, identity)));
  const existing: GitHub = (args) => {
    if (args[0].includes("/git/matching-refs/"))
      return Buffer.from(`refs/tags/${identity.tag}`);
    if (args[0].includes("/commits/")) return Buffer.from(identity.commit);
    return Buffer.from(
      args.includes("--slurp") ? "[[]]" : JSON.stringify(draft),
    );
  };
  draft.assets = [
    { name: "payload.zip", digest: `sha256:${frozen.files[0].sha256}` },
  ];
  commands.length = 0;
  publishFrozenRelease(root, frozen, identity.tag, existing, command);
  assert.equal(commands.length, 1);
  draft.draft = false;
  assert.throws(() =>
    publishFrozenRelease(root, frozen, identity.tag, existing, command),
  );
  draft.draft = true;
  draft.assets = [];
  writeFileSync(path, "substituted");
  assert.throws(
    () => publishFrozenRelease(root, frozen, identity.tag, existing, command),
    /changed after verification/,
  );
  assert.ok(
    releaseDescription(
      root,
      distribution(
        "nightly",
        `0.2.0-nightly-${identity.commit.slice(0, NIGHTLY_HASH_LENGTH)}`,
        identity.commit,
      ),
    ).includes("They do not check for updates"),
  );
});

test("unpublished beta retries recover legacy tags and replace stale or conflicting drafts", (t) => {
  for (const state of ["tag-only", "old-source", "rebuilt-bytes"] as const) {
    const root = scratch(t);
    mkdirSync(join(root, "release"));
    writeFileSync(join(root, "release/RELEASE_NOTES.md"), "Recovery notes");
    const path = join(root, "payload.zip");
    writeFileSync(path, "rebuilt bytes");
    const identity = distribution("release", "0.2.1", "b".repeat(40));
    const frozen = {
      identity,
      files: [
        {
          path,
          name: "payload.zip",
          sha256: sha256(Buffer.from("rebuilt bytes")),
        },
      ],
    };
    const draft = {
      id: 10,
      draft: true,
      target_commitish:
        state === "rebuilt-bytes" ? identity.commit : "a".repeat(40),
      html_url: "https://example.invalid/draft",
      assets: [{ name: "payload.zip", digest: `sha256:${"c".repeat(64)}` }],
    };
    let taggedCommit = "a".repeat(40);
    const mutations: string[] = [];
    const api: GitHub = (args) => {
      if (args[0].includes("/git/matching-refs/"))
        return Buffer.from(`refs/tags/${identity.tag}`);
      if (args[0].includes("/commits/")) return Buffer.from(taggedCommit);
      if (args.includes("--slurp")) return Buffer.from("[[]]");
      if (args.includes("--paginate"))
        return Buffer.from(state === "tag-only" ? "" : JSON.stringify(draft));
      if (args.includes("DELETE")) {
        assert.ok(args[0].endsWith(`/releases/${draft.id}`));
        mutations.push("delete draft");
      } else if (args.includes("PATCH")) {
        assert.ok(args[0].endsWith(`/git/refs/tags/${identity.tag}`));
        assert.ok(args.includes(`sha=${identity.commit}`));
        assert.ok(args.includes("force=true"));
        taggedCommit = identity.commit;
        mutations.push("bind tag");
      } else {
        assert.ok(args.includes("POST"));
        assert.ok(args.includes("draft=true"));
        assert.ok(args.includes(`target_commitish=${identity.commit}`));
        assert.equal(taggedCommit, identity.commit);
        mutations.push("create draft");
        return Buffer.from(
          JSON.stringify({
            ...draft,
            target_commitish: identity.commit,
            assets: [],
          }),
        );
      }
      return Buffer.from("{}");
    };
    publishFrozenRelease(root, frozen, identity.tag, api, (_program, args) => {
      mutations.push(args[1]);
      return "";
    });
    assert.deepEqual(mutations, [
      "bind tag",
      ...(state === "tag-only" ? [] : ["delete draft"]),
      "create draft",
      "upload",
      "edit",
    ]);
  }
});

test("publication retries admit the complete existing distribution without rewriting public assets", (t) => {
  const identity = distribution("release", "0.2.0", "a".repeat(40));
  const fixture = publicRelease(identity, 1);
  const api: GitHub = (args) => {
    if (args[0].includes("/commits/")) return Buffer.from(identity.commit);
    if (args.includes("--slurp")) return Buffer.from("[[]]");
    if (args.includes("--paginate"))
      return Buffer.from(
        JSON.stringify({
          ...fixture.release,
          html_url: "https://example.invalid/release",
        }),
      );
    return fixture.data;
  };
  publishFrozenRelease(
    scratch(t),
    { identity, files: [] },
    identity.tag,
    api,
    () => assert.fail("A published retry mutated the release"),
  );
  assert.throws(
    () =>
      publishFrozenRelease(
        scratch(t),
        {
          identity: distribution("release", identity.version, "b".repeat(40)),
          files: [],
        },
        identity.tag,
        (args) => {
          assert.ok(
            !args.includes("--method"),
            "Published releases must not be mutated",
          );
          return api(args);
        },
        () => assert.fail("A changed-source retry mutated public assets"),
      ),
    /another source commit/,
  );
});

test("nightly short-hash collisions refuse to move an existing tag", (t) => {
  const root = scratch(t);
  const commit = "a".repeat(40);
  const identity = distribution(
    "nightly",
    `0.2.1-nightly-${commit.slice(0, NIGHTLY_HASH_LENGTH)}`,
    commit,
  );
  const api: GitHub = (args) => {
    assert.ok(
      !args.includes("--method"),
      "A nightly collision must not mutate GitHub",
    );
    if (args[0].includes("/git/matching-refs/"))
      return Buffer.from(`refs/tags/${identity.tag}`);
    if (args[0].includes("/commits/"))
      return Buffer.from(commit.slice(0, -1) + "b");
    return Buffer.alloc(0);
  };
  assert.throws(
    () =>
      publishFrozenRelease(
        root,
        { identity, files: [] },
        identity.tag,
        api,
        () => assert.fail("A nightly collision published"),
      ),
    /Nightly tag points to another source commit/,
  );
});

test("nightlies and older beta retries never replace the newest beta as latest", (t) => {
  const root = scratch(t);
  mkdirSync(join(root, "release"));
  writeFileSync(join(root, "release/RELEASE_NOTES.md"), "Reviewed notes");
  const newer = publicRelease(
    distribution("release", "0.3.0", "b".repeat(40)),
    1,
  );
  for (const identity of [
    distribution("release", "0.2.1", "a".repeat(40)),
    distribution(
      "nightly",
      `0.3.0-nightly-${"c".repeat(NIGHTLY_HASH_LENGTH)}`,
      "c".repeat(40),
    ),
  ]) {
    const api: GitHub = (args) => {
      if (args[0].includes("/git/matching-refs/"))
        return Buffer.from(`refs/tags/${identity.tag}`);
      if (args.includes("--slurp"))
        return Buffer.from(JSON.stringify([[newer.release]]));
      if (args.includes("--header")) return newer.data;
      if (args.includes("--paginate")) return Buffer.alloc(0);
      if (args.includes("--jq")) return Buffer.from(identity.commit);
      assert.ok(args.includes("POST"));
      return Buffer.from(
        JSON.stringify({
          id: 10,
          draft: true,
          target_commitish: identity.commit,
          html_url: "https://example.invalid/release",
          assets: [],
        }),
      );
    };
    let published = false;
    publishFrozenRelease(
      root,
      { identity, files: [] },
      identity.tag,
      api,
      (_program, args) => {
        assert.ok(args.includes("--latest=false"));
        assert.ok(args.includes(`--prerelease=${identity.kind === "nightly"}`));
        published = true;
        return "";
      },
    );
    assert.ok(published);
  }
});
