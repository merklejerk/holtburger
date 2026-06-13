import { describe, expect, it } from "vitest";

import type {
	RenderDirectTextureMaterialPlan,
	RenderIndexedPalettedMaterialPlan,
} from "../render-material-plans";
import {
	buildCompactedGeometryBatch,
	describeCompactedGeometryJobKey,
	type CompactedGeometryBuildEntry,
	type CompactedGeometryPlan,
} from "./compacted-geometry";

interface TestCompactedGeometryDrawSlice {
	key: string;
	renderStateKey: string;
	materialSlotKeys: readonly string[];
	entryIds: readonly string[];
}

describe("compacted geometry builder", () => {
	it("builds batch-local geometry buffers with compacted static positions", () => {
		const plan = createPlan();
		const geometry = buildCompactedGeometryBatch({
			plan,
			entries: [
				createEntry("draw-a", "material-slot-a", 10),
				createEntry("draw-b", "material-slot-b", 20),
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
		expect(geometry?.layout).toBe("position-uv-material-slot");
		expect(geometry?.materialSlotIndices).toEqual(
			Float32Array.from([0, 0, 0, 1, 1, 1]),
		);
		expect(geometry?.indices).toEqual(Uint16Array.from([0, 1, 2, 3, 4, 5]));
		expect(geometry?.drawRanges).toEqual([
			{
				entryId: "draw-a",
				firstIndex: 0,
				indexCount: 3,
				materialSlotIndex: 0,
			},
			{
				entryId: "draw-b",
				firstIndex: 3,
				indexCount: 3,
				materialSlotIndex: 1,
			},
		]);
		expect(geometry?.drawSlices).toEqual([
			{
				key: "slice-a",
				renderStateKey: "opaque",
				firstIndex: 0,
				indexCount: 3,
				entryIds: ["draw-a"],
				materialSlotKeys: ["material-slot-a"],
			},
			{
				key: "slice-b",
				renderStateKey: "opaque",
				firstIndex: 3,
				indexCount: 3,
				entryIds: ["draw-b"],
				materialSlotKeys: ["material-slot-b"],
			},
		]);
	});

	it("orders compacted geometry by draw slice so each slice is contiguous", () => {
		const plan: CompactedGeometryPlan<TestCompactedGeometryDrawSlice> = {
			...createPlan(),
			compactableEntryIds: ["draw-b", "draw-a"],
		};

		const geometry = buildCompactedGeometryBatch({
			plan,
			entries: [
				createEntry("draw-a", "material-slot-a", 10),
				createEntry("draw-b", "material-slot-b", 20),
			],
			batchOrigin: { x: 0, y: 0, z: 0 },
		});

		expect(geometry?.drawRanges.map((range) => range.entryId)).toEqual([
			"draw-a",
			"draw-b",
		]);
		expect(geometry?.drawSlices.map((slice) => slice.firstIndex)).toEqual([
			0, 3,
		]);
	});

	it("rejects compaction entrys assigned to multiple compacted slices", () => {
		const basePlan = createPlan();
		const plan: CompactedGeometryPlan<TestCompactedGeometryDrawSlice> = {
			...basePlan,
			drawSlices: [
				...basePlan.drawSlices,
				{
					key: "slice-overlap",
					renderStateKey: "opaque",
					materialSlotKeys: ["material-slot-a"],
					entryIds: ["draw-a"],
				},
			],
		};

		expect(() =>
			buildCompactedGeometryBatch({
				plan,
				entries: [
					createEntry("draw-a", "material-slot-a", 10),
					createEntry("draw-b", "material-slot-b", 20),
				],
				batchOrigin: { x: 0, y: 0, z: 0 },
			}),
		).toThrow(/multiple draw slices/);
	});

	it("keeps the resource key stable for a common re-anchor shift", () => {
		const basePlan = createPlan();
		const firstSlice = basePlan.drawSlices[0];
		if (!firstSlice) {
			throw new Error("Fixture plan is missing its first draw slice.");
		}
		const plan = {
			...basePlan,
			compactableEntryIds: ["draw-a"],
			drawSlices: [firstSlice],
		};
		const first = buildCompactedGeometryBatch({
			plan,
			entries: [createEntry("draw-a", "material-slot-a", 10)],
			batchOrigin: { x: 10, y: 0, z: 0 },
		});
		const second = buildCompactedGeometryBatch({
			plan,
			entries: [createEntry("draw-a", "material-slot-a", 99)],
			batchOrigin: { x: 99, y: 0, z: 0 },
		});

		expect(first?.key).toBe(second?.key);
	});

	it("describes the worker job key without packing output buffers", () => {
		const basePlan = createPlan();
		const firstSlice = basePlan.drawSlices[0];
		if (!firstSlice) {
			throw new Error("Fixture plan is missing its first draw slice.");
		}
		const plan = {
			...basePlan,
			compactableEntryIds: ["draw-a"],
			drawSlices: [firstSlice],
		};
		const entry = createEntry("draw-a", "material-slot-a", 10);
		const unrelatedEntry = createEntry("draw-b", "material-slot-b", 500);
		const batchOrigin = { x: 10, y: 0, z: 0 };
		const geometry = buildCompactedGeometryBatch({
			plan,
			entries: [entry],
			batchOrigin,
		});

		expect(
			describeCompactedGeometryJobKey({
				plan,
				entries: [unrelatedEntry, entry],
				batchOrigin,
			}),
		).toBe(geometry?.key);
	});

	it("changes the resource key when relative static placement changes", () => {
		const basePlan = createPlan();
		const first = buildCompactedGeometryBatch({
			plan: basePlan,
			entries: [
				createEntry("draw-a", "material-slot-a", 10),
				createEntry("draw-b", "material-slot-b", 20),
			],
			batchOrigin: { x: 10, y: 0, z: 0 },
		});
		const second = buildCompactedGeometryBatch({
			plan: basePlan,
			entries: [
				createEntry("draw-a", "material-slot-a", 10),
				createEntry("draw-b", "material-slot-b", 30),
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
			compactableEntryIds: ["structured-a"],
			entryMaterialSlots: [
				{ entryId: "structured-a", materialSlotKey: "material-slot-a" },
			],
			drawSlices: [
				{
					...firstSlice,
					entryIds: ["structured-a"],
				},
			],
		};
		const geometry = buildCompactedGeometryBatch({
			plan,
			entries: [
				createEntry("structured-a", "material-slot-a", 100, {
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
				entryId: "structured-a",
				firstIndex: 0,
				indexCount: 3,
				materialSlotIndex: 0,
			},
		]);
	});

	it("uses explicit material slot mappings for non-RGBA compacted geometry families", () => {
		const basePlan = createPlan();
		const firstSlice = basePlan.drawSlices[0];
		const firstSlot = basePlan.materialSlots[0];
		if (!firstSlice || !firstSlot) {
			throw new Error("Fixture plan is missing its first slice or slot.");
		}
		const plan: CompactedGeometryPlan<TestCompactedGeometryDrawSlice> = {
			...basePlan,
			compactableEntryIds: ["indexed-a"],
			materialSlots: [{ ...firstSlot, key: "indexed-slot", index: 0 }],
			entryMaterialSlots: [
				{ entryId: "indexed-a", materialSlotKey: "indexed-slot" },
			],
			drawSlices: [
				{
					...firstSlice,
					materialSlotKeys: ["indexed-slot"],
					entryIds: ["indexed-a"],
				},
			],
		};

		const geometry = buildCompactedGeometryBatch({
			plan,
			entries: [
				createEntry("indexed-a", "ignored-atlas-slot", 10, {
					materialKind: "indexed-paletted",
				}),
			],
			batchOrigin: { x: 10, y: 0, z: 0 },
		});

		expect(geometry?.materialSlotIndices).toEqual(Float32Array.from([0, 0, 0]));
		expect(geometry?.drawRanges).toMatchObject([
			{
				entryId: "indexed-a",
				materialSlotIndex: 0,
			},
		]);
	});
});

function createPlan(): CompactedGeometryPlan<TestCompactedGeometryDrawSlice> {
	return {
		key: "plan-a",
		compactableEntryIds: ["draw-a", "draw-b"],
		materialSlots: [
			{
				key: "material-slot-a",
				index: 0,
			},
			{
				key: "material-slot-b",
				index: 1,
			},
		],
		entryMaterialSlots: [
			{ entryId: "draw-a", materialSlotKey: "material-slot-a" },
			{ entryId: "draw-b", materialSlotKey: "material-slot-b" },
		],
		drawSlices: [
			{
				key: "slice-a",
				renderStateKey: "opaque",
				materialSlotKeys: ["material-slot-a"],
				entryIds: ["draw-a"],
			},
			{
				key: "slice-b",
				renderStateKey: "opaque",
				materialSlotKeys: ["material-slot-b"],
				entryIds: ["draw-b"],
			},
		],
		triangleCount: 2,
	};
}

function createEntry(
	id: string,
	materialSlotKey: string,
	xOffset: number,
	options: {
		kind?: "static" | "structured-interior";
		owningLandblockId?: number;
		materialKind?: "direct-texture" | "indexed-paletted";
	} = {},
): CompactedGeometryBuildEntry {
	const kind = options.kind ?? "static";
	const materialKind = options.materialKind ?? "direct-texture";
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
		material:
			materialKind === "indexed-paletted"
				? createIndexedMaterial(id)
				: createDirectTextureMaterial(id, materialSlotKey),
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

function createDirectTextureMaterial(
	id: string,
	materialSlotKey: string,
): RenderDirectTextureMaterialPlan {
	return {
		kind: "direct-texture",
		key: `material/${id}`,
		color: new Float32Array([1, 1, 1, 1]),
		textureKey: `texture/${id}`,
		textureUpload: {} as RenderDirectTextureMaterialPlan["textureUpload"],
		behavior: createOpaqueBehavior(),
		fallbackReason: null,
		texturePageReadiness: {
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
	};
}

function createIndexedMaterial(id: string): RenderIndexedPalettedMaterialPlan {
	return {
		kind: "indexed-paletted",
		key: `indexed/${id}`,
		color: new Float32Array([1, 1, 1, 1]),
		indexedMaterial: {} as RenderIndexedPalettedMaterialPlan["indexedMaterial"],
		behavior: createOpaqueBehavior(),
		fallbackReason: null,
		detailOverlay: null,
		preparedAssetIds: [],
	};
}

function createOpaqueBehavior(): RenderDirectTextureMaterialPlan["behavior"] {
	return {
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
	};
}
