import { describe, expect, it } from "vitest";
import type { TextureResourceDependencies } from "./placement";
import {
	collectTextureLeaseResourceIds,
	createTextureLeaseSet,
	EMPTY_TEXTURE_LEASE_SET,
} from "./leases";

describe("texture lease sets", () => {
	it("creates immutable residency data from texture dependencies", () => {
		const dependencies = [
			createDependency("terrain-a"),
			createDependency("terrain-b"),
		];

		const leaseSet = createTextureLeaseSet(dependencies);

		expect(leaseSet.dependencies).toEqual(dependencies);
		expect(leaseSet.dependencies).not.toBe(dependencies);
		expect(collectTextureLeaseResourceIds(leaseSet)).toEqual([
			"terrain-a",
			"terrain-b",
		]);
	});

	it("rejects duplicate resource ids instead of hiding producer ambiguity", () => {
		expect(() =>
			createTextureLeaseSet([
				createDependency("terrain-a"),
				createDependency("terrain-a"),
			]),
		).toThrow("Texture lease set contains duplicate resource id terrain-a.");
	});

	it("provides an empty lease set singleton", () => {
		expect(EMPTY_TEXTURE_LEASE_SET.dependencies).toEqual([]);
		expect(collectTextureLeaseResourceIds(EMPTY_TEXTURE_LEASE_SET)).toEqual([]);
	});
});

function createDependency(resourceId: string): TextureResourceDependencies {
	return {
		resourceId,
		roles: [
			{
				itemIds: [`${resourceId}:texture`],
				purpose: "terrain-color",
			},
		],
	};
}
