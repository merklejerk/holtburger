import { join } from "node:path";
import { z } from "zod";
import { readJson } from "../io.ts";

/** The TUI owns its shipped-file selection; release tooling admits only unique flat filenames. */
export function cliScripts(root: string): readonly string[] {
  const files = z
    .array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/))
    .parse(readJson(join(root, "apps/holtburger-cli/scripts/bundle.json")));
  if (new Set(files).size !== files.length)
    throw new Error("TUI script bundle contains duplicate filenames");
  return files;
}
