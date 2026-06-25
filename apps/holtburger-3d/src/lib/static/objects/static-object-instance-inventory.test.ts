import { describe, expect, it } from "vitest";
import type {
	StaticObjectGeometryStaticDrawUnit,
	StaticObjectSourceMappingCoverage,
} from "../contracts";
import { inventoryGeneratedOutdoorDetailInstances } from "./static-object-instance-inventory";

describe("generated static object instance inventory", () => {
	it("groups repeated generated outdoor-detail coverage by retained source identity", () => {
		const inventory = inventoryGeneratedOutdoorDetailInstances([
			createDrawUnit({
				coverage: [
					createCoverage({ instanceId: "tree-a" }),
					createCoverage({ instanceId: "tree-b" }),
					createCoverage({
						gfxObjDid: 0x01000030,
						instanceId: "rock-a",
					}),
				],
				drawUnitId: "du-a",
			}),
			createDrawUnit({
				coverage: [createCoverage({ instanceId: "tree-c" })],
				drawUnitId: "du-b",
			}),
		]);

		expect(inventory).toMatchObject({
			drawUnitCount: 2,
			generatedCoverageCount: 4,
			generatedObjectCount: 4,
			repeatedGeneratedObjectCount: 3,
			repeatedGroupCount: 1,
		});
		expect(inventory.candidateGroups[0]).toMatchObject({
			drawUnitIds: ["du-a", "du-b"],
			generatedObjectCount: 3,
			gfxObjDid: 0x01000020,
			objectInstanceIds: ["tree-a", "tree-b", "tree-c"],
			partIndex: 0,
			sourceDid: 0x02000010,
		});
	});

	it("ignores explicit objects and non-outdoor-detail draw units", () => {
		const inventory = inventoryGeneratedOutdoorDetailInstances([
			createDrawUnit({
				coverage: [
					createCoverage({
						instanceId: "explicit-a",
						objectKind: "explicit-object",
					}),
				],
				drawUnitId: "building-du",
				domain: "outdoor-buildings",
			}),
			createDrawUnit({
				coverage: [
					createCoverage({
						instanceId: "explicit-b",
						objectKind: "explicit-object",
					}),
					createCoverage({ instanceId: "one-off-generated" }),
				],
				drawUnitId: "detail-du",
			}),
		]);

		expect(inventory).toMatchObject({
			drawUnitCount: 1,
			generatedCoverageCount: 1,
			generatedObjectCount: 1,
			repeatedGeneratedObjectCount: 0,
			repeatedGroupCount: 0,
		});
		expect(inventory.candidateGroups).toEqual([]);
	});
});

function createDrawUnit(options: {
	readonly coverage: readonly StaticObjectSourceMappingCoverage[];
	readonly drawUnitId: string;
	readonly domain?: StaticObjectGeometryStaticDrawUnit["domain"];
}): StaticObjectGeometryStaticDrawUnit {
	return {
		alphaTest: 0.5,
		coordinateSpace: "landblock-render-local",
		detailTextureTiling: 1,
		detailTextureUseId: null,
		domain: options.domain ?? "outdoor-detail",
		drawUnitId: options.drawUnitId,
		indexTextureUseId: null,
		indexedClipThreshold: 0,
		indexedTextureFormat: null,
		indexType: "uint16",
		indices: new Uint16Array([0, 1, 2]),
		kind: "static-object-geometry",
		landblockId: 0xda56ffff,
		materialBucketKey: "bucket-a",
		materialColor: [1, 1, 1, 1],
		materialEmissiveColor: [0, 0, 0],
		materialEntries: [
			{
				alphaTest: 0.5,
				detailTextureTiling: 1,
				detailTextureUseId: null,
				indexedClipThreshold: 0,
				indexedTextureFormat: null,
				indexTextureUseId: null,
				materialColor: [1, 1, 1, 1],
				materialEmissiveColor: [0, 0, 0],
				materialIds: [0x08000010],
				paletteFirstIndex: 0,
				paletteTextureUseId: null,
				primaryTextureUseId: "texture-a",
				primaryTextureWrapMode: "repeat",
				renderState: createRenderState(),
				slot: 0,
			},
		],
		materialFamily: "texture-rgba",
		materialIds: [0x08000010],
		materialPass: "alpha-test",
		materialSlotIndices: new Float32Array([0, 0, 0]),
		ownership: {
			domain: options.domain === "outdoor-buildings" ? "outdoor-buildings" : "outdoor-detail",
			kind: "outdoor-static-objects",
			landblockId: 0xda56ffff,
		},
		paletteFirstIndex: 0,
		paletteTextureUseId: null,
		positions: new Float32Array(9),
		primaryTextureUseId: "texture-a",
		primaryTextureWrapMode: "repeat",
		renderState: createRenderState(),
		sort: {
			bounds: null,
			center: [0, 0, 0],
			objectPartKey: null,
			policy: "depth-writing",
		},
		sourceMappingCoverage: options.coverage,
		spatialRecord: null,
		texCoords: new Float32Array(6),
		textureUseIds: ["texture-a"],
		triangleCount: 1,
		vertexCount: 3,
	};
}

function createCoverage(options: {
	readonly gfxObjDid?: number;
	readonly instanceId: string;
	readonly objectKind?: "explicit-object" | "building" | "generated-scenery";
	readonly sourceDid?: number;
}): StaticObjectSourceMappingCoverage {
	return {
		geometrySurfaceIds: [1],
		gfxObj: {
			kind: "static-object-source",
			sourceAssetKind: "gfx-obj",
			sourceDid: options.gfxObjDid ?? 0x01000020,
		},
		materialIds: [0x08000010],
		materialSlot: 0,
		materialVariantSignatures: [null],
		object: {
			instanceId: options.instanceId,
			kind: "static-object-instance",
			landblockId: 0xda56ffff,
			objectKind: options.objectKind ?? "generated-scenery",
		},
		partIndex: 0,
		polygonCount: 6,
		polygonRange: { max: 5, min: 0 },
		source: {
			kind: "static-object-source",
			sourceAssetKind: "setup-model",
			sourceDid: options.sourceDid ?? 0x02000010,
		},
		sourceTriangleCount: 6,
	};
}

function createRenderState(): StaticObjectGeometryStaticDrawUnit["renderState"] {
	return {
		blend: {
			dstFactor: "one-minus-src-alpha",
			enabled: false,
			mode: "clipmap",
			srcFactor: "src-alpha",
		},
		depthTest: true,
		depthWrite: true,
	};
}
