import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { z } from "zod";
import which from "which";
import {
  digest,
  digestSchema,
  readJson,
  writeJson,
  type Runner,
} from "../io.ts";
import { archiveBundle, extractBundle } from "./archives.ts";
import {
  executablePaths,
  validateManifest,
  verifyBundle,
} from "./artifacts.ts";
import {
  bundleInfo,
  flatpakRuntimeRef,
  flatpakRecord,
  installerRecord,
  INSTALLER_TARGETS,
  manifestSchema,
  nativeRecord,
  PRODUCTS,
  targetNamed,
  TARGETS,
  type BundleInfo,
  type NativeTarget,
} from "./contracts.ts";
import { verifyStagedContent, CONTENT_FILES } from "./content.ts";
import { cliScripts } from "./cli-scripts.ts";
import { sourceFacts } from "./source.ts";
import { readChannel } from "./version.ts";
import type { Distribution } from "./identity.ts";

/** Native assembly inputs; the discriminant enforces the product's required payload source. */
export type AssemblyInput = {
  /** Native target selects the package layout and executable inspection. */
  readonly target: string;
  /** Reviewed suite notice document copied into this archive. */
  readonly notices: string;
  /** Artifact directory receiving the archive and its inspected receipt. */
  readonly output: string;
} & (
  | { readonly product: "cli"; readonly content: string }
  | { readonly product: "3d"; readonly package: string }
);

/** Bind packaged hosts to Cargo, retaining both sides of a macOS signing mutation. */
export function verifyHostOrigin(
  bundle: string,
  source: string,
  target: NativeTarget,
): void {
  const [, finalHost] = executablePaths(bundle, target, "3d");
  if (target.platform === "darwin") {
    const provenance = z
      .object({
        sourceHostSha256: digestSchema,
        packagedHostSha256: digestSchema,
      })
      .parse(readJson(join(dirname(finalHost), "host-provenance.json")));
    if (provenance.sourceHostSha256 !== digest(source))
      throw new Error(
        "Mac signing provenance identifies a different Cargo host",
      );
    if (provenance.packagedHostSha256 !== digest(finalHost))
      throw new Error(
        "Mac signing provenance identifies a different packaged host",
      );
  } else if (digest(finalHost) !== digest(source))
    throw new Error(
      "Forge bundled a different Rust host than the target build",
    );
}

/** Capture native linkage evidence and reject unresolved Linux runtime libraries. */
export function inspectLinkage(
  bundle: string,
  target: NativeTarget,
  product: BundleInfo["product"],
  command: Runner,
): Record<string, string> {
  return Object.fromEntries(
    executablePaths(bundle, target, product).map((path) => {
      let report: string;
      if (target.platform === "linux") {
        report = command("ldd", [resolve(path)], bundle);
        if (report.includes("not found"))
          throw new Error(`Unresolved native library: ${path}\n${report}`);
        report += `\n${command("readelf", ["--version-info", path], bundle)}`;
      } else if (target.platform === "darwin")
        report = command("otool", ["-L", path], bundle);
      else {
        const found = which.sync("llvm-readobj", { nothrow: true });
        const inspector =
          found === null
            ? join(
                z.string().parse(process.env.ProgramFiles),
                "LLVM/bin/llvm-readobj.exe",
              )
            : found;
        if (!existsSync(inspector))
          throw new Error("Windows native inspection requires llvm-readobj");
        report = command(inspector, ["--coff-imports", path], bundle);
      }
      return [relative(bundle, path).replaceAll("\\", "/"), report];
    }),
  );
}

/** Assemble and round-trip one native payload before recording its downloadable receipt. */
export async function assemble(
  root: string,
  input: AssemblyInput,
  env: Readonly<NodeJS.ProcessEnv>,
  command: Runner,
): Promise<string> {
  const target = targetNamed(input.target);
  if (target.platform !== process.platform)
    throw new Error("Build each bundle on its native platform");
  const source = sourceFacts(root, env),
    channel = readChannel(root);
  const identity = source.identity;
  const output = resolve(input.output);
  mkdirSync(output, { recursive: true });
  const name = `holtburger-${input.product}-${identity.version}-${target.triple}`;
  const temporary = mkdtempSync(join(tmpdir(), "holtburger-bundle-"));
  try {
    const bundle = join(temporary, name);
    mkdirSync(bundle);
    const binaries = join(root, "target", target.triple, "release"),
      suffix = target.platform === "win32" ? ".exe" : "";
    const common = {
      version: identity.version,
      commit: identity.commit,
      kind: identity.kind,
      modified: source.modified,
      channel,
      product: input.product,
      target: target.triple,
      noticesSha256: digest(input.notices),
    };
    let info: BundleInfo;
    if (input.product === "cli") {
      const content = resolve(input.content),
        expected = z
          .object({ sha256: digestSchema })
          .parse(readJson(join(root, ".github/cli-content.json"))).sha256;
      await verifyStagedContent(content, expected);
      for (const [original, published] of [
        ["tui", "holtburger-cli"],
        ["dat2hba", "dat2hba"],
        ["dat-tool", "dat-tool"],
      ])
        cpSync(
          join(binaries, `${original}${suffix}`),
          join(bundle, `${published}${suffix}`),
        );
      mkdirSync(join(bundle, "scripts"));
      for (const script of cliScripts(root))
        cpSync(
          join(root, "apps/holtburger-cli/scripts", script),
          join(bundle, "scripts", script),
        );
      mkdirSync(join(bundle, "content"));
      for (const file of CONTENT_FILES)
        cpSync(join(content, file), join(bundle, "content", file));
      info = bundleInfo.parse({
        ...common,
        product: "cli",
        contentSha256: expected,
        contentFiles: Object.fromEntries(
          CONTENT_FILES.map((file) => [file, digest(join(content, file))]),
        ),
      });
    } else {
      cpSync(input.package, join(bundle, "h3d"), {
        recursive: true,
        verbatimSymlinks: true,
      });
      verifyHostOrigin(
        bundle,
        join(binaries, `holtburger-3d-host${suffix}`),
        target,
      );
      info = bundleInfo.parse(common);
    }
    cpSync(
      join(root, `release/quickstarts/${input.product}/${target.platform}.md`),
      join(bundle, "QUICKSTART.md"),
    );
    cpSync(join(root, "LICENSE.md"), join(bundle, "LICENSE.md"));
    cpSync(input.notices, join(bundle, "THIRD_PARTY_NOTICES.html"));
    writeJson(join(bundle, "build-info.json"), info);
    verifyBundle(bundle, root);
    const linkage = inspectLinkage(bundle, target, input.product, command),
      destination = join(
        output,
        `${name}${target.platform === "linux" ? ".tar.gz" : ".zip"}`,
      );
    await archiveBundle(bundle, destination, target.platform);
    const extracted = mkdtempSync(join(tmpdir(), "holtburger-extracted-"));
    try {
      verifyBundle(await extractBundle(destination, extracted), root);
    } finally {
      rmSync(extracted, { recursive: true, force: true });
    }
    writeJson(join(output, `metadata-${input.product}-${target.triple}.json`), {
      ...info,
      archive: basename(destination),
      sha256: digest(destination),
      linkage,
      runner: target.runner,
    });
    return destination;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

/** Immutable local file facts used by staging without deriving names or digests again. */
export interface ReleaseFile {
  /** Actual verified payload location. */
  readonly path: string;
  /** Public asset name admitted by the manifest. */
  readonly name: string;
  /** Byte identity at freeze time. */
  readonly sha256: string;
}
/** Release source and exact local files frozen by the manifest producer. */
export interface FrozenRelease {
  /** Validated immutable source identity. */
  readonly identity: Distribution;
  /** Payloads, manifest and checksum document to upload together. */
  readonly files: readonly ReleaseFile[];
}

/** Verify the complete local inventory and freeze immutable file facts for staging. */
export function freezeManifest(
  root: string,
  artifacts: string,
  env: Readonly<NodeJS.ProcessEnv>,
): FrozenRelease {
  const source = sourceFacts(root, env);
  if (source.modified)
    throw new Error("Refusing release metadata for a modified source checkout");
  const identity = source.identity,
    channel = readChannel(root),
    notices = join(artifacts, "THIRD_PARTY_NOTICES.html");
  if (statSync(notices).size === 0) throw new Error("Empty dependency notices");
  const native = PRODUCTS.flatMap((product) =>
    TARGETS.map((target) =>
      nativeRecord.parse(
        readJson(join(artifacts, `metadata-${product}-${target.triple}.json`)),
      ),
    ),
  );
  const flatpaks = PRODUCTS.map((product) =>
    flatpakRecord.parse(
      readJson(join(artifacts, `metadata-${product}-flatpak.json`)),
    ),
  );
  const installers = INSTALLER_TARGETS.map((target) =>
    installerRecord.parse(
      readJson(join(artifacts, `metadata-3d-installer-${target.triple}.json`)),
    ),
  );
  const assets = [
    { name: basename(notices), sha256: digest(notices) },
    ...[...native, ...flatpaks].map((record) => ({
      name: record.archive,
      sha256: record.sha256,
    })),
    ...installers.map((record) => ({
      name: record.installer,
      sha256: record.sha256,
    })),
  ];
  const document = manifestSchema.parse({
    schemaVersion: 2,
    version: identity.version,
    commit: identity.commit,
    kind: identity.kind,
    channel,
    noticesSha256: digest(notices),
    native,
    flatpaks,
    installers,
    assets,
  });
  const inventory = validateManifest(document),
    contentDigest = z
      .object({ sha256: digestSchema })
      .parse(readJson(join(root, ".github/cli-content.json"))).sha256;
  for (const item of native)
    if (item.product === "cli" && item.contentSha256 !== contentDigest)
      throw new Error(
        "CLI release content differs from the pinned source input",
      );
  const runtime = flatpakRuntimeRef(
    readJson(
      join(root, ".github/flatpak/io.github.merklejerk.holtburger-3d.json"),
    ),
  );
  for (const item of flatpaks)
    if (item.runtime !== runtime)
      throw new Error(
        "Flatpak release identity mismatch with the source runtime",
      );
  const files: ReleaseFile[] = [];
  for (const [name, hash] of inventory.assets) {
    const path = join(artifacts, name);
    if (statSync(path).size === 0)
      throw new Error(`Empty release asset: ${name}`);
    if (digest(path) !== hash)
      throw new Error(`Release asset digest mismatch: ${name}`);
    files.push({ path, name, sha256: hash });
  }
  const description = join(artifacts, "release-manifest.json");
  writeJson(description, document);
  files.push({
    path: description,
    name: "release-manifest.json",
    sha256: digest(description),
  });
  const sums = join(artifacts, "SHA256SUMS");
  writeFileSync(
    sums,
    [...files]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((file) => `${file.sha256}  ${file.name}\n`)
      .join(""),
  );
  return {
    identity: inventory.identity,
    files: [...files, { path: sums, name: "SHA256SUMS", sha256: digest(sums) }],
  };
}
