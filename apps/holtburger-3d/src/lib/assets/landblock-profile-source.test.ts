import { describe, expect, it, vi } from "vitest";

import {
	CachedLandblockProfileSource,
	decodeLandblockProfile,
} from "./landblock-profile-source";

describe("landblock profile source", () => {
	it("decodes exact owners and preserves absence", () => {
		expect(
			decodeLandblockProfile(
				{
					landblockId: "0x0005ffff",
					traversalClass: "dungeon-only",
				},
				"0x0005ffff",
			),
		).toEqual({
			landblockId: "0x0005ffff",
			traversalClass: "dungeon-only",
		});
		expect(decodeLandblockProfile(null, "0x0005ffff")).toBeNull();
	});

	it("rejects malformed classes and returned owners", () => {
		expect(() =>
			decodeLandblockProfile(
				{
					landblockId: "0x0005ffff",
					traversalClass: "dungeon",
				},
				"0x0005ffff",
			),
		).toThrow();
		expect(() =>
			decodeLandblockProfile(
				{
					landblockId: "0x0006ffff",
					traversalClass: "dungeon-only",
				},
				"0x0005ffff",
			),
		).toThrow("returned 0x0006ffff");
	});

	it("deduplicates concurrent loads and caches null absence", async () => {
		const source = {
			loadLandblockProfile: vi
				.fn()
				.mockResolvedValueOnce(null)
				.mockResolvedValue({
					landblockId: "0x0005ffff",
					traversalClass: "dungeon-only" as const,
				}),
		};
		const cached = new CachedLandblockProfileSource(source);

		await expect(
			Promise.all([
				cached.loadLandblockProfile("0x0005ffff"),
				cached.loadLandblockProfile("0x0005ffff"),
			]),
		).resolves.toEqual([null, null]);
		expect(source.loadLandblockProfile).toHaveBeenCalledOnce();
		await expect(cached.loadLandblockProfile("0x0005ffff")).resolves.toBeNull();
		expect(source.loadLandblockProfile).toHaveBeenCalledOnce();
	});

	it("removes failed entries so a later request can retry", async () => {
		const source = {
			loadLandblockProfile: vi
				.fn()
				.mockRejectedValueOnce(new Error("temporary profile failure"))
				.mockResolvedValue({
					landblockId: "0x0005ffff",
					traversalClass: "dungeon-only" as const,
				}),
		};
		const cached = new CachedLandblockProfileSource(source);

		await expect(cached.loadLandblockProfile("0x0005ffff")).rejects.toThrow(
			"temporary profile failure",
		);
		await expect(cached.loadLandblockProfile("0x0005ffff")).resolves.toEqual({
			landblockId: "0x0005ffff",
			traversalClass: "dungeon-only",
		});
		expect(source.loadLandblockProfile).toHaveBeenCalledTimes(2);
	});
});
