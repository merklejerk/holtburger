import { valid } from "semver";
import { z } from "zod";

/** Release audience is independent of version suffixes and GitHub prerelease badges. */
export const releaseChannelSchema = z.enum(["alpha", "beta"]);

/** Canonical SemVer only; aliases such as a leading v are not release identities. */
export const releaseVersionSchema = z
	.string()
	.refine(
		(value) => valid(value) === value && !value.includes("+"),
		"Expected a canonical release SemVer without build metadata",
	);

/** The packaged renderer and native update owner consume the same captured identity. */
export const appBuildSchema = z
	.object({
		/** True only for a live Vite development server. */
		development: z.boolean(),
		/** Suite release version, owned by the Cargo/npm manifests. */
		version: releaseVersionSchema,
		/** Explicit audience used to select the update feed. */
		channel: releaseChannelSchema,
		/** Abbreviated source commit displayed beside the version. */
		revision: z.string().regex(/^[0-9a-f]{8}$/),
		/** Captures tracked, untracked and submodule changes at build time. */
		modified: z.boolean(),
	})
	.strict()
	.refine(
		(value) => value.channel !== "beta" || /^0\.\d+\.\d+$/.test(value.version),
		"Beta releases require an unsuffixed 0.x.y version",
	)
	.readonly();

/** Immutable build identity shared by native validation and frontend presentation. */
export type AppBuild = z.infer<typeof appBuildSchema>;
