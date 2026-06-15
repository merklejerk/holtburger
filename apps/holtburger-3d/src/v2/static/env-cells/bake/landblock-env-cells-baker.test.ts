import { describe, expect, it } from "vitest";
import type {
	EnvCellCellStructureGeometryAttachment,
	LandblockEnvCellStaticFacts,
	StaticBakeBatchInput,
} from "../../contracts";
import { bakeLandblockEnvCells } from "./landblock-env-cells-baker";
import { createEnvCellCellStructureGeometryIdentity } from "./landblock-env-cell-geometry-attachments";

describe("V2 landblock env-cell baker", () => {
	it("emits typed env-cell peer records without draw units", () => {
		const input = createInput();
		const result = bakeLandblockEnvCells(input);

		expect(result).toMatchObject({
			buildRevision: 42,
			domain: "landblock-env-cells",
			drawUnits: [],
			materialCoverage: [
				expect.objectContaining({
					domain: "landblock-env-cells",
					materialCount: 1,
					triangleCount: 0,
				}),
			],
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

	it("requires full geometry attachments for renderable cell structures", () => {
		const input = createInputWithRenderableCellStructure();

		expect(() => bakeLandblockEnvCells(input)).toThrow(
			"Missing env-cell cell-structure geometry attachment env-cell-cell-structure-geometry|landblock:da55ffff|env-cell:da550100|environment:0e000001|cell-structure:0d000001.",
		);
	});

	it("accepts full geometry attachments for resolver-light cell structures", () => {
		const input = createInputWithRenderableCellStructure();
		const envCell = requireFirstEnvCell(input);

		const result = bakeLandblockEnvCells({
			...input,
			attachments: {
				envCellCellStructureGeometry: [createGeometryAttachment(envCell)],
				staticObjectSourceGeometry: [],
			},
		});

		expect(result.staticSpatialRecords).toHaveLength(1);
		expect(result.drawUnits).toHaveLength(1);
		expect(result.drawUnits[0]).toMatchObject({
			cellStructure: {
				cellStructureId: 0x0d000001,
				kind: "cell-structure",
			},
			coordinateSpace: "landblock-render-local",
			domain: "landblock-env-cells",
			drawUnitId:
				"7:landblock:da55ffff:landblock-env-cells:structured-interior:da550100:0d000001",
			envCellId: 0xda550100,
			kind: "structured-interior-geometry",
			landblockId: 0xda55ffff,
			materialPlan: [
				{
					fallbackReasons: [
						{
							code: "missing-cell-structure-material-source",
							material: {
								kind: "static-material-source",
								materialId: 0x08000010,
							},
							surfaceId: 0x08000010,
						},
					],
					family: "structured-interior-debug-flat",
					outcome: "render-deferred",
					pass: "opaque",
					slotId: 0,
					surfaceId: 0x08000010,
					textureUseIds: [],
				},
			],
			materialFamily: "structured-interior-debug-flat",
			materialIds: [0x08000010],
			sourceTriangleIds: [
				"polygon:1|surface:134217744|first:0|variant:none",
			],
			surfaceIds: [0x08000010],
			textureUseIds: [],
			triangleCount: 1,
			vertexCount: 3,
		});
		const drawUnit = result.drawUnits[0];
		if (!drawUnit || drawUnit.kind !== "structured-interior-geometry") {
			throw new Error("Expected structured interior geometry draw unit.");
		}
		expect(Array.from(drawUnit.indices)).toEqual([0, 1, 2]);
		expect(Array.from(drawUnit.texCoords)).toEqual([0, 0, 1, 0, 0, 1]);
		expect(result.textureUses).toEqual([]);
		expect(result.materialCoverage).toEqual([
			expect.objectContaining({
				buckets: [
					{
						family: "unsupported",
						filteringMode: "none",
						materialCount: 1,
						outcome: "render-deferred",
						partitionCount: 1,
						pass: "opaque",
						textureRoleCount: 0,
						triangleCount: 1,
					},
				],
				deferredTriangleCount: 1,
				domain: "landblock-env-cells",
				fallbackReasonCounts: [
					{ code: "missing-cell-structure-material-source", count: 1 },
				],
				fallbackReasonCount: 1,
				landblockId: 0xda55ffff,
				materialCount: 1,
				renderedTriangleCount: 0,
				triangleCount: 1,
				unrenderedBuckets: [
					{
						family: "unsupported",
						materialCount: 1,
						outcome: "render-deferred",
						partitionCount: 1,
						pass: "opaque",
						reasonCodes: ["missing-cell-structure-material-source"],
						triangleCount: 1,
					},
				],
			}),
		]);
	});

	it("bakes env-cell local placement into render-local positions", () => {
		const input = createInputWithRenderableCellStructure({
			localPlacement: {
				orientation: { w: 1, x: 0, y: 0, z: 0 },
				origin: { x: 10, y: 20, z: 30 },
			},
		});
		const envCell = requireFirstEnvCell(input);

		const result = bakeLandblockEnvCells({
			...input,
			attachments: {
				envCellCellStructureGeometry: [
					createGeometryAttachment(envCell, {
						positions: new Float32Array([0, 1, 0, 0, 0, 1, 1, 0, 0]),
					}),
				],
				staticObjectSourceGeometry: [],
			},
		});
		const drawUnit = result.drawUnits[0];
		if (!drawUnit || drawUnit.kind !== "structured-interior-geometry") {
			throw new Error("Expected structured interior geometry draw unit.");
		}

		expect(Array.from(drawUnit.positions)).toEqual([
			10, 31, -20, 10, 30, -19, 11, 30, -20,
		]);
	});
});

function createInputWithRenderableCellStructure(
	options: {
		readonly localPlacement?: LandblockEnvCellStaticFacts["localPlacement"];
	} = {},
): StaticBakeBatchInput {
	const input = createInput();
	const item = input.items[0];
	if (!item) {
		throw new Error("Missing fixture item.");
	}
	const scope = item.payload.scope;
	if (scope?.kind !== "landblock-env-cells") {
		throw new Error("Missing fixture env-cell scope.");
	}
	const envCell = scope.envCells[0];
	if (!envCell) {
		throw new Error("Missing fixture env cell.");
	}

	return {
		...input,
		attachments: {
			envCellCellStructureGeometry: [],
			staticObjectSourceGeometry: [],
		},
		items: [
			{
				...item,
				payload: {
					...item.payload,
					scope: {
						...scope,
						envCells: [
							{
								...envCell,
								renderGeometry: {
									...envCell.renderGeometry,
									sourceId: 0xda550100,
									surfaceIds: [0x08000010],
									triangleCount: 1,
									triangles: [
										{
											firstVertex: 0,
											materialVariantSignature: null,
											polygonId: 1,
											surfaceId: 0x08000010,
										},
									],
									vertexCount: 3,
								},
								localPlacement:
									options.localPlacement ?? envCell.localPlacement,
							},
						],
					},
				},
			},
		],
	};
}

function requireFirstEnvCell(
	input: StaticBakeBatchInput,
): LandblockEnvCellStaticFacts {
	const item = input.items[0];
	if (!item || item.payload.scope.kind !== "landblock-env-cells") {
		throw new Error("Missing fixture env-cell scope.");
	}
	const envCell = item.payload.scope.envCells[0];
	if (!envCell) {
		throw new Error("Missing fixture env cell.");
	}

	return envCell;
}

function createGeometryAttachment(
	envCell: LandblockEnvCellStaticFacts,
	options: {
		readonly positions?: Float32Array;
	} = {},
): EnvCellCellStructureGeometryAttachment {
	return {
		bounds: envCell.renderGeometry.bounds,
		identity: createEnvCellCellStructureGeometryIdentity({ envCell }),
		invalidPolygons: [],
		normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
		positions:
			options.positions ?? new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		skippedPolygonCount: 0,
		sourceId: envCell.renderGeometry.sourceId,
		surfaceIds: [0x08000010],
		triangleCount: envCell.renderGeometry.triangleCount,
		triangles: [
			{
				firstVertex: 0,
				materialVariantSignature: null,
				polygonId: 1,
				surfaceId: 0x08000010,
			},
		],
		uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
		vertexCount: envCell.renderGeometry.vertexCount,
	};
}

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
			envCellCellStructureGeometry: [],
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
