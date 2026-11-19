import { expect, it } from "vitest";
import {
	RELEASE_HISTORY_LIMIT,
	releaseHistoryFeedSchema,
} from "./release-history-contract";

const releases = [
	{ version: "0.10.0", tag: "v0.10.0", notes: "Newest notes" },
	{ version: "0.9.0", tag: "v0.9.0", notes: "Older notes" },
];

it("admits descending semantic versions and an older omitted boundary", () => {
	expect(
		releaseHistoryFeedSchema.parse({
			schemaVersion: 2,
			releases,
			omittedVersion: "0.8.0",
		}).releases,
	).toEqual(releases);
});

it("rejects ambiguous, inconsistent or empty release history", () => {
	for (const history of [
		[],
		[{ version: "bad", tag: "vbad", notes: "Notes" }, releases[1]],
		[
			{
				version: "0.999999999999999999999.0",
				tag: "v0.999999999999999999999.0",
				notes: "Notes",
			},
			releases[1],
		],
		[...releases].reverse(),
		[releases[0], releases[0]],
		[{ ...releases[0], tag: "https://example.invalid" }],
		[{ ...releases[0], notes: " " }],
		[
			{
				...releases[0],
				version: "0.10.0-nightly-abcdef12",
				tag: "v0.10.0-nightly-abcdef12",
			},
		],
		Array.from({ length: RELEASE_HISTORY_LIMIT + 1 }, (_, index) => ({
			version: `0.0.${RELEASE_HISTORY_LIMIT - index}`,
			tag: `v0.0.${RELEASE_HISTORY_LIMIT - index}`,
			notes: "Notes",
		})),
	])
		expect(
			releaseHistoryFeedSchema.safeParse({
				schemaVersion: 2,
				releases: history,
				omittedVersion: null,
			}).success,
		).toBe(false);
	for (const omittedVersion of ["0.9.0", "0.10.0", "0.11.0", "bad"])
		expect(
			releaseHistoryFeedSchema.safeParse({
				schemaVersion: 2,
				releases,
				omittedVersion,
			}).success,
		).toBe(false);
});
