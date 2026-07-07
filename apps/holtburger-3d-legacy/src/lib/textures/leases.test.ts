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

	it("coalesces duplicate resource ids into one lease dependency", () => {
		const leaseSet = createTextureLeaseSet([
			createDependency("visual-a", [
				{ itemIds: ["base-a", "base-a"], purpose: "object-base-color" },
			]),
			createDependency("visual-b", [
				{ itemIds: ["base-b"], purpose: "object-base-color" },
			]),
			createDependency("visual-a", [
				{ itemIds: ["detail-a"], purpose: "object-detail" },
				{ itemIds: ["base-a", "base-c"], purpose: "object-base-color" },
			]),
		]);

		expect(leaseSet.dependencies).toEqual([
			{
				resourceId: "visual-a",
				roles: [
					{
						itemIds: ["base-a", "base-c"],
						purpose: "object-base-color",
					},
					{
						itemIds: ["detail-a"],
						purpose: "object-detail",
					},
				],
			},
			{
				resourceId: "visual-b",
				roles: [
					{
						itemIds: ["base-b"],
						purpose: "object-base-color",
					},
				],
			},
		]);
	});

	it("provides an empty lease set singleton", () => {
		expect(EMPTY_TEXTURE_LEASE_SET.dependencies).toEqual([]);
		expect(collectTextureLeaseResourceIds(EMPTY_TEXTURE_LEASE_SET)).toEqual([]);
	});
});

function createDependency(
	resourceId: string,
	roles: TextureResourceDependencies["roles"] = [
		{
			itemIds: [`${resourceId}:texture`],
			purpose: "terrain-color",
		},
	],
): TextureResourceDependencies {
	return {
		resourceId,
		roles,
	};
}
