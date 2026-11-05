import {
  createWriteStream,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { crc32 } from "node:zlib";
import { fromBufferPromise } from "yauzl";
import { ZipFile } from "yazl";
import * as tar from "tar";

/** Lossless ZIP contents with kind classified once at the archive boundary. */
export type ArchiveEntry = { readonly name: string; readonly mode: number } & (
  | { readonly kind: "file"; readonly data: Buffer }
  | { readonly kind: "symlink"; readonly target: string }
  | { readonly kind: "directory" }
);

/** Decode exact members, retaining duplicates for admission checks and validating CRCs. */
export async function readZip(data: Buffer): Promise<readonly ArchiveEntry[]> {
  const zip = await fromBufferPromise(data, {
    lazyEntries: true,
    strictFileNames: true,
  });
  const entries: ArchiveEntry[] = [];
  try {
    for await (const entry of zip.eachEntry()) {
      const mode = entry.externalFileAttributes >>> 16;
      if (entry.fileName.endsWith("/")) {
        entries.push({ name: entry.fileName, mode, kind: "directory" });
        continue;
      }
      const stream = await zip.openReadStreamPromise(entry);
      const bytes = Buffer.concat(await stream.toArray());
      if (crc32(bytes) !== entry.crc32)
        throw new Error(`ZIP CRC mismatch: ${entry.fileName}`);
      if ((mode & 0o170000) === 0o120000)
        entries.push({
          name: entry.fileName,
          mode,
          kind: "symlink",
          target: bytes.toString("utf8"),
        });
      else
        entries.push({ name: entry.fileName, mode, kind: "file", data: bytes });
    }
  } finally {
    zip.close();
  }
  return entries;
}

/** One owner forwards ZIP input failures and synchronous admission errors into the output pipeline. */
async function createZip(
  destination: string,
  populate: (zip: ZipFile) => void,
): Promise<void> {
  const zip = new ZipFile();
  const output = Readable.from(zip.outputStream);
  zip.on("error", (error: Error) => output.destroy(error));
  const completed = pipeline(output, createWriteStream(destination));
  try {
    populate(zip);
    zip.end();
  } catch (error) {
    output.destroy(error instanceof Error ? error : new Error(String(error)));
  }
  await completed;
}

/** Write ZIP members with Unix modes and link targets, including framework links. */
export async function writeZip(
  entries: readonly ArchiveEntry[],
  destination: string,
): Promise<void> {
  await createZip(destination, (zip) => {
    for (const entry of entries) {
      if (entry.kind === "directory")
        zip.addEmptyDirectory(entry.name, { mode: entry.mode });
      else
        zip.addBuffer(
          entry.kind === "file" ? entry.data : Buffer.from(entry.target),
          entry.name,
          { mode: entry.mode },
        );
    }
  });
}

/** Stream regular files while recording links without following them. */
function addDirectory(zip: ZipFile, directory: string, name: string): void {
  const info = lstatSync(directory);
  if (info.isSymbolicLink())
    zip.addBuffer(Buffer.from(readlinkSync(directory)), name, {
      mode: info.mode,
      mtime: info.mtime,
    });
  else if (info.isFile())
    zip.addFile(directory, name, { mode: info.mode, mtime: info.mtime });
  else if (info.isDirectory()) {
    zip.addEmptyDirectory(name, { mode: info.mode, mtime: info.mtime });
    for (const child of readdirSync(directory).sort())
      addDirectory(zip, join(directory, child), `${name}/${child}`);
  } else throw new Error(`Unsupported archive source: ${directory}`);
}

/** Archive a native installation using TAR on Linux and ZIP on desktop platforms. */
export async function archiveBundle(
  bundle: string,
  destination: string,
  platform: string,
): Promise<void> {
  if (platform === "linux")
    await tar.c({ file: destination, cwd: dirname(bundle), gzip: true }, [
      basename(bundle),
    ]);
  else
    await createZip(destination, (zip) =>
      addDirectory(zip, bundle, basename(bundle)),
    );
}

/** Resolve an admitted relative member/link while rejecting escapes from the extraction root. */
function contained(root: string, path: string): string {
  if (isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.includes("\\"))
    throw new Error(`Archive path escapes installation: ${path}`);
  const target = resolve(root, path);
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${sep}`))
    throw new Error(`Archive path escapes installation: ${path}`);
  return target;
}

/** Refuse existing ancestor links so extraction never writes through another installation. */
function checkAncestors(root: string, target: string): void {
  let parent = dirname(target);
  while (parent !== root) {
    try {
      if (lstatSync(parent).isSymbolicLink())
        throw new Error(`Archive ancestor is a symbolic link: ${parent}`);
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    const next = dirname(parent);
    if (next === parent)
      throw new Error(`Archive path has no extraction root: ${target}`);
    parent = next;
  }
}

/** Validate the whole member/link graph before making any output file. */
function validateEntries(
  root: string,
  entries: readonly { name: string; target?: string }[],
): void {
  const names = new Set<string>();
  const links = new Set(
    entries
      .filter((entry) => entry.target !== undefined)
      .map((entry) => posix.normalize(entry.name)),
  );
  for (const entry of entries) {
    const normalized = posix.normalize(entry.name).replace(/\/$/, "");
    if (names.has(normalized))
      throw new Error(`Duplicate archive member: ${entry.name}`);
    names.add(normalized);
    const path = contained(root, entry.name);
    if (path === root)
      throw new Error("Archive member cannot replace extraction root");
    if (entry.target !== undefined) {
      if (isAbsolute(entry.target) || /^[A-Za-z]:/.test(entry.target))
        throw new Error(`Archive link escapes installation: ${entry.name}`);
      contained(root, posix.join(posix.dirname(entry.name), entry.target));
    }
    for (const link of links)
      if (normalized.startsWith(`${link}/`))
        throw new Error(`Archive member traverses a link: ${entry.name}`);
    checkAncestors(root, path);
  }
}

/** Extract into an owned directory; valid framework links and executable modes survive. */
export async function extractBundle(
  archive: string,
  destination: string,
): Promise<string> {
  mkdirSync(destination, { recursive: true });
  const root = realpathSync(destination);
  if (archive.endsWith(".tar.gz")) {
    const headers: { type: string; path: string; linkpath?: string }[] = [];
    await tar.t({
      file: archive,
      strict: true,
      onReadEntry: (entry) => {
        headers.push({
          type: entry.type,
          path: entry.path,
          linkpath: entry.linkpath,
        });
      },
    });
    const entries = headers.map((entry) => {
      if (!["File", "Directory", "SymbolicLink", "Link"].includes(entry.type))
        throw new Error(`Unsupported TAR member: ${entry.path}`);
      if (entry.type !== "SymbolicLink" && entry.type !== "Link")
        return { name: entry.path };
      if (entry.linkpath === undefined || entry.linkpath.length === 0)
        throw new Error(`TAR link has no target: ${entry.path}`);
      if (isAbsolute(entry.linkpath))
        throw new Error(`Archive link escapes installation: ${entry.path}`);
      return {
        name: entry.path,
        target:
          entry.type === "SymbolicLink"
            ? entry.linkpath
            : posix.relative(posix.dirname(entry.path), entry.linkpath),
      };
    });
    validateEntries(root, entries);
    await tar.x({ file: archive, cwd: root, strict: true });
  } else {
    const entries = await readZip(readFileSync(archive));
    validateEntries(
      root,
      entries.map((entry) =>
        entry.kind === "symlink"
          ? { name: entry.name, target: entry.target }
          : { name: entry.name },
      ),
    );
    // Files precede links so even valid links cannot redirect writes during extraction.
    for (const entry of entries.filter((entry) => entry.kind !== "symlink")) {
      const path = contained(root, entry.name);
      if (entry.kind === "directory") mkdirSync(path, { recursive: true });
      else {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, entry.data, { flag: "wx" });
        if (entry.mode !== 0) chmodSync(path, entry.mode & 0o777);
      }
    }
    for (const entry of entries)
      if (entry.kind === "symlink")
        symlinkSync(entry.target, contained(root, entry.name));
  }
  const children = readdirSync(root);
  if (
    children.length !== 1 ||
    !lstatSync(join(root, children[0])).isDirectory()
  )
    throw new Error("Bundle archive must contain one installation directory");
  return join(root, children[0]);
}
