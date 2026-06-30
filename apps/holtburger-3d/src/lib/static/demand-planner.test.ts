import { describe, expect, it } from "vitest";
import { normalizeOutdoorLandblockId } from "../../lib/landblocks";
import { normalizeOutdoorLodRadii, planStaticDemand } from "./demand-planner";
import type { StaticDemand } from "./contracts";

describe("static demand planner", () => {
	it("clamps outdoor domain radii before producing layer tasks", () => {
		const focusLandblockId = 0xda55ffff;
		const { layerTasks } = planStaticDemand(
			createOutdoorDemand(focusLandblockId, {
				buildings: 9,
				detail: 1,
				envCells: 0,
				terrain: 1,
			}),
			7,
		);

		const terrainTasks = layerTasks.filter(
			(item) => item.domain === "outdoor-terrain",
		);
		const buildingTasks = layerTasks.filter(
			(item) => item.domain === "outdoor-buildings",
		);
		const explicitObjectTasks = layerTasks.filter(
			(item) => item.domain === "outdoor-explicit-objects",
		);
		const generatedSceneryTasks = layerTasks.filter(
			(item) => item.domain === "outdoor-generated-scenery",
		);

		expect(terrainTasks).toHaveLength(9);
		expect(buildingTasks).toHaveLength(9);
		expect(explicitObjectTasks).toHaveLength(9);
		expect(generatedSceneryTasks).toHaveLength(9);
		expect(layerTasks.every((item) => item.revision === 7)).toBe(true);
		expect(layerTasks.every((item) => item.scope.kind === "landblock")).toBe(
			true,
		);
		expect(layerTasks[0]).toMatchObject({
			domain: "outdoor-terrain",
			scope: {
				kind: "landblock",
				landblockId: normalizeOutdoorLandblockId(focusLandblockId),
			},
			priority: 0,
		});
	});

	it("does not put lifecycle policy, interest radii, or camera state on task source identity", () => {
		const [task] = planStaticDemand(
			createOutdoorDemand(0xda55ffff, {
				buildings: -1,
				detail: -1,
				envCells: -1,
				terrain: 0,
			}),
			3,
		).layerTasks;

		const sourceIdentity = {
			domain: task?.domain,
			scope: task?.scope,
		};
		expect(sourceIdentity).toEqual({
			domain: "outdoor-terrain",
			scope: {
				kind: "landblock",
				landblockId: 0xda55ffff,
			},
		});
		expect(JSON.stringify(sourceIdentity)).not.toContain("revision");
		expect(JSON.stringify(sourceIdentity)).not.toContain("priority");
		expect(JSON.stringify(sourceIdentity)).not.toContain("policy");
	});

	it("plans terrain-only interest as one LoD 0 source request", () => {
		const { sourceRequests } = planStaticDemand(
			createOutdoorDemand(0xda55ffff, {
				buildings: -1,
				detail: -1,
				envCells: -1,
				terrain: 0,
			}),
			3,
		);

		expect(sourceRequests).toEqual([
			{
				context: "outdoor",
				landblockId: 0xda55ffff,
				requestedLayers: [
					{
						kind: "terrain",
						targetOwnerKey: {
							kind: "terrain",
							landblockId: 0xda55ffff,
						},
					},
				],
				sourceLod: 0,
			},
		]);
	});

	it("plans full outdoor layer interest as one LoD 4 source request per landblock", () => {
		const { sourceRequests } = planStaticDemand(
			createOutdoorDemand(0xda55ffff, {
				buildings: 0,
				detail: 0,
				envCells: 0,
				terrain: 0,
			}),
			3,
		);

		expect(sourceRequests).toEqual([
			{
				context: "outdoor",
				landblockId: 0xda55ffff,
				requestedLayers: [
					{
						kind: "terrain",
						targetOwnerKey: {
							kind: "terrain",
							landblockId: 0xda55ffff,
						},
					},
					{
						kind: "outdoor-buildings",
						targetOwnerKey: {
							kind: "outdoor-buildings",
							landblockId: 0xda55ffff,
						},
					},
					{
						kind: "outdoor-explicit-objects",
						targetOwnerKey: {
							kind: "outdoor-explicit-objects",
							landblockId: 0xda55ffff,
						},
					},
					{
						kind: "outdoor-generated-scenery",
						targetOwnerKey: {
							kind: "outdoor-generated-scenery",
							landblockId: 0xda55ffff,
						},
					},
					{
						kind: "env-cell-system",
						targetOwnerKey: {
							kind: "env-cell-system",
							landblockId: 0xda55ffff,
						},
					},
				],
				sourceLod: 4,
			},
		]);
	});

	it("normalizes domain radii without letting non-terrain domains exceed terrain", () => {
		expect(
			normalizeOutdoorLodRadii({
				buildings: 3.9,
				detail: 2.1,
				envCells: 9,
				terrain: 1.8,
			}),
		).toEqual({
			buildings: 1,
			detail: 1,
			envCells: 1,
			terrain: 1,
		});
	});

	it("plans outdoor env-cell demand from env-cell coverage radius", () => {
		const { retainedLayerOwners, layerTasks } = planStaticDemand(
			createOutdoorDemand(0xda55ffff, {
				buildings: -1,
				detail: -1,
				envCells: 1,
				terrain: 1,
			}),
			4,
		);

		const envCellTasks = layerTasks.filter(
			(item) => item.domain === "env-cell-system",
		);

		expect(envCellTasks).toHaveLength(9);
		expect(envCellTasks[0]).toMatchObject({
			domain: "env-cell-system",
			scope: {
				kind: "landblock",
				landblockId: 0xda55ffff,
			},
			priority: 10,
			taskId: "4:landblock:da55ffff:env-cell-system",
		});
		expect(retainedLayerOwners).toContainEqual({
			kind: "env-cell-system",
			landblockId: 0xda55ffff,
		});
	});

	it("plans dungeon/interior demand with same-landblock building portal facts before env-cells", () => {
		const { retainedLayerOwners, layerTasks } = planStaticDemand(
			{
				location: {
					envCellId: 0xda550123,
					kind: "interior-cell",
					landblockId: 0xda550123,
				},
				lod: {
					buildings: -1,
					detail: -1,
					envCells: -1,
					terrain: -1,
				},
			},
			12,
		);

		expect(layerTasks).toMatchObject([
			{
				domain: "outdoor-buildings",
				scope: {
					kind: "landblock",
					landblockId: 0xda55ffff,
				},
				priority: 5,
				revision: 12,
				taskId: "12:landblock:da55ffff:outdoor-buildings",
			},
			{
				domain: "env-cell-system",
				scope: {
					kind: "landblock",
					landblockId: 0xda55ffff,
				},
				priority: 10,
				revision: 12,
				taskId: "12:landblock:da55ffff:env-cell-system",
			},
		]);
		expect(retainedLayerOwners).toEqual([
			{
				kind: "outdoor-buildings",
				landblockId: 0xda55ffff,
			},
			{
				kind: "env-cell-system",
				landblockId: 0xda55ffff,
			},
		]);
		expect(
			planStaticDemand(
				{
					location: {
						envCellId: 0xda550123,
						kind: "interior-cell",
						landblockId: 0xda550123,
					},
					lod: {
						buildings: -1,
						detail: -1,
						envCells: -1,
						terrain: -1,
					},
				},
				12,
			).sourceRequests,
		).toEqual([
			{
				context: "outdoor",
				landblockId: 0xda55ffff,
				requestedLayers: [
					{
						kind: "outdoor-buildings",
						targetOwnerKey: {
							kind: "outdoor-buildings",
							landblockId: 0xda55ffff,
						},
					},
					{
						kind: "env-cell-system",
						targetOwnerKey: {
							kind: "env-cell-system",
							landblockId: 0xda55ffff,
						},
					},
				],
				sourceLod: 4,
			},
		]);
	});

	it("does not expand interior-cell demand into neighboring outdoor source landblocks", () => {
		const { retainedLayerOwners, layerTasks } = planStaticDemand(
			{
				location: {
					envCellId: 0xda550123,
					kind: "interior-cell",
					landblockId: 0xda550123,
				},
				lod: {
					buildings: 4,
					detail: 4,
					envCells: 4,
					terrain: 4,
				},
			},
			13,
		);

		expect(
			layerTasks.map((item) => ({
				domain: item.domain,
				scope: item.scope,
			})),
		).toEqual([
			{
				domain: "outdoor-buildings",
				scope: {
					kind: "landblock",
					landblockId: 0xda55ffff,
				},
			},
			{
				domain: "env-cell-system",
				scope: {
					kind: "landblock",
					landblockId: 0xda55ffff,
				},
			},
		]);
		expect(new Set(layerTasks.map((item) => item.scope.landblockId))).toEqual(
			new Set([0xda55ffff]),
		);
		expect(retainedLayerOwners.map((owner) => owner.landblockId)).toEqual([
			0xda55ffff, 0xda55ffff,
		]);
	});
});

function createOutdoorDemand(
	landblockId: number,
	lod: StaticDemand["lod"],
): StaticDemand {
	return {
		location: {
			kind: "outdoor-landblock",
			landblockId,
		},
		lod,
	};
}
