import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { sha256 } from "../io.ts";
import {
  archiveBundle,
  extractBundle,
  readZip,
  writeZip,
  type ArchiveEntry,
} from "./archives.ts";
import {
  archiveComponents,
  CONTENT_FILES,
  contentDescriptor,
  fetchContent,
  NAVIGATION_FORMAT_VERSION,
  NAVIGATION_HEADER_SIZE,
  unpackContent,
  validateComponents,
  verifyStagedContent,
  type ContentComponents,
} from "./content.ts";

/** Synthetic content shares only its runtime header constants with the staging code. */
function components(): ContentComponents {
  const navigation = Buffer.alloc(NAVIGATION_HEADER_SIZE);
  navigation.write("HLTBNAV\0");
  navigation.writeUInt32LE(NAVIGATION_FORMAT_VERSION, 8);
  navigation.writeBigUInt64LE(BigInt(NAVIGATION_HEADER_SIZE), 16);
  return {
    "bootstrap.hba": Buffer.from("HBA\0synthetic bootstrap"),
    "navigation.hnav": navigation,
  };
}

/** Owned scratch space is removed even when an archive or native check fails. */
function scratch(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "holtburger-content-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Construct input with a real ZIP library; no staging implementation is used as an oracle. */
async function contentZip(
  root: string,
  extra: readonly ArchiveEntry[] = [],
): Promise<Buffer> {
  const path = join(root, "input.zip");
  await writeZip(
    [
      ...Object.entries(components()).map(([name, data]) => ({
        name,
        data,
        kind: "file" as const,
        mode: 0o100644,
      })),
      ...extra,
    ],
    path,
  );
  return readFileSync(path);
}

test("content download credentials are confined to the pinned repository asset URL", () => {
  const sha256 = "a".repeat(64);
  contentDescriptor.parse({
    url: "https://api.github.com/repos/merklejerk/holtburger/releases/assets/123",
    sha256,
  });
  for (const url of [
    undefined,
    "https://example.invalid/releases/assets/123",
    "https://api.github.com/repos/another/repo/releases/assets/123",
    "https://api.github.com/repos/merklejerk/holtburger/releases/assets/123/extra",
  ])
    assert.throws(() => contentDescriptor.parse({ url, sha256 }));
});

test("pinned pair and original ZIP are preserved and later byte substitution is rejected", async (t) => {
  const root = scratch(t);
  const input = await contentZip(root);
  const hash = sha256(input);
  const output = join(root, "content");
  await unpackContent(input, hash, output);
  await verifyStagedContent(output, hash);
  assert.deepEqual(readFileSync(join(output, "cli-content.zip")), input);
  for (const name of CONTENT_FILES)
    assert.deepEqual(readFileSync(join(output, name)), components()[name]);
  writeFileSync(join(output, "navigation.hnav"), "substituted");
  await assert.rejects(
    verifyStagedContent(output, hash),
    /navigation.hnav differs/,
  );
});

test("bad digest and extra or duplicate members never create content output", async (t) => {
  const root = scratch(t);
  const input = await contentZip(root);
  const output = join(root, "content");
  await assert.rejects(
    unpackContent(input, "0".repeat(64), output),
    /ZIP SHA-256 mismatch/,
  );
  assert.equal(existsSync(output), false);
  for (const name of [
    "content/bootstrap.hba",
    "unneeded.hba",
    "bootstrap.hba",
  ]) {
    const bytes = await contentZip(root, [
      { kind: "file", name, mode: 0o100644, data: Buffer.from("extra") },
    ]);
    await assert.rejects(
      archiveComponents(bytes, sha256(bytes)),
      /must contain exactly/,
    );
  }
});

test("format admission rejects each malformed content header", () => {
  const invalidVersion = components()["navigation.hnav"];
  invalidVersion.writeUInt32LE(NAVIGATION_FORMAT_VERSION + 1, 8);
  for (const [name, payload, error] of [
    ["bootstrap.hba", Buffer.from("invalid"), /HBA header/],
    ["navigation.hnav", Buffer.alloc(0), /truncated/],
    [
      "navigation.hnav",
      Buffer.alloc(NAVIGATION_HEADER_SIZE),
      /navigation header/,
    ],
    ["navigation.hnav", invalidVersion, /Unsupported CLI navigation format/],
  ] as const) {
    const parts = components();
    parts[name] = payload;
    assert.throws(() => validateComponents(parts), error);
  }
});

test("staging refuses existing companions including broken symbolic links", async (t) => {
  const root = scratch(t);
  const input = await contentZip(root);
  const output = join(root, "content");
  mkdirSync(output);
  symlinkSync("missing", join(output, "bootstrap.hba"));
  await assert.rejects(
    unpackContent(input, sha256(input), output),
    /Refusing to replace/,
  );
  assert.equal(existsSync(join(output, "navigation.hnav")), false);
});

test("native ZIP framework links and TAR executable modes survive a round trip", async (t) => {
  const root = scratch(t);
  const source = join(root, "bundle");
  mkdirSync(join(source, "Versions/A"), { recursive: true });
  writeFileSync(join(source, "Versions/A/program"), "synthetic executable", {
    mode: 0o755,
  });
  symlinkSync("A", join(source, "Versions/Current"), "dir");
  for (const [platform, suffix] of [
    ["darwin", ".zip"],
    ["linux", ".tar.gz"],
  ] as const) {
    const archive = join(root, `bundle${suffix}`);
    await archiveBundle(source, archive, platform);
    const extracted = await extractBundle(archive, join(root, platform));
    assert.equal(
      readFileSync(join(extracted, "Versions/Current/program"), "utf8"),
      "synthetic executable",
    );
    assert.equal(
      statSync(join(extracted, "Versions/A/program")).mode & 0o777,
      0o755,
    );
    if (platform === "darwin") {
      const entries = await readZip(readFileSync(archive));
      assert.deepEqual(
        entries.find((entry) => entry.name === "bundle/Versions/Current"),
        {
          name: "bundle/Versions/Current",
          mode: 0o120777,
          kind: "symlink",
          target: "A",
        },
      );
    }
  }
});

test("ZIP extraction rejects escaping links and writes through archive links", async (t) => {
  const root = scratch(t);
  for (const target of ["../../outside", "/outside"]) {
    const archive = join(root, "bad.zip");
    await writeZip(
      [{ kind: "symlink", name: "bundle/link", target, mode: 0o120777 }],
      archive,
    );
    await assert.rejects(
      extractBundle(archive, join(root, "out")),
      /escapes installation/,
    );
  }
  const archive = join(root, "traversal.zip");
  await writeZip(
    [
      { kind: "symlink", name: "bundle/link", target: "real", mode: 0o120777 },
      {
        kind: "file",
        name: "bundle/link/file",
        data: Buffer.from("bad"),
        mode: 0o100644,
      },
    ],
    archive,
  );
  await assert.rejects(
    extractBundle(archive, join(root, "out")),
    /traverses a link/,
  );
});

test("pinned fetch passes exact authenticated download arguments and rejects foreign URLs before any request", async (t) => {
  const root = scratch(t),
    bytes = await contentZip(root),
    output = join(root, "downloaded");
  const descriptor = {
    url: "https://api.github.com/repos/merklejerk/holtburger/releases/assets/123",
    sha256: sha256(bytes),
  };
  let calls = 0;
  const api = (args: readonly string[]) => {
    calls++;
    assert.deepEqual(args, [
      descriptor.url,
      "--header",
      "Accept: application/octet-stream",
    ]);
    return bytes;
  };
  await fetchContent(descriptor, output, api);
  await verifyStagedContent(output, descriptor.sha256);
  for (const url of [
    undefined,
    "https://example.invalid/asset",
    "https://api.github.com/repos/foreign/project/releases/assets/123",
  ])
    await assert.rejects(
      fetchContent({ ...descriptor, url }, join(root, "foreign"), api),
    );
  assert.equal(calls, 1);
  assert.equal(existsSync(join(root, "foreign")), false);
});

test("ZIP creation propagates invalid member and unavailable source failures through its awaited operation", async (t) => {
  const root = scratch(t);
  await assert.rejects(
    writeZip(
      [
        {
          kind: "file",
          name: "../escape",
          data: Buffer.from("invalid"),
          mode: 0o100644,
        },
      ],
      join(root, "invalid.zip"),
    ),
    /invalid relative path/,
  );
  await assert.rejects(
    archiveBundle(join(root, "missing"), join(root, "missing.zip"), "darwin"),
    /ENOENT/,
  );
});
