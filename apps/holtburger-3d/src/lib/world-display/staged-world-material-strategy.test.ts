import { describe, expect, it } from "vitest";

import {
	createInitialAssetChannelState,
	formatAtlasReadyPreparedTextureAssetId,
	type AssetChannelState,
	type PreparedAssetRecord,
	type PreparedMaterialRecipePayload,
	type PreparedPalettePayload,
	type PreparedRenderSurfacePayload,
	type PreparedTexturePayload,
} from "../assets/types";
import {
	planStagedWorldMaterialStrategies,
	resolveStagedWorldMaterialStrategy,
} from "./staged-world-material-strategy";
import { resolveStagedWorldMaterialSlotPlan } from "./staged-world-materials";
import type { ResolvedMaterialSlot } from "./material-plan";

const PIXEL_FORMAT_A8R8G8B8 = 0x15;
const PIXEL_FORMAT_DXT1 = 0x3154_5844;
const PIXEL_FORMAT_INDEX16 = 0x65;
const SURFACE_TYPE_DIFFUSE = 0x20;
const SURFACE_TYPE_ALPHA = 0x100;

describe("staged world material strategy", () => {
	it("resolves atlas-eligible compressed materials as direct staged textures", () => {
		const state = createAssetState([
			createMaterialRecipeRecord({
				surfaceId: 0x08000001,
				renderSurfaceId: 0x06000001,
			}),
			createRenderSurfaceRecord({ renderSurfaceId: 0x06000001 }),
			createAtlasPreparedTextureRecord({ renderSurfaceId: 0x06000001 }),
		]);

		const strategy = resolveStagedWorldMaterialStrategy({
			assetState: state,
			input: createRequirement("static", 0),
		});

		expect(strategy.kind).toBe("direct-texture");
		expect(strategy).toMatchObject({
			kind: "direct-texture",
			reason: null,
			detail: null,
			atlasEligibility: {
				atlasEntryKey: expect.stringContaining("atlas-entry"),
				atlasEntry: {
					preparedTextureAssetId:
						"prepared-texture/06000001?usage=raw&out=rgba8&mips=none&cs=linear",
				},
			},
		});
	});

	it("keeps atlas candidacy out of staged fallback reasons", () => {
		const state = createAssetState([
			createMaterialRecipeRecord({
				surfaceId: 0x08000001,
				renderSurfaceId: 0x06000001,
			}),
			createRenderSurfaceRecord({ renderSurfaceId: 0x06000001 }),
			createAtlasPreparedTextureRecord({ renderSurfaceId: 0x06000001 }),
		]);

		const material = resolveStagedWorldMaterialSlotPlan({
			assetState: state,
			slot: createMaterialSlot({ slotIndex: 0, surfaceId: 0x08000001 }),
			fallbackColorKey: "test/static",
			renderableKind: "static",
		});

		expect(material).toMatchObject({
			kind: "direct-texture",
			fallbackReason: null,
			preparedAssetIds: [
				"material/08000001",
				"prepared-texture/06000001?usage=raw&out=rgba8&mips=none&cs=linear",
				"render-surface/06000001",
			],
		});
	});

	it("uses the same staged direct policy for structured interiors", () => {
		const state = createAssetState([
			createMaterialRecipeRecord({
				surfaceId: 0x08000001,
				renderSurfaceId: 0x06000001,
			}),
			createRenderSurfaceRecord({ renderSurfaceId: 0x06000001 }),
			createAtlasPreparedTextureRecord({ renderSurfaceId: 0x06000001 }),
		]);

		const strategy = resolveStagedWorldMaterialStrategy({
			assetState: state,
			input: createRequirement("structured-interior", 0),
		});

		expect(strategy).toMatchObject({
			kind: "direct-texture",
			renderableKind: "structured-interior",
			reason: null,
			atlasEligibility: {
				atlasEntry: {
					renderSurfaceId: 0x06000001,
				},
			},
		});
	});

	it("reports invalid indexed payloads as explicit fallbacks", () => {
		const state = createAssetState([
			createMaterialRecipeRecord({
				surfaceId: 0x08000001,
				renderSurfaceId: 0x06000001,
			}),
			createRenderSurfaceRecord({
				renderSurfaceId: 0x06000001,
				formatRaw: PIXEL_FORMAT_INDEX16,
				format: "Index16",
			}),
		]);

		const strategy = resolveStagedWorldMaterialStrategy({
			assetState: state,
			input: createRequirement("static", 0),
		});

		expect(strategy).toMatchObject({
			kind: "flat-fallback",
			reason: "indexed-paletted-deferred",
			detail: expect.stringContaining(
				"could not resolve indexed palette resources",
			),
		});
	});

	it("resolves indexed/paletted materials with prepared palette resources", () => {
		const state = createAssetState([
			createMaterialRecipeRecord({
				surfaceId: 0x08000001,
				renderSurfaceId: 0x06000001,
				paletteId: 0x04000001,
			}),
			createRenderSurfaceRecord({
				renderSurfaceId: 0x06000001,
				formatRaw: PIXEL_FORMAT_INDEX16,
				format: "Index16",
				width: 2,
				height: 1,
				sourceBytes: new Uint8Array([0, 0, 1, 0]),
				defaultPaletteId: 0x04000001,
			}),
			createPaletteRecord(0x04000001, [0xff000000, 0xffffffff]),
		]);

		const strategy = resolveStagedWorldMaterialStrategy({
			assetState: state,
			input: createRequirement("static", 0),
		});

		expect(strategy).toMatchObject({
			kind: "indexed-paletted",
			materialAssetId: "material/08000001",
			indexedMaterial: {
				texture: { format: "index16", maxIndex: 1 },
				palette: { colorCount: 2 },
			},
		});
	});

	it("keeps alpha indexed/paletted materials on the indexed shader path", () => {
		const state = createAssetState([
			createMaterialRecipeRecord({
				surfaceId: 0x08000001,
				renderSurfaceId: 0x06000001,
				paletteId: 0x04000001,
				surfaceType: SURFACE_TYPE_DIFFUSE | SURFACE_TYPE_ALPHA,
			}),
			createRenderSurfaceRecord({
				renderSurfaceId: 0x06000001,
				formatRaw: PIXEL_FORMAT_INDEX16,
				format: "Index16",
				width: 2,
				height: 1,
				sourceBytes: new Uint8Array([0, 0, 1, 0]),
				defaultPaletteId: 0x04000001,
			}),
			createPaletteRecord(0x04000001, [0x00000000, 0xffffffff]),
		]);

		const strategy = resolveStagedWorldMaterialStrategy({
			assetState: state,
			input: createRequirement("static", 0),
		});

		expect(strategy).toMatchObject({
			kind: "indexed-paletted",
			behavior: {
				transparent: true,
				blend: {
					enabled: true,
					mode: "alpha",
					depthWrite: false,
				},
			},
			indexedMaterial: {
				texture: { format: "index16", maxIndex: 1 },
				palette: { colorCount: 2 },
			},
		});
	});

	it("deduplicates atlas entries across static and structured-interior requirements", () => {
		const state = createAssetState([
			createMaterialRecipeRecord({
				surfaceId: 0x08000001,
				renderSurfaceId: 0x06000001,
			}),
			createRenderSurfaceRecord({ renderSurfaceId: 0x06000001 }),
			createAtlasPreparedTextureRecord({ renderSurfaceId: 0x06000001 }),
		]);

		const plan = planStagedWorldMaterialStrategies({
			assetState: state,
			requirements: [
				createRequirement("static", 0),
				createRequirement("structured-interior", 1),
			],
		});

		expect(plan.atlasSet.atlasEntries).toHaveLength(1);
		expect(plan.atlasSet.atlasTextures[0]?.placements).toHaveLength(1);
		expect(plan.atlasLayoutDecisions.map((entry) => entry.kind)).toEqual([
			"atlas",
			"atlas",
		]);
		expect(
			plan.atlasLayoutDecisions.map((entry) =>
				entry.kind === "atlas" ? entry.atlasEntryKey : entry.reason,
			),
		).toEqual([
			plan.atlasSet.atlasEntries[0]?.key,
			plan.atlasSet.atlasEntries[0]?.key,
		]);
	});

	it("requires atlas-ready decompressed prepared textures for compressed surfaces", () => {
		const state = createAssetState([
			createMaterialRecipeRecord({
				surfaceId: 0x08000001,
				renderSurfaceId: 0x06000001,
			}),
			createRenderSurfaceRecord({ renderSurfaceId: 0x06000001 }),
		]);

		const plan = planStagedWorldMaterialStrategies({
			assetState: state,
			requirements: [createRequirement("static", 0)],
		});

		expect(plan.atlasLayoutDecisions).toMatchObject([
			{
				kind: "flat-fallback",
				reason: "missing-decompressed-prepared-texture",
			},
		]);
		expect(plan.fallbackReasonCounts).toEqual({
			"missing-decompressed-prepared-texture": 1,
		});
	});

	it("classifies direct-color and normalized blended compressed materials as direct-texture", () => {
		const state = createAssetState([
			createMaterialRecipeRecord({
				surfaceId: 0x08000001,
				renderSurfaceId: 0x06000001,
			}),
			createRenderSurfaceRecord({
				renderSurfaceId: 0x06000001,
				formatRaw: PIXEL_FORMAT_A8R8G8B8,
				format: "A8R8G8B8",
			}),
			createMaterialRecipeRecord({
				surfaceId: 0x08000002,
				renderSurfaceId: 0x06000002,
				surfaceType: SURFACE_TYPE_DIFFUSE | SURFACE_TYPE_ALPHA,
			}),
			createRenderSurfaceRecord({ renderSurfaceId: 0x06000002 }),
			createAtlasPreparedTextureRecord({ renderSurfaceId: 0x06000002 }),
		]);

		const plan = planStagedWorldMaterialStrategies({
			assetState: state,
			requirements: [
				createRequirement("static", 0, 0x08000001),
				createRequirement("static", 1, 0x08000002),
			],
		});

		expect(
			plan.atlasLayoutDecisions.map((entry) =>
				entry.kind === "flat-fallback" || entry.kind === "unsupported"
					? entry.reason
					: entry.kind,
			),
		).toEqual(["direct-texture", "direct-texture"]);

		const s3tcPlan = planStagedWorldMaterialStrategies({
			assetState: state,
			requirements: [
				createRequirement("static", 0, 0x08000001),
				createRequirement("static", 1, 0x08000002),
			],
			textureCapabilities: {
				supportsS3tc: true,
				supportsS3tcSrgb: false,
				supportsPackedRgb565: false,
				supportsPackedRgba4444: true,
				maxAnisotropy: 1,
			},
		});

		expect(s3tcPlan.atlasLayoutDecisions.map((entry) => entry.kind)).toEqual([
			"direct-texture",
			"direct-texture",
		]);
	});

	it("creates additional atlas textures until the configured atlas set capacity is exhausted", () => {
		const records: PreparedAssetRecord[] = [];
		for (let index = 0; index < 3; index += 1) {
			const surfaceId = 0x08000010 + index;
			const renderSurfaceId = 0x06000010 + index;
			records.push(
				createMaterialRecipeRecord({ surfaceId, renderSurfaceId }),
				createRenderSurfaceRecord({ renderSurfaceId }),
				createAtlasPreparedTextureRecord({ renderSurfaceId }),
			);
		}
		const plan = planStagedWorldMaterialStrategies({
			assetState: createAssetState(records),
			requirements: [0, 1, 2].map((index) =>
				createRequirement("static", index, 0x08000010 + index),
			),
			policy: {
				maxAtlasTextureSize: 16,
				maxAtlasTextureCount: 2,
				baseGutterPixels: 2,
			},
		});

		expect(plan.atlasSet.atlasTextures).toHaveLength(2);
		expect(
			plan.atlasSet.drawSlices.map((slice) => slice.atlasTextureIndex),
		).toEqual([0, 1]);
		expect(
			plan.atlasLayoutDecisions.map((entry) =>
				entry.kind === "flat-fallback" || entry.kind === "unsupported"
					? entry.reason
					: entry.kind === "atlas"
						? entry.atlasTextureIndex
						: entry.kind,
			),
		).toEqual([0, 1, "atlas-full"]);
	});

	it("falls back when the bounded material table overflows", () => {
		const state = createAssetState([
			createMaterialRecipeRecord({
				surfaceId: 0x08000001,
				renderSurfaceId: 0x06000001,
			}),
			createRenderSurfaceRecord({ renderSurfaceId: 0x06000001 }),
			createAtlasPreparedTextureRecord({ renderSurfaceId: 0x06000001 }),
			createMaterialRecipeRecord({
				surfaceId: 0x08000002,
				renderSurfaceId: 0x06000002,
			}),
			createRenderSurfaceRecord({ renderSurfaceId: 0x06000002 }),
			createAtlasPreparedTextureRecord({ renderSurfaceId: 0x06000002 }),
		]);

		const plan = planStagedWorldMaterialStrategies({
			assetState: state,
			requirements: [
				createRequirement("static", 0, 0x08000001),
				createRequirement("static", 1, 0x08000002),
			],
			policy: { maxMaterialSlotsPerDraw: 1 },
		});

		expect(
			plan.atlasLayoutDecisions.map((entry) =>
				entry.kind === "flat-fallback" || entry.kind === "unsupported"
					? entry.reason
					: entry.kind,
			),
		).toEqual(["atlas", "material-table-overflow"]);
	});
});

function createRequirement(
	renderableKind: "static" | "structured-interior",
	slotIndex: number,
	surfaceId = 0x08000001,
) {
	return {
		renderableKind,
		slot: createMaterialSlot({ slotIndex, surfaceId }),
	};
}

function createMaterialSlot(options: {
	slotIndex: number;
	surfaceId: number;
}): ResolvedMaterialSlot {
	return {
		slotIndex: options.slotIndex,
		surfaceId: options.surfaceId,
		materialAssetId: `material/${options.surfaceId.toString(16).padStart(8, "0")}`,
		materialVariantSignature: null,
	};
}

function createAssetState(records: PreparedAssetRecord[]): AssetChannelState {
	const state = createInitialAssetChannelState();
	state.preparedByAssetId = Object.fromEntries(
		records.map((record) => [record.request.assetId, record]),
	);
	return state;
}

function createMaterialRecipeRecord(options: {
	surfaceId: number;
	renderSurfaceId: number;
	surfaceType?: number;
	paletteId?: number | null;
}): PreparedAssetRecord {
	const assetId = `material/${options.surfaceId.toString(16).padStart(8, "0")}`;
	return createRecord(assetId, {
		kind: "material-recipe",
		sourceAssetKind: "material-recipe",
		residencyKind: "unknown",
		provenance: createProvenance(),
		surfaceId: options.surfaceId,
		surfaceType: options.surfaceType ?? SURFACE_TYPE_DIFFUSE,
		source: {
			kind: "texture",
			surfaceTextureId: 0x05000001,
			selectedRenderSurfaceId: options.renderSurfaceId,
			paletteId: options.paletteId ?? null,
			renderSurfaceDefaultPaletteIds: [],
		},
		translucency: 0,
		luminosity: 0,
		diffuse: 1,
		dependencies: {
			surfaceTextureAssetIds: [],
			renderSurfaceAssetIds: [
				`render-surface/${options.renderSurfaceId.toString(16).padStart(8, "0")}`,
			],
			paletteAssetIds: [],
		},
	} satisfies PreparedMaterialRecipePayload);
}

function createRenderSurfaceRecord(options: {
	renderSurfaceId: number;
	formatRaw?: number;
	format?: string;
	width?: number;
	height?: number;
	sourceBytes?: Uint8Array;
	defaultPaletteId?: number | null;
}): PreparedAssetRecord {
	const assetId = `render-surface/${options.renderSurfaceId.toString(16).padStart(8, "0")}`;
	const width = options.width ?? 8;
	const height = options.height ?? 8;
	const sourceByteLength =
		options.sourceBytes?.byteLength ??
		(options.formatRaw === PIXEL_FORMAT_A8R8G8B8 ? width * height * 4 : 32);
	return createRecord(assetId, {
		kind: "render-surface",
		sourceAssetKind: "render-surface",
		residencyKind: "unknown",
		provenance: createProvenance(),
		renderSurfaceId: options.renderSurfaceId,
		unknown: 0,
		width,
		height,
		formatRaw: options.formatRaw ?? PIXEL_FORMAT_DXT1,
		format: options.format ?? "DXT1",
		sourceByteLength,
		sourceBytes: options.sourceBytes ?? new Uint8Array(sourceByteLength),
		defaultPaletteId: options.defaultPaletteId ?? null,
		dependencies: {
			paletteAssetIds:
				options.defaultPaletteId === undefined || options.defaultPaletteId === null
					? []
					: [
							`palette/${options.defaultPaletteId.toString(16).padStart(8, "0")}`,
						],
		},
	} satisfies PreparedRenderSurfacePayload);
}

function createPaletteRecord(
	paletteId: number,
	colorsArgb: readonly number[],
): PreparedAssetRecord {
	return createRecord(`palette/${paletteId.toString(16).padStart(8, "0")}`, {
		kind: "palette",
		sourceAssetKind: "palette",
		residencyKind: "unknown",
		provenance: createProvenance(),
		paletteId,
		colorCount: colorsArgb.length,
		colorsArgb: new Uint32Array(colorsArgb),
	} satisfies PreparedPalettePayload);
}

function createAtlasPreparedTextureRecord(options: {
	renderSurfaceId: number;
}): PreparedAssetRecord {
	const assetId = formatAtlasReadyPreparedTextureAssetId({
		renderSurfaceId: options.renderSurfaceId,
		usage: "raw",
	});
	return createRecord(assetId, {
		kind: "prepared-texture",
		sourceAssetKind: "prepared-texture",
		residencyKind: "unknown",
		provenance: createProvenance(),
		renderSurfaceId: options.renderSurfaceId,
		usage: "raw",
		outputFormat: "rgba8",
		mipPolicy: "none",
		colorSpace: "linear",
		sourceFormatRaw: PIXEL_FORMAT_DXT1,
		sourceFormat: "DXT1",
		sourceWidth: 8,
		sourceHeight: 8,
		sourceByteLength: 32,
		sourceHash: `hash-${options.renderSurfaceId}`,
		levels: [
			{
				level: 0,
				width: 8,
				height: 8,
				formatRaw: PIXEL_FORMAT_A8R8G8B8,
				format: "A8R8G8B8",
				byteLength: 256,
				bytes: new Uint8Array(256),
			},
		],
		dependencies: {
			renderSurfaceAssetIds: [
				`render-surface/${options.renderSurfaceId.toString(16).padStart(8, "0")}`,
			],
		},
		diagnostics: {
			generatedLevelCount: 1,
			generatedByteLength: 256,
			decodeMs: 0,
			downsampleMs: 0,
			encodeMs: 0,
			totalMs: 0,
		},
	} satisfies PreparedTexturePayload);
}

function createRecord(
	assetId: string,
	payload: PreparedAssetRecord["payload"],
): PreparedAssetRecord {
	return {
		request: { assetId },
		response: { assetId, status: "ready", payload },
		payload,
		preparedAt: "test",
	} as PreparedAssetRecord;
}

function createProvenance() {
	return {
		source: "cache",
		sourceAssetKind: null,
		errorCode: null,
		detail: null,
	} as const;
}
