import assert from "node:assert/strict";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { sha256, writeJson } from "../io.ts";
import {
  executableArchitecture,
  TOOLS,
  validateManifest,
  verifyBundle,
} from "./artifacts.ts";
import { verifyPayload } from "../filesystem.ts";
import { cliScripts } from "./cli-scripts.ts";
import { createManifestFixture } from "./test-fixtures.ts";

/** Disposable synthetic installation; no external runtime data is required. */
function scratch(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "holtburger-artifact-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("complete release inventories bind both products, native targets and installer sources", () => {
  const document = createManifestFixture(),
    inventory = validateManifest(document);
  assert.equal(inventory.identity.tag, `v${document.version}`);
  assert.equal(inventory.assets.size, document.assets.length);
  for (const asset of document.assets)
    assert.equal(inventory.assets.get(asset.name), asset.sha256);
});

test("missing/duplicate product, target and installer inventories are refused", () => {
  for (const mutate of [
    (doc: ReturnType<typeof createManifestFixture>) => {
      doc.native.splice(0, 1);
    },
    (doc: ReturnType<typeof createManifestFixture>) => {
      doc.native[0] = doc.native[1];
    },
    (doc: ReturnType<typeof createManifestFixture>) => {
      doc.flatpaks.pop();
    },
    (doc: ReturnType<typeof createManifestFixture>) => {
      doc.installers.pop();
    },
    (doc: ReturnType<typeof createManifestFixture>) => {
      doc.assets[0] = doc.assets[1];
    },
  ]) {
    const doc = createManifestFixture();
    mutate(doc);
    assert.throws(() => validateManifest(doc), /requires|inventory/);
  }
});

test("native identities, filenames, notices and shared CLI companions must agree", () => {
  for (const [mutate, error] of [
    [
      (doc: ReturnType<typeof createManifestFixture>) => {
        doc.native[0].modified = true;
      },
      /identity mismatch/,
    ],
    [
      (doc: ReturnType<typeof createManifestFixture>) => {
        doc.native[0].commit = "b".repeat(40);
      },
      /identity mismatch/,
    ],
    [
      (doc: ReturnType<typeof createManifestFixture>) => {
        doc.native[0].archive = "wrong.zip";
      },
      /filename mismatch/,
    ],
    [
      (doc: ReturnType<typeof createManifestFixture>) => {
        doc.native[0].noticesSha256 = "c".repeat(64);
      },
      /identity mismatch/,
    ],
    [
      (doc: ReturnType<typeof createManifestFixture>) => {
        const cli = doc.native.filter((record) => record.product === "cli");
        cli[0].contentFiles["navigation.hnav"] = "d".repeat(64);
      },
      /different content companions/,
    ],
  ] as const) {
    const doc = createManifestFixture();
    mutate(doc);
    assert.throws(() => validateManifest(doc), error);
  }
});

test("Flatpak family/app identity, installer source digests and asset bytes are bound", () => {
  for (const [mutate, error] of [
    [
      (doc: ReturnType<typeof createManifestFixture>) => {
        for (const flatpak of doc.flatpaks)
          flatpak.runtime = "unrelated.Platform/x86_64/1";
      },
      /supported runtime family/,
    ],
    [
      (doc: ReturnType<typeof createManifestFixture>) => {
        doc.flatpaks[0].appId = "different.application";
      },
      /Flatpak release identity/,
    ],
    [
      (doc: ReturnType<typeof createManifestFixture>) => {
        doc.installers[0].nativeArchiveSha256 = "b".repeat(64);
      },
      /Installer release identity/,
    ],
    [
      (doc: ReturnType<typeof createManifestFixture>) => {
        doc.assets[0].sha256 = "c".repeat(64);
      },
      /asset digest differs/,
    ],
  ] as const) {
    const doc = createManifestFixture();
    mutate(doc);
    assert.throws(() => validateManifest(doc), error);
  }
  const invalid = createManifestFixture();
  invalid.assets[0].sha256 = "not a digest";
  assert.throws(() => validateManifest(invalid));
});

test("executable inspection reads ELF64, PE and thin Mach-O machine fields", (t) => {
  const root = scratch(t),
    path = join(root, "program");
  const elf = Buffer.alloc(64);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(elf);
  elf.writeUInt16LE(62, 18);
  writeFileSync(path, elf);
  assert.equal(executableArchitecture(path), "x64");
  const pe = Buffer.alloc(70);
  pe.write("MZ");
  pe.writeUInt32LE(64, 60);
  pe.write("PE\0\0", 64);
  pe.writeUInt16LE(0xaa64, 68);
  writeFileSync(path, pe);
  assert.equal(executableArchitecture(path), "arm64");
  const macho = Buffer.alloc(64);
  macho.writeUInt32LE(0xfeedfacf);
  macho.writeUInt32LE(0x0100000c, 4);
  writeFileSync(path, macho);
  assert.equal(executableArchitecture(path), "arm64");
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.alloc(64),
    Buffer.from(pe.subarray(0, 64)),
  ]) {
    writeFileSync(path, bytes);
    assert.throws(() => executableArchitecture(path));
  }
  elf.writeUInt16LE(0, 18);
  writeFileSync(path, elf);
  assert.throws(
    () => executableArchitecture(path),
    /Unsupported executable machine/,
  );
});

test("native CLI admission requires exact content/scripts, notices, executable permissions and contained symlinks", (t) => {
  const root = scratch(t),
    bundle = join(root, "bundle");
  mkdirSync(join(bundle, "content"), { recursive: true });
  mkdirSync(join(bundle, "scripts"));
  mkdirSync(join(root, "apps/holtburger-cli/scripts"), { recursive: true });
  writeJson(join(root, "apps/holtburger-cli/scripts/bundle.json"), [
    "fixture.js",
    "fixture.data.json",
  ]);
  const header = Buffer.alloc(64);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(header);
  header.writeUInt16LE(62, 18);
  for (const name of TOOLS)
    writeFileSync(join(bundle, name), header, { mode: 0o755 });
  for (const name of cliScripts(root))
    writeFileSync(join(bundle, "scripts", name), name);
  const contents = {
    "bootstrap.hba": Buffer.from("bootstrap"),
    "navigation.hnav": Buffer.from("navigation"),
  };
  for (const [name, bytes] of Object.entries(contents))
    writeFileSync(join(bundle, "content", name), bytes);
  const info = {
    version: "0.2.0",
    commit: "a".repeat(40),
    modified: false,
    kind: "release",
    channel: "beta",
    product: "cli",
    target: "x86_64-unknown-linux-gnu",
    noticesSha256: sha256(Buffer.from("notices")),
    contentSha256: sha256(Buffer.from("zip")),
    contentFiles: Object.fromEntries(
      Object.entries(contents).map(([name, bytes]) => [name, sha256(bytes)]),
    ),
  };
  writeJson(join(bundle, "build-info.json"), info);
  writeFileSync(join(bundle, "THIRD_PARTY_NOTICES.html"), "notices");
  writeFileSync(join(bundle, "LICENSE.md"), "license");
  writeFileSync(join(bundle, "QUICKSTART.md"), "instructions");
  if (process.platform === "linux") {
    assert.equal(verifyBundle(bundle, root).product, "cli");
    writeFileSync(join(bundle, "content/navigation.hnav"), "substituted");
    assert.throws(() => verifyBundle(bundle, root), /content digest mismatch/);
    writeFileSync(
      join(bundle, "content/navigation.hnav"),
      contents["navigation.hnav"],
    );
    chmodSync(join(bundle, TOOLS[0]), 0o644);
    assert.throws(() => verifyBundle(bundle, root));
    chmodSync(join(bundle, TOOLS[0]), 0o755);

    // Model macOS temporary directories reached through a symlinked parent.
    symlinkSync(".", join(root, "alias"), "dir");
    const aliasedBundle = join(root, "alias/bundle"),
      script = join(bundle, "scripts/fixture.js");
    rmSync(script);
    symlinkSync("fixture.data.json", script);
    assert.equal(verifyBundle(aliasedBundle, root).product, "cli");

    // A sibling with the bundle's name as a prefix still lies outside it.
    writeFileSync(join(root, "bundle-outside.js"), "outside");
    rmSync(script);
    symlinkSync("../../bundle-outside.js", script);
    assert.throws(
      () => verifyBundle(aliasedBundle, root),
      /Bundle symlink escapes installation/,
    );
  }
});

test("installed payload verification detects substitution, inventory, links and modes", (t) => {
  const root = scratch(t),
    source = join(root, "source"),
    target = join(root, "installed");
  mkdirSync(source);
  writeFileSync(join(source, "program"), "original", { mode: 0o755 });
  symlinkSync("program", join(source, "link"));
  cpSync(source, target, { recursive: true, verbatimSymlinks: true });
  verifyPayload(source, target);
  chmodSync(join(target, "program"), 0o644);
  if (process.platform !== "win32")
    assert.throws(() => verifyPayload(source, target), /executable mode/);
  chmodSync(join(target, "program"), 0o755);
  writeFileSync(join(target, "program"), "substituted");
  assert.throws(() => verifyPayload(source, target), /file differs/);
  writeFileSync(join(target, "program"), "original");
  rmSync(join(target, "link"));
  symlinkSync("different", join(target, "link"));
  assert.throws(() => verifyPayload(source, target), /link differs/);
  writeFileSync(join(target, "unexpected"), "extra");
  assert.throws(() => verifyPayload(source, target), /inventory differs/);
});
