import { describe, expect, it } from "vitest";

import type { AssetLookupResponseDto } from "../host/contracts";
import { getAssetResponseDependencies } from "./dependencies";

const provenance = {
	source: "repo-local-hba" as const,
	sourceAssetKind: "synthetic",
	errorCode: null,
	detail: null,
};

describe("asset response dependencies", () => {
	it("extracts landblock pack shared renderable references", () => {
		const response = createJsonResponse("landblock-pack/da55ffff", {
			kind: "landblock-pack",
			residencyKind: "landblock",
			sourceAssetKind: "landblock-pack",
			landblockId: 0xda55ffff,
			landblockInfoId: 0xda55fffe,
			classification: "outdoor",
			sourceFacts: {
				buildings: [],
			},
			prepared: {
				terrainMesh: null,
				outdoorStaticInstances: [],
				interiorCells: [],
				staticMeshes: [],
				spatialItems: [],
				staticLandblockBvh: null,
			},
			dependencies: {
				cellDatIds: [0xda55ffff, 0xda55fffe],
				portalDatIds: [],
				renderableAssetIds: [
					"setup-model/02000001",
					"gfx-obj/01000001",
					"setup-model/02000001",
				],
				missing: [],
				unsupported: [],
			},
			diagnostics: {
				sourceRecords: [],
				omissions: [],
				errors: [],
			},
			provenance,
		});

		expect(getAssetResponseDependencies(response)).toEqual([
			{ assetId: "gfx-obj/01000001" },
			{ assetId: "setup-model/02000001" },
		]);
	});

	it("extracts setup-model part gfx objects without worker preparation", () => {
		const response = createJsonResponse("setup-model/02000010", {
			kind: "setup-model",
			residencyKind: "unknown",
			sourceAssetKind: "setup-model",
			setupModelId: 0x02000010,
			flags: null,
			parts: [
				createSetupPart(0, "gfx-obj/01000010"),
				createSetupPart(1, "gfx-obj/01000011"),
				createSetupPart(2, "gfx-obj/01000010"),
			],
			holdingLocations: [],
			connectionPoints: [],
			placementSets: [],
			collisionWitness: {
				cylSphereCount: 0,
				sphereCount: 0,
			},
			height: null,
			radius: null,
			stepUp: null,
			stepDown: null,
			sortingSphere: null,
			selectionSphere: null,
			lights: [],
			defaultAnimation: null,
			defaultScript: null,
			defaultMotionTable: null,
			defaultSoundTable: null,
			defaultScriptTable: null,
			dependencies: {
				gfxObjAssetIds: [
					"gfx-obj/01000010",
					"gfx-obj/01000011",
					"gfx-obj/01000010",
				],
				setupAppearanceAssetId: "setup-appearance/02000010",
			},
			provenance,
		});

		expect(getAssetResponseDependencies(response)).toEqual([
			{ assetId: "gfx-obj/01000010" },
			{ assetId: "gfx-obj/01000011" },
			{ assetId: "setup-appearance/02000010" },
		]);
	});

	it("extracts material dependencies from gfx and setup appearance payloads", () => {
		expect(
			getAssetResponseDependencies(
				createJsonResponse("gfx-obj/01000010", {
					kind: "gfx-obj",
					residencyKind: "unknown",
					sourceAssetKind: "gfx-obj",
					gfxObjId: 0x01000010,
					flags: null,
					surfaceIds: [0x08000010],
					vertexArray: { vertexType: null, vertexCount: 0, vertices: [] },
					drawingPolygons: [],
					drawingBsp: null,
					dependencies: {
						materialAssetIds: ["material/08000010"],
					},
					physicsWitness: { polygonCount: 0, hasBsp: false },
					renderGeometry: {
						sourceId: 0x01000010,
						vertexCount: 0,
						triangleCount: 0,
						positions: [],
						normals: [],
						uvs: [],
						triangles: [],
						surfaceIds: [],
						invalidPolygons: [],
						skippedPolygonCount: 0,
						bounds: null,
					},
					sortCenter: null,
					didDegrade: null,
					provenance,
				}),
			),
		).toEqual([{ assetId: "material/08000010" }]);

		expect(
			getAssetResponseDependencies(
				createJsonResponse("setup-appearance/02000010", {
					kind: "setup-appearance",
					residencyKind: "unknown",
					sourceAssetKind: "setup-appearance",
					setupModelId: 0x02000010,
					appearanceKey: "setup:0x02000010|base",
					parts: [],
					textureChanges: [],
					animPartChanges: [],
					paletteId: null,
					subPalettes: [],
					dependencies: {
						materialAssetIds: ["material/08000010"],
						paletteAssetIds: ["palette/04000010"],
					},
					provenance,
				}),
			),
		).toEqual([
			{ assetId: "material/08000010" },
			{ assetId: "palette/04000010" },
		]);
	});

	it("extracts render resource dependencies from material payloads", () => {
		expect(
			getAssetResponseDependencies(
				createJsonResponse("material/08000010", {
					kind: "material-recipe",
					residencyKind: "unknown",
					sourceAssetKind: "material-recipe",
					surfaceId: 0x08000010,
					surfaceType: 2,
					source: {
						kind: "texture",
						renderTextureId: 0x05000010,
						renderSurfaceIds: [0x06000010],
						paletteId: 0x04000010,
						renderSurfaceDefaultPaletteIds: [],
					},
					translucency: 1,
					luminosity: 0,
					diffuse: 1,
					dependencies: {
						renderTextureAssetIds: ["render-texture/05000010"],
						renderSurfaceAssetIds: ["render-surface/06000010"],
						paletteAssetIds: ["palette/04000010"],
					},
					provenance,
				}),
			),
		).toEqual([
			{ assetId: "palette/04000010" },
			{ assetId: "render-surface/06000010" },
			{ assetId: "render-texture/05000010" },
		]);

		expect(
			getAssetResponseDependencies(
				createJsonResponse("render-texture/05000010", {
					kind: "render-texture",
					residencyKind: "unknown",
					sourceAssetKind: "render-texture",
					renderTextureId: 0x05000010,
					textureType: 1,
					unknown: 0,
					renderSurfaceIds: [0x06000010],
					dependencies: {
						renderSurfaceAssetIds: ["render-surface/06000010"],
					},
					provenance,
				}),
			),
		).toEqual([{ assetId: "render-surface/06000010" }]);
	});

	it("extracts dependency manifest asset ids", () => {
		const response = createJsonResponse("dependency-manifest/synthetic", {
			kind: "dependency-manifest",
			residencyKind: "unknown",
			dependencyAssetIds: [
				"gfx-obj/01000020",
				"setup-model/02000020",
				"gfx-obj/01000020",
			],
			provenance,
		});

		expect(getAssetResponseDependencies(response)).toEqual([
			{ assetId: "gfx-obj/01000020" },
			{ assetId: "setup-model/02000020" },
		]);
	});

	it("returns no dependencies for unknown payloads", () => {
		expect(
			getAssetResponseDependencies(
				createJsonResponse("unknown/synthetic", {
					kind: "unknown-synthetic",
					residencyKind: "unknown",
					provenance,
				}),
			),
		).toEqual([]);
	});
});

function createJsonResponse(
	assetId: string,
	payload: unknown,
): AssetLookupResponseDto {
	return {
		requestId: `request-${assetId}`,
		assetId,
		payloadKind: "json",
		payload,
	};
}

function createSetupPart(partIndex: number, gfxObjAssetId: string) {
	return {
		partIndex,
		gfxObjId: 0x01000010 + partIndex,
		gfxObjAssetId,
		parentIndex: null,
		scale: null,
	};
}
