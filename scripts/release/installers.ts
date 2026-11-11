import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { commandLine, nonEmpty, requiredString, runCli } from "../cli.ts";
import { ROOT, digest, readJson, run, writeJson, type Runner } from "../io.ts";
import { extractBundle } from "./archives.ts";
import { requireFields, verifyBundle } from "./artifacts.ts";
import {
  installerFilename,
  installerNamed,
  nativeRecord,
  targetNamed,
} from "./contracts.ts";
import { validateVersion } from "./version.ts";

/** The app owns installer construction and input verification; root supplies admitted input/output paths. */
export function invokeInstaller(
  root: string,
  native: string,
  destination: string,
  compiler: string | undefined,
  command: Runner,
): void {
  const args = [
    "run",
    "--silent",
    "package:installer",
    "--",
    "--native",
    resolve(native),
    "--output",
    resolve(destination),
  ];
  if (compiler !== undefined) args.push("--iscc", resolve(compiler));
  const diagnostic = command("npm", args, join(root, "apps/holtburger-3d"));
  if (diagnostic.length > 0) console.log(diagnostic);
}

/** Validate source bytes and app output before recording the suite's installer receipt. */
export async function buildInstaller(
  root: string,
  artifacts: string,
  triple: string,
  output: string,
  compiler: string | undefined,
): Promise<string> {
  const target = targetNamed(triple),
    installer = installerNamed(triple);
  if (target.platform !== process.platform)
    throw new Error("Generate desktop installers on their native platform");
  const record = nativeRecord.parse(
    readJson(join(artifacts, `metadata-3d-${triple}.json`)),
  );
  validateVersion(record.version);
  const archive = join(artifacts, record.archive),
    expected = `holtburger-3d-${record.version}-${triple}.zip`;
  if (record.archive !== expected || digest(archive) !== record.sha256)
    throw new Error("Installer native archive digest/path mismatch");
  mkdirSync(output, { recursive: true });
  const destination = join(
      output,
      installerFilename(installer, record.version),
    ),
    work = mkdtempSync(join(tmpdir(), "holtburger-installer-input-"));
  try {
    const native = await extractBundle(archive, join(work, "native")),
      info = verifyBundle(native, root);
    if (info.product !== "3d" || info.target !== triple)
      throw new Error("Installer input product/target mismatch");
    requireFields(
      record,
      info,
      "Installer archive identity differs from its metadata",
    );
    invokeInstaller(root, native, destination, compiler, run);
    if (statSync(destination).size === 0)
      throw new Error("Generated installer is empty");
    writeJson(join(output, `metadata-3d-installer-${triple}.json`), {
      ...info,
      format: installer.format,
      installer: basename(destination),
      sha256: digest(destination),
      nativeArchiveSha256: record.sha256,
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return destination;
}

if (import.meta.main) {
  await runCli(
    commandLine("npm run release:installers --").command(
      "$0",
      "Build a platform installer from verified native artifacts",
      (builder) =>
        builder
          .option("artifacts", {
            ...requiredString,
            describe: "Native artifact directory",
          })
          .option("target", {
            ...requiredString,
            describe: "Native target triple",
          })
          .option("output", {
            ...requiredString,
            describe: "Installer destination directory",
          })
          .option("iscc", {
            type: "string",
            coerce: nonEmpty,
            describe: "Inno Setup compiler path",
          }),
      async (args) => {
        console.log(
          await buildInstaller(
            ROOT,
            resolve(args.artifacts),
            args.target,
            resolve(args.output),
            args.iscc,
          ),
        );
      },
    ),
  );
}
