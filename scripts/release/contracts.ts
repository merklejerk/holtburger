import { z } from "zod";
import { digestSchema } from "../io.ts";
import { distributionKind, releaseChannel } from "./version.ts";
import { commitSchema } from "./identity.ts";

/** Supported product names are also used in artifact names and Flatpak identities. */
export const productSchema = z.enum(["cli", "3d"]);
/** Target facts consumed by build matrices, native inspectors and archive naming. */
export const TARGETS = [
  {
    triple: "x86_64-unknown-linux-gnu",
    runner: "ubuntu-22.04",
    platform: "linux",
    architecture: "x64",
  },
  {
    triple: "x86_64-pc-windows-msvc",
    runner: "windows-2022",
    platform: "win32",
    architecture: "x64",
  },
  {
    triple: "aarch64-apple-darwin",
    runner: "macos-15",
    platform: "darwin",
    architecture: "arm64",
  },
] as const;
/** Required installer formats and canonical filename suffixes. */
export const INSTALLER_TARGETS = [
  {
    triple: "x86_64-pc-windows-msvc",
    format: "inno-setup",
    suffix: "-setup.exe",
  },
  { triple: "aarch64-apple-darwin", format: "dmg", suffix: ".dmg" },
] as const;
/** A supported native build selected at the external target boundary. */
export type NativeTarget = (typeof TARGETS)[number];
/** A supported desktop installer contract. */
export type InstallerTarget = (typeof INSTALLER_TARGETS)[number];
/** The complete product inventory; diagnostic selection is handled by the planner. */
export const PRODUCTS = productSchema.options;
/** Runtime facts shared by independently built archives, Flatpaks and installers. */
export const identityFields = z.object({
  /** Effective suite version. */
  version: z.string(),
  /** Original full source revision. */
  commit: commitSchema,
  /** Dirty local builds are diagnostic-only. */
  modified: z.boolean(),
  /** Explicit source audience. */
  channel: releaseChannel,
  /** Distinguishes release and nightly update behavior. */
  kind: distributionKind,
  /** Original suite notice document's byte identity. */
  noticesSha256: digestSchema,
});
/** CLI content stays one composite receipt, never independent unbound digests. */
export const contentFields = {
  contentSha256: digestSchema.describe("Pinned generated ZIP identity"),
  contentFiles: z
    .strictObject({
      "bootstrap.hba": digestSchema,
      "navigation.hnav": digestSchema,
    })
    .describe("Exact extracted companion identities"),
};
/** Native identity is kept lossless so generated receipts retain platform evidence. */
const bundleFields = identityFields
  .extend({ target: z.string() })
  .passthrough();
/** CLI and 3D payloads have different required content contracts. */
export const bundleInfo = z.discriminatedUnion("product", [
  bundleFields.extend({ product: z.literal("cli"), ...contentFields }),
  bundleFields.extend({ product: z.literal("3d") }),
]);
/** Validated native installation metadata used by packaging and installers. */
export type BundleInfo = z.infer<typeof bundleInfo>;
/** Downloadable native archive receipt. */
export const nativeRecord = z.discriminatedUnion("product", [
  bundleFields.extend({
    product: z.literal("cli"),
    ...contentFields,
    archive: z.string(),
    sha256: digestSchema,
  }),
  bundleFields.extend({
    product: z.literal("3d"),
    archive: z.string(),
    sha256: digestSchema,
  }),
]);
/** Flatpak receipt adds its installation identity/runtime to the native facts. */
export const flatpakRecord = z.discriminatedUnion("product", [
  bundleFields.extend({
    product: z.literal("cli"),
    ...contentFields,
    archive: z.string(),
    sha256: digestSchema,
    appId: z.string(),
    runtime: z.string(),
  }),
  bundleFields.extend({
    product: z.literal("3d"),
    archive: z.string(),
    sha256: digestSchema,
    appId: z.string(),
    runtime: z.string(),
  }),
]);
/** Installer identity additionally binds the source archive used for wrapping. */
export const installerRecord = bundleFields.extend({
  product: z.literal("3d"),
  format: z.string(),
  nativeArchiveSha256: digestSchema,
  installer: z.string(),
  sha256: digestSchema,
});
/** Complete managed release description, admitted independently of the local checkout. */
export const manifestSchema = identityFields.omit({ modified: true }).extend({
  schemaVersion: z.literal(2),
  native: z.array(nativeRecord),
  flatpaks: z.array(flatpakRecord),
  installers: z.array(installerRecord),
  assets: z.array(z.object({ name: z.string(), sha256: digestSchema })),
});

/** Reject unknown target spellings before choosing any platform policy. */
export function targetNamed(triple: string): NativeTarget {
  const target = TARGETS.find((entry) => entry.triple === triple);
  if (target === undefined)
    throw new Error(`Unsupported native target: ${triple}`);
  return target;
}

/** Installer lookup admits only the two declared desktop formats. */
export function installerNamed(triple: string): InstallerTarget {
  const target = INSTALLER_TARGETS.find((entry) => entry.triple === triple);
  if (target === undefined)
    throw new Error(`Unsupported installer target: ${triple}`);
  return target;
}

/** Canonical downloadable installer name. */
export function installerFilename(
  installer: InstallerTarget,
  version: string,
): string {
  return `holtburger-3d-${version}-${installer.triple}${installer.suffix}`;
}

/** Canonical source runtime reference for both products' Flatpak receipts. */
export function flatpakRuntimeRef(recipe: unknown): string {
  const runtime = z
    .object({ runtime: z.string(), "runtime-version": z.string() })
    .parse(recipe);
  return `${runtime.runtime}/x86_64/${runtime["runtime-version"]}`;
}
