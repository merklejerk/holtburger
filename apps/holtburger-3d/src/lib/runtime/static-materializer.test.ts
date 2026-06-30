import { describe, expect, it } from "vitest";
import type { TexturePlacementUpdate } from "../renderer/types";
import type {
	PreparedRgbaRenderSurfaceTextureUseIdentity,
	StaticBakeTextureUse,
	StaticCoordinatorCommitDelta,
	StaticDrawUnit,
	StaticObjectGeometryStaticDrawUnit,
	StaticMaterialTableEntry,
	StaticObjectVisualResource,
	StaticLayerPeerRecordOwner,
	TerrainGeometryStaticDrawUnit,
} from "../static/contracts";
import { materializeStaticCommit } from "./static-materializer";

describe("static materializer", () => {
	it("materializes static residency from committed texture bindings", () => {
		const drawUnit = createTerrainDrawUnit("terrain-textured", {
			textureUseIds: ["terrain-textured:prepared-texture:06000010"],
		});
		const textureUpdate = createTexturePlacementUpdate(drawUnit);

		const materialized = materializeStaticCommit({
			commit: createCommitDelta({
				addedDrawUnits: [drawUnit],
				textureUses: [createBakeTextureUse(drawUnit.drawUnitId)],
			}),
			textureUpdate,
		});

		expect(materialized.textureUpdate).toBe(textureUpdate);
		expect(materialized.staticSourceMappings).toEqual([]);
		expect(materialized.staticSpatialRecords).toEqual([]);
		expect(materialized.materializedDrawUnits).toEqual([drawUnit]);
		expect(materialized.portalApertureResources).toEqual([]);
		expect(materialized.removedResources).toEqual([]);
	});

	it("rejects textured draw units without committed texture bindings", () => {
		const drawUnit = createTerrainDrawUnit("terrain-textured", {
			textureUseIds: ["terrain-textured:prepared-texture:06000010"],
		});

		expect(() =>
			materializeStaticCommit({
				commit: createCommitDelta({
					addedDrawUnits: [drawUnit],
					textureUses: [createBakeTextureUse(drawUnit.drawUnitId)],
				}),
				textureUpdate: null,
			}),
		).toThrow(
			/terrain-textured is missing committed texture bindings for terrain-textured:prepared-texture:06000010/,
		);
	});

	it("materializes untextured draw units without a texture update", () => {
		const drawUnit = createTerrainDrawUnit("terrain-flat");

		const materialized = materializeStaticCommit({
			commit: createCommitDelta({
				addedDrawUnits: [drawUnit],
				textureUses: [],
			}),
			textureUpdate: null,
		});

		expect(materialized.materializedDrawUnits).toEqual([drawUnit]);
		expect(materialized.textureUpdate).toBeNull();
	});

	it("fine-splits static object tables by committed static role-page capacity", () => {
		const drawUnit = createStaticObjectDrawUnit("static-table", 5);
		const textureUpdate = createStaticObjectTexturePlacementUpdate(drawUnit);

		const materialized = materializeStaticCommit({
			commit: createCommitDelta({
				addedDrawUnits: [drawUnit],
				staticSpatialRecords: [
					{
						bounds: {
							max: { x: 2, y: 3, z: 4 },
							min: { x: 1, y: 2, z: 3 },
						},
						envCellId: 0xda550100,
						instanceId: "da550100:env-cell-static-0",
						kind: "env-cell-static-object-bounds",
						landblockId: 0xda55ffff,
						owner: createEnvCellLayerOwner(),
					},
				],
				textureUses: drawUnit.textureUseIds.map((textureUseId) =>
					createBakeTextureUse(
						drawUnit.drawUnitId,
						textureUseId,
						"outdoor-buildings",
					),
				),
			}),
			textureUpdate,
		});

		const addedDrawUnits = materialized.materializedDrawUnits;
		expect(addedDrawUnits.map((added) => added.drawUnitId)).toEqual([
			"static-table",
			"static-table#fine-1",
		]);
		expect(
			addedDrawUnits.map((added) =>
				added.kind === "static-object-geometry"
					? added.materialEntries.map((entry) => entry.slot)
					: [],
			),
		).toEqual([[0, 1, 2, 3], [0]]);
		expect(
			addedDrawUnits.map((added) =>
				added.kind === "static-object-geometry"
					? Array.from(added.materialSlotIndices)
					: [],
			),
		).toEqual([
			[0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3],
			[0, 0, 0],
		]);
		expect(
			addedDrawUnits.map((added) =>
				added.kind === "static-object-geometry" ? added.renderState : null,
			),
		).toEqual([drawUnit.renderState, drawUnit.renderState]);
		expect(materialized.textureUpdate?.textureBindings).toMatchObject([
			{
				owner: { drawUnitId: "static-table", kind: "draw-unit" },
				rolePage: { kind: "object-base-color", slot: 0 },
			},
			{
				owner: { drawUnitId: "static-table", kind: "draw-unit" },
				rolePage: { kind: "object-base-color", slot: 1 },
			},
			{
				owner: { drawUnitId: "static-table", kind: "draw-unit" },
				rolePage: { kind: "object-base-color", slot: 2 },
			},
			{
				owner: { drawUnitId: "static-table", kind: "draw-unit" },
				rolePage: { kind: "object-base-color", slot: 3 },
			},
			{
				owner: { drawUnitId: "static-table#fine-1", kind: "draw-unit" },
				rolePage: { kind: "object-base-color", slot: 0 },
			},
		]);
		expect(materialized.staticSourceMappings).toEqual([]);
		expect(
			addedDrawUnits.map((drawUnit) =>
				drawUnit.kind === "static-object-geometry"
					? drawUnit.sourceMappingCoverage.map((coverage) => ({
							materialSlot: coverage.materialSlot,
							polygonRange: coverage.polygonRange,
						}))
					: [],
			),
		).toEqual([
			[
				{ materialSlot: 0, polygonRange: { max: 0, min: 0 } },
				{ materialSlot: 1, polygonRange: { max: 1, min: 1 } },
				{ materialSlot: 2, polygonRange: { max: 2, min: 2 } },
				{ materialSlot: 3, polygonRange: { max: 3, min: 3 } },
			],
			[{ materialSlot: 0, polygonRange: { max: 4, min: 4 } }],
		]);
		expect(materialized.staticSpatialRecords).toEqual([
			{
				bounds: {
					max: { x: 2, y: 3, z: 4 },
					min: { x: 1, y: 2, z: 3 },
				},
				envCellId: 0xda550100,
				instanceId: "da550100:env-cell-static-0",
				kind: "env-cell-static-object-bounds",
				landblockId: 0xda55ffff,
				owner: createEnvCellLayerOwner(),
			},
			{
				drawUnitId: "static-table",
				kind: "draw-unit-bounds",
				owner: {
					drawUnitId: "static-table",
					kind: "draw-unit",
				},
				triangleCount: 4,
			},
			{
				drawUnitId: "static-table#fine-1",
				kind: "draw-unit-bounds",
				owner: {
					drawUnitId: "static-table#fine-1",
					kind: "draw-unit",
				},
				triangleCount: 1,
			},
		]);
	});

	it("preserves owner-keyed texture bindings for static object visual resources", () => {
		const drawUnit = createStaticObjectDrawUnit("static-table", 2);
		const visualResource = createStaticObjectVisualResource(
			"visual-static-table",
			drawUnit,
		);
		const textureUpdate = {
			...createStaticObjectTexturePlacementUpdate(drawUnit),
			textureBindings: drawUnit.textureUseIds.map((textureUseId, index) => ({
				owner: {
					kind: "static-object-visual-resource" as const,
					resourceId: "visual-static-table",
				},
				rect: [0, 0, 1, 1] as const,
				rolePage: {
					kind: "object-base-color" as const,
					slot: index,
				},
				textureHeight: 1,
				textureRefId: `texture-ref-${index}`,
				textureUseId,
				textureWidth: 1,
			})),
		};

		const materialized = materializeStaticCommit({
			commit: createCommitDelta({
				addedDrawUnits: [],
				staticObjectVisualResources: [visualResource],
				textureUses: [],
			}),
			textureUpdate,
		});

		expect(materialized.textureUpdate?.textureBindings).toMatchObject([
			{
				owner: {
					kind: "static-object-visual-resource",
					resourceId: "visual-static-table",
				},
				rolePage: { kind: "object-base-color", slot: 0 },
				textureUseId: "static-table:prepared-texture:0",
			},
			{
				owner: {
					kind: "static-object-visual-resource",
					resourceId: "visual-static-table",
				},
				rolePage: { kind: "object-base-color", slot: 1 },
				textureUseId: "static-table:prepared-texture:1",
			},
		]);
	});

	it("expands removed static draw unit ids through previous materialization mappings", () => {
		const materialized = materializeStaticCommit({
			commit: {
				addedDrawUnits: [],
				addedPortalApertureResources: [],
				removedResources: [{ drawUnitId: "static-table", kind: "draw-unit" }],
				revision: 8,
				staticAuthoredDynamicSeeds: [],
				staticBatchId: "batch-a",
				staticPortalGraphs: [],
				staticPortalInteriorRecords: [],
				staticSourceMappings: [],
				staticSpatialRecords: [],
				staticVisibilityRecords: [],
				textureUses: [],
			},
			materializedDrawUnitIdsBySourceDrawUnitId: new Map([
				["static-table", ["static-table", "static-table#fine-1"]],
			]),
			textureUpdate: null,
		});

		expect(materialized.removedResources).toEqual([
			{ drawUnitId: "static-table", kind: "draw-unit" },
			{ drawUnitId: "static-table#fine-1", kind: "draw-unit" },
		]);
	});

	it("preserves removed portal aperture resources", () => {
		const materialized = materializeStaticCommit({
			commit: {
				addedDrawUnits: [],
				addedPortalApertureResources: [],
				removedResources: [
					{
						apertureResourceId: "portal-aperture-resource:da55ffff",
						kind: "portal-aperture-resource",
					},
				],
				revision: 9,
				staticAuthoredDynamicSeeds: [],
				staticBatchId: "batch-a",
				staticPortalGraphs: [],
				staticPortalInteriorRecords: [],
				staticSourceMappings: [],
				staticSpatialRecords: [],
				staticVisibilityRecords: [],
				textureUses: [],
			},
			textureUpdate: null,
		});

		expect(materialized.materializedDrawUnits).toEqual([]);
		expect(materialized.portalApertureResources).toEqual([]);
		expect(materialized.removedResources).toEqual([
			{
				apertureResourceId: "portal-aperture-resource:da55ffff",
				kind: "portal-aperture-resource",
			},
		]);
	});
});

function createCommitDelta(options: {
	readonly addedDrawUnits: readonly StaticDrawUnit[];
	readonly staticSpatialRecords?: StaticCoordinatorCommitDelta["staticSpatialRecords"];
	readonly staticObjectVisualResources?: readonly StaticObjectVisualResource[];
	readonly textureUses: readonly StaticBakeTextureUse[];
}): StaticCoordinatorCommitDelta {
	return {
		addedDrawUnits: options.addedDrawUnits,
		addedPortalApertureResources: [],
		commitId: "static-commit:batch-a",
		materialCoverage: [],
		removedResources: [],
		revision: 7,
		staticAuthoredDynamicSeeds: [],
		staticBatchId: "batch-a",
		staticPortalGraphs: [],
		staticPortalInteriorRecords: [],
		staticSourceMappings: [],
		staticSpatialRecords: options.staticSpatialRecords ?? [],
		staticObjectRenderInstances: [],
		staticObjectVisualResources: options.staticObjectVisualResources ?? [],
		staticVisibilityRecords: [],
		tasks: [],
		textureUses: options.textureUses,
	};
}

function createEnvCellLayerOwner(): StaticLayerPeerRecordOwner {
	return {
		domain: "env-cell-system",
		key: { kind: "env-cell-system", landblockId: 0xda55ffff },
		kind: "layer-owner",
		ownerId: "env-cell-system:0xda55ffff",
	};
}

function createTerrainDrawUnit(
	drawUnitId: string,
	options: {
		readonly textureUseIds?: readonly string[];
	} = {},
): TerrainGeometryStaticDrawUnit {
	const textureUseIds = options.textureUseIds ?? [];

	return {
		coordinateSpace: "landblock-render-local",
		domain: "outdoor-terrain",
		drawUnitId,
		indexType: "uint16",
		indices: new Uint16Array([0, 1, 2]),
		kind: "terrain-geometry",
		landblockId: 0xda55ffff,
		layerSlots: new Float32Array([0, 0, 0]),
		materialBucketKey:
			textureUseIds.length > 0
				? "shader:terrain-single-base-color"
				: "shader:terrain-debug-flat",
		materialFamily:
			textureUseIds.length > 0
				? "terrain-single-base-color"
				: "terrain-debug-flat",
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
		primaryTextureUseId: textureUseIds[0] ?? null,
		sourceTriangleIds: ["triangle-a"],
		terrainFallbackReasons: [],
		terrainMaterialPlan: null,
		texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
		textureUseIds,
		triangleCount: 1,
		vertexCount: 3,
	};
}

function createBakeTextureUse(
	drawUnitId: string,
	textureUseId = `${drawUnitId}:prepared-texture:06000010`,
	domain: StaticBakeTextureUse["domain"] = "outdoor-terrain",
): StaticBakeTextureUse {
	return {
		domain,
		owners: [{ drawUnitId, kind: "draw-unit" }],
		samplingPolicy: {
			wrapS: "repeat",
			wrapT: "repeat",
		},
		source: createPreparedTextureUse(),
		staticBatchId: "batch-a",
		textureUseId,
	};
}

function createPreparedTextureUse(): PreparedRgbaRenderSurfaceTextureUseIdentity {
	return {
		kind: "prepared-render-surface-texture-use",
		renderSurface: {
			kind: "render-surface",
			renderSurfaceId: 0x06000010,
		},
		usage: "rgba-color",
	};
}

function createTexturePlacementUpdate(
	drawUnit: TerrainGeometryStaticDrawUnit,
): TexturePlacementUpdate {
	const textureUseId = drawUnit.textureUseIds[0];
	if (!textureUseId) {
		throw new Error("Texture placement fixture needs a textured draw unit.");
	}

	return {
		textureBindings: [
			{
				owner: { drawUnitId: drawUnit.drawUnitId, kind: "draw-unit" },
				rect: { height: 1, width: 1, x: 0, y: 0 },
				rolePage: { kind: "color", slot: 0 },
				textureHeight: 1,
				textureRefId: "texture-ref-a",
				textureUseId,
				textureWidth: 1,
			},
		],
		placements: [],
		removedTextureRefIds: [],
		revision: 3,
		textureUsePlacements: [
			{
				rect: [0, 0, 1, 1],
				textureHeight: 1,
				textureRefId: "texture-ref-a",
				textureUseId,
				textureWidth: 1,
			},
		],
	};
}

function createStaticObjectDrawUnit(
	drawUnitId: string,
	materialCount: number,
): StaticObjectGeometryStaticDrawUnit {
	const positions: number[] = [];
	const texCoords: number[] = [];
	const materialSlotIndices: number[] = [];
	const indices: number[] = [];
	const materialEntries: StaticMaterialTableEntry[] = [];

	for (let slot = 0; slot < materialCount; slot += 1) {
		const vertexOffset = slot * 3;
		positions.push(0, 0, slot, 1, 0, slot, 0, 1, slot);
		texCoords.push(0, 0, 1, 0, 0, 1);
		materialSlotIndices.push(slot, slot, slot);
		indices.push(vertexOffset, vertexOffset + 1, vertexOffset + 2);
		materialEntries.push(createStaticObjectMaterialEntry(slot, drawUnitId));
	}

	const textureUseIds = materialEntries.map(
		(entry) => entry.primaryTextureUseId!,
	);

	return {
		coordinateSpace: "landblock-render-local",
		domain: "outdoor-buildings",
		drawUnitId,
		indexType: "uint16",
		indices: new Uint16Array(indices),
		kind: "static-object-geometry",
		landblockId: 0xda55ffff,
		materialBucketKey: "static-object:test",
		materialEntries,
		materialFamily: "texture-rgba",
		materialIds: materialEntries.flatMap((entry) => entry.materialIds),
		materialPass: "opaque",
		materialSlotIndices: new Float32Array(materialSlotIndices),
		positions: new Float32Array(positions),
		renderState: {
			blend: {
				dstFactor: null,
				enabled: false,
				mode: "opaque",
				srcFactor: null,
			},
			depthTest: true,
			depthWrite: true,
		},
		sort: {
			bounds: null,
			center: [0, 0, 0],
			objectPartKey: null,
			policy: "depth-writing",
		},
		sourceMappingCoverage: Array.from(
			{ length: materialCount },
			(_, index) => ({
				geometrySurfaceIds: [index],
				gfxObj: {
					kind: "static-object-source" as const,
					sourceAssetKind: "gfx-obj" as const,
					sourceDid: 0x01000020,
				},
				materialIds: [index + 1],
				materialSlot: index,
				materialVariantSignatures: [null],
				object: {
					instanceId: "outdoor-static-0",
					kind: "static-object-instance" as const,
					landblockId: 0xda55ffff,
					objectKind: "explicit-object" as const,
				},
				partIndex: 0,
				polygonCount: 1,
				polygonRange: { max: index, min: index },
				source: {
					kind: "static-object-source" as const,
					sourceAssetKind: "setup-model" as const,
					sourceDid: 0x02000010,
				},
				sourceTriangleCount: 1,
			}),
		),
		spatialRecord: {
			drawUnitId,
			kind: "draw-unit-bounds",
			owner: {
				drawUnitId,
				kind: "draw-unit",
			},
			triangleCount: materialCount,
		},
		texCoords: new Float32Array(texCoords),
		textureUseIds,
		triangleCount: materialCount,
		vertexCount: materialCount * 3,
	};
}

function createStaticObjectVisualResource(
	resourceId: string,
	drawUnit: StaticObjectGeometryStaticDrawUnit,
): StaticObjectVisualResource {
	return {
		bounds: null,
		coordinateSpace: "static-object-source-local",
		geometry: {
			gfxObjDid: 0x01000020,
			kind: "static-object-source-geometry",
			partIndex: 0,
			setupModelDid: 0x02000010,
		},
		indexType: drawUnit.indexType,
		indices: drawUnit.indices,
		key: {
			geometry: {
				gfxObjDid: 0x01000020,
				kind: "static-object-source-geometry",
				partIndex: 0,
				setupModelDid: 0x02000010,
			},
			indexType: drawUnit.indexType,
			kind: "static-object-visual-resource-key",
			materialEntries: drawUnit.materialEntries,
			materialFamily: drawUnit.materialFamily,
			materialPass: drawUnit.materialPass,
			renderState: drawUnit.renderState,
			textureUseIds: drawUnit.textureUseIds,
		},
		kind: "static-object-visual-resource",
		materialEntries: drawUnit.materialEntries,
		materialFamily: drawUnit.materialFamily,
		materialPass: drawUnit.materialPass,
		materialSlotIndices: drawUnit.materialSlotIndices,
		positions: drawUnit.positions,
		renderState: drawUnit.renderState,
		resourceId,
		texCoords: drawUnit.texCoords,
		textureUseIds: drawUnit.textureUseIds,
		triangleCount: drawUnit.triangleCount,
		vertexCount: drawUnit.vertexCount,
	};
}

function createStaticObjectMaterialEntry(
	slot: number,
	drawUnitId: string,
): StaticMaterialTableEntry {
	return {
		alphaTest: 0,
		indexedClipThreshold: -1,
		detailTextureTiling: 1,
		detailTextureUseId: null,
		indexTextureUseId: null,
		indexedTextureFormat: null,
		materialColor: [1, 1, 1, 1],
		materialEmissiveColor: [0, 0, 0],
		materialIds: [slot + 1],
		paletteFirstIndex: 0,
		paletteTextureUseId: null,
		primaryTextureUseId: `${drawUnitId}:prepared-texture:${slot}`,
		primaryTextureWrapMode: "clamp",
		renderState: {
			blend: {
				dstFactor: null,
				enabled: false,
				mode: "opaque",
				srcFactor: null,
			},
			depthTest: true,
			depthWrite: true,
		},
		slot,
	};
}

function createStaticObjectTexturePlacementUpdate(
	drawUnit: StaticObjectGeometryStaticDrawUnit,
): TexturePlacementUpdate {
	return {
		textureBindings: [],
		placements: [],
		removedTextureRefIds: [],
		revision: 3,
		textureUsePlacements: drawUnit.textureUseIds.map((textureUseId, index) => ({
			anisotropy: 1,
			filteringMode: "nearest",
			format: "rgba8",
			height: 1,
			mipmapsGenerated: false,
			pixels: new Uint8Array([255, 255, 255, 255]),
			placementRevision: 1,
			rect: [0, 0, 1, 1],
			sampleClass: "rgba-color",
			samplerPolicyKey: `policy-${index}`,
			textureRefId: `texture-ref-${index}`,
			textureUseId,
			width: 1,
			wrapS: "clamp-to-edge",
			wrapT: "clamp-to-edge",
		})),
	};
}
