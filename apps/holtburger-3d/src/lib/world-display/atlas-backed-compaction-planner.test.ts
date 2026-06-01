import { describe, expect, it } from "vitest";

import {
	createEmptyAtlasBackedCompactionPlan,
	planAtlasBackedCompaction,
	type AtlasBackedCompactionCandidate,
} from "./atlas-backed-compaction-planner";
import type { LegacyMaterialBehaviorDto } from "./material-behavior";
import type { StagedWorldMaterialAtlasEligibility } from "./staged-world-material-strategy";

describe("atlas-backed compaction planner", () => {
	it("plans landblock-owned opaque direct-texture units into deterministic atlas slices", () => {
		const plan = planAtlasBackedCompaction({
			drawUnits: [
				createCandidate({ id: "static-b", entryKey: "entry-b" }),
				createCandidate({
					id: "structured-a",
					kind: "structured-interior",
					sceneDomain: "interior",
					entryKey: "entry-a",
					staticPartCount: 0,
					staticObjectKeys: [],
				}),
			],
			policy: {
				maxAtlasTextureSize: 32,
				maxAtlasTextureCount: 1,
				baseGutterPixels: 2,
				maxMaterialSlotsPerDraw: 4,
			},
		});

		expect(plan.compactableDrawUnitIds).toEqual(["static-b", "structured-a"]);
		expect(plan.bypasses).toEqual([]);
		expect(
			plan.atlasTextures[0]?.placements.map((entry) => entry.atlasEntryKey),
		).toEqual(["entry-a", "entry-b"]);
		expect(plan.materialSlots.map((slot) => slot.key)).toEqual([
			"slot-entry-a|detail=none",
			"slot-entry-b|detail=none",
		]);
		expect(plan.drawSlices).toMatchObject([
			{
				atlasTextureIndex: 0,
				materialTableSlotStart: 0,
				materialTableSlotCount: 2,
				drawUnitIds: ["static-b", "structured-a"],
			},
		]);
		expect(plan.staticPartCount).toBe(1);
		expect(plan.triangleCount).toBe(4);
		expect(plan.preparedTextureAssetIds).toEqual([
			"prepared-texture/entry-a",
			"prepared-texture/entry-b",
		]);
	});

	it("keeps unsupported first-slice materials on the staged path with reasons", () => {
		const plan = planAtlasBackedCompaction({
			drawUnits: [
				createCandidate({ id: "terrain", kind: "terrain" }),
				createCandidate({ id: "missing-landblock", owningLandblockId: null }),
				createCandidate({ id: "indexed", materialKind: "indexed-paletted" }),
				createCandidate({ id: "detail", hasDetailOverlay: true }),
				createCandidate({
					id: "clip",
					materialBehavior: { ...OPAQUE_BEHAVIOR, alphaTest: 0.5 },
				}),
				createCandidate({ id: "missing-entry", atlasEligibility: null }),
			],
			policy: {
				maxAtlasTextureSize: 32,
				maxAtlasTextureCount: 1,
				baseGutterPixels: 2,
				maxMaterialSlotsPerDraw: 4,
			},
		});

		expect(plan.compactableDrawUnitIds).toEqual([]);
		expect(plan.bypasses.map((bypass) => bypass.reason)).toEqual([
			"non-static",
			"missing-landblock-origin",
			"non-direct-texture",
			"missing-detail-atlas-entry",
			"non-opaque-material",
			"missing-atlas-eligibility",
		]);
	});

	it("keeps detail-overlay draw units compactable when an RGBA8 detail atlas entry is available", () => {
		const plan = planAtlasBackedCompaction({
			drawUnits: [
				createCandidate({
					id: "plain",
					entryKey: "base-a",
				}),
				createCandidate({
					id: "detailed",
					entryKey: "base-b",
					hasDetailOverlay: true,
					detailAtlasEntry: createDetailAtlasEntry("detail-b"),
				}),
			],
			policy: {
				maxAtlasTextureSize: 64,
				maxAtlasTextureCount: 1,
				baseGutterPixels: 2,
				maxMaterialSlotsPerDraw: 4,
			},
		});

		expect(plan.compactableDrawUnitIds).toEqual(["plain", "detailed"]);
		expect(plan.bypasses).toEqual([]);
		expect(plan.detailAtlasEntryRecords.map((entry) => entry.key)).toEqual([
			"detail-b",
		]);
		expect(plan.materialSlots).toMatchObject([
			{ key: "slot-base-a|detail=none", detailAtlasEntryKey: null },
			{ key: "slot-base-b|detail=detail-b", detailAtlasEntryKey: "detail-b" },
		]);
		expect(plan.drawSlices.map((slice) => slice.detailAtlasTextureIndex)).toEqual([
			null,
			0,
		]);
	});

	it("splits compaction material slots when the same base material has different detail state", () => {
		const plan = planAtlasBackedCompaction({
			drawUnits: [
				createCandidate({ id: "plain", entryKey: "shared" }),
				createCandidate({
					id: "detailed",
					entryKey: "shared",
					hasDetailOverlay: true,
					detailAtlasEntry: createDetailAtlasEntry("detail-shared"),
				}),
			],
			policy: {
				maxAtlasTextureSize: 64,
				maxAtlasTextureCount: 1,
				baseGutterPixels: 2,
				maxMaterialSlotsPerDraw: 4,
			},
		});

		expect(plan.materialSlots.map((slot) => slot.key)).toEqual([
			"slot-shared|detail=detail-shared",
			"slot-shared|detail=none",
		]);
		expect(plan.drawUnitMaterialSlots).toEqual([
			{ drawUnitId: "plain", materialSlotKey: "slot-shared|detail=none" },
			{
				drawUnitId: "detailed",
				materialSlotKey: "slot-shared|detail=detail-shared",
			},
		]);
	});

	it("reports source texture and material table overflow before GPU resources exist", () => {
		const plan = planAtlasBackedCompaction({
			drawUnits: [
				createCandidate({
					id: "too-big",
					entryKey: "too-big",
					width: 128,
					height: 8,
				}),
				createCandidate({ id: "slot-a", entryKey: "slot-a" }),
				createCandidate({ id: "slot-b", entryKey: "slot-b" }),
			],
			policy: {
				maxAtlasTextureSize: 64,
				maxAtlasTextureCount: 1,
				baseGutterPixels: 2,
				maxMaterialSlotsPerDraw: 1,
			},
		});

		expect(plan.compactableDrawUnitIds).toEqual(["slot-a"]);
		expect(plan.bypasses.map((bypass) => bypass.reason)).toEqual([
			"source-texture-too-large",
			"material-table-overflow",
		]);
	});

	it("creates an empty plan for store initialization", () => {
		expect(createEmptyAtlasBackedCompactionPlan()).toMatchObject({
			key: "atlas-backed-compaction/empty",
			compactableDrawUnitIds: [],
			atlasTextures: [],
			drawSlices: [],
		});
	});
});

const OPAQUE_BEHAVIOR: LegacyMaterialBehaviorDto = {
	color: [1, 1, 1],
	emissive: [0, 0, 0],
	emissiveIntensity: 0,
	opacity: 1,
	transparent: false,
	alphaTest: 0,
	side: "front",
	blend: {
		mode: "opaque",
		enabled: false,
		srcFactor: null,
		dstFactor: null,
		depthWrite: true,
	},
	unsupportedSurfaceFlags: [],
};

function createCandidate(
	options: Partial<AtlasBackedCompactionCandidate> & {
		entryKey?: string;
		width?: number;
		height?: number;
	} = {},
): AtlasBackedCompactionCandidate {
	const entryKey = options.entryKey ?? "entry";
	return {
		id: options.id ?? "static",
		kind: options.kind ?? "static",
		owningLandblockId:
			options.owningLandblockId === undefined
				? 0x0102ffff
				: options.owningLandblockId,
		sceneDomain: options.sceneDomain ?? "exterior",
		materialKind: options.materialKind ?? "direct-texture",
		materialKey: options.materialKey ?? `material-${entryKey}`,
		materialBehavior: options.materialBehavior ?? OPAQUE_BEHAVIOR,
		hasUvBuffer: options.hasUvBuffer ?? true,
		hasDetailOverlay: options.hasDetailOverlay ?? false,
		detailAtlasEntry: options.detailAtlasEntry ?? null,
		atlasEligibility:
			options.atlasEligibility === undefined
				? createAtlasEligibility({
						entryKey,
						width: options.width ?? 8,
						height: options.height ?? 8,
					})
				: options.atlasEligibility,
		triangleCount: options.triangleCount ?? 2,
		staticPartCount: options.staticPartCount ?? 1,
		staticObjectKeys: options.staticObjectKeys ?? [`object-${entryKey}`],
	};
}

function createDetailAtlasEntry(key: string) {
	return {
		key,
		renderSurfaceId: 0x06000002,
		sourceFormatRaw: 0x1c,
		width: 4,
		height: 4,
		bytes: new Uint8Array(4 * 4 * 4),
		format: "rgba8" as const,
		tiling: 12,
		blendMode: "dst-color" as const,
	};
}

function createAtlasEligibility(options: {
	entryKey: string;
	width: number;
	height: number;
}): StagedWorldMaterialAtlasEligibility {
	return {
		materialSlotKey: `slot-${options.entryKey}`,
		atlasEntryKey: options.entryKey,
		renderStateKey:
			"shader=atlas-color;blend=opaque;depth=write;alphaTest=0;side=front",
		samplingKey:
			"wrap=vertex;filter=linear/linear/linear;color=linear;mips=atlas",
		atlasEntry: {
			renderSurfaceId: 0x06000001,
			preparedTextureAssetId: `prepared-texture/${options.entryKey}`,
			level: {
				level: 0,
				width: options.width,
				height: options.height,
				formatRaw: 0x15,
				format: "A8R8G8B8",
				byteLength: options.width * options.height * 4,
				bytes: new Uint8Array(options.width * options.height * 4),
			},
			sourceHash: options.entryKey,
			sourceFormatRaw: 0x3154_5844,
		},
	};
}
