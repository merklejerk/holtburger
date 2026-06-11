import { describe, expect, it, vi } from "vitest";
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
import type {
	TexturePackingJob,
	TexturePackingResult,
} from "./packing/protocol";
import { TextureManager } from "./texture-manager";

const STABLE_TEXTURE_REF_ID =
	"texture-ref:outdoor-terrain:batch-a:terrain-a:prepared-texture:06000010";

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
					rect: [0, 0, 1, 1],
					textureHeight: 256,
					textureRefId: STABLE_TEXTURE_REF_ID,
					textureWidth: 256,
					textureUseId: "terrain-a:prepared-texture:06000010",
				},
			],
			placements: [
				{
					format: "rgba8",
					filteringMode: "anisotropic-4x",
					height: 256,
					kind: "direct-texture",
					mipmapsGenerated: true,
					anisotropy: 4,
					placementRevision: 1,
					rect: [0, 0, 1, 1],
					sampleClass: "rgba-color",
					samplerPolicyKey:
						"sample=rgba-color;filter=anisotropic-4x;mips=on;aniso=4",
					textureRefId: STABLE_TEXTURE_REF_ID,
					textureUseId: "terrain-a:prepared-texture:06000010",
					wrapS: "repeat",
					wrapT: "repeat",
					width: 256,
				},
			],
			removedTextureRefIds: [],
			revision: 1,
		});
		expect(Array.from(update?.placements[0]?.pixels.slice(0, 4) ?? [])).toEqual(
			[255, 128, 0, 255],
		);
		expect(texturePacker.jobs).toMatchObject([
			{
				domain: "outdoor-terrain",
				page: {
					fillRgba: [128, 128, 128, 255],
					format: "rgba8",
					gutterEdgeMode: "repeat",
					gutterPixels: 96,
					height: 2048,
					pageSelection: "minimize-textures",
					width: 2048,
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

	it("packs compatible new texture uses into one shared page placement", async () => {
		const assetService = new FixtureAssetService();
		const texturePacker = new FixtureTexturePacker({
			pageHeight: 16,
			pageWidth: 16,
			pixels: new Uint8Array(16 * 16 * 4),
			rect: [4, 4, 1, 1],
		});
		const textureManager = new TextureManager({ assetService, texturePacker });

		const update = await textureManager.applyStaticCommitDelta({
			addedDrawUnits: [],
			removedDrawUnitIds: [],
			revision: 1,
			staticBatchId: "batch-a",
			textureUses: [
				createTextureUseCommit({
					drawUnitId: "terrain-a",
					renderSurfaceId: 0x06000010,
					textureUseId: "terrain-a:prepared-texture:06000010",
				}),
				createTextureUseCommit({
					drawUnitId: "terrain-b",
					renderSurfaceId: 0x06000020,
					textureUseId: "terrain-b:prepared-texture:06000020",
				}),
			],
		});

		expect(texturePacker.jobs).toMatchObject([
			{
				page: {
					fillRgba: [128, 128, 128, 255],
					format: "rgba8",
					gutterEdgeMode: "repeat",
					gutterPixels: 96,
					height: 2048,
					pageSelection: "minimize-textures",
					width: 2048,
				},
				sources: [
					{
						textureUseId: "terrain-a:prepared-texture:06000010",
					},
					{
						textureUseId: "terrain-b:prepared-texture:06000020",
					},
				],
			},
		]);
		expect(texturePacker.jobs[0]?.cohorts).toBeUndefined();
		expect(update?.placements).toHaveLength(1);
		expect(update?.drawUnitBindings).toEqual([
			expect.objectContaining({
				drawUnitId: "terrain-a",
				rect: [4, 4, 1, 1],
				textureRefId: update?.placements[0]?.textureRefId,
			}),
			expect.objectContaining({
				drawUnitId: "terrain-b",
				rect: [4, 4, 1, 1],
				textureRefId: update?.placements[0]?.textureRefId,
			}),
		]);
		expect(update?.placements[0]?.textureRefId).toContain("texture-page-ref");
	});

	it("does not force terrain color refs into draw-unit same-page cohorts", async () => {
		const assetService = new FixtureAssetService();
		const texturePacker = new FixtureTexturePacker();
		const textureManager = new TextureManager({ assetService, texturePacker });

		await textureManager.applyStaticCommitDelta({
			addedDrawUnits: [],
			removedDrawUnitIds: [],
			revision: 1,
			staticBatchId: "batch-a",
			textureUses: [
				createTextureUseCommit({
					drawUnitId: "terrain-slice-a",
					renderSurfaceId: 0x06000010,
					textureUseId: "terrain-base-a",
				}),
				createTextureUseCommit({
					drawUnitId: "terrain-slice-a",
					renderSurfaceId: 0x06000011,
					textureUseId: "terrain-road",
				}),
				createTextureUseCommit({
					drawUnitId: "terrain-slice-b",
					renderSurfaceId: 0x06000012,
					textureUseId: "terrain-base-b",
				}),
				createTextureUseCommit({
					drawUnitId: "terrain-slice-b",
					renderSurfaceId: 0x06000011,
					textureUseId: "terrain-road",
				}),
			],
		});

		expect(texturePacker.jobs[0]?.cohorts).toBeUndefined();
		expect(
			texturePacker.jobs[0]?.sources.map((source) => source.textureUseId),
		).toEqual(["terrain-base-a", "terrain-road", "terrain-base-b"]);
	});

	it("scopes non-terrain texture packing cohorts to draw-unit ownership within a batch", async () => {
		const assetService = new FixtureAssetService();
		const texturePacker = new FixtureTexturePacker({
			pageHeight: 512,
			pageWidth: 512,
			pixels: new Uint8Array(512 * 512 * 4),
			rect: [96, 96, 1, 1],
		});
		const textureManager = new TextureManager({ assetService, texturePacker });

		await textureManager.applyStaticCommitDelta({
			addedDrawUnits: [],
			removedDrawUnitIds: [],
			revision: 1,
			staticBatchId: "batch-a",
			textureUses: [
				createTextureUseCommit({
					domain: "outdoor-buildings",
					drawUnitId: "terrain-a",
					renderSurfaceId: 0x06000010,
					textureUseId: "terrain-a:prepared-texture:06000010",
				}),
				createTextureUseCommit({
					domain: "outdoor-buildings",
					drawUnitId: "terrain-a",
					renderSurfaceId: 0x06000020,
					textureUseId: "terrain-a:prepared-texture:06000020",
				}),
				createTextureUseCommit({
					domain: "outdoor-buildings",
					drawUnitId: "terrain-b",
					renderSurfaceId: 0x06000030,
					textureUseId: "terrain-b:prepared-texture:06000030",
				}),
				createTextureUseCommit({
					domain: "outdoor-buildings",
					drawUnitId: "terrain-b",
					renderSurfaceId: 0x06000040,
					textureUseId: "terrain-b:prepared-texture:06000040",
				}),
			],
		});

		expect(texturePacker.jobs[0]?.cohorts).toEqual([
			{
				key: expect.stringContaining("draw-unit:terrain-a"),
				textureUseIds: [
					"terrain-a:prepared-texture:06000010",
					"terrain-a:prepared-texture:06000020",
				],
			},
			{
				key: expect.stringContaining("draw-unit:terrain-b"),
				textureUseIds: [
					"terrain-b:prepared-texture:06000030",
					"terrain-b:prepared-texture:06000040",
				],
			},
		]);
		expect(
			texturePacker.jobs[0]?.sources.map((source) => source.textureUseId),
		).toEqual([
			"terrain-a:prepared-texture:06000010",
			"terrain-a:prepared-texture:06000020",
			"terrain-b:prepared-texture:06000030",
			"terrain-b:prepared-texture:06000040",
		]);
	});

	it("keeps shared prepared sources as separate logical packing entries when cohorts differ", async () => {
		const assetService = new FixtureAssetService();
		const texturePacker = new FixtureTexturePacker({
			pageHeight: 512,
			pageWidth: 512,
			pixels: new Uint8Array(512 * 512 * 4),
			rect: [96, 96, 1, 1],
		});
		const textureManager = new TextureManager({ assetService, texturePacker });

		await textureManager.applyStaticCommitDelta({
			addedDrawUnits: [],
			removedDrawUnitIds: [],
			revision: 1,
			staticBatchId: "batch-a",
			textureUses: [
				createTextureUseCommit({
					domain: "outdoor-buildings",
					drawUnitId: "terrain-a",
					renderSurfaceId: 0x06000010,
					textureUseId: "terrain-a:prepared-texture:06000010",
				}),
				createTextureUseCommit({
					domain: "outdoor-buildings",
					drawUnitId: "terrain-b",
					renderSurfaceId: 0x06000010,
					textureUseId: "terrain-b:prepared-texture:06000010",
				}),
			],
		});

		expect(
			texturePacker.jobs[0]?.sources.map((source) => source.textureUseId),
		).toEqual([
			"terrain-a:prepared-texture:06000010",
			"terrain-b:prepared-texture:06000010",
		]);
		expect(texturePacker.jobs[0]?.cohorts).toEqual([
			{
				key: expect.stringContaining("draw-unit:terrain-a"),
				textureUseIds: ["terrain-a:prepared-texture:06000010"],
			},
			{
				key: expect.stringContaining("draw-unit:terrain-b"),
				textureUseIds: ["terrain-b:prepared-texture:06000010"],
			},
		]);
	});

	it("carries atlas rect metadata on duplicate logical texture placements", async () => {
		const assetService = new FixtureAssetService();
		const texturePacker = new FixtureTexturePacker({
			pageHeight: 4,
			pageWidth: 4,
			pixels: new Uint8Array(4 * 4 * 4),
			rect: [2, 1, 1, 1],
		});
		const textureManager = new TextureManager({ assetService, texturePacker });

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
				textureUseId: "terrain-b:prepared-texture:06000010",
			}),
		);

		expect(firstUpdate).toMatchObject({
			drawUnitBindings: [
				{
					drawUnitId: "terrain-a",
					rect: [2, 1, 1, 1],
					textureHeight: 4,
					textureWidth: 4,
				},
			],
			placements: [
				{
					height: 4,
					rect: [2, 1, 1, 1],
					width: 4,
				},
			],
		});
		expect(secondUpdate).toMatchObject({
			drawUnitBindings: [
				{
					drawUnitId: "terrain-b",
					rect: [2, 1, 1, 1],
					textureHeight: 4,
					textureWidth: 4,
				},
			],
			placements: [
				{
					height: 4,
					rect: [2, 1, 1, 1],
					textureRefId:
						"texture-ref:outdoor-terrain:batch-a:terrain-b:prepared-texture:06000010",
					textureUseId: "terrain-b:prepared-texture:06000010",
					width: 4,
				},
			],
		});
	});

	it("assigns draw-local terrain role-page slots from committed placements", async () => {
		const assetService = new FixtureAssetService();
		const texturePacker = new FixtureTexturePacker({
			rectsByTextureUseId: new Map([
				[
					"terrain-a:prepared-texture:06000010",
					{
						pageHeight: 512,
						pageId: "page:0",
						pageWidth: 512,
						rect: [96, 96, 1, 1],
					},
				],
				[
					"terrain-a:prepared-texture:06000020",
					{
						pageHeight: 512,
						pageId: "page:1",
						pageWidth: 512,
						rect: [96, 96, 1, 1],
					},
				],
			]),
		});
		const textureManager = new TextureManager({ assetService, texturePacker });

		const update = await textureManager.applyStaticCommitDelta({
			addedDrawUnits: [],
			removedDrawUnitIds: [],
			revision: 1,
			staticBatchId: "batch-a",
			textureUses: [
				createTextureUseCommit({
					drawUnitId: "terrain-a",
					renderSurfaceId: 0x06000010,
					textureUseId: "terrain-a:prepared-texture:06000010",
				}),
				createTextureUseCommit({
					drawUnitId: "terrain-a",
					renderSurfaceId: 0x06000020,
					textureUseId: "terrain-a:prepared-texture:06000020",
				}),
			],
		});

		expect(update?.drawUnitBindings).toEqual([
			expect.objectContaining({
				rolePage: { kind: "color", slot: 0 },
				textureUseId: "terrain-a:prepared-texture:06000010",
			}),
			expect.objectContaining({
				rolePage: { kind: "color", slot: 1 },
				textureUseId: "terrain-a:prepared-texture:06000020",
			}),
		]);
	});

	it("keeps terrain role-page overflow local to the affected draw unit", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const assetService = new FixtureAssetService();
			const rectsByTextureUseId = new Map<
				string,
				FixtureTexturePackerRectPlacement
			>();
			for (let index = 0; index < 5; index += 1) {
				rectsByTextureUseId.set(`overflow-texture-${index}`, {
					pageHeight: 512,
					pageId: `overflow-page:${index}`,
					pageWidth: 512,
					rect: [96, 96, 1, 1],
				});
			}
			rectsByTextureUseId.set("unrelated-texture", {
				pageHeight: 512,
				pageId: "unrelated-page",
				pageWidth: 512,
				rect: [96, 96, 1, 1],
			});
			const texturePacker = new FixtureTexturePacker({ rectsByTextureUseId });
			const textureManager = new TextureManager({ assetService, texturePacker });

			const update = await textureManager.applyStaticCommitDelta({
				addedDrawUnits: [],
				removedDrawUnitIds: [],
				revision: 1,
				staticBatchId: "batch-a",
				textureUses: [
					...Array.from({ length: 5 }, (_, index) =>
						createTextureUseCommit({
							drawUnitId: "terrain-overflow",
							renderSurfaceId: 0x06000010 + index,
							textureUseId: `overflow-texture-${index}`,
						}),
					),
					createTextureUseCommit({
						drawUnitId: "terrain-ok",
						renderSurfaceId: 0x06000030,
						textureUseId: "unrelated-texture",
					}),
				],
			});

			expect(
				update?.drawUnitBindings.filter(
					(binding) => binding.drawUnitId === "terrain-overflow",
				),
			).toHaveLength(4);
			expect(update?.drawUnitBindings).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						drawUnitId: "terrain-ok",
						rolePage: { kind: "color", slot: 0 },
						textureUseId: "unrelated-texture",
					}),
				]),
			);
		} finally {
			warnSpy.mockRestore();
		}
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
			staticBatchId: "batch-a",
			textureUses: [],
		});

		expect(update).toMatchObject({
			drawUnitBindings: [],
			placements: [],
			removedTextureRefIds: [STABLE_TEXTURE_REF_ID],
			revision: 2,
		});
	});

	it("duplicates logical placements across draw units that share prepared source", async () => {
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
				textureUseId: "terrain-b:prepared-texture:06000010",
			}),
		);

		expect(assetService.requestedKeys).toHaveLength(2);
		expect(firstUpdate?.placements).toHaveLength(1);
		expect(secondUpdate).toMatchObject({
			drawUnitBindings: [
				{
					drawUnitId: "terrain-b",
					textureRefId:
						"texture-ref:outdoor-terrain:batch-a:terrain-b:prepared-texture:06000010",
					textureUseId: "terrain-b:prepared-texture:06000010",
				},
			],
			placements: [
				{
					textureRefId:
						"texture-ref:outdoor-terrain:batch-a:terrain-b:prepared-texture:06000010",
					textureUseId: "terrain-b:prepared-texture:06000010",
				},
			],
			removedTextureRefIds: [],
			revision: 2,
		});

		const removeFirstUpdate = await textureManager.applyStaticCommitDelta({
			addedDrawUnits: [],
			removedDrawUnitIds: ["terrain-a"],
			revision: 3,
			staticBatchId: "batch-a",
			textureUses: [],
		});
		expect(removeFirstUpdate).toMatchObject({
			removedTextureRefIds: [
				"texture-ref:outdoor-terrain:batch-a:terrain-a:prepared-texture:06000010",
			],
		});

		const removeSecondUpdate = await textureManager.applyStaticCommitDelta({
			addedDrawUnits: [],
			removedDrawUnitIds: ["terrain-b"],
			revision: 4,
			staticBatchId: "batch-a",
			textureUses: [],
		});
		expect(removeSecondUpdate).toMatchObject({
			removedTextureRefIds: [
				"texture-ref:outdoor-terrain:batch-a:terrain-b:prepared-texture:06000010",
			],
		});
	});

	it("duplicates compatible textures across independent static batches", async () => {
		const assetService = new FixtureAssetService();
		const textureManager = new TextureManager({
			assetService,
		});

		const firstUpdate = await textureManager.applyStaticCommitDelta(
			createCommitDelta({ outputFormat: "rgba8" }),
		);
		const secondUpdate = await textureManager.applyStaticCommitDelta(
			createCommitDelta({
				drawUnitId: "terrain-b",
				outputFormat: "rgba8",
				staticBatchId: "batch-b",
				textureUseId: "terrain-b:prepared-texture:06000010",
			}),
		);

		expect(assetService.requestedKeys).toHaveLength(2);
		expect(firstUpdate?.placements).toHaveLength(1);
		expect(secondUpdate).toMatchObject({
			drawUnitBindings: [
				{
					drawUnitId: "terrain-b",
					textureRefId:
						"texture-ref:outdoor-terrain:batch-b:terrain-b:prepared-texture:06000010",
				},
			],
			placements: [
				{
					textureRefId:
						"texture-ref:outdoor-terrain:batch-b:terrain-b:prepared-texture:06000010",
				},
			],
		});
	});

	it("creates scoped static atlas batch snapshots from typed payload texture uses", async () => {
		const textureManager = new TextureManager({
			assetService: new FixtureAssetService(),
		});
		const payload = createTerrainPayload([createTextureUse(0x06000010)]);

		expect(
			textureManager.createStaticAtlasBatchSnapshot([payload], "batch-a"),
		).toEqual({
			domain: "outdoor-terrain",
			placements: [],
			staticBatchId: "batch-a",
			textureUses: [createTextureUse(0x06000010)],
		});

		await textureManager.applyStaticCommitDelta(
			createCommitDelta({ outputFormat: "rgba8" }),
		);

		expect(
			textureManager.createStaticAtlasBatchSnapshot([payload], "batch-a"),
		).toMatchObject({
			domain: "outdoor-terrain",
			placements: [
				{
					texture: {
						kind: "prepared-texture-use",
						renderSurfaceId: 0x06000010,
					},
				},
			],
			staticBatchId: "batch-a",
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

	it("keeps exact mask pages out of generated mip policy", async () => {
		const texturePacker = new FixtureTexturePacker();
		const textureManager = new TextureManager({
			assetService: new FixtureAssetService(),
			texturePacker,
		});

		const update = await textureManager.applyStaticCommitDelta(
			createCommitDelta({
				outputFormat: "rgba8",
				usage: "mask",
			}),
		);

		expect(update?.placements[0]).toMatchObject({
			anisotropy: 4,
			filteringMode: "anisotropic-4x",
			mipmapsGenerated: false,
			sampleClass: "rgba-mask",
			samplerPolicyKey:
				"sample=rgba-mask;filter=anisotropic-4x;mips=off;aniso=4",
			wrapS: "clamp-to-edge",
			wrapT: "clamp-to-edge",
		});
		expect(texturePacker.jobs[0]?.page).toMatchObject({
			gutterEdgeMode: "clamp",
			gutterPixels: 16,
		});
	});

	it("carries nearest filtering as placement policy instead of rebaking geometry", async () => {
		const textureManager = new TextureManager({
			assetService: new FixtureAssetService(),
			filteringMode: "nearest",
		});

		const update = await textureManager.applyStaticCommitDelta(
			createCommitDelta({ outputFormat: "rgba8" }),
		);

		expect(update?.placements[0]).toMatchObject({
			anisotropy: 1,
			filteringMode: "nearest",
			mipmapsGenerated: false,
			samplerPolicyKey: "sample=rgba-color;filter=nearest;mips=off;aniso=1",
		});
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
			payload: createPreparedTexturePayload(
				this.#payloadOptions ?? {
					outputFormat,
					renderSurfaceId: getPreparedTextureRenderSurfaceId(key),
					usage: getPreparedTextureUsage(key),
				},
			),
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
	readonly #options: FixtureTexturePackerOptions;

	constructor(options: FixtureTexturePackerOptions = {}) {
		this.#options = options;
	}

	async pack(job: TexturePackingJob): Promise<TexturePackingResult> {
		this.jobs.push(job);
		if (this.#options.rectsByTextureUseId) {
			const pagesById = new Map<string, TexturePackingResult["pages"][number]>();
			const rects: TexturePackingResult["rects"] = [];
			for (const source of job.sources) {
				const placement = this.#options.rectsByTextureUseId.get(
					source.textureUseId,
				);
				if (!placement) {
					throw new Error(
						`Missing fixture rect placement for ${source.textureUseId}.`,
					);
				}
				pagesById.set(placement.pageId, {
					format: "rgba8",
					height: placement.pageHeight,
					pageId: placement.pageId,
					pixels: new Uint8Array(placement.pageWidth * placement.pageHeight * 4),
					width: placement.pageWidth,
				});
				rects.push({
					pageId: placement.pageId,
					rect: placement.rect,
					textureUseId: source.textureUseId,
				});
			}

			return {
				domain: job.domain,
				jobId: job.jobId,
				pages: [...pagesById.values()],
				placementRevision: job.placementRevision,
				rects,
			};
		}

		const pageWidth =
			this.#options.pageWidth ?? createFixturePageSide(job, "width");
		const pageHeight =
			this.#options.pageHeight ?? createFixturePageSide(job, "height");

		return {
			domain: job.domain,
			jobId: job.jobId,
			pages: [
				{
					format: "rgba8",
					height: pageHeight,
					pageId: `${job.jobId}:page:0`,
					pixels:
						this.#options.pixels ??
						createFixturePagePixels(
							pageWidth,
							pageHeight,
							job.sources[0]?.source.pixels,
						),
					width: pageWidth,
				},
			],
			placementRevision: job.placementRevision,
			rects: job.sources.map((source) => ({
				pageId: `${job.jobId}:page:0`,
				rect:
					this.#options.rect ??
					([0, 0, source.source.width, source.source.height] as const),
				textureUseId: source.textureUseId,
			})),
		};
	}
}

interface FixtureTexturePackerOptions {
	readonly pageWidth?: number;
	readonly pageHeight?: number;
	readonly pixels?: Uint8Array;
	readonly rect?: readonly [number, number, number, number];
	readonly rectsByTextureUseId?: ReadonlyMap<
		string,
		FixtureTexturePackerRectPlacement
	>;
}

interface FixtureTexturePackerRectPlacement {
	readonly pageId: string;
	readonly pageWidth: number;
	readonly pageHeight: number;
	readonly rect: readonly [number, number, number, number];
}

function createFixturePagePixels(
	width: number,
	height: number,
	sourcePixels: Uint8Array | undefined,
): Uint8Array {
	const pixels = new Uint8Array(width * height * 4);
	if (sourcePixels) {
		pixels.set(sourcePixels.subarray(0, 4), 0);
	}

	return pixels;
}

function createFixturePageSide(
	job: TexturePackingJob,
	dimension: "height" | "width",
): number {
	const gutterPixels = job.page.gutterPixels ?? 0;
	const minSide = Math.max(
		1,
		...job.sources.map((source) => source.source[dimension] + gutterPixels * 2),
	);
	return Math.min(nextPowerOfTwo(minSide), job.page[dimension]);
}

function nextPowerOfTwo(value: number): number {
	let power = 1;
	while (power < value) {
		power *= 2;
	}

	return power;
}

function createCommitDelta(options: {
	readonly drawUnitId?: string;
	readonly outputFormat: "rgba8" | "dxt1";
	readonly renderSurfaceId?: number;
	readonly staticBatchId?: string;
	readonly textureUseId?: string;
	readonly usage?: PreparedTextureUseIdentity["usage"];
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
		staticBatchId: options.staticBatchId ?? "batch-a",
		textureUses: [
			createTextureUseCommit({
				drawUnitId,
				outputFormat: options.outputFormat,
				renderSurfaceId,
				staticBatchId: options.staticBatchId,
				textureUseId,
				usage: options.usage,
			}),
		],
	};
}

function createTextureUseCommit(options: {
	readonly domain?: StaticCoordinatorCommitDelta["textureUses"][number]["domain"];
	readonly drawUnitId: string;
	readonly outputFormat?: "rgba8" | "dxt1";
	readonly renderSurfaceId: number;
	readonly staticBatchId?: string;
	readonly textureUseId: string;
	readonly usage?: PreparedTextureUseIdentity["usage"];
}): StaticCoordinatorCommitDelta["textureUses"][number] {
	return {
		domain: options.domain ?? "outdoor-terrain",
		ownerDrawUnitIds: [options.drawUnitId],
		source: {
			kind: "prepared-texture-use",
			outputFormat: options.outputFormat ?? "rgba8",
			renderSurfaceId: options.renderSurfaceId,
			usage: options.usage ?? "color",
		},
		staticBatchId: options.staticBatchId ?? "batch-a",
		textureUseId: options.textureUseId,
	};
}

function createTextureUse(renderSurfaceId: number): PreparedTextureUseIdentity {
	return {
		kind: "prepared-texture-use",
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
	readonly renderSurfaceId?: number;
	readonly usage?: PreparedTextureUseIdentity["usage"];
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
		renderSurfaceId: options.renderSurfaceId ?? 0x06000010,
		usage: options.usage ?? "color",
	};
}

function getPreparedTextureRenderSurfaceId(key: HostAssetKey): number {
	return Number.parseInt(key.id.slice(0, 8), 16);
}

function getPreparedTextureUsage(
	key: HostAssetKey,
): PreparedTextureUseIdentity["usage"] {
	if (key.id.includes("usage=detail")) {
		return "detail";
	}
	if (key.id.includes("usage=mask")) {
		return "mask";
	}
	if (key.id.includes("usage=raw")) {
		return "raw";
	}

	return "color";
}
