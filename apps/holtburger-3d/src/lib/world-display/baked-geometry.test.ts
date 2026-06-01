import { describe, expect, it } from "vitest";

import type { StagedWorldDrawUnitAssembly } from "./staged-world-assembly";
import type { StagedWorldDirectTextureMaterialPlan } from "./staged-world-materials";
import type { BakedRenderablePlan } from "./baked-renderable-planner";
import { buildBakedGeometry } from "./baked-geometry";

describe("baked geometry geometry builder", () => {
	it("builds batch-local geometry buffers with baked static positions", () => {
		const plan = createPlan();
		const geometry = buildBakedGeometry({
			plan,
			drawUnits: [
				createDrawUnit("draw-a", "material-slot-a", 10),
				createDrawUnit("draw-b", "material-slot-b", 20),
			],
			batchOrigin: { x: 0, y: 0, z: 0 },
		});

		expect(geometry?.positions).toEqual(
			Float32Array.from([
				10, 0, 0, 11, 0, 0, 10, 1, 0, 20, 0, 0, 21, 0, 0, 20, 1, 0,
			]),
		);
		expect(geometry?.batchModelMatrix[12]).toBe(0);
		expect(geometry?.uvs).toEqual(
			Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
		);
		expect(geometry?.materialSlots).toEqual(
			Float32Array.from([0, 0, 0, 1, 1, 1]),
		);
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
				detailAtlasTextureIndex: null,
				renderStateKey: "opaque",
				firstIndex: 0,
				indexCount: 3,
				drawUnitIds: ["draw-a"],
				materialSlotKeys: ["material-slot-a"],
			},
			{
				key: "slice-b",
				atlasTextureIndex: 0,
				detailAtlasTextureIndex: null,
				renderStateKey: "opaque",
				firstIndex: 3,
				indexCount: 3,
				drawUnitIds: ["draw-b"],
				materialSlotKeys: ["material-slot-b"],
			},
		]);
	});

	it("keeps the resource key stable for a common re-anchor shift", () => {
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
		const first = buildBakedGeometry({
			plan,
			drawUnits: [createDrawUnit("draw-a", "material-slot-a", 10)],
			batchOrigin: { x: 10, y: 0, z: 0 },
		});
		const second = buildBakedGeometry({
			plan,
			drawUnits: [createDrawUnit("draw-a", "material-slot-a", 99)],
			batchOrigin: { x: 99, y: 0, z: 0 },
		});

		expect(first?.key).toBe(second?.key);
	});

	it("changes the resource key when relative static placement changes", () => {
		const basePlan = createPlan();
		const first = buildBakedGeometry({
			plan: basePlan,
			drawUnits: [
				createDrawUnit("draw-a", "material-slot-a", 10),
				createDrawUnit("draw-b", "material-slot-b", 20),
			],
			batchOrigin: { x: 10, y: 0, z: 0 },
		});
		const second = buildBakedGeometry({
			plan: basePlan,
			drawUnits: [
				createDrawUnit("draw-a", "material-slot-a", 10),
				createDrawUnit("draw-b", "material-slot-b", 30),
			],
			batchOrigin: { x: 10, y: 0, z: 0 },
		});

		expect(first?.key).not.toBe(second?.key);
	});

	it("compacts structured-interior geometry in the same landblock-local buffer", () => {
		const basePlan = createPlan();
		const firstSlice = basePlan.drawSlices[0];
		if (!firstSlice) {
			throw new Error("Fixture plan is missing its first draw slice.");
		}
		const plan = {
			...basePlan,
			compactableDrawUnitIds: ["structured-a"],
			drawSlices: [
				{
					...firstSlice,
					drawUnitIds: ["structured-a"],
				},
			],
		};
		const geometry = buildBakedGeometry({
			plan,
			drawUnits: [
				createDrawUnit("structured-a", "material-slot-a", 100, {
					kind: "structured-interior",
					owningLandblockId: 0x0203ffff,
				}),
			],
			batchOrigin: { x: 96, y: 0, z: 0 },
		});

		expect(geometry?.batchModelMatrix[12]).toBe(96);
		expect(geometry?.positions).toEqual(
			Float32Array.from([4, 0, 0, 5, 0, 0, 4, 1, 0]),
		);
		expect(geometry?.drawRanges).toMatchObject([
			{
				drawUnitId: "structured-a",
				firstIndex: 0,
				indexCount: 3,
				materialSlotIndex: 0,
			},
		]);
	});
});

function createPlan(): BakedRenderablePlan {
	return {
		key: "plan-a",
		compactableDrawUnitIds: ["draw-a", "draw-b"],
		bypasses: [],
		atlasEntryRecords: [],
		atlasEntries: [],
		atlasTextures: [],
		detailAtlasEntryRecords: [],
		detailAtlasTextures: [],
		materialSlots: [
			{
				key: "material-slot-a",
				sourceMaterialSlotKey: "material-slot-a",
				index: 0,
				renderStateKey: "opaque",
				samplingKey: "sampling",
				samplingPolicy: { wrapS: "clamp", wrapT: "clamp" },
				atlasEntryKey: "entry-a",
				detailAtlasEntryKey: null,
				detailTiling: 1,
			},
			{
				key: "material-slot-b",
				sourceMaterialSlotKey: "material-slot-b",
				index: 1,
				renderStateKey: "opaque",
				samplingKey: "sampling",
				samplingPolicy: { wrapS: "clamp", wrapT: "clamp" },
				atlasEntryKey: "entry-b",
				detailAtlasEntryKey: null,
				detailTiling: 1,
			},
		],
		drawUnitMaterialSlots: [
			{ drawUnitId: "draw-a", materialSlotKey: "material-slot-a" },
			{ drawUnitId: "draw-b", materialSlotKey: "material-slot-b" },
		],
		drawSlices: [
			{
				key: "slice-a",
				atlasTextureIndex: 0,
				detailAtlasTextureIndex: null,
				renderStateKey: "opaque",
				materialTableSlotStart: 0,
				materialTableSlotCount: 1,
				materialSlotKeys: ["material-slot-a"],
				drawUnitIds: ["draw-a"],
			},
			{
				key: "slice-b",
				atlasTextureIndex: 0,
				detailAtlasTextureIndex: null,
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
	options: {
		kind?: "static" | "structured-interior";
		owningLandblockId?: number;
	} = {},
): StagedWorldDrawUnitAssembly {
	const kind = options.kind ?? "static";
	const base = {
		id,
		kind,
		owningLandblockId: options.owningLandblockId ?? 0x0102ffff,
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
				samplingPolicy: { wrapS: "clamp", wrapT: "clamp" },
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
		staticPartCount: kind === "static" ? 1 : 0,
		staticObjectKeys: kind === "static" ? [`object/${id}`] : [],
	};
	if (kind === "structured-interior") {
		return base;
	}
	return {
		...base,
		kind: "static",
		renderDomain: "exterior-static",
	};
}
