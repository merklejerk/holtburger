import { describe, expect, it } from "vitest";

import type { StagedWorldDrawUnitAssembly } from "./staged-world-assembly";
import type { StagedWorldDirectTextureMaterialPlan } from "./staged-world-materials";
import type { AtlasStaticCompactionPlan } from "./atlas-static-compaction-planner";
import { buildAtlasStaticCompactedGeometry } from "./atlas-static-geometry-compactor";

describe("atlas static geometry compactor", () => {
	it("builds local geometry buffers with material and transform slots", () => {
		const plan = createPlan();
		const geometry = buildAtlasStaticCompactedGeometry({
			plan,
			drawUnits: [
				createDrawUnit("draw-a", "material-slot-a", 10),
				createDrawUnit("draw-b", "material-slot-b", 20),
			],
		});

		expect(geometry?.positions).toEqual(
			Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0]),
		);
		expect(geometry?.uvs).toEqual(
			Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
		);
		expect(geometry?.materialSlots).toEqual(
			Float32Array.from([0, 0, 0, 1, 1, 1]),
		);
		expect(geometry?.transformSlots).toEqual(
			Float32Array.from([0, 0, 0, 1, 1, 1]),
		);
		expect(geometry?.transformTable.map((matrix) => matrix[12])).toEqual([
			10, 20,
		]);
		expect(geometry?.indices).toEqual(Uint16Array.from([0, 1, 2, 3, 4, 5]));
		expect(geometry?.drawRanges).toEqual([
			{
				drawUnitId: "draw-a",
				firstIndex: 0,
				indexCount: 3,
				materialSlotIndex: 0,
			},
			{
				drawUnitId: "draw-b",
				firstIndex: 3,
				indexCount: 3,
				materialSlotIndex: 1,
			},
		]);
		expect(geometry?.drawSlices).toEqual([
			{
				key: "slice-a",
				atlasTextureIndex: 0,
				renderStateKey: "opaque",
				firstIndex: 0,
				indexCount: 3,
				drawUnitIds: ["draw-a"],
				materialSlotKeys: ["material-slot-a"],
			},
			{
				key: "slice-b",
				atlasTextureIndex: 0,
				renderStateKey: "opaque",
				firstIndex: 3,
				indexCount: 3,
				drawUnitIds: ["draw-b"],
				materialSlotKeys: ["material-slot-b"],
			},
		]);
	});

	it("does not include transform matrix values in the resource key", () => {
		const basePlan = createPlan();
		const firstSlice = basePlan.drawSlices[0];
		if (!firstSlice) {
			throw new Error("Fixture plan is missing its first draw slice.");
		}
		const plan = {
			...basePlan,
			compactableDrawUnitIds: ["draw-a"],
			drawSlices: [firstSlice],
		};
		const first = buildAtlasStaticCompactedGeometry({
			plan,
			drawUnits: [createDrawUnit("draw-a", "material-slot-a", 10)],
		});
		const second = buildAtlasStaticCompactedGeometry({
			plan,
			drawUnits: [createDrawUnit("draw-a", "material-slot-a", 99)],
		});

		expect(first?.key).toBe(second?.key);
	});
});

function createPlan(): AtlasStaticCompactionPlan {
	return {
		key: "plan-a",
		compactableDrawUnitIds: ["draw-a", "draw-b"],
		bypasses: [],
		atlasEntryRecords: [],
		atlasEntries: [],
		atlasTextures: [],
		materialSlots: [
			{
				key: "material-slot-a",
				index: 0,
				renderStateKey: "opaque",
				samplingKey: "sampling",
				atlasEntryKey: "entry-a",
			},
			{
				key: "material-slot-b",
				index: 1,
				renderStateKey: "opaque",
				samplingKey: "sampling",
				atlasEntryKey: "entry-b",
			},
		],
		drawSlices: [
			{
				key: "slice-a",
				atlasTextureIndex: 0,
				renderStateKey: "opaque",
				materialTableSlotStart: 0,
				materialTableSlotCount: 1,
				materialSlotKeys: ["material-slot-a"],
				drawUnitIds: ["draw-a"],
			},
			{
				key: "slice-b",
				atlasTextureIndex: 0,
				renderStateKey: "opaque",
				materialTableSlotStart: 1,
				materialTableSlotCount: 1,
				materialSlotKeys: ["material-slot-b"],
				drawUnitIds: ["draw-b"],
			},
		],
		staticObjectKeys: ["object-a", "object-b"],
		staticPartCount: 2,
		triangleCount: 2,
		preparedTextureAssetIds: ["prepared-texture/a", "prepared-texture/b"],
	};
}

function createDrawUnit(
	id: string,
	materialSlotKey: string,
	xOffset: number,
): StagedWorldDrawUnitAssembly {
	return {
		id,
		kind: "static",
		renderDomain: "exterior-static",
		geometry: {
			positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
			uvs: Float32Array.from([0, 0, 1, 0, 0, 1]),
			indices: Uint16Array.from([0, 1, 2]),
			vertexCount: 3,
			triangleCount: 1,
		},
		modelMatrix: new Float32Array([
			1,
			0,
			0,
			0,
			0,
			1,
			0,
			0,
			0,
			0,
			1,
			0,
			xOffset,
			0,
			0,
			1,
		]),
		material: {
			kind: "direct-texture",
			key: `material/${id}`,
			color: new Float32Array([1, 1, 1, 1]),
			textureKey: `texture/${id}`,
			textureUpload:
				{} as StagedWorldDirectTextureMaterialPlan["textureUpload"],
			behavior: {
				transparent: false,
				opacity: 1,
				alphaTest: 0,
				blend: {
					enabled: false,
					mode: null,
					srcFactor: null,
					dstFactor: null,
					depthWrite: true,
				},
			},
			fallbackReason: null,
			atlasEligibility: {
				materialSlotKey,
				atlasEntryKey: "entry-a",
				renderStateKey: "opaque",
				samplingKey: "sampling",
				atlasEntry: {
					renderSurfaceId: 1,
					preparedTextureAssetId: "prepared-texture/a",
					sourceHash: "hash-a",
					sourceFormatRaw: 0,
					level: {
						level: 0,
						width: 1,
						height: 1,
						formatRaw: 0,
						format: "rgba8",
						byteLength: 4,
						bytes: Uint8Array.from([0, 0, 0, 255]),
					},
				},
			},
			detailOverlay: null,
			preparedAssetIds: [],
		},
		preparedAssetIds: [],
		bvhBinding: {
			itemKeys: [],
			fallbackReason: null,
		},
		staticPartCount: 1,
		staticObjectKeys: [`object/${id}`],
	};
}
