import { describe, expect, it } from "vitest";

import {
	createInitialAssetChannelState,
	type AssetChannelState,
	type PreparedPolygonSetRenderGeometry,
} from "../assets/types";
import { createBaseMaterialAppearanceContext } from "./material-appearance";
import { WORLD_RENDER_DOMAIN } from "./render-domains";
import {
	buildStagedStaticDrawUnitAssemblies,
	describeStagedWorldAssemblyGraphRecordSignature,
} from "./staged-world-assembly";
import type { RenderChunkTransform } from "./render-anchor";
import type { StaticRenderablePart } from "./static-renderables";

describe("staged world assembly", () => {
	it("splits static draw units by material slot and keeps chunk-local geometry", () => {
		const drawUnits = buildStagedStaticDrawUnitAssemblies({
			assetState: createAssetState(createTwoSlotGfxGeometry()),
			chunkOffsetByKey: new Map([
				["landblock/12340000", { x: 10, y: 20, z: 30 }],
			]),
			staticRenderableScene: {
				partsByRenderGroupKey: new Map(),
				parts: [
					createStaticPart({
						materialSlots: [
							createMaterialSlot(0, 0x08000001),
							createMaterialSlot(1, 0x08000002),
						],
					}),
				],
			},
		});

		expect(drawUnits).toHaveLength(2);
		expect(drawUnits.map((unit) => unit.geometry.triangleCount)).toEqual([1, 1]);
		expect(drawUnits.map((unit) => unit.modelMatrix[12])).toEqual([10, 10]);
		expect(drawUnits.map((unit) => unit.geometry.uvs.length)).toEqual([6, 6]);
		expect(drawUnits.map((unit) => unit.preparedAssetIds[0])).toEqual([
			"gfx-obj/01000001",
			"gfx-obj/01000001",
		]);
	});

	it("normalizes duplicate static BVH keys during draw-unit assembly", () => {
		const part = createStaticPart();
		const drawUnits = buildStagedStaticDrawUnitAssemblies({
			assetState: createAssetState(createStaticGfxGeometry()),
			chunkOffsetByKey: new Map([
				["landblock/12340000", { x: 10, y: 20, z: 30 }],
			]),
			staticRenderableScene: {
				partsByRenderGroupKey: new Map(),
				parts: [part, { ...part, gfxObjAssetId: "gfx-obj/01000002" }],
			},
		});

		for (const drawUnit of drawUnits) {
			expect(drawUnit.bvhBinding.itemKeys).toEqual([
				...new Set(drawUnit.bvhBinding.itemKeys),
			]);
		}
	});

	it("creates stable graph signatures from sorted prepared dependencies", () => {
		const signature = describeStagedWorldAssemblyGraphRecordSignature({
			drawUnitId: "static-staged/test",
			label: "test",
			material: {
				kind: "flat",
				key: "flat/test",
				color: new Float32Array([1, 1, 1, 1]),
				behavior: null,
				fallbackReason: null,
				preparedAssetIds: [],
			},
			preparedAssetIds: ["z", "a", "z"],
		});

		expect(signature).toBe("test|flat|flat/test|none|a|z");
	});
});

function createAssetState(
	renderGeometry: PreparedPolygonSetRenderGeometry,
): AssetChannelState {
	const state = createInitialAssetChannelState();
	for (const assetId of ["gfx-obj/01000001", "gfx-obj/01000002"]) {
		state.preparedByAssetId[assetId] = {
			payload: {
				kind: "gfx-obj",
				renderGeometry,
			},
		} as AssetChannelState["preparedAsset"];
	}
	return state;
}

function createStaticGfxGeometry(): PreparedPolygonSetRenderGeometry {
	return {
		sourceId: 1,
		vertexCount: 3,
		triangleCount: 1,
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		normals: [],
		uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
		triangles: [{ polygonId: 0, surfaceId: null, firstVertex: 0 }],
		surfaceIds: [],
		bounds: null,
	};
}

function createTwoSlotGfxGeometry(): PreparedPolygonSetRenderGeometry {
	return {
		sourceId: 1,
		vertexCount: 6,
		triangleCount: 2,
		positions: new Float32Array([
			0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0,
		]),
		normals: [],
		uvs: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1, 2, 1, 1, 2]),
		triangles: [
			{ polygonId: 0, surfaceId: 0, firstVertex: 0 },
			{ polygonId: 1, surfaceId: 1, firstVertex: 3 },
		],
		surfaceIds: [0, 1],
		bounds: null,
	};
}

function createStaticPart({
	materialSlots = [],
}: {
	materialSlots?: StaticRenderablePart["materialSlots"];
} = {}): StaticRenderablePart {
	return {
		renderKey: "static/group",
		renderDomain: WORLD_RENDER_DOMAIN.exteriorStatic,
		instanceId: "instance-a",
		sourceAssetId: "gfx-obj/01000001",
		sourceDid: 0x01000001,
		owningLandblockId: 0x12340000,
		regionNumber: 1,
		owningEnvCellId: null,
		renderChunk: {
			chunkKey: "landblock/12340000",
			chunkLandblockId: 0x12340000,
		},
		kind: "scenery",
		partIndex: 0,
		gfxObjId: 0x01000001,
		gfxObjAssetId: "gfx-obj/01000001",
		materialAppearanceContext: createBaseMaterialAppearanceContext("base"),
		materialSlots,
		materialSignature: "base",
		parentPlacements: [],
		chunkLocalInstancePlacement: createPlacement({ x: 1, y: 2, z: 3 }),
		partPlacements: [],
		scale: { x: 1, y: 1, z: 1 },
		debugColorKey: "instance-a",
		textureVelocity: null,
		textureVelocitySignature: "uv:none",
		detailRoleKind: "scenery",
		detailSignature: "detail:none",
	};
}

function createMaterialSlot(
	slotIndex: number,
	surfaceId: number,
): StaticRenderablePart["materialSlots"][number] {
	return {
		slotIndex,
		surfaceId,
		materialAssetId: `material/${surfaceId.toString(16).padStart(8, "0")}`,
		materialVariantSignature: null,
	};
}

function createPlacement(origin: RenderChunkTransform["offset"]) {
	return {
		origin,
		orientation: { w: 1, x: 0, y: 0, z: 0 },
	};
}
