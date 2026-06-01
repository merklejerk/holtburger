import { describe, expect, it } from "vitest";

import {
	createBakeEligibility,
	createEmptyBakedRenderablePlan,
	planBakedRenderables,
	type BakedRenderableCandidate,
	type BakedIndexedMaterialTableRecord,
} from "./baked-renderable-planner";
import type { LegacyMaterialBehaviorDto } from "./material-behavior";
import type { StagedWorldMaterialAtlasEligibility } from "./staged-world-material-strategy";
import type { TexturePageBinding } from "./texture-page-binding";

type CandidateOptions = Partial<BakedRenderableCandidate> & {
	entryKey?: string;
	width?: number;
	height?: number;
	materialKind?:
		| "flat"
		| "direct-texture"
		| "indexed-paletted"
		| "terrain-blend";
	materialBehavior?: LegacyMaterialBehaviorDto | null;
	hasUvBuffer?: boolean;
	hasDetailOverlay?: boolean;
	atlasEligibility?: StagedWorldMaterialAtlasEligibility | null;
	texturePageBindings?: readonly TexturePageBinding[];
	indexedMaterialTableRecord?: BakedIndexedMaterialTableRecord | null;
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
		expect(plan.submitFamilies.rgbaAtlas.compactableDrawUnitIds).toEqual([
			"static-b",
			"structured-a",
		]);
		expect(plan.submitFamilies.rgbaAtlas.materialSlots).toEqual(
			plan.materialSlots,
		);
		expect(plan.submitFamilies.indexedPaletted.materialTableRecords).toEqual(
			[],
		);
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
			"unsupported-indexed-paletted-material",
			"missing-detail-atlas-entry",
			"unsupported-alpha-test-material",
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

	it("keeps indexed texture-page readiness separate from baked indexed shader support", () => {
		const indexed = createCandidate({ materialKind: "indexed-paletted" });

		expect(indexed.bakeEligibility.material).toMatchObject({
			family: "indexed-paletted",
			alphaPolicy: "opaque",
			blockers: ["missing-baked-indexed-paletted-family"],
		});

		const missingPalette = createCandidate({
			materialKind: "indexed-paletted",
			texturePageBindings: [createIndexedTexelTexturePageBinding()],
		});

		expect(missingPalette.bakeEligibility.material.blockers).toEqual([
			"missing-indexed-palette-page",
			"missing-baked-indexed-paletted-family",
		]);
	});

	it("expresses indexed sampling and alpha policy as orthogonal bake facts", () => {
		const cutoutIndexed = createCandidate({
			materialKind: "indexed-paletted",
			materialBehavior: { ...OPAQUE_BEHAVIOR, alphaTest: 0.5 },
		});

		expect(cutoutIndexed.bakeEligibility.material).toMatchObject({
			family: "indexed-paletted",
			alphaPolicy: "cutout",
			blockers: [
				"missing-baked-indexed-paletted-family",
				"indexed-alpha-policy-unsupported",
			],
		});
	});

	it("builds indexed opaque material-table records without compacting them before submit support", () => {
		const plan = planBakedRenderables({
			drawUnits: [
				createCandidate({
					id: "indexed-a",
					materialKey: "indexed/material-a",
					materialKind: "indexed-paletted",
					indexedMaterialTableRecord: createIndexedMaterialTableRecord("a"),
				}),
				createCandidate({
					id: "indexed-cutout",
					materialKey: "indexed/material-cutout",
					materialKind: "indexed-paletted",
					materialBehavior: { ...OPAQUE_BEHAVIOR, alphaTest: 0.5 },
					indexedMaterialTableRecord: createIndexedMaterialTableRecord("cutout"),
				}),
			],
			policy: {
				maxAtlasTextureSize: 32,
				maxAtlasTextureCount: 1,
				baseGutterPixels: 2,
				maxMaterialSlotsPerDraw: 4,
			},
		});

		expect(plan.compactableDrawUnitIds).toEqual([]);
		expect(plan.indexedMaterialTableRecords).toEqual([
			createIndexedMaterialTableRecord("a"),
		]);
		expect(plan.submitFamilies.rgbaAtlas.compactableDrawUnitIds).toEqual([]);
		expect(plan.submitFamilies.indexedPaletted).toMatchObject({
			kind: "indexed-paletted",
			compactableDrawUnitIds: [],
			materialTableRecords: [createIndexedMaterialTableRecord("a")],
			drawUnitMaterialSlots: [],
			drawSlices: [],
		});
		expect(plan.bypasses.map((bypass) => bypass.reason)).toEqual([
			"unsupported-indexed-paletted-material",
			"unsupported-indexed-paletted-material",
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
		options.texturePageBindings ??
		createTexturePageBindings({
			materialKind: options.materialKind ?? "direct-texture",
			atlasEligibility,
			width: options.width ?? 8,
			height: options.height ?? 8,
		});
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
		detailAtlasEntry,
		indexedMaterialTableRecord:
			options.indexedMaterialTableRecord === undefined
				? options.materialKind === "indexed-paletted"
					? createIndexedMaterialTableRecord(entryKey)
					: null
				: options.indexedMaterialTableRecord,
		bakeEligibility: createBakeEligibility({
			kind: options.kind ?? "static",
			owningLandblockId:
				options.owningLandblockId === undefined
					? 0x0102ffff
					: options.owningLandblockId,
			materialKind: options.materialKind ?? "direct-texture",
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

function createIndexedMaterialTableRecord(
	key: string,
): BakedIndexedMaterialTableRecord {
	return {
		key: `indexed-table-${key}`,
		sourceMaterialKey: `indexed/material-${key}`,
		indexPageKey: `index-page-${key}`,
		palettePageKey: `palette-page-${key}`,
		indexFormat: "p8",
		indexPageWidth: 8,
		indexPageHeight: 8,
		paletteColorCount: 256,
		clipThreshold: 8,
		wrapS: "clamp",
		wrapT: "clamp",
		alphaPolicy: "opaque",
		filteringMode: "shader-palette-linear",
	};
}

function createTexturePageBindings({
	materialKind,
	atlasEligibility,
	width,
	height,
}: {
	materialKind: NonNullable<CandidateOptions["materialKind"]>;
	atlasEligibility: StagedWorldMaterialAtlasEligibility | null;
	width: number;
	height: number;
}): readonly TexturePageBinding[] {
	if (materialKind === "indexed-paletted") {
		return [
			createIndexedTexelTexturePageBinding({ width, height }),
			createIndexedPaletteTexturePageBinding(),
		];
	}
	if (!atlasEligibility) {
		return [];
	}
	return [
		{
			pageKind: "single-entry",
			usageBucket: "base-color",
			sampleClass: "rgba-color",
			texture: {} as never,
			rect: [0, 0, width, height],
			width,
			height,
			wrapS: atlasEligibility.samplingPolicy.wrapS,
			wrapT: atlasEligibility.samplingPolicy.wrapT,
			sampling: {
				wrapS: atlasEligibility.samplingPolicy.wrapS,
				wrapT: atlasEligibility.samplingPolicy.wrapT,
				minFilter: "linear",
				magFilter: "linear",
				mip: "material-policy",
				samplingDomain: "color",
				lookup: "color-filtered",
			},
			source: "standalone-direct-texture",
		},
	];
}

function createIndexedTexelTexturePageBinding({
	width = 8,
	height = 8,
}: {
	width?: number;
	height?: number;
} = {}): TexturePageBinding {
	return {
		pageKind: "single-entry",
		usageBucket: "indexed-texels",
		sampleClass: "indexed-data",
		texture: {} as never,
		rect: [0, 0, width, height],
		width,
		height,
		wrapS: "clamp",
		wrapT: "clamp",
		sampling: {
			wrapS: "clamp",
			wrapT: "clamp",
			minFilter: "nearest",
			magFilter: "nearest",
			mip: "none",
			samplingDomain: "data",
			lookup: "exact",
		},
		source: "indexed-material",
	};
}

function createIndexedPaletteTexturePageBinding(): TexturePageBinding {
	return {
		pageKind: "single-entry",
		usageBucket: "palette-lookup",
		sampleClass: "palette-data",
		texture: {} as never,
		rect: [0, 0, 256, 1],
		width: 256,
		height: 1,
		wrapS: "clamp",
		wrapT: "clamp",
		sampling: {
			wrapS: "clamp",
			wrapT: "clamp",
			minFilter: "nearest",
			magFilter: "nearest",
			mip: "none",
			samplingDomain: "data",
			lookup: "exact",
		},
		source: "indexed-material",
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
