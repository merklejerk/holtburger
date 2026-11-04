import { valid } from "semver";
import { z } from "zod";

/** Release audience is independent of version suffixes and GitHub prerelease badges. */
export const releaseChannelSchema = z.literal("beta");

/** Canonical SemVer only; aliases such as a leading v are not release identities. */
export const releaseVersionSchema = z
	.string()
	.refine(
		(value) => valid(value) === value && !value.includes("+"),
		"Expected a canonical release SemVer without build metadata",
	);

/** Distribution kind controls version validation and native update eligibility. */
export const distributionKindSchema = z.enum(["release", "nightly"]);

/** The packaged renderer and native update owner consume the same captured identity. */
export const appBuildSchema = z
	.object({
		/** True only for a live Vite development server. */
		development: z.boolean(),
		/** Suite release version, owned by the Cargo/npm manifests. */
		version: releaseVersionSchema,
		/** Explicit audience used to select the update feed. */
		channel: releaseChannelSchema,
		/** Release builds check for updates; nightly builds never do. */
		kind: distributionKindSchema,
		/** Abbreviated source commit displayed beside the version. */
		revision: z.string().regex(/^[0-9a-f]{8}$/),
		/** Captures tracked, untracked and submodule changes at build time. */
		modified: z.boolean(),
	})
	.strict()
	.refine(
		(value) =>
			(value.kind === "release"
				? /^0\.\d+\.\d+$/
				: /^0\.\d+\.\d+-nightly-[0-9a-f]{40}$/
			).test(value.version),
		"Distribution version must match its release or nightly kind",
	)
	.readonly();

/** Immutable build identity shared by native validation and frontend presentation. */
export type AppBuild = z.infer<typeof appBuildSchema>;
