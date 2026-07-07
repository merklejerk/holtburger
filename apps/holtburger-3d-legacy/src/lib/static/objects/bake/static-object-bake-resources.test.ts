import { describe, expect, it } from "vitest";
import type { GfxObjPayloadDto } from "../../../../lib/host/contracts";
import type {
	HostAssetKey,
	PreparedAsset,
	PreparedAssetReader,
} from "../../../assets/contracts";
import { createHostAssetKey, describeHostAssetKey } from "../../../assets/keys";
import type {
	EnvCellSystemStaticScopePayload,
	OutdoorStaticObjectsScopePayload,
	StaticBakeResourceRequest,
	StaticObjectPartSourceFacts,
	StaticObjectSourceGeometryIdentity,
	StaticObjectSourceIdentity,
} from "../../contracts";
import { createStaticObjectSourceGeometryIdentity } from "../static-object-source-assets";
import { StaticObjectBakeResourceProvider } from "./static-object-bake-resources";

describe("static object bake resources", () => {
	it("attaches duplicate source geometry once per static bake job", async () => {
		const source = createSourceIdentity("setup-model", 0x02000010);
		const gfxObj = createSourceIdentity("gfx-obj", 0x01000020);
		const geometry = createStaticObjectSourceGeometryIdentity({
			gfxObj,
			partIndex: 0,
			source,
		});
		const assetReader = new FixturePreparedAssetReader([
			createPreparedAsset(createHostAssetKey("gfx-obj", 0x01000020)),
		]);
		const provider = new StaticObjectBakeResourceProvider({ assetReader });

		const resources = await provider.createResources(
			createResourceRequest([
				createPart({ geometry, gfxObj, source }),
				createPart({ geometry, gfxObj, source }),
			]),
		);

		expect(assetReader.requests).toEqual([
			createHostAssetKey("gfx-obj", 0x01000020),
		]);
		expect(resources.staticObjectSourceGeometry).toEqual([
			expect.objectContaining({
				buffer: expect.objectContaining({
					coordinateSpace: "source-local",
					positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
					texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
				}),
				identity: geometry.canonical,
			}),
		]);
	});

	it("dedupes distinct source parts that reference the same canonical gfx geometry", async () => {
		const firstSource = createSourceIdentity("setup-model", 0x02000010);
		const secondSource = createSourceIdentity("setup-model", 0x02000011);
		const gfxObj = createSourceIdentity("gfx-obj", 0x01000020);
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
		const provider = new StaticObjectBakeResourceProvider({ assetReader });

		const resources = await provider.createResources(
			createResourceRequest([
				createPart({ geometry: firstGeometry, gfxObj, source: firstSource }),
				createPart({ geometry: secondGeometry, gfxObj, source: secondSource }),
			]),
		);

		expect(assetReader.requests).toEqual([
			createHostAssetKey("gfx-obj", 0x01000020),
		]);
		expect(resources.staticObjectSourceGeometry).toHaveLength(1);
		expect(resources.staticObjectSourceGeometry[0]).toMatchObject({
			identity: firstGeometry.canonical,
		});
	});

	it("attaches env-cell static placement source geometry for landblock env-cell jobs", async () => {
		const source = createSourceIdentity("setup-model", 0x02000010);
		const gfxObj = createSourceIdentity("gfx-obj", 0x01000020);
		const geometry = createStaticObjectSourceGeometryIdentity({
			gfxObj,
			partIndex: 0,
			source,
		});
		const assetReader = new FixturePreparedAssetReader([
			createPreparedAsset(createHostAssetKey("gfx-obj", 0x01000020)),
		]);
		const provider = new StaticObjectBakeResourceProvider({ assetReader });

		const resources = await provider.createResources(
			createEnvCellResourceRequest([createPart({ geometry, gfxObj, source })]),
		);

		expect(assetReader.requests).toEqual([
			createHostAssetKey("gfx-obj", 0x01000020),
		]);
		expect(resources.staticObjectSourceGeometry).toEqual([
			expect.objectContaining({
				buffer: expect.objectContaining({
					coordinateSpace: "source-local",
					positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
					texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
				}),
				identity: geometry.canonical,
			}),
		]);
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

function createResourceRequest(
	parts: readonly StaticObjectPartSourceFacts[],
): StaticBakeResourceRequest {
	const domain = "outdoor-buildings";
	const job = {
		domain,
		scope: {
			kind: "landblock" as const,
			landblockId: 0xda55ffff,
		},
	};
	return {
		domain,
		payload: {
			job,
			scope: createPayload(parts),
			sourceRevision: 1,
		},
		revision: 1,
		task: {
			domain,
			ownerId: "outdoor-buildings:0xda55ffff",
			ownerKey: { kind: "outdoor-buildings", landblockId: 0xda55ffff },
			revision: 1,
			scope: job.scope,
			scopeKey: "landblock:da55ffff",
			taskId: "task:static-object-resources",
		},
	};
}

function createEnvCellResourceRequest(
	parts: readonly StaticObjectPartSourceFacts[],
): StaticBakeResourceRequest {
	const domain = "env-cell-system";
	const job = {
		domain,
		scope: {
			kind: "landblock" as const,
			landblockId: 0xda55ffff,
		},
	};
	return {
		domain,
		payload: {
			job,
			scope: createEnvCellPayload(parts),
			sourceRevision: 1,
		},
		revision: 1,
		task: {
			domain,
			ownerId: "env-cell-system:0xda55ffff",
			ownerKey: { kind: "env-cell-system", landblockId: 0xda55ffff },
			revision: 1,
			scope: job.scope,
			scopeKey: "landblock:da55ffff",
			taskId: "task:env-cell-static-object-resources",
		},
	};
}

function createPayload(
	parts: readonly StaticObjectPartSourceFacts[],
): OutdoorStaticObjectsScopePayload {
	return {
		domain: "outdoor-buildings",
		kind: "outdoor-static-objects",
		landblock: {
			kind: "landblock-source",
			landblockId: 0xda55ffff,
			source: "outdoor",
		},
		materialSlots: [],
		materialSources: [],
		missingRefs: [],
		objects: [],
		paletteSources: [],
		regionRenderProfile: {
			detailRoles: [],
			identity: {
				kind: "region-render-profile",
				regionNumber: 1,
			},
		},
		sourceAssets: [
			{
				bounds: null,
				debug: { sourceAssetId: "setup-model/02000010" },
				identity: createSourceIdentity("setup-model", 0x02000010),
				invalidPolygonCount: 0,
				materialSlotCount: 0,
				partCount: parts.length,
				parts,
				physicsPolygonCount: 0,
				renderTriangleCount: 0,
				skippedPolygonCount: 0,
				sourceAssetKind: "setup-model",
			},
		],
		sourceSpatial: {
			bounds: null,
			coordinateSpace: "landblock-render-local",
			outdoorBvh: null,
			outdoorBvhItemCount: 0,
			outdoorBvhNodeCount: 0,
		},
		textureRefs: [],
	};
}

function createEnvCellPayload(
	parts: readonly StaticObjectPartSourceFacts[],
): EnvCellSystemStaticScopePayload {
	return {
		acceptedEnvCellIds: [0xda550100],
		envCells: [],
		kind: "env-cell-system",
		landblock: {
			kind: "landblock-source",
			landblockId: 0xda55ffff,
			source: "env-cells",
		},
		materialSources: [],
		missingRefs: [],
		paletteSources: [],
		portalLinks: [],
		regionRenderProfile: {
			kind: "region-render-profile",
			regionNumber: 1,
		},
		residencySpatial: {
			envCellSystemBvh: {
				items: [],
				nodes: [],
			},
			envCellSystemBvhItemCount: 0,
			envCellSystemBvhNodeCount: 0,
		},
		sourceAssets: [
			{
				bounds: null,
				debug: { sourceAssetId: "setup-model/02000010" },
				identity: createSourceIdentity("setup-model", 0x02000010),
				invalidPolygonCount: 0,
				materialSlotCount: 0,
				partCount: parts.length,
				parts,
				physicsPolygonCount: 0,
				renderTriangleCount: 0,
				skippedPolygonCount: 0,
				sourceAssetKind: "setup-model",
			},
		],
		textureRefs: [],
		visibilityDiagnostics: [],
	};
}

function createPart(options: {
	readonly geometry: StaticObjectSourceGeometryIdentity;
	readonly gfxObj: StaticObjectSourceIdentity;
	readonly source: StaticObjectSourceIdentity;
}): StaticObjectPartSourceFacts {
	return {
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
