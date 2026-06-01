import { describe, expect, it } from "vitest";

import {
	createBakeEligibility,
	createEmptyBakedRenderablePlan,
	planBakedRenderables,
	type BakedRenderableCandidate,
} from "./baked-renderable-planner";
import type { LegacyMaterialBehaviorDto } from "./material-behavior";
import type { StagedWorldMaterialAtlasEligibility } from "./staged-world-material-strategy";

type CandidateOptions = Partial<BakedRenderableCandidate> & {
	entryKey?: string;
	width?: number;
	height?: number;
	materialKind?: "direct-texture" | "indexed-paletted";
	materialBehavior?: LegacyMaterialBehaviorDto | null;
	hasUvBuffer?: boolean;
	hasDetailOverlay?: boolean;
	atlasEligibility?: StagedWorldMaterialAtlasEligibility | null;
};

describe("baked renderable planner", () => {
	it("plans landblock-owned opaque direct-texture units into deterministic atlas slices", () => {
		const plan = planBakedRenderables({
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
			"slot-entry-a|wrap=clamp/clamp|detail=none",
			"slot-entry-b|wrap=clamp/clamp|detail=none",
		]);
		expect(plan.materialSlots.map((slot) => slot.samplingPolicy)).toEqual([
			{ wrapS: "clamp", wrapT: "clamp" },
			{ wrapS: "clamp", wrapT: "clamp" },
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
		const plan = planBakedRenderables({
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

	it("keeps material-only and geometry-only eligibility on the direct path", () => {
		const plan = planBakedRenderables({
			drawUnits: [
				createCandidate({ id: "material-only", owningLandblockId: null }),
				createCandidate({ id: "geometry-only", atlasEligibility: null }),
				createCandidate({ id: "fully-eligible" }),
			],
			policy: {
				maxAtlasTextureSize: 32,
				maxAtlasTextureCount: 1,
				baseGutterPixels: 2,
				maxMaterialSlotsPerDraw: 4,
			},
		});

		expect(plan.compactableDrawUnitIds).toEqual(["fully-eligible"]);
		expect(plan.bypasses).toMatchObject([
			{
				drawUnitId: "material-only",
				reason: "missing-landblock-origin",
			},
			{
				drawUnitId: "geometry-only",
				reason: "missing-atlas-eligibility",
			},
		]);
	});

	it("keeps detail-overlay draw units compactable when an RGBA8 detail atlas entry is available", () => {
		const plan = planBakedRenderables({
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
			{
				key: "slot-base-a|wrap=clamp/clamp|detail=none",
				detailAtlasEntryKey: null,
			},
			{
				key: "slot-base-b|wrap=clamp/clamp|detail=detail-b",
				detailAtlasEntryKey: "detail-b",
			},
		]);
		expect(plan.drawSlices.map((slice) => slice.detailAtlasTextureIndex)).toEqual([
			null,
			0,
		]);
	});

	it("splits compaction material slots when the same base material has different detail state", () => {
		const plan = planBakedRenderables({
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
			"slot-shared|wrap=clamp/clamp|detail=detail-shared",
			"slot-shared|wrap=clamp/clamp|detail=none",
		]);
		expect(plan.drawUnitMaterialSlots).toEqual([
			{
				drawUnitId: "plain",
				materialSlotKey: "slot-shared|wrap=clamp/clamp|detail=none",
			},
			{
				drawUnitId: "detailed",
				materialSlotKey: "slot-shared|wrap=clamp/clamp|detail=detail-shared",
			},
		]);
	});

	it("splits compaction material slots when the same base material has different wrap policy", () => {
		const plan = planBakedRenderables({
			drawUnits: [
				createCandidate({
					id: "clamp",
					entryKey: "shared",
					atlasEligibility: createAtlasEligibility({
						entryKey: "shared",
						width: 8,
						height: 8,
						materialSlotKey: "slot-shared",
						wrapS: "clamp",
						wrapT: "clamp",
					}),
				}),
				createCandidate({
					id: "repeat",
					entryKey: "shared",
					atlasEligibility: createAtlasEligibility({
						entryKey: "shared",
						width: 8,
						height: 8,
						materialSlotKey: "slot-shared",
						wrapS: "repeat",
						wrapT: "repeat",
					}),
				}),
			],
			policy: {
				maxAtlasTextureSize: 64,
				maxAtlasTextureCount: 1,
				baseGutterPixels: 2,
				maxMaterialSlotsPerDraw: 4,
			},
		});

		expect(plan.materialSlots).toMatchObject([
			{
				key: "slot-shared|wrap=clamp/clamp|detail=none",
				samplingPolicy: { wrapS: "clamp", wrapT: "clamp" },
			},
			{
				key: "slot-shared|wrap=repeat/repeat|detail=none",
				samplingPolicy: { wrapS: "repeat", wrapT: "repeat" },
			},
		]);
	});

	it("reports source texture and material table overflow before GPU resources exist", () => {
		const plan = planBakedRenderables({
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
		expect(createEmptyBakedRenderablePlan()).toMatchObject({
			key: "baked-renderables/empty",
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
	options: CandidateOptions = {},
): BakedRenderableCandidate {
	const entryKey = options.entryKey ?? "entry";
	const atlasEligibility =
		options.atlasEligibility === undefined
			? createAtlasEligibility({
					entryKey,
					width: options.width ?? 8,
					height: options.height ?? 8,
				})
			: options.atlasEligibility;
	const hasDetailOverlay = options.hasDetailOverlay ?? false;
	const detailAtlasEntry = options.detailAtlasEntry ?? null;
	const texturePageBindings =
		options.materialKind === "indexed-paletted" || !atlasEligibility
			? []
			: [
					{
						pageKind: "single-entry" as const,
						usageBucket: "base-color" as const,
						sampleClass: "rgba-color" as const,
						texture: {} as never,
						rect: [0, 0, options.width ?? 8, options.height ?? 8] as const,
						width: options.width ?? 8,
						height: options.height ?? 8,
						wrapS: atlasEligibility.samplingPolicy.wrapS,
						wrapT: atlasEligibility.samplingPolicy.wrapT,
						sampling: {
							wrapS: atlasEligibility.samplingPolicy.wrapS,
							wrapT: atlasEligibility.samplingPolicy.wrapT,
							minFilter: "linear" as const,
							magFilter: "linear" as const,
							mip: "material-policy" as const,
							samplingDomain: "color" as const,
							lookup: "color-filtered" as const,
						},
						source: "standalone-direct-texture" as const,
					},
				];
	return {
		id: options.id ?? "static",
		kind: options.kind ?? "static",
		owningLandblockId:
			options.owningLandblockId === undefined
				? 0x0102ffff
				: options.owningLandblockId,
		sceneDomain: options.sceneDomain ?? "exterior",
		materialKey: options.materialKey ?? `material-${entryKey}`,
		detailAtlasEntry,
		bakeEligibility: createBakeEligibility({
			kind: options.kind ?? "static",
			owningLandblockId:
				options.owningLandblockId === undefined
					? 0x0102ffff
					: options.owningLandblockId,
			hasUvBuffer: options.hasUvBuffer ?? true,
			texturePageBindings,
			materialBehavior: options.materialBehavior ?? OPAQUE_BEHAVIOR,
			hasDetailOverlay,
			detailAtlasEntry,
			atlasEligibility,
		}),
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
	materialSlotKey?: string;
	wrapS?: "clamp" | "repeat";
	wrapT?: "clamp" | "repeat";
}): StagedWorldMaterialAtlasEligibility {
	const wrapS = options.wrapS ?? "clamp";
	const wrapT = options.wrapT ?? "clamp";
	return {
		materialSlotKey: options.materialSlotKey ?? `slot-${options.entryKey}`,
		atlasEntryKey: options.entryKey,
		renderStateKey:
			"shader=atlas-color;blend=opaque;depth=write;alphaTest=0;side=front",
		samplingKey:
			`wrap=${wrapS}/${wrapT};filter=linear/linear/linear;color=linear;mips=atlas`,
		samplingPolicy: { wrapS, wrapT },
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
