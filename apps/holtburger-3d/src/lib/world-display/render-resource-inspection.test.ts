import { describe, expect, it } from "vitest";

import {
	formatRenderResourceInspectionKeyForDisplay,
	inspectWebgl2WorldResources,
} from "./render-resource-inspection";
import type { Webgl2WorldResourceStore } from "./webgl2-world-resources";

describe("render resource inspection", () => {
	it("projects resident WebGL2 resource stores into a plain inspection snapshot", () => {
		const snapshot = inspectWebgl2WorldResources(
			createInspectableWorldStore(),
		);

		expect(snapshot.summary).toEqual({
			staticBundleLayerCount: 1,
			structuredInteriorCellCount: 1,
			texturePageCount: 3,
			materialCount: 2,
			geometryResourceCount: 3,
			triangleCount: 12,
			texturePageEntryCount: 4,
		});
		expect(snapshot.staticBundleLayers).toMatchObject([
			{
				key: "layer:a",
				bundleKind: "outdoor-buildings",
				sourceObjectCount: 4,
				objectRecordCount: 3,
				materialCount: 1,
				texturePageCount: 1,
				triangleCount: 5,
			},
		]);
		expect(snapshot.structuredInteriorCells).toMatchObject([
			{
				key: "cell:a",
				envCellId: 0xda5501e9,
				materialSliceCount: 1,
				hasFallbackShell: true,
				triangleCount: 7,
			},
		]);
		expect(snapshot.texturePages.map((page) => page.ownerKind)).toEqual([
			"static-bundle",
			"structured-interior",
			"terrain",
		]);
		expect(
			snapshot.texturePages.map((page) => ({
				key: page.key,
				coveredPixelCount: page.coveredPixelCount,
				coverageRatio: page.coverageRatio,
			})),
		).toEqual([
			{
				key: "page:static",
				coveredPixelCount: 49_152,
				coverageRatio: 0.75,
			},
			{
				key: "page:structured",
				coveredPixelCount: 32_768,
				coverageRatio: 1,
			},
			{
				key: "page:terrain",
				coveredPixelCount: 4_096,
				coverageRatio: 1,
			},
		]);
		expect(
			snapshot.materials.map((material) => ({
				key: material.key,
				detailTiling: material.detailTiling,
				geometryReferenceCount: material.geometryReferenceCount,
				referencedIndexCount: material.referencedIndexCount,
				referencedTriangleCount: material.referencedTriangleCount,
			})),
		).toEqual([
			{
				key: "material:static",
				detailTiling: 2,
				geometryReferenceCount: 1,
				referencedIndexCount: 15,
				referencedTriangleCount: 5,
			},
			{
				key: "material:structured",
				detailTiling: 0,
				geometryReferenceCount: 1,
				referencedIndexCount: 6,
				referencedTriangleCount: 2,
			},
		]);
		expect(snapshot.geometry.map((geometry) => geometry.geometryKind)).toEqual([
			"fallback-shell",
			"compacted-batch",
			"material-slice",
		]);
	});

	it("returns an empty snapshot when WebGL resources are unavailable", () => {
		const snapshot = inspectWebgl2WorldResources(null);

		expect(snapshot.generatedAtMs).toBe(0);
		expect(snapshot.summary.texturePageCount).toBe(0);
		expect(snapshot.materials).toHaveLength(0);
	});

	it("formats landblock and env-cell resource key ids as hex for display", () => {
		expect(
			formatRenderResourceInspectionKeyForDisplay(
				"env-cell:3663069183:3663003906:env-cell-static:page:indexed-texels:0",
			),
		).toBe(
			"env-cell:0xda55ffff:0xda550102:env-cell-static:page:indexed-texels:0",
		);
		expect(
			formatRenderResourceInspectionKeyForDisplay(
				"landblock:3663069183:outdoor-buildings:page:base-color:0",
			),
		).toBe("landblock:0xda55ffff:outdoor-buildings:page:base-color:0");
	});
});

function createInspectableWorldStore(): Webgl2WorldResourceStore {
	const staticPage = createTexturePage({
		key: "page:static",
		width: 256,
		height: 256,
		rects: [
			[0, 0, 128, 256],
			[64, 0, 128, 256],
		],
	});
	const structuredPage = createTexturePage({
		key: "page:structured",
		width: 128,
		height: 256,
		rects: [[0, 0, 128, 256]],
	});
	const terrainPage = createTexturePage({
		key: "page:terrain",
		width: 64,
		height: 64,
		rects: [[0, 0, 64, 64]],
	});
	const staticMaterial = createMaterial({
		key: "material:static",
		detailTextureRefKey: "texture:detail",
		detailTiling: 2,
	});
	const structuredMaterial = createMaterial({
		key: "material:structured",
		detailTextureRefKey: null,
		detailTiling: 0,
	});

	return {
		staticBundleLayerResources: {
			layersByKey: new Map([
				[
					"layer:a",
					{
						key: "layer:a",
						scope: "landblock",
						landblockId: 0xda55ffff,
						bundleKind: "outdoor-buildings",
						sourceObjectCount: 4,
						objectRecordCount: 3,
						spatialHintCount: 2,
						texturePages: [staticPage],
						materialRecords: [staticMaterial],
						compactedBatches: [
							{
								key: "geometry:static",
								materialRecordKey: "material:static",
								vertexCount: 9,
								indexCount: 15,
								triangleCount: 5,
							},
						],
						directEntries: [],
					},
				],
			]),
		},
		structuredInteriorResources: {
			cellsByKey: new Map([
				[
					"cell:a",
					{
						key: "cell:a",
						artifactKey: "artifact:a",
						landblockId: 0xda55ffff,
						envCellId: 0xda5501e9,
						materialSlices: [
							{
								key: "slice:a",
								materialRecordKey: "material:structured",
								indexCount: 6,
								triangleCount: 2,
							},
						],
						fallbackShell: {
							indexCount: 15,
							triangleCount: 5,
						},
						materialRecords: [structuredMaterial],
						texturePages: [structuredPage],
						triangleCount: 7,
					},
				],
			]),
		},
		productTerrainTexturePagesByKey: new Map([["page:terrain", terrainPage]]),
	} as unknown as Webgl2WorldResourceStore;
}

function createTexturePage({
	key,
	width,
	height,
	rects,
}: {
	key: string;
	width: number;
	height: number;
	rects: readonly (readonly [number, number, number, number])[];
}): unknown {
	return {
		key,
		role: "base-color",
		sampleClass: "rgba-color",
		pageKind: "packed-atlas",
		indexedFormat: null,
		samplerPolicyKey: "linear",
		mipmapsGenerated: false,
		texture: { width, height },
		entries: rects.map((rect, index) => ({
			virtualRefKey: `${key}:entry:${index}`,
			sourceAssetId: `prepared-texture/${index}`,
			rect,
		})),
	};
}

function createMaterial({
	key,
	detailTextureRefKey,
	detailTiling,
}: {
	key: string;
	detailTextureRefKey: string | null;
	detailTiling: number;
}): unknown {
	return {
		key,
		familyKey: "static:textured-opaque:alpha=opaque",
		family: {
			key: "static:textured-opaque:alpha=opaque",
			kind: "texture-page",
			sourceFamily: "textured-opaque",
			alphaPolicy: "opaque",
		},
		isTransparent: false,
		textureBindings: [{ virtualRefKey: "texture:base" }],
		indexedMaterial: undefined,
		detailTextureRefKey,
		detailTiling,
	};
}
