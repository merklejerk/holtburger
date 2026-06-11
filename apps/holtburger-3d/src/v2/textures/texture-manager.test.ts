import { describe, expect, it } from "vitest";
import type {
	AssetService,
	AssetServiceSnapshot,
	HostAssetKey,
	PreparedAsset,
	PreparedAssetLease,
} from "../assets/contracts";
import type {
	PreparedTextureUseIdentity,
	StaticCoordinatorCommitDelta,
	StaticScopePayload,
} from "../static/contracts";
import type { TexturePacker } from "./packing/packer";
import type { TexturePackingJob, TexturePackingResult } from "./packing/protocol";
import { TextureManager } from "./texture-manager";

const STABLE_TEXTURE_REF_ID =
	"texture-ref:outdoor-terrain:06000010:color:rgba8:none:linear";

describe("V2 texture manager", () => {
	it("turns bake-local texture uses into runtime-owned direct placements", async () => {
		const assetService = new FixtureAssetService();
		const texturePacker = new FixtureTexturePacker();
		const textureManager = new TextureManager({ assetService, texturePacker });

		const update = await textureManager.applyStaticCommitDelta(
			createCommitDelta({ outputFormat: "rgba8" }),
		);

		expect(assetService.requestedKeys).toEqual([
			{
				id: "06000010?cs=linear&mips=none&out=rgba8&usage=color",
				kind: "prepared-texture",
			},
		]);
		expect(update).toMatchObject({
			drawUnitBindings: [
				{
					drawUnitId: "terrain-a",
					textureRefId: STABLE_TEXTURE_REF_ID,
					textureUseId: "terrain-a:prepared-texture:06000010",
				},
			],
			placements: [
				{
					format: "rgba8",
					height: 1,
					kind: "direct-texture",
					placementRevision: 1,
					rect: [0, 0, 1, 1],
					textureRefId: STABLE_TEXTURE_REF_ID,
					textureUseId: "terrain-a:prepared-texture:06000010",
					width: 1,
				},
			],
			removedTextureRefIds: [],
			revision: 1,
		});
		expect(Array.from(update?.placements[0]?.pixels ?? [])).toEqual([
			255, 128, 0, 255,
		]);
		expect(texturePacker.jobs).toMatchObject([
			{
				domain: "outdoor-terrain",
				page: {
					format: "rgba8",
					height: 1,
					width: 1,
				},
				placementRevision: 1,
				sources: [
					{
						textureUseId: "terrain-a:prepared-texture:06000010",
					},
				],
			},
		]);
	});

	it("removes texture refs by draw-unit ownership without requiring rebaked geometry", async () => {
		const textureManager = new TextureManager({
			assetService: new FixtureAssetService(),
		});

		await textureManager.applyStaticCommitDelta(
			createCommitDelta({ outputFormat: "rgba8" }),
		);
		const update = await textureManager.applyStaticCommitDelta({
			addedDrawUnits: [],
			removedDrawUnitIds: ["terrain-a"],
			revision: 2,
			textureUses: [],
		});

		expect(update).toMatchObject({
			drawUnitBindings: [],
			placements: [],
			removedTextureRefIds: [STABLE_TEXTURE_REF_ID],
			revision: 2,
		});
	});

	it("reuses compatible domain placements across draw units", async () => {
		const assetService = new FixtureAssetService();
		const textureManager = new TextureManager({ assetService });

		const firstUpdate = await textureManager.applyStaticCommitDelta(
			createCommitDelta({
				drawUnitId: "terrain-a",
				outputFormat: "rgba8",
				textureUseId: "terrain-a:prepared-texture:06000010",
			}),
		);
		const secondUpdate = await textureManager.applyStaticCommitDelta(
			createCommitDelta({
				drawUnitId: "terrain-b",
				outputFormat: "rgba8",
				placementRevisionAssumption: 0,
				textureUseId: "terrain-b:prepared-texture:06000010",
			}),
		);

		expect(assetService.requestedKeys).toHaveLength(1);
		expect(firstUpdate?.placements).toHaveLength(1);
		expect(secondUpdate).toMatchObject({
			drawUnitBindings: [
				{
					drawUnitId: "terrain-b",
					textureRefId: STABLE_TEXTURE_REF_ID,
					textureUseId: "terrain-b:prepared-texture:06000010",
				},
			],
			placements: [],
			removedTextureRefIds: [],
			revision: 2,
		});

		const removeFirstUpdate = await textureManager.applyStaticCommitDelta({
			addedDrawUnits: [],
			removedDrawUnitIds: ["terrain-a"],
			revision: 3,
			textureUses: [],
		});
		expect(removeFirstUpdate).toBeNull();

		const removeSecondUpdate = await textureManager.applyStaticCommitDelta({
			addedDrawUnits: [],
			removedDrawUnitIds: ["terrain-b"],
			revision: 4,
			textureUses: [],
		});
		expect(removeSecondUpdate).toMatchObject({
			removedTextureRefIds: [STABLE_TEXTURE_REF_ID],
		});
	});

	it("rejects stale new placement requirements without corrupting the active registry", async () => {
		const textureManager = new TextureManager({
			assetService: new FixtureAssetService(),
		});

		await textureManager.applyStaticCommitDelta(
			createCommitDelta({ outputFormat: "rgba8" }),
		);

		await expect(
			textureManager.applyStaticCommitDelta(
				createCommitDelta({
					outputFormat: "rgba8",
					placementRevisionAssumption: 0,
					renderSurfaceId: 0x06000020,
					textureUseId: "terrain-b:prepared-texture:06000020",
				}),
			),
		).rejects.toThrow(
			"assumed outdoor-terrain atlas revision 0, but the active revision is 1",
		);

		const snapshot = textureManager.createDomainAtlasSnapshot(
			createTerrainPayload([
				createTextureUse(0x06000010),
				createTextureUse(0x06000020),
			]),
		);
		expect(snapshot).toMatchObject({
			domain: "outdoor-terrain",
			placements: [
				{
					placementRevision: 1,
					texture: {
						renderSurfaceId: 0x06000010,
					},
				},
			],
			revision: 1,
		});
	});

	it("creates scoped domain atlas snapshots from typed payload texture uses", async () => {
		const textureManager = new TextureManager({
			assetService: new FixtureAssetService(),
		});
		const payload = createTerrainPayload([createTextureUse(0x06000010)]);

		expect(textureManager.createDomainAtlasSnapshot(payload)).toEqual({
			domain: "outdoor-terrain",
			placements: [],
			revision: 0,
			textureUses: [createTextureUse(0x06000010)],
		});

		await textureManager.applyStaticCommitDelta(
			createCommitDelta({ outputFormat: "rgba8" }),
		);

		expect(textureManager.createDomainAtlasSnapshot(payload)).toMatchObject({
			domain: "outdoor-terrain",
			placements: [
				{
					placementRevision: 1,
					texture: {
						kind: "prepared-texture-use",
						renderSurfaceId: 0x06000010,
					},
				},
			],
			revision: 1,
			textureUses: [createTextureUse(0x06000010)],
		});
	});

	it("accepts host pixel-format labels when the prepared policy is normalized rgba8", async () => {
		const textureManager = new TextureManager({
			assetService: new FixtureAssetService({
				levelFormat: "A8R8G8B8",
				outputFormat: "rgba8",
			}),
		});

		const update = await textureManager.applyStaticCommitDelta(
			createCommitDelta({ outputFormat: "rgba8" }),
		);

		expect(update?.placements).toHaveLength(1);
	});

	it("fails explicitly when normalized rgba8 byte length is invalid", async () => {
		const textureManager = new TextureManager({
			assetService: new FixtureAssetService({
				byteLength: 3,
				outputFormat: "rgba8",
			}),
		});

		await expect(
			textureManager.applyStaticCommitDelta(
				createCommitDelta({ outputFormat: "rgba8" }),
			),
		).rejects.toThrow("expected 4 rgba8 bytes, got 3");
	});
});

class FixtureAssetService implements AssetService {
	readonly requestedKeys: HostAssetKey[] = [];
	readonly #payloadOptions: PreparedTexturePayloadOptions | null;

	constructor(payloadOptions: PreparedTexturePayloadOptions | null = null) {
		this.#payloadOptions = payloadOptions;
	}

	async requestPreparedAsset(key: HostAssetKey): Promise<PreparedAsset> {
		this.requestedKeys.push(key);

		const outputFormat = key.id.includes("dxt1") ? "dxt1" : "rgba8";
		return {
			key,
			payload: createPreparedTexturePayload(this.#payloadOptions ?? {
				outputFormat,
			}),
			preparedAt: "test",
			revision: 1,
			sourceAssetId: `prepared-texture/${key.id}`,
		};
	}

	acquirePreparedAssetLease(key: HostAssetKey): PreparedAssetLease {
		return {
			key,
			release() {},
		};
	}

	pruneExpiredWarmAssets(): void {}

	createSnapshot(): AssetServiceSnapshot {
		return {
			committed: [],
			failures: [],
			pending: [],
		};
	}
}

class FixtureTexturePacker implements TexturePacker {
	readonly jobs: TexturePackingJob[] = [];

	async pack(job: TexturePackingJob): Promise<TexturePackingResult> {
		this.jobs.push(job);

		return {
			domain: job.domain,
			jobId: job.jobId,
			pages: [
				{
					format: "rgba8",
					height: job.page.height,
					pageId: `${job.jobId}:page:0`,
					pixels: job.sources[0]?.source.pixels ?? new Uint8Array(),
					width: job.page.width,
				},
			],
			placementRevision: job.placementRevision,
			rects: job.sources.map((source) => ({
				pageId: `${job.jobId}:page:0`,
				rect: [0, 0, source.source.width, source.source.height] as const,
				textureUseId: source.textureUseId,
			})),
		};
	}
}

function createCommitDelta(options: {
	readonly drawUnitId?: string;
	readonly outputFormat: "rgba8" | "dxt1";
	readonly placementRevisionAssumption?: number;
	readonly renderSurfaceId?: number;
	readonly textureUseId?: string;
}): StaticCoordinatorCommitDelta {
	const drawUnitId = options.drawUnitId ?? "terrain-a";
	const renderSurfaceId = options.renderSurfaceId ?? 0x06000010;
	const textureUseId =
		options.textureUseId ??
		`${drawUnitId}:prepared-texture:${renderSurfaceId.toString(16).padStart(8, "0")}`;

	return {
		addedDrawUnits: [],
		removedDrawUnitIds: [],
		revision: 1,
		textureUses: [
			{
				domain: "outdoor-terrain",
				ownerDrawUnitIds: [drawUnitId],
				placementRevisionAssumption: options.placementRevisionAssumption ?? 0,
				source: {
					colorSpace: "linear",
					kind: "prepared-texture-use",
					mipPolicy: "none",
					outputFormat: options.outputFormat,
					renderSurfaceId,
					usage: "color",
				},
				textureUseId,
			},
		],
	};
}

function createTextureUse(renderSurfaceId: number): PreparedTextureUseIdentity {
	return {
		colorSpace: "linear",
		kind: "prepared-texture-use",
		mipPolicy: "none",
		outputFormat: "rgba8",
		renderSurfaceId,
		usage: "color",
	};
}

function createTerrainPayload(
	textureUses: readonly PreparedTextureUseIdentity[],
): StaticScopePayload {
	return {
		job: {
			domain: "outdoor-terrain",
			scope: {
				kind: "landblock",
				landblockId: 0xda55ffff,
			},
		},
		scope: {
			kind: "terrain",
			landblock: {
				kind: "landblock",
				landblockId: 0xda55ffff,
			},
			mesh: {
				bounds: null,
				gridSize: 1,
				maxHeight: 0,
				minHeight: 0,
				quadCount: 0,
				quads: [],
				tileSize: 24,
				triangleCount: 0,
				triangles: [],
				vertexCount: 0,
				vertices: [],
			},
			missingRefs: [],
			regionProfile: {
				detailTextureIds: [],
				identity: {
					kind: "region-render-profile",
					regionNumber: 1,
				},
				sourceRevision: 1,
			},
			spatial: {
				bounds: null,
				coordinateSpace: "landblock-local",
			},
			terrainMaterial: {
				identity: {
					kind: "terrain-material",
					regionNumber: 1,
					terrainMaterialId: 1,
				},
				sourceRevision: 1,
				surfaceTextureIds: [],
			},
			textureUses: textureUses.map((texture) => ({
				preparedTextureUse: texture,
				role: "terrain-base",
				texture: {
					kind: "surface-texture",
					surfaceTextureId: texture.renderSurfaceId,
				},
			})),
		},
		sourceRevision: 1,
	};
}

interface PreparedTexturePayloadOptions {
	readonly byteLength?: number;
	readonly levelFormat?: string;
	readonly outputFormat: "rgba8" | "dxt1";
}

function createPreparedTexturePayload(options: PreparedTexturePayloadOptions) {
	const bytes =
		options.byteLength === undefined
			? new Uint8Array([255, 128, 0, 255])
			: new Uint8Array(options.byteLength).fill(255);

	return {
		colorSpace: "linear",
		kind: "prepared-texture",
		levels: [
			{
				bytes,
				format: options.levelFormat ?? "A8R8G8B8",
				height: 1,
				level: 0,
				width: 1,
			},
		],
		mipPolicy: "none",
		outputFormat: options.outputFormat,
		renderSurfaceId: 0x06000010,
		usage: "color",
	};
}
