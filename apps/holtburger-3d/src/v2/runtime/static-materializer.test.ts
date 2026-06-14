import { describe, expect, it } from "vitest";
import type { TexturePlacementUpdate } from "../renderer/types";
import type {
	PreparedRgbaRenderSurfaceTextureUseIdentity,
	StaticBakeTextureUse,
	StaticCoordinatorCommitDelta,
	StaticDrawUnit,
	StaticObjectGeometryStaticDrawUnit,
	StaticObjectMaterialTableEntry,
	TerrainGeometryStaticDrawUnit,
} from "../static/contracts";
import { materializeStaticCommit } from "./static-materializer";

describe("V2 static materializer", () => {
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
		expect(materialized.staticDelta).toEqual({
			addedDrawUnits: [drawUnit],
			removedDrawUnitIds: [],
			revision: 7,
		});
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

		expect(materialized.staticDelta.addedDrawUnits).toEqual([drawUnit]);
		expect(materialized.textureUpdate).toBeNull();
	});

	it("fine-splits static object tables by committed static role-page capacity", () => {
		const drawUnit = createStaticObjectDrawUnit("static-table", 5);
		const textureUpdate = createStaticObjectTexturePlacementUpdate(drawUnit);

		const materialized = materializeStaticCommit({
			commit: createCommitDelta({
				addedDrawUnits: [drawUnit],
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

		const addedDrawUnits = materialized.staticDelta.addedDrawUnits;
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
		expect(materialized.textureUpdate?.drawUnitBindings).toMatchObject([
			{
				drawUnitId: "static-table",
				rolePage: { kind: "static-base-color", slot: 0 },
			},
			{
				drawUnitId: "static-table",
				rolePage: { kind: "static-base-color", slot: 1 },
			},
			{
				drawUnitId: "static-table",
				rolePage: { kind: "static-base-color", slot: 2 },
			},
			{
				drawUnitId: "static-table",
				rolePage: { kind: "static-base-color", slot: 3 },
			},
			{
				drawUnitId: "static-table#fine-1",
				rolePage: { kind: "static-base-color", slot: 0 },
			},
		]);
		expect(materialized.staticSourceMappings).toEqual([
			"static-table:source:0",
			"static-table:source:1",
			"static-table:source:2",
			"static-table:source:3",
			"static-table#fine-1:source:4",
		]);
		expect(materialized.staticSpatialRecords).toEqual([
			"static-table:bounds:4t",
			"static-table#fine-1:bounds:1t",
		]);
	});

	it("expands removed static draw unit ids through previous materialization mappings", () => {
		const materialized = materializeStaticCommit({
			commit: {
				addedDrawUnits: [],
				removedDrawUnitIds: ["static-table"],
				revision: 8,
				staticAuthoredDynamicSeeds: [],
				staticBatchId: "batch-a",
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

		expect(materialized.staticDelta.removedDrawUnitIds).toEqual([
			"static-table",
			"static-table#fine-1",
		]);
	});
});

function createCommitDelta(options: {
	readonly addedDrawUnits: readonly StaticDrawUnit[];
	readonly textureUses: readonly StaticBakeTextureUse[];
}): StaticCoordinatorCommitDelta {
	return {
		addedDrawUnits: options.addedDrawUnits,
		materialCoverage: [],
		removedDrawUnitIds: [],
		revision: 7,
		staticAuthoredDynamicSeeds: [],
		staticBatchId: "batch-a",
		staticPortalInteriorRecords: [],
		staticSourceMappings: [],
		staticSpatialRecords: [],
		staticVisibilityRecords: [],
		textureUses: options.textureUses,
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
		ownerDrawUnitIds: [drawUnitId],
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
		drawUnitBindings: [
			{
				drawUnitId: drawUnit.drawUnitId,
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
	const materialEntries: StaticObjectMaterialTableEntry[] = [];

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
		alphaTest: 0,
		coordinateSpace: "landblock-render-local",
		detailTextureTiling: 1,
		detailTextureUseId: null,
		domain: "outdoor-buildings",
		drawUnitId,
		indexTextureUseId: null,
		indexType: "uint16",
		indexedTextureFormat: null,
		indices: new Uint16Array(indices),
		kind: "static-object-geometry",
		landblockId: 0xda55ffff,
		materialBucketKey: "static-object:test",
		materialColor: [1, 1, 1, 1],
		materialEmissiveColor: [0, 0, 0],
		materialEntries,
		materialFamily: "texture-rgba",
		materialIds: materialEntries.flatMap((entry) => entry.materialIds),
		materialPass: "opaque",
		materialSlotIndices: new Float32Array(materialSlotIndices),
		paletteFirstIndex: 0,
		paletteTextureUseId: null,
		positions: new Float32Array(positions),
		primaryTextureUseId: textureUseIds[0] ?? null,
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
		sort: {
			bounds: null,
			center: [0, 0, 0],
			objectPartKey: null,
			policy: "depth-writing",
		},
		sourceMappingRecords: Array.from(
			{ length: materialCount },
			(_, index) => `${drawUnitId}:source:${index}`,
		),
		spatialRecord: `${drawUnitId}:bounds:${materialCount}t`,
		texCoords: new Float32Array(texCoords),
		textureUseIds,
		triangleCount: materialCount,
		vertexCount: materialCount * 3,
	};
}

function createStaticObjectMaterialEntry(
	slot: number,
	drawUnitId: string,
): StaticObjectMaterialTableEntry {
	return {
		alphaTest: 0,
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
		drawUnitBindings: [],
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
