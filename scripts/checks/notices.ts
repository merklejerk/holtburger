import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { commandLine, nonEmpty, runCli } from "../cli.ts";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import {
  digest,
  digestSchema,
  ROOT,
  readJson,
  run,
  sha256,
  writeJson,
} from "../io.ts";

/** Pinned generator whose license matching/reporting behavior is part of this receipt. */
export const CARGO_ABOUT_VERSION = "0.9.3";
/** Public suite notice document and its generated provenance receipt. */
export const NOTICE_PATH = ".github/licenses/THIRD_PARTY_NOTICES.html";
/** Input/output digests bind the generated document without requiring network for checks. */
export const INPUT_RECORD_PATH =
  ".github/licenses/THIRD_PARTY_NOTICES.inputs.json";
/** Reject unresolved template attribution near a license heading, preserving appendix examples. */
const placeholder = /Copyright[^\n]*(?:<year>|<owner>|<copyright holders>)/i;
const nativeNotices = z.object({
  packages: z.record(z.string(), z.string()),
  files: z.array(
    z.object({
      path: z.string(),
      component: z.string(),
      sourceUrl: z.string(),
      encoding: z.string(),
      sha256: digestSchema,
    }),
  ),
});
const crate = z.object({
  name: z.string(),
  version: z.string(),
  authors: z.array(z.string()).optional(),
});
const reportSchema = z.object({
  crates: z.array(z.object({ package: crate })),
  licenses: z.array(
    z.object({
      name: z.string(),
      text: z.string(),
      used_by: z.array(z.object({ crate })),
    }),
  ),
});

/** Plain license text is preserved verbatim after HTML decoding. */
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
}

/** Fingerprint all true generator inputs, including the root tooling graph and helper module. */
export function inputDigest(root: string): string {
  const workspace = z
    .object({ workspace: z.object({ members: z.array(z.string()) }) })
    .parse(parseToml(readFileSync(join(root, "Cargo.toml"), "utf8")));
  const native = nativeNotices.parse(
    readJson(join(root, ".github/native-notices.json")),
  );
  const paths = new Set([
    "Cargo.toml",
    "Cargo.lock",
    "LICENSE.md",
    ".github/about.toml",
    ".github/native-notices.json",
    "scripts/checks/notices.ts",
    "scripts/io.ts",
    "scripts/cli.ts",
    "scripts/filesystem.ts",
    "package.json",
    "package-lock.json",
    ...workspace.workspace.members.map((member) => `${member}/Cargo.toml`),
    ...native.files.map((notice) => `.github/${notice.path}`),
  ]);
  const hashes = Object.fromEntries(
    [...paths].sort().map((path) => [path, digest(join(root, path))]),
  );
  return sha256(Buffer.from(JSON.stringify(hashes)));
}

/** Verify committed receipts without installing cargo-about or contacting the network. */
export function checkNotices(root: string): void {
  for (const path of [NOTICE_PATH, INPUT_RECORD_PATH])
    if (!existsSync(join(root, path)))
      throw new Error(
        `Missing committed notices file: ${path}. Run npm run generate:notices.`,
      );
  const receipt = z
    .object({ inputsSha256: digestSchema, noticesSha256: digestSchema })
    .parse(readJson(join(root, INPUT_RECORD_PATH)));
  if (receipt.inputsSha256 !== inputDigest(root))
    throw new Error(
      "Notice inputs changed since local generation. Run npm run generate:notices.",
    );
  if (receipt.noticesSha256 !== digest(join(root, NOTICE_PATH)))
    throw new Error(
      "Committed notice output differs from its generated digest",
    );
  console.log(`Committed notices are current: ${NOTICE_PATH}`);
}

/** Preserve upstream texts/qualifications while refusing unreviewed native versions and attributions. */
export function renderNotices(
  document: unknown,
  nativeManifest: string,
): string {
  const report = reportSchema.parse(document),
    native = nativeNotices.parse(readJson(nativeManifest));
  for (const [name, version] of Object.entries(native.packages)) {
    const versions = new Set(
      report.crates
        .filter((entry) => entry.package.name === name)
        .map((entry) => entry.package.version),
    );
    if (versions.size !== 1 || !versions.has(version))
      throw new Error(
        `Native notices need review for ${name}: ${[...versions]}`,
      );
  }
  const sections = [
    '<!doctype html><html lang="en"><meta charset="utf-8">',
    "<title>Holtburger third-party notices</title>",
    "<style>body{max-width:75em;margin:2em auto;padding:0 1em}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>",
    "<h1>Holtburger third-party notices</h1>",
    `<p>Rust runtime and build dependencies across the release targets, generated with cargo-about ${CARGO_ABOUT_VERSION}. Electron/Chromium and font notices are also included inside the h3d application.</p>`,
  ];
  for (const license of report.licenses) {
    let text = license.text;
    const used = license.used_by.map((usage) => usage.crate);
    if (placeholder.test(text.slice(0, 400))) {
      // This package has published MIT metadata but no original standalone notice.
      // Its actual ICU data remains covered by the separately pinned native appendix.
      if (
        used.length === 0 ||
        used.some(
          (item) =>
            item.name !== "deno_core_icudata" || item.version !== "0.74.0",
        )
      )
        throw new Error(
          `Unresolved template attribution: ${used.map((item) => `${item.name} ${item.version}`).join(", ")}`,
        );
      text = text.replace(placeholder, "");
      const authors = z
        .object({ authors: z.array(z.string()) })
        .parse(used[0])
        .authors.join(", ");
      sections.push(
        `<p>deno_core_icudata 0.74.0: MIT license declared in published package metadata; no original standalone notice was supplied. The text below is the canonical license with its template attribution omitted. Published authors: ${escapeHtml(authors)}. ICU data notices follow separately.</p>`,
      );
    }
    sections.push(`<h2>${escapeHtml(license.name)}</h2><ul>`);
    for (const item of used)
      sections.push(
        `<li>${escapeHtml(item.name)} ${escapeHtml(item.version)}</li>`,
      );
    sections.push(`</ul><pre>${escapeHtml(text)}</pre>`);
  }
  sections.push("<h1>Native libraries and packaging helpers</h1>");
  if (native.files.length === 0)
    throw new Error("No embedded native-library notices");
  const directory = realpathSync(dirname(nativeManifest));
  for (const notice of native.files) {
    const path = realpathSync(resolve(directory, notice.path));
    const rel = relative(directory, path);
    if (rel === ".." || rel.startsWith(`..${sep}`))
      throw new Error("Native notice path escapes its source directory");
    const data = readFileSync(path);
    const text = new TextDecoder(notice.encoding, { fatal: true }).decode(data);
    if (!text.trim() || sha256(data) !== notice.sha256)
      throw new Error(`Native notice digest/contents mismatch: ${notice.path}`);
    sections.push(
      `<h2>${escapeHtml(notice.component)}: ${escapeHtml(basename(path))}</h2><p><a href="${escapeHtml(notice.sourceUrl)}">Original pinned source</a></p><pre>${escapeHtml(text)}</pre>`,
    );
  }
  return `${sections.join("\n")}\n</html>\n`;
}

/** Regenerate only with the pinned tool and stable inputs, then record the actual output. */
export function generateNotices(root: string, tool: string): void {
  const inputs = inputDigest(root);
  if (run(tool, ["--version"], root) !== `cargo-about ${CARGO_ABOUT_VERSION}`)
    throw new Error(`Expected cargo-about ${CARGO_ABOUT_VERSION}`);
  const temporary = mkdtempSync(join(tmpdir(), "holtburger-notices-"));
  try {
    const report = join(temporary, "report.json");
    run(
      tool,
      [
        "generate",
        "--locked",
        "--fail",
        "--workspace",
        "--config",
        join(root, ".github/about.toml"),
        "--format",
        "json",
        "--output-file",
        report,
      ],
      root,
    );
    const html = renderNotices(
      readJson(report),
      join(root, ".github/native-notices.json"),
    );
    if (inputDigest(root) !== inputs)
      throw new Error(
        "Notice inputs changed during generation; rerun with stable inputs",
      );
    mkdirSync(dirname(join(root, NOTICE_PATH)), { recursive: true });
    writeFileSync(join(root, NOTICE_PATH), html);
    writeJson(join(root, INPUT_RECORD_PATH), {
      inputsSha256: inputs,
      noticesSha256: sha256(Buffer.from(html)),
    });
    checkNotices(root);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  await runCli(
    commandLine("npm run <check:notices|generate:notices> --")
      .command(
        "tool-version",
        "Print the required cargo-about version",
        {},
        () => {
          console.log(CARGO_ABOUT_VERSION);
        },
      )
      .command(
        "check",
        "Verify checked-in notices against locked inputs",
        {},
        () => {
          checkNotices(ROOT);
        },
      )
      .command(
        "generate",
        "Regenerate notices using the pinned cargo-about",
        (builder) =>
          builder.option("cargo-about", {
            type: "string",
            default: "cargo-about",
            coerce: nonEmpty,
            describe: "cargo-about executable path",
          }),
        (args) => {
          generateNotices(ROOT, args.cargoAbout);
        },
      )
      .demandCommand(1),
  );
}
