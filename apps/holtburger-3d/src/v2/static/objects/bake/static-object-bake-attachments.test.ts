import { describe, expect, it } from "vitest";
import type { GfxObjPayloadDto } from "../../../../lib/host/contracts";
import type {
	HostAssetKey,
	PreparedAsset,
	PreparedAssetReader,
} from "../../../assets/contracts";
import { createHostAssetKey, describeHostAssetKey } from "../../../assets/keys";
import type {
	LandblockEnvCellsStaticScopePayload,
	OutdoorStaticObjectsScopePayload,
	StaticBakeAttachmentRequest,
	StaticObjectPartSourceFacts,
	StaticObjectSourceGeometryIdentity,
	StaticObjectSourceIdentity,
} from "../../contracts";
import { createStaticObjectSourceGeometryIdentity } from "../static-object-source-assets";
import { StaticObjectBakeAttachmentProvider } from "./static-object-bake-attachments";

describe("V2 static object bake attachments", () => {
	it("attaches duplicate source geometry once per bake batch", async () => {
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
		const provider = new StaticObjectBakeAttachmentProvider({ assetReader });

		const attachments = await provider.createAttachments(
			createAttachmentRequest([
				createPart({ geometry, gfxObj, source }),
				createPart({ geometry, gfxObj, source }),
			]),
		);

		expect(assetReader.requests).toEqual([
			createHostAssetKey("gfx-obj", 0x01000020),
		]);
		expect(attachments.staticObjectSourceGeometry).toEqual([
			expect.objectContaining({
				identity: geometry,
				positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
				texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
			}),
		]);
	});

	it("attaches env-cell static seed source geometry for landblock env-cell batches", async () => {
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
		const provider = new StaticObjectBakeAttachmentProvider({ assetReader });

		const attachments = await provider.createAttachments(
			createEnvCellAttachmentRequest([createPart({ geometry, gfxObj, source })]),
		);

		expect(assetReader.requests).toEqual([
			createHostAssetKey("gfx-obj", 0x01000020),
		]);
		expect(attachments.staticObjectSourceGeometry).toEqual([
			expect.objectContaining({
				identity: geometry,
				positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
				texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
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

function createAttachmentRequest(
	parts: readonly StaticObjectPartSourceFacts[],
): StaticBakeAttachmentRequest {
	const domain = "outdoor-buildings";
	const job = {
		domain,
		scope: {
			kind: "landblock" as const,
			landblockId: 0xda55ffff,
		},
	};
	const work = {
		job,
		priority: 0,
		revision: 1,
		workId: "work:static-object-attachments",
	};

	return {
		domain,
		items: [
			{
				payload: {
					job,
					scope: createPayload(parts),
					sourceRevision: 1,
				},
				work,
			},
		],
		revision: 1,
		staticBatchId: "static-batch:objects",
	};
}

function createEnvCellAttachmentRequest(
	parts: readonly StaticObjectPartSourceFacts[],
): StaticBakeAttachmentRequest {
	const domain = "landblock-env-cells";
	const job = {
		domain,
		scope: {
			kind: "landblock" as const,
			landblockId: 0xda55ffff,
		},
	};
	const work = {
		job,
		priority: 0,
		revision: 1,
		workId: "work:env-cell-static-object-attachments",
	};

	return {
		domain,
		items: [
			{
				payload: {
					job,
					scope: createEnvCellPayload(parts),
					sourceRevision: 1,
				},
				work,
			},
		],
		revision: 1,
		staticBatchId: "static-batch:env-cells",
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
): LandblockEnvCellsStaticScopePayload {
	return {
		acceptedEnvCellIds: [0xda550100],
		envCells: [],
		kind: "landblock-env-cells",
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
			landblockEnvCellBvh: {
				items: [],
				nodes: [],
			},
			landblockEnvCellBvhItemCount: 0,
			landblockEnvCellBvhNodeCount: 0,
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
		partIndex: options.geometry.partIndex,
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
			normals: [],
			positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
			skippedPolygonCount: 0,
			sourceId: 0x01000020,
			surfaceIds: [],
			triangleCount: 0,
			triangles: [],
			uvs: [0, 0, 1, 0, 0, 1],
			vertexCount: 3,
		},
		residencyKind: "unknown",
		sortCenter: null,
		sourceAssetKind: "gfx-obj",
		surfaceIds: [],
		vertexArray: { vertices: [] },
	};
}
