import {
  accessSync,
  openSync,
  readSync,
  closeSync,
  constants,
  lstatSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { digest, readJson, run } from "../io.ts";
import { walk } from "../filesystem.ts";
import { cliScripts } from "./cli-scripts.ts";
import {
  bundleInfo,
  INSTALLER_TARGETS,
  installerFilename,
  installerNamed,
  manifestSchema,
  PRODUCTS,
  TARGETS,
  targetNamed,
  type BundleInfo,
  type NativeTarget,
} from "./contracts.ts";
import { distribution, type Distribution } from "./identity.ts";
import { validateChannelVersion } from "./version.ts";

/** Native CLI tools included with the terminal frontend. */
export const TOOLS = ["holtburger-cli", "dat2hba", "dat-tool"] as const;
/** A complete inventory carries validated identity and exact downloadable byte identities. */
export interface ReleaseInventory {
  /** Identity computed once while admitting the managed manifest. */
  readonly identity: Distribution;
  /** All downloadable payloads excluding the manifest and checksum list. */
  readonly assets: ReadonlyMap<string, string>;
}

/** Check identity/receipt fields without reconstructing them in each downstream consumer. */
export function requireFields(
  actual: Readonly<Record<string, unknown>>,
  expected: Readonly<Record<string, unknown>>,
  message: string,
): void {
  for (const [key, value] of Object.entries(expected))
    if (!isDeepStrictEqual(actual[key], value))
      throw new Error(`${message}: ${key}`);
}

/** Compare unordered inventories while rejecting duplicate entries. */
function exactNames(
  actual: readonly string[],
  expected: readonly string[],
  message: string,
): void {
  if (!isDeepStrictEqual([...actual].sort(), [...expected].sort()))
    throw new Error(message);
}

/** Admit all products, native targets, Flatpaks, installers and shared content as one release. */
export function validateManifest(document: unknown): ReleaseInventory {
  const doc = manifestSchema.parse(document);
  validateChannelVersion(doc.channel, doc.version, doc.kind);
  const identity = distribution(doc.kind, doc.version, doc.commit);
  const shared = {
    version: doc.version,
    channel: doc.channel,
    commit: doc.commit,
    modified: false,
    noticesSha256: doc.noticesSha256,
    kind: doc.kind,
  };
  const assets = new Map<string, string>([
    ["THIRD_PARTY_NOTICES.html", doc.noticesSha256],
  ]);
  const cli = doc.native.filter((record) => record.product === "cli");
  if (cli.length === 0)
    throw new Error("Release manifest requires CLI content receipts");
  const content = {
    contentSha256: cli[0].contentSha256,
    contentFiles: cli[0].contentFiles,
  };
  for (const record of doc.native) {
    requireFields(
      record,
      shared,
      "Release identity mismatch for native archive",
    );
    const target = targetNamed(record.target);
    const filename = `holtburger-${record.product}-${doc.version}-${target.triple}${target.platform === "linux" ? ".tar.gz" : ".zip"}`;
    if (record.archive !== filename)
      throw new Error("Release archive filename mismatch");
    assets.set(filename, record.sha256);
    if (record.product === "cli")
      requireFields(
        record,
        content,
        "CLI native targets contain different content companions",
      );
  }
  for (const record of doc.installers) {
    const installer = installerNamed(record.target);
    const archive = doc.native.find(
      (item) => item.product === "3d" && item.target === installer.triple,
    );
    if (archive === undefined)
      throw new Error("Installer has no corresponding native archive");
    requireFields(
      record,
      {
        ...shared,
        product: "3d",
        format: installer.format,
        nativeArchiveSha256: archive.sha256,
      },
      "Installer release identity mismatch",
    );
    const filename = installerFilename(installer, doc.version);
    if (record.installer !== filename)
      throw new Error("Installer release filename mismatch");
    assets.set(filename, record.sha256);
  }
  exactNames(
    doc.native.map((record) => `${record.product}/${record.target}`),
    PRODUCTS.flatMap((product) =>
      TARGETS.map((target) => `${product}/${target.triple}`),
    ),
    "Release manifest requires both products on every native target",
  );
  exactNames(
    doc.installers.map((record) => record.target),
    INSTALLER_TARGETS.map((target) => target.triple),
    "Release manifest requires every desktop installer",
  );
  const runtimes = new Set(doc.flatpaks.map((record) => record.runtime));
  if (runtimes.size !== 1) throw new Error("Flatpak release runtimes differ");
  for (const record of doc.flatpaks) {
    if (!/^org\.freedesktop\.Platform\/x86_64\/[0-9.]+$/.test(record.runtime))
      throw new Error(
        "Flatpak runtime is outside the supported runtime family",
      );
    requireFields(
      record,
      {
        ...shared,
        target: "x86_64-unknown-linux-gnu",
        appId: `io.github.merklejerk.holtburger-${record.product}`,
        ...(record.product === "cli" ? content : {}),
      },
      "Flatpak release identity mismatch",
    );
    const filename = `holtburger-${record.product}-${doc.version}-x86_64.flatpak`;
    if (record.archive !== filename)
      throw new Error("Flatpak release filename mismatch");
    assets.set(filename, record.sha256);
  }
  exactNames(
    doc.flatpaks.map((record) => record.product),
    PRODUCTS,
    "Release manifest requires both product Flatpaks",
  );
  exactNames(
    doc.assets.map((record) => record.name),
    [...assets.keys()],
    "Release manifest asset inventory differs from payload records",
  );
  for (const asset of doc.assets)
    if (assets.get(asset.name) !== asset.sha256)
      throw new Error(`Release manifest asset digest differs: ${asset.name}`);
  return { identity, assets };
}

/** Inspect executable headers rather than trusting download filenames. */
export function executableArchitecture(path: string): "x64" | "arm64" {
  const handle = openSync(path, "r");
  const data = Buffer.alloc(64);
  let machine: number;
  let architectures: Readonly<Record<number, "x64" | "arm64">>;
  try {
    if (readSync(handle, data, 0, data.length, 0) !== data.length)
      throw new Error(`Truncated native executable: ${path}`);
    if (
      data.subarray(0, 6).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]))
    ) {
      machine = data.readUInt16LE(18);
      architectures = { 62: "x64", 183: "arm64" };
    } else if (data.subarray(0, 2).toString() === "MZ") {
      const offset = data.readUInt32LE(60),
        pe = Buffer.alloc(6);
      if (
        readSync(handle, pe, 0, pe.length, offset) !== pe.length ||
        !pe.subarray(0, 4).equals(Buffer.from("PE\0\0"))
      )
        throw new Error(`Invalid PE header: ${path}`);
      machine = pe.readUInt16LE(4);
      architectures = { 0x8664: "x64", 0xaa64: "arm64" };
    } else if (data.readUInt32LE(0) === 0xfeedfacf) {
      machine = data.readUInt32LE(4);
      architectures = { 0x01000007: "x64", 0x0100000c: "arm64" };
    } else throw new Error(`Unsupported native executable format: ${path}`);
  } finally {
    closeSync(handle);
  }
  const architecture = architectures[machine];
  if (architecture === undefined)
    throw new Error(`Unsupported executable machine ${machine}: ${path}`);
  return architecture;
}

/** One layout owner supplies both launcher and host paths to inspectors and installers. */
export function executablePaths(
  bundle: string,
  target: NativeTarget,
  product: "3d",
): readonly [launcher: string, host: string];
export function executablePaths(
  bundle: string,
  target: NativeTarget,
  product: BundleInfo["product"],
): readonly string[];
export function executablePaths(
  bundle: string,
  target: NativeTarget,
  product: BundleInfo["product"],
): readonly string[] {
  const suffix = target.platform === "win32" ? ".exe" : "";
  if (product === "cli")
    return TOOLS.map((name) => join(bundle, `${name}${suffix}`));
  const app = join(bundle, "h3d");
  return target.platform === "darwin"
    ? [
        join(app, "holtburger-3d.app/Contents/MacOS/holtburger-3d"),
        join(app, "holtburger-3d.app/Contents/Resources/holtburger-3d-host"),
      ]
    : [
        join(app, `holtburger-3d${suffix}`),
        join(app, `resources/holtburger-3d-host${suffix}`),
      ];
}

/** Validate downloaded native payload shape, source facts, executable headers and notices. */
export function verifyBundle(bundle: string, root: string): BundleInfo {
  const info = bundleInfo.parse(readJson(join(bundle, "build-info.json")));
  const target = targetNamed(info.target);
  if (process.platform !== target.platform)
    throw new Error("Bundle inspection must run on its native platform");
  validateChannelVersion(info.channel, info.version, info.kind);
  distribution(info.kind, info.version, info.commit);
  const resources = ["QUICKSTART.md", "LICENSE.md", "THIRD_PARTY_NOTICES.html"];
  const expected = [...resources, "build-info.json"];
  if (info.product === "cli") {
    const scriptFiles = cliScripts(root);
    expected.push(
      "scripts",
      "content",
      ...TOOLS.map(
        (name) => `${name}${target.platform === "win32" ? ".exe" : ""}`,
      ),
    );
    exactNames(
      readdirSync(join(bundle, "scripts")),
      scriptFiles,
      "Unexpected or missing bundled script entries",
    );
    exactNames(
      readdirSync(join(bundle, "content")),
      Object.keys(info.contentFiles),
      "Unexpected or missing CLI content entries",
    );
    for (const [name, hash] of Object.entries(info.contentFiles))
      if (digest(join(bundle, "content", name)) !== hash)
        throw new Error(`CLI content digest mismatch: ${name}`);
    resources.push(...scriptFiles.map((name) => `scripts/${name}`));
  } else expected.push("h3d");
  exactNames(
    readdirSync(bundle),
    expected,
    `Unexpected or missing ${info.product} bundle root entries`,
  );
  if (digest(join(bundle, "THIRD_PARTY_NOTICES.html")) !== info.noticesSha256)
    throw new Error("Bundle dependency notices digest mismatch");
  for (const resource of resources)
    if (statSync(join(bundle, resource)).size === 0)
      throw new Error(`Empty bundle resource: ${resource}`);
  for (const path of executablePaths(bundle, target, info.product)) {
    if (executableArchitecture(path) !== target.architecture)
      throw new Error(
        `Executable architecture does not match ${target.triple}: ${path}`,
      );
    if (target.platform !== "win32") accessSync(path, constants.X_OK);
  }
  for (const path of walk(bundle)) {
    if (info.product === "3d" && /\.(hba|hwc)$/i.test(path))
      throw new Error(`Unexpected content archive in h3d: ${path}`);
    if (lstatSync(path).isSymbolicLink()) {
      const rel = relative(resolve(bundle), realpathSync(path));
      if (rel === ".." || rel.startsWith(`..${sep}`))
        throw new Error(`Bundle symlink escapes installation: ${path}`);
    }
  }
  if (info.product === "3d") {
    const appRoot = join(root, "apps/holtburger-3d");
    const renderer = z
      .object({
        version: z.string(),
        revision: z.string(),
        modified: z.boolean(),
        channel: z.string(),
        kind: z.string(),
      })
      .parse(
        JSON.parse(
          run(
            "node",
            ["scripts/verify-electron-package.mjs", resolve(bundle, "h3d")],
            appRoot,
          ),
        ),
      );
    requireFields(
      renderer,
      {
        version: info.version,
        revision: info.commit.slice(0, 8),
        modified: info.modified,
        channel: info.channel,
        kind: info.kind,
      },
      "3D build identity differs from the packaged renderer",
    );
  }
  return info;
}
