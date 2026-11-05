import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";

/** Dependency-free filesystem primitives shared by repository and app packaging tools. */
export function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Hash the actual file bytes, including any native signatures. */
export function digest(path: string): string {
  return sha256(readFileSync(path));
}

/** Traverse a native tree deterministically without following symbolic links. */
export function walk(root: string): string[] {
  return readdirSync(root)
    .sort()
    .flatMap((name) => {
      const path = join(root, name);
      return lstatSync(path).isDirectory() ? [path, ...walk(path)] : [path];
    });
}

/** Compare complete installed trees, preserving byte, link and executable-mode guarantees. */
export function verifyPayload(native: string, installed: string): void {
  const expected = walk(native).map((path) => relative(native, path));
  if (
    !isDeepStrictEqual(
      walk(installed).map((path) => relative(installed, path)),
      expected,
    )
  )
    throw new Error(
      "Installed payload inventory differs from its native input",
    );
  for (const name of expected) {
    const source = join(native, name),
      destination = join(installed, name);
    const a = lstatSync(source),
      b = lstatSync(destination);
    if (a.isSymbolicLink()) {
      if (
        !b.isSymbolicLink() ||
        readlinkSync(source) !== readlinkSync(destination)
      )
        throw new Error(`Installed payload link differs: ${name}`);
    } else if (a.isFile()) {
      if (!b.isFile() || digest(source) !== digest(destination))
        throw new Error(`Installed payload file differs: ${name}`);
      if (process.platform !== "win32" && (a.mode & 0o111) !== (b.mode & 0o111))
        throw new Error(`Installed payload executable mode differs: ${name}`);
    } else if (!b.isDirectory())
      throw new Error(`Installed payload directory differs: ${name}`);
  }
}
