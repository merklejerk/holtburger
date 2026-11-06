import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commandLine, requiredString, runCli } from "../cli.ts";
import { z } from "zod";
import { ROOT, readJson, sha256, digestSchema } from "../io.ts";
import { github, REPOSITORY, type GitHub } from "../github.ts";
import { readZip } from "./archives.ts";

/** The generated CLI installation admits exactly this pair of content files. */
export const CONTENT_FILES = ["bootstrap.hba", "navigation.hnav"] as const;
/** HNAV header contract checked during staging; the runtime owns complete decoding. */
export const NAVIGATION_FORMAT_VERSION = 4;
/** Eight-byte magic, two u32 values and a u64 payload location. */
export const NAVIGATION_HEADER_SIZE = 24;
/** Admitted pair, keeping filenames and payloads in one contract. */
export type ContentComponents = Record<(typeof CONTENT_FILES)[number], Buffer>;
/** Only this repository's pinned GitHub asset endpoints may receive credentials. */
export const contentDescriptor = z.object({
  url: z.string().refine((url) => {
    const prefix = `https://api.github.com/repos/${REPOSITORY}/releases/assets/`;
    return url.startsWith(prefix) && /^[0-9]+$/.test(url.slice(prefix.length));
  }),
  sha256: digestSchema,
});

/** Check format admission facts without duplicating runtime content codecs. */
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

/** Verify pinned bytes before decoding exact regular-file members, including duplicate checks. */
export async function archiveComponents(
  data: Buffer,
  expected: string,
): Promise<ContentComponents> {
  if (sha256(data) !== expected)
    throw new Error("CLI content ZIP SHA-256 mismatch");
  const entries = await readZip(data);
  const names = entries.map((entry) => entry.name);
  if (
    names.length !== CONTENT_FILES.length ||
    new Set(names).size !== CONTENT_FILES.length ||
    CONTENT_FILES.some((name) => !names.includes(name)) ||
    entries.some((entry) => entry.kind !== "file")
  )
    throw new Error(
      "CLI content must contain exactly bootstrap.hba and navigation.hnav",
    );
  const components = z
    .object({
      "bootstrap.hba": z.instanceof(Buffer),
      "navigation.hnav": z.instanceof(Buffer),
    })
    .parse(
      Object.fromEntries(
        entries.flatMap((entry) =>
          entry.kind === "file" ? [[entry.name, entry.data]] : [],
        ),
      ),
    );
  validateComponents(components);
  return components;
}

/** Stage the pair and original receipt without overwriting files or broken symlinks. */
export async function unpackContent(
  data: Buffer,
  expected: string,
  output: string,
): Promise<void> {
  const components = await archiveComponents(data, expected);
  const files = { ...components, "cli-content.zip": data };
  for (const name of Object.keys(files))
    if (lstatSync(join(output, name), { throwIfNoEntry: false }) !== undefined)
      throw new Error(`Refusing to replace existing CLI content: ${name}`);
  mkdirSync(output, { recursive: true });
  for (const [name, bytes] of Object.entries(files))
    writeFileSync(join(output, name), bytes, { flag: "wx" });
}

/** Bind extracted files to the original pinned ZIP retained during staging. */
export async function verifyStagedContent(
  directory: string,
  expected: string,
): Promise<void> {
  const parts = await archiveComponents(
    readFileSync(join(directory, "cli-content.zip")),
    expected,
  );
  for (const name of CONTENT_FILES)
    if (!readFileSync(join(directory, name)).equals(parts[name]))
      throw new Error(`Staged CLI ${name} differs from the pinned ZIP`);
}

/** Fetch only after admitting the complete descriptor, keeping auth in GitHub CLI. */
export async function fetchContent(
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
  await unpackContent(bytes, pinned.sha256, output);
  console.log(`Verified CLI content: ${pinned.sha256}`);
}

if (import.meta.main) {
  await runCli(
    commandLine("npm run content:<command> --")
      .command(
        "fetch <output>",
        "Download and verify the pinned CLI content archive",
        (builder) =>
          builder.positional("output", {
            ...requiredString,
            describe: "New content destination directory",
          }),
        async (args) => {
          await fetchContent(
            readJson(join(ROOT, ".github/cli-content.json")),
            args.output,
            github,
          );
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
          await unpackContent(
            readFileSync(args.archive),
            args.sha256,
            args.output,
          );
          console.log(`Verified CLI content: ${args.sha256}`);
        },
      )
      .demandCommand(1),
  );
}
