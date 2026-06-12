import { describe, expect, it } from "vitest";
import type { TexturePlacementUpdate } from "../renderer/types";
import type {
	PreparedRgbaRenderSurfaceTextureUseIdentity,
	StaticBakeTextureUse,
	StaticCoordinatorCommitDelta,
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
			renderAnchorLandblockId: 0xda55ffff,
			textureUpdate,
		});

		expect(materialized.textureUpdate).toBe(textureUpdate);
		expect(materialized.staticDelta).toEqual({
			addedDrawUnitPlacements: [
				{
					drawUnit,
					translation: [0, 0, 0],
				},
			],
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
				renderAnchorLandblockId: 0xda55ffff,
				textureUpdate: null,
			}),
		).toThrow(
			/terrain-textured is missing committed texture bindings for terrain-textured:prepared-texture:06000010/,
		);
	});

	it("materializes untextured draw units without a texture update", () => {
		const drawUnit = createTerrainDrawUnit("terrain-flat");

		const materialized = materializeStaticCommit({
			commit: createCommitDelta({ addedDrawUnits: [drawUnit], textureUses: [] }),
			renderAnchorLandblockId: 0xda55ffff,
			textureUpdate: null,
		});

		expect(materialized.staticDelta.addedDrawUnitPlacements).toEqual([
			{
				drawUnit,
				translation: [0, 0, 0],
			},
		]);
		expect(materialized.textureUpdate).toBeNull();
	});
});

function createCommitDelta(options: {
	readonly addedDrawUnits: readonly TerrainGeometryStaticDrawUnit[];
	readonly textureUses: readonly StaticBakeTextureUse[];
}): StaticCoordinatorCommitDelta {
	return {
		addedDrawUnits: options.addedDrawUnits,
		removedDrawUnitIds: [],
		revision: 7,
		staticBatchId: "batch-a",
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

function createBakeTextureUse(drawUnitId: string): StaticBakeTextureUse {
	return {
		domain: "outdoor-terrain",
		ownerDrawUnitIds: [drawUnitId],
		samplingPolicy: {
			wrapS: "repeat",
			wrapT: "repeat",
		},
		source: createPreparedTextureUse(),
		staticBatchId: "batch-a",
		textureUseId: `${drawUnitId}:prepared-texture:06000010`,
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
	};
}
