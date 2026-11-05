import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse as parseIni } from "ini";
import { z } from "zod";
import { digest, readJson, writeJson, type Runner } from "../io.ts";
import { verifyPayload } from "../filesystem.ts";
import { extractBundle } from "./archives.ts";
import {
  executableArchitecture,
  requireFields,
  TOOLS,
  verifyBundle,
} from "./artifacts.ts";
import {
  bundleInfo,
  flatpakRuntimeRef,
  nativeRecord,
  productSchema,
  type BundleInfo,
} from "./contracts.ts";
import { commitSchema } from "./identity.ts";
import { sourceFacts } from "./source.ts";

/** Expanded flatpak-builder source policy; other source kinds retain their own fields. */
const sourceSchema = z
  .object({ path: z.string().optional(), dest: z.string().optional() })
  .passthrough();
const recipeSchema = z
  .object({
    id: z.string(),
    runtime: z.string(),
    "runtime-version": z.string(),
    sdk: z.string(),
    modules: z.array(
      z
        .object({ name: z.string(), sources: z.array(sourceSchema) })
        .passthrough(),
    ),
  })
  .passthrough();

/** Each product retains its owning recipe while sharing the Freedesktop runtime generation. */
export function recipePath(root: string, product: string): string {
  return productSchema.parse(product) === "cli"
    ? join(
        root,
        "apps/holtburger-cli/dist/io.github.merklejerk.holtburger-cli.yaml",
      )
    : join(root, ".github/flatpak/io.github.merklejerk.holtburger-3d.json");
}

/** Expand imports without allowing builder cache state to modify the source checkout. */
export function flatpakRecipe(
  root: string,
  product: string,
  command: Runner,
): z.infer<typeof recipeSchema> {
  const temporary = mkdtempSync(join(tmpdir(), "holtburger-flatpak-manifest-"));
  try {
    const recipe = recipeSchema.parse(
      JSON.parse(
        command(
          "flatpak-builder",
          ["--show-manifest", recipePath(root, product)],
          temporary,
        ),
      ),
    );
    const runtime = z
      .object({
        runtime: z.string(),
        "runtime-version": z.string(),
        sdk: z.string(),
      })
      .parse(readJson(recipePath(root, "3d")));
    return { ...recipe, ...runtime };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

/** Admit only inspected Linux x86-64 bytes for the clean source distribution. */
export function requireFlatpakRelease(
  info: BundleInfo,
  root: string,
  env: Readonly<NodeJS.ProcessEnv>,
): void {
  if (info.target !== "x86_64-unknown-linux-gnu")
    throw new Error("The release Flatpaks require Linux x86-64 inputs");
  const source = sourceFacts(root, env);
  if (source.modified)
    throw new Error(
      "Flatpak source checkout contains unexpected modifications",
    );
  requireFields(
    info,
    {
      commit: source.identity.commit,
      version: source.identity.version,
      modified: false,
    },
    "Flatpak input does not match the clean release identity",
  );
}

/** Inspect installed identity/runtime using the standard INI metadata format. */
export function installedRuntime(files: string, recipe: unknown): string {
  const admitted = recipeSchema.parse(recipe);
  const metadata = z
    .object({
      Application: z.object({ name: z.string(), runtime: z.string() }),
    })
    .parse(parseIni(readFileSync(join(files, "../metadata"), "utf8")));
  if (metadata.Application.name !== admitted.id)
    throw new Error("Installed Flatpak application ID differs from its recipe");
  const runtime = flatpakRuntimeRef(admitted);
  if (metadata.Application.runtime !== runtime)
    throw new Error("Installed Flatpak runtime differs from its recipe");
  return runtime;
}

/** Substitute the already-inspected native payload without rebuilding it inside Flatpak. */
export function flatpakManifest(
  root: string,
  native: string,
  output: string,
  env: Readonly<NodeJS.ProcessEnv>,
  command: Runner,
): void {
  const info = verifyBundle(native, root);
  requireFlatpakRelease(info, root, env);
  const path = recipePath(root, info.product),
    recipe = flatpakRecipe(root, info.product, command);
  const modules = recipe.modules.filter(
    (module) => module.name === `holtburger-${info.product}`,
  );
  if (modules.length !== 1)
    throw new Error("Flatpak recipe requires exactly one product module");
  const sources = modules[0].sources.filter(
    (source) => source.dest === "bundle",
  );
  if (sources.length !== 1)
    throw new Error(
      "Flatpak recipe requires exactly one native payload source",
    );
  sources[0].path = resolve(native);
  for (const dependency of recipe.modules)
    for (const source of dependency.sources)
      if (source.path !== undefined)
        source.path = resolve(dirname(path), source.path);

  mkdirSync(dirname(output), { recursive: true });
  writeJson(output, recipe);
}

/** Retain a verified native directory beside the manifest for the next builder step. */
export async function prepareFlatpak(
  root: string,
  artifacts: string,
  product: string,
  output: string,
  env: Readonly<NodeJS.ProcessEnv>,
  command: Runner,
): Promise<string> {
  productSchema.parse(product);
  const record = nativeRecord.parse(
    readJson(
      join(artifacts, `metadata-${product}-x86_64-unknown-linux-gnu.json`),
    ),
  );
  requireFlatpakRelease(record, root, env);
  if (record.product !== product)
    throw new Error("Flatpak input product differs from the requested product");
  const archive = resolve(artifacts, record.archive);
  if (
    dirname(archive) !== resolve(artifacts) ||
    digest(archive) !== record.sha256
  )
    throw new Error("Flatpak input archive digest/path mismatch");
  mkdirSync(dirname(output), { recursive: true });
  const extracted = mkdtempSync(
    join(dirname(output), `${product}-flatpak-input-`),
  );
  try {
    const native = await extractBundle(archive, extracted),
      info = bundleInfo.parse(readJson(join(native, "build-info.json")));
    requireFields(
      record,
      info,
      "Flatpak archive metadata differs from its native input",
    );
    flatpakManifest(root, native, output, env, command);
    return resolve(native);
  } catch (error) {
    rmSync(extracted, { recursive: true, force: true });
    throw error;
  }
}

/** Bind installed payloads, helper provenance and runtime to a distributable Flatpak. */
export function recordFlatpak(
  root: string,
  files: string,
  native: string,
  bundle: string,
  output: string,
  env: Readonly<NodeJS.ProcessEnv>,
  command: Runner,
): void {
  const info = verifyBundle(native, root),
    installed = join(files, "lib/holtburger");
  if (!isDeepStrictEqual(readJson(join(installed, "build-info.json")), info))
    throw new Error("Installed Flatpak identity differs from its native input");
  requireFlatpakRelease(info, root, env);
  verifyPayload(native, installed);
  let helper: { sandboxHelperCommit: string } | Record<string, never> = {};
  if (info.product === "cli") {
    for (const tool of TOOLS)
      if (
        readlinkSync(join(files, "bin", tool)) !== `/app/lib/holtburger/${tool}`
      )
        throw new Error(`Installed Flatpak tool entry differs: ${tool}`);
  } else {
    const recipes = join(root, ".github/flatpak");
    if (
      digest(join(files, "bin/holtburger-3d")) !==
      digest(join(recipes, "holtburger-3d"))
    )
      throw new Error(
        "Installed Flatpak launcher differs from the sandbox wrapper",
      );
    for (const component of ["zypak", "nickle"])
      if (
        digest(join(files, `share/licenses/${component}/LICENSE`)) !==
        digest(join(root, `.github/licenses/native/${component}/LICENSE`))
      )
        throw new Error(
          `Installed Flatpak helper notice needs review: ${component}`,
        );
    for (const executable of ["zypak-helper", "zypak-sandbox"])
      if (executableArchitecture(join(files, "bin", executable)) !== "x64")
        throw new Error(
          `Installed Flatpak helper architecture differs: ${executable}`,
        );
    helper = {
      sandboxHelperCommit: z
        .object({
          sources: z
            .tuple([z.object({ commit: commitSchema })])
            .rest(z.unknown()),
        })
        .parse(readJson(join(recipes, "zypak.json"))).sources[0].commit,
    };
  }
  const recipe = flatpakRecipe(root, info.product, command),
    runtime = installedRuntime(files, recipe);
  if (statSync(bundle).size === 0) throw new Error("Empty Flatpak bundle");
  mkdirSync(dirname(output), { recursive: true });
  writeJson(output, {
    ...info,
    ...helper,
    appId: recipe.id,
    runtime,
    archive: basename(bundle),
    sha256: digest(bundle),
  });
}
