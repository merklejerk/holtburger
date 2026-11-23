import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commandLine, requiredString, runCli, scalarChoice } from "../cli.ts";
import { z } from "zod";
import { ROOT, readJson, sha256, digestSchema } from "../io.ts";
import { github, REPOSITORY, type GitHub } from "../github.ts";
import { readZip } from "./archives.ts";
import { PRODUCTS } from "./contracts.ts";

/** The generated CLI installation admits exactly this pair of content files. */
export const CONTENT_FILES = ["bootstrap.hba", "navigation.hnav"] as const;
/** HNAV header contract checked during staging; the runtime owns complete decoding. */
export const NAVIGATION_FORMAT_VERSION = 4;
/** Eight-byte magic, two u32 values and a u64 payload location. */
export const NAVIGATION_HEADER_SIZE = 24;
/** Admitted pair, keeping filenames and payloads in one contract. */
export type ContentComponents = Record<(typeof CONTENT_FILES)[number], Buffer>;

/** The 3D Explorer release bundles exactly one compiled ACE weenie catalog. */
export const EXPLORER_CONTENT_FILES = ["weenies.hwc"] as const;
/** HWC header magic checked during staging; the runtime owns complete decoding. */
export const WEENIE_CATALOG_MAGIC = Buffer.from([
  0x48, 0x42, 0x57, 0x43, 0x41, 0x54, 0x00, 0x1a,
]);
/** HWC format version checked during staging; must match holtburger-weenie-catalog. */
export const WEENIE_CATALOG_FORMAT_VERSION = 11;
/** Fixed 64-byte HWC binary header size. */
export const WEENIE_CATALOG_HEADER_SIZE = 64;
/** Admitted Explorer catalog payload keyed by canonical filename. */
export type ExplorerContentComponents = Record<
  (typeof EXPLORER_CONTENT_FILES)[number],
  Buffer
>;

/** Only this repository's pinned GitHub asset endpoints may receive credentials. */
export const contentDescriptor = z.object({
  url: z.string().refine((url) => {
    const prefix = `https://api.github.com/repos/${REPOSITORY}/releases/assets/`;
    return url.startsWith(prefix) && /^[0-9]+$/.test(url.slice(prefix.length));
  }),
  sha256: digestSchema,
});

/** Check CLI format admission facts without duplicating runtime content codecs. */
export function validateComponents(parts: ContentComponents): void {
  if (!parts["bootstrap.hba"].subarray(0, 4).equals(Buffer.from("HBA\0")))
    throw new Error("CLI bootstrap payload has no HBA header");
  const nav = parts["navigation.hnav"];
  if (nav.length < NAVIGATION_HEADER_SIZE)
    throw new Error("CLI navigation header is truncated");
  if (!nav.subarray(0, 8).equals(Buffer.from("HLTBNAV\0")))
    throw new Error("CLI navigation payload has no navigation header");
  if (nav.readUInt32LE(8) !== NAVIGATION_FORMAT_VERSION)
    throw new Error(
      `Unsupported CLI navigation format: ${nav.readUInt32LE(8)}`,
    );
}

/** Check Explorer weenie catalog header invariants without duplicating the Rust codec. */
export function validateExplorerComponents(
  parts: ExplorerContentComponents,
): void {
  const catalog = parts["weenies.hwc"];
  if (catalog.length < WEENIE_CATALOG_HEADER_SIZE)
    throw new Error("Explorer weenie catalog header is truncated");
  if (!catalog.subarray(0, 8).equals(WEENIE_CATALOG_MAGIC))
    throw new Error("Explorer weenie catalog payload has no HBWCAT header");
  const version = catalog.readUInt32LE(8);
  if (version !== WEENIE_CATALOG_FORMAT_VERSION)
    throw new Error(`Unsupported Explorer weenie catalog format: ${version}`);
  const headerLength = catalog.readUInt32LE(12);
  if (headerLength !== WEENIE_CATALOG_HEADER_SIZE)
    throw new Error(
      `Unsupported Explorer weenie catalog header length: ${headerLength}`,
    );
  if (
    !catalog.subarray(20, 24).equals(Buffer.alloc(4)) ||
    !catalog.subarray(56, 64).equals(Buffer.alloc(8))
  )
    throw new Error(
      "Explorer weenie catalog reserved header bytes are nonzero",
    );
}

/** Verify pinned ZIP bytes and admit exact regular-file members before format checks. */
async function extractExactArchive<Name extends string>(
  label: string,
  expectedNames: readonly Name[],
  data: Buffer,
  expectedSha256: string,
): Promise<Record<Name, Buffer>> {
  if (sha256(data) !== expectedSha256)
    throw new Error(`${label} content ZIP SHA-256 mismatch`);
  const entries = await readZip(data);
  const names = entries.map((entry) => entry.name);
  if (
    names.length !== expectedNames.length ||
    new Set(names).size !== expectedNames.length ||
    expectedNames.some((name) => !names.includes(name)) ||
    entries.some((entry) => entry.kind !== "file")
  )
    throw new Error(
      `${label} content must contain exactly ${expectedNames.join(" and ")}`,
    );
  const entriesByName = new Map(
    entries.flatMap((entry) =>
      entry.kind === "file" ? [[entry.name, entry.data] as const] : [],
    ),
  );
  return Object.fromEntries(
    expectedNames.map((name) => [name, entriesByName.get(name)]),
  ) as Record<Name, Buffer>;
}

/** Write verified payloads and their pinned archive receipt without replacing existing files or symlinks. */
function stageFiles(
  label: string,
  files: Readonly<Record<string, Buffer>>,
  output: string,
): void {
  for (const name of Object.keys(files))
    if (lstatSync(join(output, name), { throwIfNoEntry: false }) !== undefined)
      throw new Error(`Refusing to replace existing ${label} content: ${name}`);
  mkdirSync(output, { recursive: true });
  for (const [name, bytes] of Object.entries(files))
    writeFileSync(join(output, name), bytes, { flag: "wx" });
}

/** Compare extracted files against the pinned ZIP retained during staging. */
async function verifyStagedArchive<Name extends string>(
  label: string,
  archiveName: string,
  expectedNames: readonly Name[],
  readArchive: (
    data: Buffer,
    expected: string,
  ) => Promise<Record<Name, Buffer>>,
  directory: string,
  expected: string,
): Promise<void> {
  const parts = await readArchive(
    readFileSync(join(directory, archiveName)),
    expected,
  );
  for (const name of expectedNames)
    if (!readFileSync(join(directory, name)).equals(parts[name]))
      throw new Error(`Staged ${label} ${name} differs from the pinned ZIP`);
}

/** Fetch only after admitting the complete descriptor, keeping auth in GitHub CLI. */
async function fetchPinnedContent(
  label: string,
  unpack: (data: Buffer, expected: string, output: string) => Promise<void>,
  descriptor: unknown,
  output: string,
  api: GitHub,
): Promise<void> {
  const pinned = contentDescriptor.parse(descriptor);
  const bytes = api([
    pinned.url,
    "--header",
    "Accept: application/octet-stream",
  ]);
  await unpack(bytes, pinned.sha256, output);
  console.log(`Verified ${label} content: ${pinned.sha256}`);
}

/** Verify pinned CLI bytes before decoding exact regular-file members, including duplicate checks. */
export async function archiveComponents(
  data: Buffer,
  expected: string,
): Promise<ContentComponents> {
  const components = await extractExactArchive(
    "CLI",
    CONTENT_FILES,
    data,
    expected,
  );
  validateComponents(components);
  return components;
}

/** Verify pinned Explorer bytes before admitting the exact compiled weenie catalog member. */
export async function explorerArchiveComponents(
  data: Buffer,
  expected: string,
): Promise<ExplorerContentComponents> {
  const components = await extractExactArchive(
    "Explorer",
    EXPLORER_CONTENT_FILES,
    data,
    expected,
  );
  validateExplorerComponents(components);
  return components;
}

/** Stage the CLI pair and original receipt without overwriting files or broken symlinks. */
export async function unpackContent(
  data: Buffer,
  expected: string,
  output: string,
): Promise<void> {
  const components = await archiveComponents(data, expected);
  stageFiles("CLI", { ...components, "cli-content.zip": data }, output);
}

/** Stage the Explorer catalog and original receipt without overwriting files or broken symlinks. */
export async function unpackExplorerContent(
  data: Buffer,
  expected: string,
  output: string,
): Promise<void> {
  const components = await explorerArchiveComponents(data, expected);
  stageFiles(
    "Explorer",
    { ...components, "explorer-content.zip": data },
    output,
  );
}

/** Bind extracted CLI files to the original pinned ZIP retained during staging. */
export async function verifyStagedContent(
  directory: string,
  expected: string,
): Promise<void> {
  await verifyStagedArchive(
    "CLI",
    "cli-content.zip",
    CONTENT_FILES,
    archiveComponents,
    directory,
    expected,
  );
}

/** Bind extracted Explorer catalog bytes to the original pinned ZIP retained during staging. */
export async function verifyStagedExplorerContent(
  directory: string,
  expected: string,
): Promise<void> {
  await verifyStagedArchive(
    "Explorer",
    "explorer-content.zip",
    EXPLORER_CONTENT_FILES,
    explorerArchiveComponents,
    directory,
    expected,
  );
}

/** Fetch only after admitting the complete CLI descriptor, keeping auth in GitHub CLI. */
export async function fetchContent(
  descriptor: unknown,
  output: string,
  api: GitHub,
): Promise<void> {
  await fetchPinnedContent("CLI", unpackContent, descriptor, output, api);
}

/** Fetch only after admitting the complete Explorer descriptor, keeping auth in GitHub CLI. */
export async function fetchExplorerContent(
  descriptor: unknown,
  output: string,
  api: GitHub,
): Promise<void> {
  await fetchPinnedContent(
    "Explorer",
    unpackExplorerContent,
    descriptor,
    output,
    api,
  );
}

if (import.meta.main) {
  await runCli(
    commandLine("npm run content:<command> --")
      .command(
        "fetch <output>",
        "Download and verify a pinned content archive",
        (builder) =>
          builder
            .positional("output", {
              ...requiredString,
              describe: "New content destination directory",
            })
            .option("product", {
              ...scalarChoice(PRODUCTS),
              default: "cli" as const,
              describe: "Product content descriptor to fetch",
            }),
        async (args) => {
          if (args.product === "cli") {
            await fetchContent(
              readJson(join(ROOT, ".github/cli-content.json")),
              args.output,
              github,
            );
          } else {
            await fetchExplorerContent(
              readJson(join(ROOT, ".github/explorer-content.json")),
              args.output,
              github,
            );
          }
        },
      )
      .command(
        "stage <archive>",
        "Verify and unpack an explicit content archive",
        (builder) =>
          builder
            .positional("archive", {
              ...requiredString,
              describe: "Input ZIP archive",
            })
            .option("product", {
              ...scalarChoice(PRODUCTS),
              default: "cli" as const,
              describe: "Product content contract to verify",
            })
            .option("sha256", {
              ...requiredString,
              describe: "Expected archive SHA-256",
              coerce: (value) => digestSchema.parse(value),
            })
            .option("output", {
              ...requiredString,
              describe: "New content destination directory",
            }),
        async (args) => {
          if (args.product === "cli") {
            await unpackContent(
              readFileSync(args.archive),
              args.sha256,
              args.output,
            );
            console.log(`Verified CLI content: ${args.sha256}`);
          } else {
            await unpackExplorerContent(
              readFileSync(args.archive),
              args.sha256,
              args.output,
            );
            console.log(`Verified Explorer content: ${args.sha256}`);
          }
        },
      )
      .demandCommand(1),
  );
}
