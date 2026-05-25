import { describe, expect, it } from "vitest";

import {
	createInitialAssetChannelState,
	type PreparedAssetRecord,
} from "./types";
import { describeMaterialAssetDiagnostics } from "./material-diagnostics";

describe("material diagnostics", () => {
	it("summarizes prepared material resources and missing recipe dependencies", () => {
		const material = createMaterialRecipeRecord("material/08000001", {
			renderTextureAssetIds: ["render-texture/05000001"],
			renderSurfaceAssetIds: ["render-surface/06000001"],
			paletteAssetIds: ["palette/04000001"],
		});
		const state = createInitialAssetChannelState();
		state.preparedByAssetId = {
			[material.request.assetId]: material,
			"render-texture/05000001": createRenderTextureRecord(
				"render-texture/05000001",
			),
		};

		const diagnostics = describeMaterialAssetDiagnostics({
			assetState: state,
			browserDestination: null,
			options: {
				terrainRadius: 0,
				buildingRadius: 0,
				detailRadius: 0,
				envCellRadius: 0,
			},
		});

		expect(diagnostics).toContain("recipes 1 (1 texture, 0 solid)");
		expect(diagnostics).toContain("render resources 1 textures, 0 surfaces");
		expect(diagnostics).toContain("missing deps tex 0");
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
			assetState: state,
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
				renderTextureAssetIds: [],
				renderSurfaceAssetIds: [
					"render-surface/06000003",
					"render-surface/06000004",
				],
				paletteAssetIds: ["palette/04000003"],
			},
			{
				paletteId: 0x04000003,
				renderSurfaceIds: [0x06000003, 0x06000004],
			},
		);
		const emptyPaletteRecipe = createMaterialRecipeRecord(
			"material/08000005",
			{
				renderTextureAssetIds: [],
				renderSurfaceAssetIds: ["render-surface/06000005"],
				paletteAssetIds: ["palette/04000004"],
			},
			{
				paletteId: 0x04000004,
				renderSurfaceIds: [0x06000005],
			},
		);
		const defaultPaletteRecipe = createMaterialRecipeRecord(
			"material/08000004",
			{
				renderTextureAssetIds: [],
				renderSurfaceAssetIds: ["render-surface/06000006"],
				paletteAssetIds: ["palette/04000006"],
			},
			{
				paletteId: null,
				renderSurfaceIds: [0x06000006],
				renderSurfaceDefaultPaletteIds: [0x04000006],
			},
		);
		const state = createInitialAssetChannelState();
		state.preparedByAssetId = {
			[indexedRecipe.request.assetId]: indexedRecipe,
			[emptyPaletteRecipe.request.assetId]: emptyPaletteRecipe,
			[defaultPaletteRecipe.request.assetId]: defaultPaletteRecipe,
			"render-surface/06000003": createRenderSurfaceRecord(
				"render-surface/06000003",
				{
					formatRaw: 0x29,
					format: "P8",
					sourceBytes: new Uint8Array([0, 1]),
					defaultPaletteId: null,
				},
			),
			"render-surface/06000004": createRenderSurfaceRecord(
				"render-surface/06000004",
				{
					formatRaw: 0x65,
					format: "Index16",
					sourceBytes: new Uint8Array([0x00, 0x00, 0x03, 0x00]),
					defaultPaletteId: null,
				},
			),
			"render-surface/06000005": createRenderSurfaceRecord(
				"render-surface/06000005",
				{
					formatRaw: 0x29,
					format: "P8",
					sourceBytes: new Uint8Array([0]),
					defaultPaletteId: null,
				},
			),
			"render-surface/06000006": createRenderSurfaceRecord(
				"render-surface/06000006",
				{
					formatRaw: 0x65,
					format: "Index16",
					sourceBytes: new Uint8Array([0x01, 0x00]),
					defaultPaletteId: 0x04000006,
				},
			),
			"palette/04000003": createPaletteRecord("palette/04000003", 2),
			"palette/04000004": createPaletteRecord("palette/04000004", 0),
			"palette/04000006": createPaletteRecord("palette/04000006", 2),
		};

		const diagnostics = describeMaterialAssetDiagnostics({
			assetState: state,
			browserDestination: null,
			options: {
				terrainRadius: 0,
				buildingRadius: 0,
				detailRadius: 0,
				envCellRadius: 0,
			},
		});

		expect(diagnostics).toContain("indexed recipes 3");
		expect(diagnostics).toContain("surfaces P8 2, Index16 2");
		expect(diagnostics).toContain(
			"palettes prepared 2, recipe 3, default 1, missing 0",
		);
		expect(diagnostics).toContain("empty 1 (palette/04000004)");
		expect(diagnostics).toContain("range errors 1 (render-surface/06000004)");
	});
});

function createMaterialRecipeRecord(
	assetId: string,
	dependencies: {
		renderTextureAssetIds: string[];
		renderSurfaceAssetIds: string[];
		paletteAssetIds: string[];
	},
	options: {
		paletteId?: number | null;
		renderSurfaceIds?: number[];
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
			renderTextureId: 0x05000001,
			renderSurfaceIds: options.renderSurfaceIds ?? [0x06000001],
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

function createRenderTextureRecord(assetId: string): PreparedAssetRecord {
	const request = {
		requestId: `fixture-${assetId}`,
		assetId,
		priority: "streaming" as const,
	};
	const payload = {
		kind: "render-texture" as const,
		sourceAssetKind: "render-texture" as const,
		residencyKind: "unknown" as const,
		provenance: {
			source: "repo-local-hba" as const,
			sourceAssetKind: "render-texture",
			errorCode: null,
			detail: null,
		},
		renderTextureId: 0x05000001,
		textureType: 0,
		unknown: 0,
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
