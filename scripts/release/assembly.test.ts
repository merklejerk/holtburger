import assert from "node:assert/strict";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { z } from "zod";
import { digest, readJson, writeJson, type Runner } from "../io.ts";
import { extractBundle, writeZip } from "./archives.ts";
import { TOOLS, verifyBundle } from "./artifacts.ts";
import { assemble, freezeManifest, verifyHostOrigin } from "./assembly.ts";
import { flatpakRecord, nativeRecord, targetNamed } from "./contracts.ts";
import {
  NAVIGATION_FORMAT_VERSION,
  NAVIGATION_HEADER_SIZE,
  unpackContent,
} from "./content.ts";
import {
  flatpakManifest,
  flatpakRecipe,
  installedRuntime,
  prepareFlatpak,
  recordFlatpak,
  requireFlatpakRelease,
} from "./flatpak.ts";
import { cliScripts } from "./cli-scripts.ts";
import { distribution, git } from "./identity.ts";
import { createManifestFixture, createSourceFixture } from "./test-fixtures.ts";

/** Real archive/content assembly over synthetic ELF bytes and an isolated clean source. */
async function cliSource(t: TestContext) {
  const root = createSourceFixture(t),
    target = "x86_64-unknown-linux-gnu",
    content = join(root, "staged"),
    output = join(root, "output");
  writeFileSync(
    join(root, ".gitignore"),
    "target/\nstaged/\noutput/\nextracted/\nflatpak/\nrecipes/\ncontent.zip\n",
  );
  mkdirSync(join(root, "release/quickstarts/cli"), { recursive: true });
  writeFileSync(
    join(root, "release/quickstarts/cli/linux.md"),
    "Native CLI instructions",
  );
  writeFileSync(join(root, "LICENSE.md"), "License");
  const notices = join(root, "notices.html");
  writeFileSync(notices, "notice bytes");
  mkdirSync(join(root, "apps/holtburger-cli/scripts"), { recursive: true });
  writeJson(join(root, "apps/holtburger-cli/scripts/bundle.json"), [
    "fixture.js",
    "fixture.data.json",
  ]);
  for (const name of cliScripts(root))
    writeFileSync(
      join(root, "apps/holtburger-cli/scripts", name),
      `script ${name}`,
    );
  const header = Buffer.alloc(64);
  header.write("\x7fELF\x02\x01", "binary");
  header.writeUInt16LE(62, 18);
  const binaries = join(root, "target", target, "release");
  mkdirSync(binaries, { recursive: true });
  for (const name of ["tui", "dat2hba", "dat-tool"]) {
    writeFileSync(join(binaries, name), header);
    chmodSync(join(binaries, name), 0o755);
  }
  const navigation = Buffer.alloc(NAVIGATION_HEADER_SIZE);
  navigation.write("HLTBNAV\0");
  navigation.writeUInt32LE(NAVIGATION_FORMAT_VERSION, 8);
  const archive = join(root, "content.zip");
  await writeZip(
    [
      {
        name: "bootstrap.hba",
        mode: 0o100644,
        kind: "file",
        data: Buffer.from("HBA\0fixture"),
      },
      {
        name: "navigation.hnav",
        mode: 0o100644,
        kind: "file",
        data: navigation,
      },
    ],
    archive,
  );
  await unpackContent(readFileSync(archive), digest(archive), content);
  mkdirSync(join(root, ".github/flatpak"), { recursive: true });
  writeJson(join(root, ".github/cli-content.json"), {
    sha256: digest(archive),
  });
  writeJson(
    join(root, ".github/flatpak/io.github.merklejerk.holtburger-3d.json"),
    {
      id: "io.github.merklejerk.holtburger-3d",
      runtime: "org.freedesktop.Platform",
      "runtime-version": "26.08",
      sdk: "org.freedesktop.Sdk",
    },
  );
  git(root, "add", ".");
  git(root, "commit", "-m", "Synthetic release inputs");
  const calls: string[] = [];
  const command: Runner = (program) => {
    calls.push(program);
    return "linked libraries";
  };
  const bundleArchive = await assemble(
    root,
    { product: "cli", target, content, notices, output },
    {},
    command,
  );
  const native = await extractBundle(bundleArchive, join(root, "extracted"));
  return { root, output, native, target, calls, bundleArchive };
}

test(
  "native CLI assembly round-trips pinned content, documents, tools, modes and source receipts",
  { skip: process.platform !== "linux" },
  async (t) => {
    const { root, output, native, target, calls, bundleArchive } =
      await cliSource(t);
    const info = verifyBundle(native, root);
    assert.equal(info.product, "cli");
    assert.equal(info.modified, false);
    assert.equal(
      readFileSync(join(native, "QUICKSTART.md"), "utf8"),
      "Native CLI instructions",
    );
    assert.deepEqual(
      calls,
      TOOLS.flatMap(() => ["ldd", "readelf"]),
    );
    assert.equal(statSync(join(native, "holtburger-cli")).mode & 0o777, 0o755);
    const receipt = nativeRecord.parse(
      readJson(join(output, `metadata-cli-${target}.json`)),
    );
    assert.equal(receipt.sha256, digest(bundleArchive));
    assert.equal(receipt.commit, git(root, "rev-parse", "HEAD"));
    writeFileSync(join(native, "content/bootstrap.hba"), "substituted");
    assert.throws(
      () => verifyBundle(native, root),
      /CLI content digest mismatch/,
    );
  },
);

test(
  "Flatpak preparation binds clean native bytes, relative recipe inputs, installed inventory and runtime",
  { skip: process.platform !== "linux" },
  async (t) => {
    const { root, output, native, target } = await cliSource(t);
    const locations: string[] = [];
    const command: Runner = (program, args, cwd) => {
      assert.equal(program, "flatpak-builder");
      assert.equal(args[0], "--show-manifest");
      locations.push(cwd);
      writeFileSync(join(cwd, "builder-state"), "temporary");
      return JSON.stringify({
        id: "io.github.merklejerk.holtburger-cli",
        runtime: "org.freedesktop.Platform",
        "runtime-version": "old",
        sdk: "org.freedesktop.Sdk",
        modules: [
          {
            name: "helper",
            sources: [{ type: "patch", path: "helper.patch" }],
          },
          {
            name: "holtburger-cli",
            sources: [
              { type: "file", path: "launcher" },
              { type: "dir", path: "placeholder", dest: "bundle" },
            ],
          },
        ],
      });
    };
    const manifest = join(root, "recipes/release.json");
    const staged = await prepareFlatpak(
      root,
      output,
      "cli",
      manifest,
      {},
      command,
    );
    assert.ok(existsSync(staged));
    assert.ok(locations.every((location) => !existsSync(location)));
    const recipe = z
      .object({
        modules: z.array(
          z.object({ sources: z.array(z.object({ path: z.string() })) }),
        ),
      })
      .parse(readJson(manifest));
    assert.equal(recipe.modules[1].sources[1].path, staged);
    assert.equal(
      recipe.modules[0].sources[0].path,
      join(root, "apps/holtburger-cli/dist/helper.patch"),
    );
    const files = join(root, "flatpak/files"),
      installed = join(files, "lib/holtburger");
    cpSync(native, installed, { recursive: true, verbatimSymlinks: true });
    mkdirSync(join(files, "bin"));
    for (const name of TOOLS)
      symlinkSync(`/app/lib/holtburger/${name}`, join(files, "bin", name));
    const runtime = "org.freedesktop.Platform/x86_64/26.08";
    writeFileSync(
      join(files, "../metadata"),
      `[Application]\nname=io.github.merklejerk.holtburger-cli\nruntime=${runtime}\n`,
    );
    const bundle = join(root, "flatpak/cli.flatpak"),
      receipt = join(root, "flatpak/record.json");
    writeFileSync(bundle, "synthetic Flatpak container");
    recordFlatpak(root, files, native, bundle, receipt, {}, command);
    const record = flatpakRecord.parse(readJson(receipt));
    assert.equal(record.runtime, runtime);
    assert.equal(record.sha256, digest(bundle));
    const executable = join(installed, "dat-tool");
    chmodSync(executable, 0o644);
    assert.throws(
      () => recordFlatpak(root, files, native, bundle, receipt, {}, command),
      /executable mode differs/,
    );
    chmodSync(executable, 0o755);
    writeFileSync(executable, "substituted");
    assert.throws(
      () => recordFlatpak(root, files, native, bundle, receipt, {}, command),
      /payload file differs/,
    );
    const expanded = flatpakRecipe(root, "cli", command);
    writeFileSync(
      join(files, "../metadata"),
      `[Application]\nname=wrong\nruntime=${runtime}\n`,
    );
    assert.throws(() => installedRuntime(files, expanded), /application ID/);
    writeFileSync(
      join(files, "../metadata"),
      "[Application]\nname=io.github.merklejerk.holtburger-cli\nruntime=wrong\n",
    );
    assert.throws(() => installedRuntime(files, expanded), /runtime differs/);
    const info = verifyBundle(native, root);
    for (const change of [
      { commit: "b".repeat(40) },
      { modified: true },
      { target: "other" },
    ])
      assert.throws(() =>
        requireFlatpakRelease({ ...info, ...change }, root, {}),
      );
    writeFileSync(join(root, "LICENSE.md"), "changed source");
    assert.throws(
      () => flatpakManifest(root, native, manifest, {}, command),
      /source checkout/,
    );
    assert.ok(existsSync(join(output, `metadata-cli-${target}.json`)));
  },
);

test("release freezing validates actual bytes, source pins and complete receipts before checksums", (t) => {
  const root = createSourceFixture(t),
    identity = distribution("release", "0.2.0", git(root, "rev-parse", "HEAD"));
  const artifacts = mkdtempSync(join(tmpdir(), "holtburger-freeze-"));
  t.after(() => rmSync(artifacts, { recursive: true, force: true }));
  const document = createManifestFixture(identity);
  mkdirSync(join(root, ".github/flatpak"), { recursive: true });
  writeJson(join(root, ".github/cli-content.json"), {
    sha256: document.native.find((record) => record.product === "cli")
      ?.contentSha256,
  });
  writeJson(
    join(root, ".github/flatpak/io.github.merklejerk.holtburger-3d.json"),
    { runtime: "org.freedesktop.Platform", "runtime-version": "26.08" },
  );
  git(root, "add", ".");
  git(root, "commit", "-m", "Pinned source inputs");
  const commit = git(root, "rev-parse", "HEAD");
  writeFileSync(join(artifacts, "THIRD_PARTY_NOTICES.html"), "notice bytes");
  for (const record of document.native) {
    record.commit = commit;
    const bytes = Buffer.from(`${record.product}/${record.target}`);
    writeFileSync(join(artifacts, record.archive), bytes);
    writeJson(
      join(artifacts, `metadata-${record.product}-${record.target}.json`),
      record,
    );
  }
  for (const record of document.flatpaks) {
    record.commit = commit;
    writeFileSync(join(artifacts, record.archive), `flatpak/${record.product}`);
    writeJson(
      join(artifacts, `metadata-${record.product}-flatpak.json`),
      record,
    );
  }
  for (const record of document.installers) {
    record.commit = commit;
    writeFileSync(
      join(artifacts, record.installer),
      `installer/${record.target}`,
    );
    writeJson(
      join(artifacts, `metadata-3d-installer-${record.target}.json`),
      record,
    );
  }
  const frozen = freezeManifest(root, artifacts, {});
  assert.equal(frozen.identity.commit, commit);
  assert.equal(frozen.files.length, document.assets.length + 2);
  const sums = readFileSync(join(artifacts, "SHA256SUMS"), "utf8");
  for (const file of frozen.files) {
    assert.equal(file.sha256, digest(file.path));
    if (file.name !== "SHA256SUMS")
      assert.ok(sums.includes(`${file.sha256}  ${file.name}\n`));
  }
  const asset = join(artifacts, document.flatpaks[0].archive);
  writeFileSync(asset, "changed");
  assert.throws(() => freezeManifest(root, artifacts, {}), /digest mismatch/);
  writeFileSync(join(root, "LICENSE.md"), "untracked source");
  assert.throws(() => freezeManifest(root, artifacts, {}), /modified source/);
});

test("macOS host provenance binds both unsigned Cargo bytes and final signed bytes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "holtburger-host-origin-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "cargo-host"),
    host = join(
      root,
      "h3d/holtburger-3d.app/Contents/Resources/holtburger-3d-host",
    );
  mkdirSync(dirname(host), { recursive: true });
  writeFileSync(source, "unsigned");
  writeFileSync(host, "signed");
  writeJson(join(dirname(host), "host-provenance.json"), {
    sourceHostSha256: digest(source),
    packagedHostSha256: digest(host),
  });
  const target = targetNamed("aarch64-apple-darwin");
  verifyHostOrigin(root, source, target);
  writeFileSync(source, "other build");
  assert.throws(
    () => verifyHostOrigin(root, source, target),
    /different Cargo host/,
  );
  writeFileSync(source, "unsigned");
  writeFileSync(host, "tampered signature");
  assert.throws(
    () => verifyHostOrigin(root, source, target),
    /different packaged host/,
  );
});
