import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { compare } from "semver";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	appBuildSchema,
	releaseVersionSchema,
	SOURCE_REVISION_LENGTH,
} from "../src/app/app-build-contract";
import { readAppBuild } from "./app-build";

const cases: {
	comparisons: { left: string; right: string; expected: number }[];
	invalidReleaseVersions: string[];
} = JSON.parse(
	readFileSync(
		new URL("../../../release/semver-cases.json", import.meta.url),
		"utf8",
	),
);

describe("release build identity", () => {
	afterEach(() => vi.unstubAllEnvs());

	it("uses the same SemVer examples as release tooling", () => {
		for (const { left, right, expected } of cases.comparisons) {
			expect(
				compare(
					releaseVersionSchema.parse(left),
					releaseVersionSchema.parse(right),
				),
			).toBe(expected);
		}
		for (const version of cases.invalidReleaseVersions)
			expect(releaseVersionSchema.safeParse(version).success).toBe(false);
	});

	it("captures the explicit channel for an ordinary beta version", () => {
		const root = mkdtempSync(resolve(tmpdir(), "holtburger-build-"));
		try {
			const app = resolve(root, "apps/holtburger-3d");
			mkdirSync(app, { recursive: true });
			mkdirSync(resolve(root, "release"));
			writeFileSync(
				resolve(app, "package.json"),
				JSON.stringify({ version: "0.2.0" }),
			);
			writeFileSync(
				resolve(root, "release/channel.json"),
				JSON.stringify("beta"),
			);
			vi.stubEnv("HOLTBURGER_SOURCE_REVISION", "abcdef1234567890");
			vi.stubEnv("HOLTBURGER_SOURCE_MODIFIED", "0");
			expect(readAppBuild(app, false)).toEqual({
				version: "0.2.0",
				channel: "beta",
				kind: "release",
				revision: "abcdef12",
				modified: false,
				development: false,
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects a beta identity with a prerelease suffix", () => {
		expect(
			appBuildSchema.safeParse({
				version: "0.2.0-beta.1",
				channel: "beta",
				kind: "release",
				revision: "abcdef12",
				modified: false,
				development: false,
			}).success,
		).toBe(false);
	});

	it("admits nightly versions only when their short hash matches the captured revision", () => {
		const revision = "a".repeat(SOURCE_REVISION_LENGTH);
		const build = {
			version: `0.2.0-nightly-${revision}`,
			channel: "beta",
			kind: "nightly",
			revision,
			modified: false,
			development: false,
		};
		expect(appBuildSchema.parse(build)).toEqual(build);
		for (const suffix of [
			"b".repeat(SOURCE_REVISION_LENGTH),
			revision.slice(1),
			`${revision}b`,
			"a".repeat(40),
		])
			expect(
				appBuildSchema.safeParse({
					...build,
					version: `0.2.0-nightly-${suffix}`,
				}).success,
			).toBe(false);
	});
});
