import { describe, expect, it } from "vitest";

import {
	createInitialAssetChannelState,
	type PreparedAssetRecord,
} from "./types";
import { createTestPreparedAssetResolver } from "../../../test-support/prepared-asset-resolver";
import { describeMaterialAssetDiagnostics } from "./material-diagnostics";

describe("material diagnostics", () => {
	it("summarizes prepared material resources and missing recipe dependencies", () => {
		const material = createMaterialRecipeRecord("material/08000001", {
			surfaceTextureAssetIds: ["surface-texture/05000001"],
			renderSurfaceAssetIds: ["render-surface/06000001"],
			paletteAssetIds: ["palette/04000001"],
		});
		const state = createInitialAssetChannelState();
		const records = [
			material,
			createSurfaceTextureRecord("surface-texture/05000001"),
		];

		const diagnostics = describeMaterialAssetDiagnostics({
			assetPresentationState: state,
			preparedAssetResolver: createTestPreparedAssetResolver(records),
			browserDestination: null,
			options: {
				terrainRadius: 0,
				buildingRadius: 0,
				detailRadius: 0,
				envCellRadius: 0,
			},
		});

		expect(diagnostics).toContain("recipes 1 (1 texture, 0 solid)");
		expect(diagnostics).toContain(
			"render resources 1 surface textures, 0 surfaces",
		);
		expect(diagnostics).toContain("missing deps surface texture 0");
		expect(diagnostics).toContain(
			"surface 1 (render-surface/06000001), palette 1 (palette/04000001)",
		);
	});

	it("shows pending material pipeline assets separately from missing assets", () => {
		const state = createInitialAssetChannelState();
		state.activeRequest = {
			requestId: "fixture-material",
			assetId: "material/08000002",
			priority: "streaming",
		};
		state.history = [
			{
				requestId: "fixture-material",
				assetId: "material/08000002",
				priority: "streaming",
				status: "requested",
				channel: "tauri",
				timestamp: "2026-05-24T00:00:00.000Z",
			},
		];

		const diagnostics = describeMaterialAssetDiagnostics({
			assetPresentationState: state,
			preparedAssetResolver: createTestPreparedAssetResolver(),
			browserDestination: null,
			options: {
				terrainRadius: 0,
				buildingRadius: 0,
				detailRadius: 0,
				envCellRadius: 0,
			},
		});

		expect(diagnostics).toContain("pending 1 (material/08000002)");
	});

	it("summarizes indexed material coverage and palette diagnostics", () => {
		const indexedRecipe = createMaterialRecipeRecord(
			"material/08000003",
			{
				surfaceTextureAssetIds: [],
				renderSurfaceAssetIds: [
					"render-surface/06000003",
					"render-surface/06000004",
				],
				paletteAssetIds: ["palette/04000003"],
			},
			{
				paletteId: 0x04000003,
				selectedRenderSurfaceId: 0x06000003,
			},
		);
		const emptyPaletteRecipe = createMaterialRecipeRecord(
			"material/08000005",
			{
				surfaceTextureAssetIds: [],
				renderSurfaceAssetIds: ["render-surface/06000005"],
				paletteAssetIds: ["palette/04000004"],
			},
			{
				paletteId: 0x04000004,
				selectedRenderSurfaceId: 0x06000005,
			},
		);
		const defaultPaletteRecipe = createMaterialRecipeRecord(
			"material/08000004",
			{
				surfaceTextureAssetIds: [],
				renderSurfaceAssetIds: ["render-surface/06000006"],
				paletteAssetIds: ["palette/04000006"],
			},
			{
				paletteId: null,
				selectedRenderSurfaceId: 0x06000006,
				renderSurfaceDefaultPaletteIds: [0x04000006],
			},
		);
		const state = createInitialAssetChannelState();
		const records = [
			indexedRecipe,
			emptyPaletteRecipe,
			defaultPaletteRecipe,
			createRenderSurfaceRecord("render-surface/06000003", {
				formatRaw: 0x29,
				format: "P8",
				sourceBytes: new Uint8Array([0, 1]),
				defaultPaletteId: null,
			}),
			createRenderSurfaceRecord("render-surface/06000004", {
				formatRaw: 0x65,
				format: "Index16",
				sourceBytes: new Uint8Array([0x00, 0x00, 0x03, 0x00]),
				defaultPaletteId: null,
			}),
			createRenderSurfaceRecord("render-surface/06000005", {
				formatRaw: 0x29,
				format: "P8",
				sourceBytes: new Uint8Array([0]),
				defaultPaletteId: null,
			}),
			createRenderSurfaceRecord("render-surface/06000006", {
				formatRaw: 0x65,
				format: "Index16",
				sourceBytes: new Uint8Array([0x01, 0x00]),
				defaultPaletteId: 0x04000006,
			}),
			createPaletteRecord("palette/04000003", 2),
			createPaletteRecord("palette/04000004", 0),
			createPaletteRecord("palette/04000006", 2),
		];

		const diagnostics = describeMaterialAssetDiagnostics({
			assetPresentationState: state,
			preparedAssetResolver: createTestPreparedAssetResolver(records),
			browserDestination: null,
			options: {
				terrainRadius: 0,
				buildingRadius: 0,
				detailRadius: 0,
				envCellRadius: 0,
			},
		});

		expect(diagnostics).toContain("indexed recipes 3");
		expect(diagnostics).toContain("surfaces P8 2, Index16 1");
		expect(diagnostics).toContain(
			"palettes prepared 2, recipe 2, default 1, missing 0",
		);
		expect(diagnostics).toContain("empty 1 (palette/04000004)");
		expect(diagnostics).toContain("range errors 0");
	});
});

function createMaterialRecipeRecord(
	assetId: string,
	dependencies: {
		surfaceTextureAssetIds: string[];
		renderSurfaceAssetIds: string[];
		paletteAssetIds: string[];
	},
	options: {
		paletteId?: number | null;
		selectedRenderSurfaceId?: number | null;
		renderSurfaceDefaultPaletteIds?: number[];
	} = {},
): PreparedAssetRecord {
	const surfaceId = Number.parseInt(assetId.slice("material/".length), 16);
	const request = {
		requestId: `fixture-${assetId}`,
		assetId,
		priority: "streaming" as const,
	};
	const payload = {
		kind: "material-recipe" as const,
		sourceAssetKind: "material-recipe" as const,
		residencyKind: "unknown" as const,
		provenance: {
			source: "repo-local-hba" as const,
			sourceAssetKind: "material-recipe",
			errorCode: null,
			detail: null,
		},
		surfaceId,
		surfaceType: 0,
		source: {
			kind: "texture" as const,
			surfaceTextureId: 0x05000001,
			selectedRenderSurfaceId: options.selectedRenderSurfaceId ?? 0x06000001,
			paletteId:
				options.paletteId === undefined ? 0x04000001 : options.paletteId,
			renderSurfaceDefaultPaletteIds:
				options.renderSurfaceDefaultPaletteIds ?? [],
		},
		translucency: 0,
		luminosity: 0,
		diffuse: 0,
		dependencies,
	};
	return createPreparedRecord(request, payload);
}

function createRenderSurfaceRecord(
	assetId: string,
	options: {
		formatRaw: number;
		format: string;
		sourceBytes: Uint8Array;
		defaultPaletteId: number | null;
	},
): PreparedAssetRecord {
	const renderSurfaceId = Number.parseInt(
		assetId.slice("render-surface/".length),
		16,
	);
	const request = {
		requestId: `fixture-${assetId}`,
		assetId,
		priority: "streaming" as const,
	};
	const bytesPerPixel = options.formatRaw === 0x65 ? 2 : 1;
	const payload = {
		kind: "render-surface" as const,
		sourceAssetKind: "render-surface" as const,
		residencyKind: "unknown" as const,
		provenance: {
			source: "repo-local-hba" as const,
			sourceAssetKind: "render-surface",
			errorCode: null,
			detail: null,
		},
		renderSurfaceId,
		unknown: 0,
		width: options.sourceBytes.byteLength / bytesPerPixel,
		height: 1,
		formatRaw: options.formatRaw,
		format: options.format,
		sourceByteLength: options.sourceBytes.byteLength,
		sourceBytes: options.sourceBytes,
		defaultPaletteId: options.defaultPaletteId,
		dependencies: {
			paletteAssetIds:
				options.defaultPaletteId === null
					? []
					: [
							`palette/${options.defaultPaletteId.toString(16).padStart(8, "0")}`,
						],
		},
	};
	return createPreparedRecord(request, payload);
}

function createPaletteRecord(
	assetId: string,
	colorCount: number,
): PreparedAssetRecord {
	const paletteId = Number.parseInt(assetId.slice("palette/".length), 16);
	const request = {
		requestId: `fixture-${assetId}`,
		assetId,
		priority: "streaming" as const,
	};
	const payload = {
		kind: "palette" as const,
		sourceAssetKind: "palette" as const,
		residencyKind: "unknown" as const,
		provenance: {
			source: "repo-local-hba" as const,
			sourceAssetKind: "palette",
			errorCode: null,
			detail: null,
		},
		paletteId,
		colorCount,
		colorsArgb: new Uint32Array(colorCount),
	};
	return createPreparedRecord(request, payload);
}

function createSurfaceTextureRecord(assetId: string): PreparedAssetRecord {
	const request = {
		requestId: `fixture-${assetId}`,
		assetId,
		priority: "streaming" as const,
	};
	const payload = {
		kind: "surface-texture" as const,
		sourceAssetKind: "surface-texture" as const,
		residencyKind: "unknown" as const,
		provenance: {
			source: "repo-local-hba" as const,
			sourceAssetKind: "surface-texture",
			errorCode: null,
			detail: null,
		},
		surfaceTextureId: 0x05000001,
		textureType: 0,
		unknown: 0,
		selectedRenderSurfaceId: 0x06000001,
		renderSurfaceIds: [0x06000001],
		dependencies: {
			renderSurfaceAssetIds: ["render-surface/06000001"],
		},
	};
	return createPreparedRecord(request, payload);
}

function createPreparedRecord(
	request: PreparedAssetRecord["request"],
	payload: PreparedAssetRecord["payload"],
): PreparedAssetRecord {
	return {
		request,
		response: {
			requestId: request.requestId,
			assetId: request.assetId,
			payloadKind: "json",
			payload,
		},
		payload,
		preparedAt: "2026-05-24T00:00:00.000Z",
	};
}
