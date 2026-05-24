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
});

function createMaterialRecipeRecord(
	assetId: string,
	dependencies: {
		renderTextureAssetIds: string[];
		renderSurfaceAssetIds: string[];
		paletteAssetIds: string[];
	},
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
			renderSurfaceIds: [0x06000001],
			paletteId: 0x04000001,
			renderSurfaceDefaultPaletteIds: [],
		},
		translucency: 0,
		luminosity: 0,
		diffuse: 0,
		dependencies,
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
