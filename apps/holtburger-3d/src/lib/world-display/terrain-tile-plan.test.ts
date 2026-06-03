import { describe, expect, it } from "vitest";

import type {
	PreparedRenderSurfacePayload,
	PreparedTerrainMesh,
} from "../assets/types";
import type {
	TerrainBlendPlan,
	TerrainBlendPlanSet,
	TerrainBlendTextureRef,
} from "./terrain-blend-plan";
import {
	buildTerrainTileLayerGeometry,
	buildTerrainTileLayerPlan,
} from "./terrain-tile-plan";

describe("terrain tile plan", () => {
	it("assigns stable layer slots from pcode blend plans", () => {
		const plan = buildTerrainTileLayerPlan({
			planSet: createPlanSet([createBlendPlan(2), createBlendPlan(1)]),
		});

		expect(plan?.blockers).toEqual([]);
		expect(plan?.layerEntries.map((entry) => [entry.slot, entry.pcode])).toEqual([
			[0, 1],
			[1, 2],
		]);
		expect(plan?.layerSlotByPcode.get(1)).toBe(0);
		expect(plan?.layerSlotByPcode.get(2)).toBe(1);
	});

	it("blocks tiles that exceed the layer-entry limit", () => {
		const plan = buildTerrainTileLayerPlan({
			planSet: createPlanSet([createBlendPlan(1), createBlendPlan(2)]),
			maxLayerEntries: 1,
		});

		expect(plan?.layerEntries).toEqual([]);
		expect(plan?.blockers).toEqual([
			"terrain tile requires 2 layer entries; limit is 1",
		]);
	});

	it("builds duplicated quad-local geometry with uv and layer slot attributes", () => {
		const plan = buildTerrainTileLayerPlan({
			planSet: createPlanSet([createBlendPlan(1)]),
		});
		if (!plan) {
			throw new Error("Expected terrain tile layer plan.");
		}

		const geometry = buildTerrainTileLayerGeometry({
			mesh: createTerrainMesh(),
			plan,
		});

		expect(geometry.vertexCount).toBe(6);
		expect(geometry.triangleCount).toBe(2);
		expect([...geometry.indices]).toEqual([0, 1, 2, 3, 4, 5]);
		expect([...geometry.layerSlots]).toEqual([0, 0, 0, 0, 0, 0]);
		expect([...geometry.uvs]).toEqual([0, 0, 1, 0, 1, 1, 1, 1, 1, 0, 0, 1]);
	});
});

function createPlanSet(plans: TerrainBlendPlan[]): TerrainBlendPlanSet {
	return {
		plans,
		planByPcode: new Map(plans.map((plan) => [plan.pcode, plan])),
		diagnostics: [],
		signature: `plans:${plans.map((plan) => plan.pcode).join(",")}`,
	};
}

function createBlendPlan(pcode: number): TerrainBlendPlan {
	const base = createTextureRef(pcode, "color");
	return {
		pcode,
		base,
		overlays: [],
		roads: [],
		allRoad: false,
	};
}

function createTextureRef(
	id: number,
	role: TerrainBlendTextureRef["role"],
): TerrainBlendTextureRef {
	return {
		textureAssetId: `surface-texture/${id.toString(16).padStart(8, "0")}`,
		renderSurface: createRenderSurface(id),
		tiling: 4,
		wrap: role === "mask" ? "clamp" : "repeat",
		role,
	};
}

function createRenderSurface(renderSurfaceId: number): PreparedRenderSurfacePayload {
	return {
		kind: "render-surface",
		sourceAssetKind: "render-surface",
		residencyKind: "unknown",
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "render-surface",
			errorCode: null,
			detail: null,
		},
		renderSurfaceId,
		unknown: 0,
		width: 1,
		height: 1,
		formatRaw: 0x15,
		format: "A8R8G8B8",
		sourceByteLength: 4,
		sourceBytes: new Uint8Array([0, 0, 0, 0]),
		defaultPaletteId: null,
		dependencies: {
			paletteAssetIds: [],
		},
	};
}

function createTerrainMesh(): PreparedTerrainMesh {
	const bounds = {
		min: { x: 0, y: 0, z: 0 },
		max: { x: 16, y: 0, z: 16 },
	};
	return {
		landblockId: 0x12340000,
		gridSize: 2,
		tileSize: 16,
		vertices: [
			{ x: 0, y: 0, z: 0 },
			{ x: 16, y: 0, z: 0 },
			{ x: 0, y: 16, z: 0 },
			{ x: 16, y: 16, z: 0 },
		],
		triangles: [
			{
				a: 0,
				b: 1,
				c: 2,
				quadIndex: 0,
				triangleInQuad: 0,
				debugTerrainPcode: 1,
				averageHeight: 0,
			},
			{
				a: 2,
				b: 1,
				c: 3,
				quadIndex: 0,
				triangleInQuad: 1,
				debugTerrainPcode: 1,
				averageHeight: 0,
			},
		],
		quads: [
			{
				terrainQuadId: "terrain/12340000/quad/0",
				row: 0,
				col: 0,
				quadIndex: 0,
				sourceTerrainIndices: [0, 1, 2, 3],
				vertexIndices: [0, 1, 2, 3],
				triangleIndices: [0, 1],
				diagonal: "southwest-northeast",
				cornerTerrainCodes: [1, 1, 1, 1],
				pcode: 1,
				averageHeight: 0,
				bounds,
			},
		],
		minHeight: 0,
		maxHeight: 0,
	};
}
