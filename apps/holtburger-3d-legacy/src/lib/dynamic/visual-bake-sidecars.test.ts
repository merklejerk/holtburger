import { describe, expect, it } from "vitest";
import type { GfxObjPayloadDto } from "../host/contracts";
import type {
	HostAssetKey,
	PreparedAsset,
	PreparedAssetReader,
} from "../assets/contracts";
import { createHostAssetKey, describeHostAssetKey } from "../assets/keys";
import type { DynamicEntityRecipe } from "./contracts";
import type {
	StaticObjectSourceAssetFacts,
	StaticObjectSourceIdentity,
} from "../static/contracts";
import { createStaticObjectSourceGeometryIdentity } from "../static/objects/static-object-source-assets";
import { createDynamicVisualBakeSourceGeometry } from "./visual-bake-sidecars";

describe("dynamic visual bake sidecars", () => {
	it("dedupes distinct source parts that reference the same canonical gfx geometry", async () => {
		const gfxObj = createSourceIdentity("gfx-obj", 0x01000020);
		const firstSource = createSourceIdentity("setup-model", 0x02000010);
		const secondSource = createSourceIdentity("setup-model", 0x02000011);
		const firstGeometry = createStaticObjectSourceGeometryIdentity({
			gfxObj,
			partIndex: 0,
			source: firstSource,
		});
		const secondGeometry = createStaticObjectSourceGeometryIdentity({
			gfxObj,
			partIndex: 0,
			source: secondSource,
		});
		const assetReader = new FixturePreparedAssetReader([
			createPreparedAsset(createHostAssetKey("gfx-obj", 0x01000020)),
		]);

		const sidecars = await createDynamicVisualBakeSourceGeometry(assetReader, [
			createRecipe([
				createSourceAsset({
					geometry: firstGeometry,
					gfxObj,
					source: firstSource,
				}),
				createSourceAsset({
					geometry: secondGeometry,
					gfxObj,
					source: secondSource,
				}),
			]),
		]);

		expect(assetReader.requests).toEqual([
			createHostAssetKey("gfx-obj", 0x01000020),
		]);
		expect(sidecars).toHaveLength(1);
		expect(sidecars[0]).toMatchObject({
			identity: firstGeometry.canonical,
		});
	});
});

class FixturePreparedAssetReader implements PreparedAssetReader {
	readonly #assets = new Map<string, PreparedAsset>();
	readonly requests: HostAssetKey[] = [];

	constructor(assets: readonly PreparedAsset[]) {
		for (const asset of assets) {
			this.#assets.set(describeHostAssetKey(asset.key), asset);
		}
	}

	requestPreparedAsset(key: HostAssetKey): Promise<PreparedAsset> {
		this.requests.push(key);
		const asset = this.#assets.get(describeHostAssetKey(key));
		if (!asset) {
			return Promise.reject(
				new Error(`Missing fixture asset ${describeHostAssetKey(key)}.`),
			);
		}

		return Promise.resolve(asset);
	}
}

function createRecipe(
	sourceAssets: readonly StaticObjectSourceAssetFacts[],
): DynamicEntityRecipe {
	const setupModel = sourceAssets[0];
	if (!setupModel) {
		throw new Error("Dynamic sidecar fixture needs at least one source.");
	}
	return {
		animationSelection: { kind: "none" },
		baseTransform: {
			baseLocalPlacement: {
				orientation: { w: 1, x: 0, y: 0, z: 0 },
				origin: { x: 0, y: 0, z: 0 },
			},
			sourceScale: { x: 1, y: 1, z: 1 },
		},
		entityId: "runtime:test",
		source: {
			kind: "runtime-authored",
			runtimeEntityId: "runtime:test",
			sourceResidence: {
				kind: "outdoor-landblock",
				landblockId: 0xda55ffff,
			},
		},
		visual: {
			animation: null,
			materialPolicy: {
				detailRolePolicy: { kind: "runtime-authored-none" },
				materialPlanningDomain: "runtime-authored-dynamic-object-material",
				visualObject: {
					kind: "dynamic-visual-object",
					source: {
						kind: "runtime-authored",
						runtimeEntityId: "runtime:test",
						sourceResidence: {
							kind: "outdoor-landblock",
							landblockId: 0xda55ffff,
						},
					},
				},
			},
			materialSources: [],
			missingRefs: [],
			paletteSources: [],
			setupModel,
			sourceAssets,
			textureRefs: [],
		},
	};
}

function createSourceAsset(options: {
	readonly geometry: StaticObjectSourceAssetFacts["parts"][number]["geometry"];
	readonly gfxObj: StaticObjectSourceIdentity;
	readonly source: StaticObjectSourceIdentity;
}): StaticObjectSourceAssetFacts {
	return {
		bounds: null,
		debug: {
			sourceAssetId: `setup-model/${formatHex32(options.source.sourceDid)}`,
		},
		defaultAnimation: null,
		identity: options.source,
		invalidPolygonCount: 0,
		materialSlotCount: 0,
		partCount: 1,
		parts: [
			{
				bounds: null,
				defaultPlacements: [],
				geometry: options.geometry,
				gfxObj: options.gfxObj,
				invalidPolygonCount: 0,
				materialSlotCount: 0,
				materialSlots: [],
				partIndex: options.geometry.canonical.partIndex,
				physicsPolygonCount: 0,
				renderTriangleCount: 0,
				scale: { x: 1, y: 1, z: 1 },
				skippedPolygonCount: 0,
				source: options.source,
				triangles: [],
			},
		],
		physicsPolygonCount: 0,
		renderTriangleCount: 0,
		skippedPolygonCount: 0,
		sourceAssetKind: options.source.sourceAssetKind,
	};
}

function createSourceIdentity(
	sourceAssetKind: StaticObjectSourceIdentity["sourceAssetKind"],
	sourceDid: number,
): StaticObjectSourceIdentity {
	return {
		kind: "static-object-source",
		sourceAssetKind,
		sourceDid,
	};
}

function createPreparedAsset(key: HostAssetKey): PreparedAsset {
	return {
		key,
		payload: createGfxObjPayload(),
		preparedAt: "2026-06-15T00:00:00.000Z",
		revision: 1,
		sourceAssetId: describeHostAssetKey(key),
	};
}

function createGfxObjPayload(): GfxObjPayloadDto {
	return {
		dependencies: { materialAssetIds: [] },
		didDegrade: null,
		drawingBsp: null,
		drawingPolygons: [],
		flags: null,
		gfxObjId: 0x01000020,
		kind: "gfx-obj",
		physicsWitness: { hasBsp: false, polygonCount: 0, rootKind: null },
		provenance: { source: "test" },
		renderGeometry: {
			bounds: null,
			invalidPolygons: [],
			normals: new Float32Array(),
			positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
			skippedPolygonCount: 0,
			sourceId: 0x01000020,
			surfaceIds: [],
			triangleCount: 0,
			triangles: [],
			uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
			vertexCount: 3,
		},
		residencyKind: "unknown",
		sortCenter: null,
		sourceAssetKind: "gfx-obj",
		surfaceIds: [],
		vertexArray: { vertices: [] },
	};
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
