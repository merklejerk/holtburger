import { gt, valid } from "semver";
import { z } from "zod";

/** Public history retention, shared by the publisher and native reader. */
export const RELEASE_HISTORY_LIMIT = 10;

/** Published beta identities use canonical release versions, without suffixes or metadata. */
const versionSchema = z
	.string()
	.refine(
		(value) =>
			/^0\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(value) &&
			valid(value) === value,
		"Expected a canonical beta release version",
	);

/** Notes come from the immutable source commit recorded in the verified release manifest. */
export const releaseChangelogSchema = z
	.object({
		/** Canonical release version, used for native selection and display. */
		version: versionSchema,
		/** Native browser navigation appends only this validated tag to a fixed repository URL. */
		tag: z.string(),
		/** Reviewed Markdown; presentation does not permit embedded HTML or remote media. */
		notes: z.string().trim().min(1),
	})
	.strict()
	.refine(
		(release) => release.tag === `v${release.version}`,
		"Release tag must match its version",
	);

/** Nonempty release groups let consumers read the latest entry without fallback identities. */
export const releaseChangelogsSchema = z
	.tuple([releaseChangelogSchema])
	.rest(releaseChangelogSchema)
	.refine(
		(releases) => releases.length <= RELEASE_HISTORY_LIMIT,
		"Release history exceeds retention",
	)
	// Transforms run only after child validation; SemVer must never inspect rejected strings.
	.transform((releases, context) => {
		if (
			!releases.every(
				(release, index) =>
					index === 0 || gt(releases[index - 1].version, release.version),
			)
		) {
			context.addIssue({
				code: "custom",
				message: "Release history versions must decrease strictly",
			});
			return z.NEVER;
		}
		return releases;
	});

/** Versioned public document; legacy beta.json remains available to already shipped clients. */
export const releaseHistoryFeedSchema = z
	.object({
		/** History format is independent of application versions. */
		schemaVersion: z.literal(2),
		/** Newest verified beta first, including at most the retention limit. */
		releases: releaseChangelogsSchema,
		/** Newest excluded release detects missing changes relative to the installed version. */
		omittedVersion: versionSchema.nullable(),
	})
	.strict()
	.transform((feed, context) => {
		if (
			feed.omittedVersion !== null &&
			!gt(feed.releases[feed.releases.length - 1].version, feed.omittedVersion)
		) {
			context.addIssue({
				code: "custom",
				message: "Omitted release must predate retained history",
			});
			return z.NEVER;
		}
		return feed;
	});

/** Validated publisher output and native input share one contract. */
export type ReleaseHistoryFeed = z.infer<typeof releaseHistoryFeedSchema>;
