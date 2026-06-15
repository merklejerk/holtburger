import { describe, expect, it } from "vitest";
import type { StaticBakeBatchInput } from "../../contracts";
import { bakeLandblockEnvCells } from "./landblock-env-cells-baker";

describe("V2 landblock env-cell baker", () => {
	it("emits typed env-cell peer records without draw units", () => {
		const input = createInput();
		const result = bakeLandblockEnvCells(input);

		expect(result).toMatchObject({
			buildRevision: 42,
			domain: "landblock-env-cells",
			drawUnits: [],
			materialCoverage: [],
			staticBatchId: "env-batch-a",
			textureUses: [],
			works: [input.items[0]?.work],
		});
		expect(result.staticSpatialRecords).toEqual([
			expect.objectContaining({
				envCellId: 0xda550100,
				kind: "env-cell-spatial",
				landblockId: 0xda55ffff,
				localBvhItemCount: 1,
				localBvhNodeCount: 1,
				owner: expect.objectContaining({
					kind: "work",
					scopeKey: "landblock:da55ffff",
					workId: "7:landblock:da55ffff:landblock-env-cells",
				}),
				renderBounds: {
					max: { x: 1, y: 2, z: 3 },
					min: { x: -1, y: -2, z: -3 },
				},
				residencyBvhItemCount: 1,
				residencyBvhNodeCount: 1,
			}),
		]);
		expect(result.staticVisibilityRecords).toEqual([
			expect.objectContaining({
				acceptedEnvCellIds: [0xda550100],
				kind: "env-cell-visibility",
				visibleLinks: [
					{
						sourceEnvCellId: 0xda550100,
						targetEnvCellId: 0xda550101,
					},
				],
			}),
		]);
		expect(result.staticPortalInteriorRecords).toEqual([
			expect.objectContaining({
				envCells: [
					{
						envCellId: 0xda550100,
						portalApertures: [],
						portals: [],
					},
				],
				kind: "env-cell-portal-interior",
				portalLinks: [],
			}),
		]);
		expect(result.staticSourceMappings).toEqual([
			expect.objectContaining({
				envCellId: 0xda550100,
				kind: "env-cell-source",
				surfaces: [
					{
						material: {
							kind: "static-material-source",
							materialId: 0x08000010,
						},
						slotId: 0,
						surfaceId: 0x08000010,
					},
				],
			}),
		]);
		expect(result.staticAuthoredDynamicSeeds).toEqual([
			expect.objectContaining({
				envCellId: 0xda550100,
				kind: "env-cell-static-object-seed",
				seed: expect.objectContaining({
					sourceIndex: 0,
				}),
			}),
		]);
	});

	it("rejects non-env-cell batches", () => {
		expect(() =>
			bakeLandblockEnvCells({
				...createInput(),
				domain: "outdoor-terrain",
			}),
		).toThrow(
			"Landblock env-cell baker only supports landblock env-cell batches. Received outdoor-terrain.",
		);
	});
});

function createInput(): StaticBakeBatchInput {
	const work = {
		job: {
			domain: "landblock-env-cells" as const,
			scope: {
				kind: "landblock" as const,
				landblockId: 0xda55ffff,
			},
		},
		priority: 5,
		revision: 7,
		workId: "7:landblock:da55ffff:landblock-env-cells",
	};

	return {
		atlasSnapshot: {
			domain: "landblock-env-cells",
			placements: [],
			staticBatchId: "env-batch-a",
			textureUses: [],
		},
		attachments: {
			staticObjectSourceGeometry: [],
		},
		domain: "landblock-env-cells",
		items: [
			{
				payload: {
					job: work.job,
					scope: {
						acceptedEnvCellIds: [0xda550100],
						envCells: [
							{
								cellBsp: {
									kind: "leaf",
									polyIds: [],
									solid: 0,
									sphere: null,
								},
								cellStructure: {
									cellStructureId: 0x0d000001,
									kind: "cell-structure",
								},
								environment: {
									environmentId: 0x0e000001,
									kind: "environment",
								},
								identity: {
									envCellId: 0xda550100,
									kind: "env-cell-source",
								},
								landblockId: 0xda55ffff,
								localPlacement: {
									orientation: { w: 1, x: 0, y: 0, z: 0 },
									origin: { x: 0, y: 0, z: 0 },
								},
								localSpatial: {
									localBvh: {
										items: [],
										nodes: [],
									},
									localBvhItemCount: 1,
									localBvhNodeCount: 1,
								},
								memberId: "cell-0",
								portalApertures: [],
								portals: [],
								renderGeometry: {
									bounds: {
										max: { x: 1, y: 2, z: 3 },
										min: { x: -1, y: -2, z: -3 },
									},
									invalidPolygons: [],
									normals: [],
									positions: [],
									skippedPolygonCount: 0,
									sourceId: 0xda550100,
									surfaceIds: [],
									triangleCount: 0,
									triangles: [],
									uvs: [],
									vertexCount: 0,
								},
								restrictionObjectId: null,
								seenOutside: null,
								staticObjectSeeds: [
									{
										debug: {
											sourceAssetId: "gfxobj/01000020",
										},
										identity: {
											instanceId: "env-cell-static-0",
											kind: "static-object-instance",
											landblockId: 0xda55ffff,
											objectKind: "explicit-object",
										},
										instanceBounds: null,
										localPlacement: {
											orientation: { w: 1, x: 0, y: 0, z: 0 },
											origin: { x: 1, y: 2, z: 3 },
										},
										source: {
											kind: "static-object-source",
											sourceAssetKind: "gfx-obj",
											sourceDid: 0x01000020,
										},
										sourceBounds: null,
										sourceIndex: 0,
										sourceScale: null,
									},
								],
								surfaces: [
									{
										material: {
											kind: "static-material-source",
											materialId: 0x08000010,
										},
										slotId: 0,
										surfaceId: 0x08000010,
									},
								],
								visibleEnvCellIds: [0xda550101],
							},
						],
						kind: "landblock-env-cells",
						landblock: {
							kind: "landblock-source",
							landblockId: 0xda55ffff,
							source: "env-cells",
						},
						missingRefs: [],
						portalLinks: [],
						regionRenderProfile: {
							kind: "region-render-profile",
							regionNumber: 1,
						},
						residencySpatial: {
							landblockEnvCellBvh: {
								items: [],
								nodes: [],
							},
							landblockEnvCellBvhItemCount: 1,
							landblockEnvCellBvhNodeCount: 1,
						},
						visibilityDiagnostics: [],
					},
					sourceRevision: 42,
				},
				work,
			},
		],
		revision: 7,
		staticBatchId: "env-batch-a",
	};
}
