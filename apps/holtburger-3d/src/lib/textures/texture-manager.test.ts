import { describe, expect, it, vi } from "vitest";
import type {
	AssetService,
	AssetServiceSnapshot,
	HostAssetKey,
	PreparedAsset,
	PreparedAssetLease,
} from "../assets/contracts";
import type {
	PreparedRgbaRenderSurfaceTextureUseIdentity,
	PreparedRgbaRenderSurfaceTextureUsage,
	StaticBakeTextureSamplingPolicy,
	StaticCoordinatorCommitDelta,
	StaticScopePayload,
	VisualTextureDomain,
} from "../static/contracts";
import { AtlasTexturePacker, type TexturePacker } from "./packing/packer";
import type {
	TexturePackingJob,
	TexturePackingResult,
} from "./packing/protocol";
import { MAX_OBJECT_MATERIAL_BASE_COLOR_PAGES_PER_DRAW } from "../renderer/types";
import {
	TextureManager,
	type DynamicTextureUseCommit,
} from "./texture-manager";

const STABLE_TEXTURE_REF_ID =
	"texture-ref:outdoor-terrain:batch-a:terrain-a:prepared-texture:06000010";

describe("browser texture manager", () => {
	it("turns bake-local texture uses into runtime-owned texture page placements", async () => {
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
			textureBindings: [
				{
					owner: { drawUnitId: "terrain-a", kind: "draw-unit" },
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
					gutterEdgeMode: "clamp",
					gutterPixels: 96,
					height: 2048,
					pageSelection: "minimize-textures",
					width: 2048,
				},
				placementRevision: 1,
				sources: [
					{
						gutterEdgeMode: "repeat",
						textureUseId: "terrain-a:prepared-texture:06000010",
					},
				],
			},
		]);
	});

	it("updates resident texture page sampler policy without repacking", async () => {
		const assetService = new FixtureAssetService();
		const texturePacker = new FixtureTexturePacker({
			pageHeight: 16,
			pageWidth: 16,
			rect: [4, 4, 1, 1],
		});
		const textureManager = new TextureManager({ assetService, texturePacker });

		await textureManager.applyStaticCommitDelta(
			createCommitDelta({ outputFormat: "rgba8" }),
		);
		const update = textureManager.setFilteringMode("nearest");

		expect(update).toEqual({
			policies: [
				{
					anisotropy: 1,
					filteringMode: "nearest",
					mipmapsGenerated: false,
					samplerPolicyKey: "sample=rgba-color;filter=nearest;mips=off;aniso=1",
					textureRefId: STABLE_TEXTURE_REF_ID,
				},
			],
			revision: 2,
		});
		expect(texturePacker.jobs).toHaveLength(1);
	});

	it("limits terrain role-page bindings when a draw unit overflows available pages", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const assetService = new FixtureAssetService();
		const textureUses = [
			0x06000010, 0x06000020, 0x06000030, 0x06000040, 0x06000050,
		].map((renderSurfaceId) =>
			createTextureUseCommit({
				drawUnitId: "terrain-overflow",
				renderSurfaceId,
				textureUseId: `terrain-overflow:prepared-texture:${renderSurfaceId.toString(16).padStart(8, "0")}`,
			}),
		);
		const texturePacker = new FixtureTexturePacker({
			rectsByTextureUseId: new Map(
				textureUses.map((textureUse, index) => [
					textureUse.textureUseId,
					{
						pageHeight: 16,
						pageId: `page-${index}`,
						pageWidth: 16,
						rect: [0, 0, 1, 1],
					},
				]),
			),
		});
		const textureManager = new TextureManager({ assetService, texturePacker });

		try {
			const update = await textureManager.applyStaticCommitDelta({
				addedDrawUnits: [],
				removedResources: [],
				revision: 1,
				staticBatchId: "batch-a",
				textureUses,
			});

			expect(update?.textureBindings).toHaveLength(4);
		} finally {
			warn.mockRestore();
		}
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
			removedResources: [],
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
					gutterEdgeMode: "clamp",
					gutterPixels: 96,
					height: 2048,
					pageSelection: "minimize-textures",
					width: 2048,
				},
				sources: [
					{
						gutterEdgeMode: "repeat",
						textureUseId: "terrain-a:prepared-texture:06000010",
					},
					{
						gutterEdgeMode: "repeat",
						textureUseId: "terrain-b:prepared-texture:06000020",
					},
				],
			},
		]);
		expect(texturePacker.jobs[0]?.cohorts).toBeUndefined();
		expect(update?.placements).toHaveLength(1);
		expect(update?.textureBindings).toEqual([
			expect.objectContaining({
				owner: { drawUnitId: "terrain-a", kind: "draw-unit" },
				rect: [4, 4, 1, 1],
				textureRefId: update?.placements[0]?.textureRefId,
			}),
			expect.objectContaining({
				owner: { drawUnitId: "terrain-b", kind: "draw-unit" },
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
			removedResources: [],
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

	it("does not force static object texture refs into draw-unit same-page cohorts", async () => {
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
			removedResources: [],
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

		expect(texturePacker.jobs[0]?.cohorts).toBeUndefined();
		expect(
			texturePacker.jobs[0]?.sources.map((source) => source.textureUseId),
		).toEqual([
			"terrain-a:prepared-texture:06000010",
			"terrain-a:prepared-texture:06000020",
			"terrain-b:prepared-texture:06000030",
			"terrain-b:prepared-texture:06000040",
		]);
	});

	it("packs outdoor-detail static object base-color refs across pages instead of one cohort page", async () => {
		const textureManager = new TextureManager({
			assetService: new FixtureAssetService({
				byteLength: 512 * 512 * 4,
				height: 512,
				outputFormat: "rgba8",
				width: 512,
			}),
			texturePacker: new AtlasTexturePacker(),
		});
		const textureUses = Array.from({ length: 10 }, (_, index) =>
			createTextureUseCommit({
				domain: "outdoor-detail",
				drawUnitId: "detail-static-a",
				renderSurfaceId: 0x06003780 + index,
				textureUseId: `detail-static-a:base:${index}`,
				usage: "rgba-color",
			}),
		);

		const update = await textureManager.applyStaticCommitDelta({
			addedDrawUnits: [],
			removedResources: [],
			revision: 1,
			staticBatchId: "batch-detail",
			textureUses,
		});

		expect(update?.placements.length).toBeGreaterThan(1);
		expect(update?.textureUsePlacements).toHaveLength(textureUses.length);
		expect(update?.textureBindings).toHaveLength(textureUses.length);
		expect(
			new Set(update?.textureBindings.map((binding) => binding.rolePage?.slot))
				.size,
		).toBeGreaterThan(1);
	});

	it("dedupes shared prepared sources inside one static batch", async () => {
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
			removedResources: [],
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
		).toEqual(["terrain-a:prepared-texture:06000010"]);
		expect(texturePacker.jobs[0]?.cohorts).toBeUndefined();
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
			textureBindings: [
				{
					owner: { drawUnitId: "terrain-a", kind: "draw-unit" },
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
			textureBindings: [
				{
					owner: { drawUnitId: "terrain-b", kind: "draw-unit" },
					rect: [2, 1, 1, 1],
					textureHeight: 4,
					textureWidth: 4,
				},
			],
			placements: [],
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
			removedResources: [],
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

		expect(update?.textureBindings).toEqual([
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
			const textureManager = new TextureManager({
				assetService,
				texturePacker,
			});

			const update = await textureManager.applyStaticCommitDelta({
				addedDrawUnits: [],
				removedResources: [],
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
				update?.textureBindings.filter(
					(binding) =>
						binding.owner.kind === "draw-unit" &&
						binding.owner.drawUnitId === "terrain-overflow",
				),
			).toHaveLength(4);
			expect(update?.textureBindings).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						owner: { drawUnitId: "terrain-ok", kind: "draw-unit" },
						rolePage: { kind: "color", slot: 0 },
						textureUseId: "unrelated-texture",
					}),
				]),
			);
		} finally {
			warnSpy.mockRestore();
		}
	});

	it("assigns static object base-color role pages per draw unit", async () => {
		const assetService = new FixtureAssetService();
		const rectsByTextureUseId = new Map<
			string,
			FixtureTexturePackerRectPlacement
		>([
			[
				"static-a:base:0",
				{
					pageHeight: 512,
					pageId: "static-base-page:0",
					pageWidth: 512,
					rect: [96, 96, 1, 1],
				},
			],
			[
				"static-a:base:1",
				{
					pageHeight: 512,
					pageId: "static-base-page:1",
					pageWidth: 512,
					rect: [96, 96, 1, 1],
				},
			],
		]);
		const texturePacker = new FixtureTexturePacker({ rectsByTextureUseId });
		const textureManager = new TextureManager({ assetService, texturePacker });

		const update = await textureManager.applyStaticCommitDelta({
			addedDrawUnits: [],
			removedResources: [],
			revision: 1,
			staticBatchId: "batch-a",
			textureUses: [
				createTextureUseCommit({
					domain: "outdoor-buildings",
					drawUnitId: "static-a",
					renderSurfaceId: 0x06000010,
					textureUseId: "static-a:base:0",
					usage: "rgba-color",
				}),
				createTextureUseCommit({
					domain: "outdoor-buildings",
					drawUnitId: "static-a",
					renderSurfaceId: 0x06000020,
					textureUseId: "static-a:base:1",
					usage: "rgba-color",
				}),
			],
		});

		expect(update?.textureBindings).toEqual([
			expect.objectContaining({
				owner: { drawUnitId: "static-a", kind: "draw-unit" },
				rolePage: { kind: "object-base-color", slot: 0 },
				textureUseId: "static-a:base:0",
			}),
			expect.objectContaining({
				owner: { drawUnitId: "static-a", kind: "draw-unit" },
				rolePage: { kind: "object-base-color", slot: 1 },
				textureUseId: "static-a:base:1",
			}),
		]);
	});

	it("assigns landblock env-cell texture uses to static role pages", async () => {
		const rectsByTextureUseId = new Map<
			string,
			FixtureTexturePackerRectPlacement
		>([
			[
				"structured-interior-a:base:0",
				{
					pageHeight: 16,
					pageId: "env-cell-base-page:0",
					pageWidth: 16,
					rect: [4, 4, 1, 1],
				},
			],
			[
				"structured-interior-a:base:1",
				{
					pageHeight: 16,
					pageId: "env-cell-base-page:1",
					pageWidth: 16,
					rect: [4, 4, 1, 1],
				},
			],
		]);
		const texturePacker = new FixtureTexturePacker({ rectsByTextureUseId });
		const textureManager = new TextureManager({
			assetService: new FixtureAssetService(),
			texturePacker,
		});

		const update = await textureManager.applyStaticCommitDelta({
			addedDrawUnits: [],
			materialCoverage: [],
			removedResources: [],
			revision: 1,
			staticAuthoredDynamicSeeds: [],
			staticBatchId: "batch-env",
			staticPortalGraphs: [],
			staticPortalInteriorRecords: [],
			staticSourceMappings: [],
			staticSpatialRecords: [],
			staticVisibilityRecords: [],
			textureUses: [
				createTextureUseCommit({
					domain: "landblock-env-cells",
					drawUnitId: "structured-interior-a",
					renderSurfaceId: 0x06000010,
					staticBatchId: "batch-env",
					textureUseId: "structured-interior-a:base:0",
					usage: "rgba-color",
				}),
				createTextureUseCommit({
					domain: "landblock-env-cells",
					drawUnitId: "structured-interior-a",
					renderSurfaceId: 0x06000020,
					staticBatchId: "batch-env",
					textureUseId: "structured-interior-a:base:1",
					usage: "rgba-color",
				}),
			],
		});

		expect(update?.textureBindings).toEqual([
			expect.objectContaining({
				owner: {
					drawUnitId: "structured-interior-a",
					kind: "draw-unit",
				},
				rolePage: { kind: "object-base-color", slot: 0 },
				textureUseId: "structured-interior-a:base:0",
			}),
			expect.objectContaining({
				owner: {
					drawUnitId: "structured-interior-a",
					kind: "draw-unit",
				},
				rolePage: { kind: "object-base-color", slot: 1 },
				textureUseId: "structured-interior-a:base:1",
			}),
		]);
		expect(texturePacker.jobs).toMatchObject([
			{
				domain: "landblock-env-cells",
				page: {
					gutterPixels: 4,
				},
				sources: [
					expect.objectContaining({
						gutterEdgeMode: "repeat",
						textureUseId: "structured-interior-a:base:0",
					}),
					expect.objectContaining({
						gutterEdgeMode: "repeat",
						textureUseId: "structured-interior-a:base:1",
					}),
				],
			},
		]);
	});

	it("records static object role-page overflow without collapsing to slot zero", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const assetService = new FixtureAssetService();
			const textureUses = Array.from(
				{ length: MAX_OBJECT_MATERIAL_BASE_COLOR_PAGES_PER_DRAW + 1 },
				(_, index) =>
					createTextureUseCommit({
						domain: "outdoor-buildings",
						drawUnitId: "static-overflow",
						renderSurfaceId: 0x06000010 + index,
						textureUseId: `static-overflow:base:${index}`,
						usage: "rgba-color",
					}),
			);
			const rectsByTextureUseId = new Map<
				string,
				FixtureTexturePackerRectPlacement
			>(
				textureUses.map((textureUse, index) => [
					textureUse.textureUseId,
					{
						pageHeight: 512,
						pageId: `static-overflow-page:${index}`,
						pageWidth: 512,
						rect: [96, 96, 1, 1],
					},
				]),
			);
			const texturePacker = new FixtureTexturePacker({ rectsByTextureUseId });
			const textureManager = new TextureManager({
				assetService,
				texturePacker,
			});

			const update = await textureManager.applyStaticCommitDelta({
				addedDrawUnits: [],
				removedResources: [],
				revision: 1,
				staticBatchId: "batch-a",
				textureUses,
			});

			expect(update?.textureBindings).toHaveLength(
				MAX_OBJECT_MATERIAL_BASE_COLOR_PAGES_PER_DRAW,
			);
			expect(
				update?.textureUsePlacements.map((placement) => placement.textureUseId),
			).toEqual(textureUses.map((textureUse) => textureUse.textureUseId));
			expect(
				update?.textureBindings.map((binding) => binding.rolePage),
			).toEqual([
				{ kind: "object-base-color", slot: 0 },
				{ kind: "object-base-color", slot: 1 },
				{ kind: "object-base-color", slot: 2 },
				{ kind: "object-base-color", slot: 3 },
			]);
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
			removedResources: [{ drawUnitId: "terrain-a", kind: "draw-unit" }],
			revision: 2,
			staticBatchId: "batch-a",
			textureUses: [],
		});

		expect(update).toMatchObject({
			textureBindings: [],
			placements: [],
			removedTextureRefIds: [STABLE_TEXTURE_REF_ID],
			revision: 2,
		});
	});

	it("reuses one placement across draw units that share prepared source", async () => {
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

		expect(assetService.requestedKeys).toHaveLength(1);
		expect(firstUpdate?.placements).toHaveLength(1);
		expect(secondUpdate).toMatchObject({
			textureBindings: [
				{
					owner: { drawUnitId: "terrain-b", kind: "draw-unit" },
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
			removedResources: [{ drawUnitId: "terrain-a", kind: "draw-unit" }],
			revision: 3,
			staticBatchId: "batch-a",
			textureUses: [],
		});
		expect(removeFirstUpdate).toBeNull();

		const removeSecondUpdate = await textureManager.applyStaticCommitDelta({
			addedDrawUnits: [],
			removedResources: [{ drawUnitId: "terrain-b", kind: "draw-unit" }],
			revision: 4,
			staticBatchId: "batch-a",
			textureUses: [],
		});
		expect(removeSecondUpdate).toMatchObject({
			removedTextureRefIds: [STABLE_TEXTURE_REF_ID],
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
			textureBindings: [
				{
					owner: { drawUnitId: "terrain-b", kind: "draw-unit" },
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
						kind: "prepared-render-surface-texture-use",
						renderSurface: {
							kind: "render-surface",
							renderSurfaceId: 0x06000010,
						},
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
				usage: "rgba-mask",
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

	it("keeps static object color textures filterable while preserving clamp wrapping", async () => {
		const texturePacker = new FixtureTexturePacker();
		const textureManager = new TextureManager({
			assetService: new FixtureAssetService(),
			texturePacker,
		});

		const update = await textureManager.applyStaticCommitDelta(
			createCommitDelta({
				domain: "outdoor-buildings",
				outputFormat: "rgba8",
				samplingPolicy: {
					wrapS: "clamp-to-edge",
					wrapT: "clamp-to-edge",
				},
				usage: "rgba-color",
			}),
		);

		expect(update?.placements[0]).toMatchObject({
			anisotropy: 4,
			filteringMode: "anisotropic-4x",
			mipmapsGenerated: true,
			sampleClass: "rgba-color",
			samplerPolicyKey:
				"sample=rgba-color;filter=anisotropic-4x;mips=on;aniso=4",
			wrapS: "clamp-to-edge",
			wrapT: "clamp-to-edge",
		});
		expect(texturePacker.jobs[0]?.page).toMatchObject({
			gutterEdgeMode: "clamp",
			gutterPixels: 4,
		});
	});

	it("shares static object clamp and repeat color uses in one virtual-wrap atlas page", async () => {
		const texturePacker = new FixtureTexturePacker();
		const textureManager = new TextureManager({
			assetService: new FixtureAssetService(),
			texturePacker,
		});

		const update = await textureManager.applyStaticCommitDelta({
			addedDrawUnits: [],
			removedResources: [],
			revision: 1,
			staticBatchId: "batch-a",
			textureUses: [
				createTextureUseCommit({
					domain: "outdoor-buildings",
					drawUnitId: "building-clamp",
					renderSurfaceId: 0x06000010,
					samplingPolicy: {
						wrapS: "clamp-to-edge",
						wrapT: "clamp-to-edge",
					},
					textureUseId: "building-clamp:06000010",
					usage: "rgba-color",
				}),
				createTextureUseCommit({
					domain: "outdoor-buildings",
					drawUnitId: "building-repeat",
					renderSurfaceId: 0x06000020,
					samplingPolicy: {
						wrapS: "repeat",
						wrapT: "repeat",
					},
					textureUseId: "building-repeat:06000020",
					usage: "rgba-color",
				}),
			],
		});

		expect(texturePacker.jobs).toHaveLength(1);
		expect(texturePacker.jobs[0]).toMatchObject({
			page: {
				gutterEdgeMode: "clamp",
				gutterPixels: 4,
			},
			sources: [
				{
					gutterEdgeMode: "clamp",
					textureUseId: "building-clamp:06000010",
				},
				{
					gutterEdgeMode: "repeat",
					textureUseId: "building-repeat:06000020",
				},
			],
		});
		expect(update?.placements).toMatchObject([
			{
				textureUseId: "building-clamp:06000010",
				wrapS: "clamp-to-edge",
				wrapT: "clamp-to-edge",
			},
		]);
		expect(
			new Set(update?.textureBindings.map((binding) => binding.textureRefId)),
		).toHaveProperty("size", 1);
	});

	it("reuses a static object atlas rect for later authored wrap aliases", async () => {
		const texturePacker = new FixtureTexturePacker();
		const textureManager = new TextureManager({
			assetService: new FixtureAssetService(),
			texturePacker,
		});

		const firstUpdate = await textureManager.applyStaticCommitDelta({
			addedDrawUnits: [],
			removedResources: [],
			revision: 1,
			staticBatchId: "batch-a",
			textureUses: [
				createTextureUseCommit({
					domain: "outdoor-buildings",
					drawUnitId: "building-clamp",
					renderSurfaceId: 0x06000010,
					samplingPolicy: {
						wrapS: "clamp-to-edge",
						wrapT: "clamp-to-edge",
					},
					textureUseId: "building-clamp:06000010",
					usage: "rgba-color",
				}),
			],
		});
		const secondUpdate = await textureManager.applyStaticCommitDelta({
			addedDrawUnits: [],
			removedResources: [],
			revision: 2,
			staticBatchId: "batch-a",
			textureUses: [
				createTextureUseCommit({
					domain: "outdoor-buildings",
					drawUnitId: "building-repeat",
					renderSurfaceId: 0x06000010,
					samplingPolicy: {
						wrapS: "repeat",
						wrapT: "repeat",
					},
					textureUseId: "building-repeat:06000010",
					usage: "rgba-color",
				}),
			],
		});

		expect(texturePacker.jobs).toHaveLength(1);
		expect(secondUpdate?.placements).toEqual([]);
		expect(secondUpdate?.textureBindings).toMatchObject([
			{
				owner: { drawUnitId: "building-repeat", kind: "draw-unit" },
				textureRefId: firstUpdate?.placements[0]?.textureRefId,
				textureUseId: "building-repeat:06000010",
			},
		]);
	});

	it("shares atlas entries across compatible static and dynamic visual owners", async () => {
		const texturePacker = new FixtureTexturePacker();
		const textureManager = new TextureManager({
			assetService: new FixtureAssetService(),
			texturePacker,
		});

		const staticUpdate = await textureManager.applyStaticCommitDelta({
			addedDrawUnits: [],
			removedResources: [],
			revision: 1,
			staticBatchId: "batch-a",
			textureUses: [
				createTextureUseCommit({
					domain: "outdoor-detail",
					drawUnitId: "detail-a",
					renderSurfaceId: 0x06000010,
					samplingPolicy: {
						wrapS: "clamp-to-edge",
						wrapT: "clamp-to-edge",
					},
					textureUseId: "detail-a:06000010",
					usage: "rgba-color",
				}),
			],
		});
		const dynamicUpdate = await textureManager.applyDynamicTextureUseDelta({
			removedOwners: [],
			textureUses: [
				createDynamicTextureUseCommit({
					textureBatchId: "batch-a",
					textureDomain: "outdoor-detail",
					renderSurfaceId: 0x06000010,
					resourceId: "dynamic-windmill-part-0",
					samplingPolicy: {
						wrapS: "clamp-to-edge",
						wrapT: "clamp-to-edge",
					},
					textureUseId: "dynamic-windmill-part-0:06000010",
				}),
			],
		});

		expect(texturePacker.jobs).toHaveLength(1);
		expect(dynamicUpdate?.placements).toEqual([]);
		expect(dynamicUpdate?.textureBindings).toMatchObject([
			{
				owner: {
					kind: "dynamic-visual-resource",
					resourceId: "dynamic-windmill-part-0",
				},
				textureRefId: staticUpdate?.placements[0]?.textureRefId,
				textureUseId: "dynamic-windmill-part-0:06000010",
			},
		]);
	});

	it("packs runtime object-material dynamic texture refs in their own visual domain", async () => {
		const rectsByTextureUseId = new Map<
			string,
			FixtureTexturePackerRectPlacement
		>([
			[
				"runtime-spawn:1:base:0",
				{
					pageHeight: 512,
					pageId: "runtime-base-page:0",
					pageWidth: 512,
					rect: [96, 96, 1, 1],
				},
			],
			[
				"runtime-spawn:1:base:1",
				{
					pageHeight: 512,
					pageId: "runtime-base-page:1",
					pageWidth: 512,
					rect: [96, 96, 1, 1],
				},
			],
		]);
		const texturePacker = new FixtureTexturePacker({ rectsByTextureUseId });
		const textureManager = new TextureManager({
			assetService: new FixtureAssetService(),
			texturePacker,
		});

		const update = await textureManager.applyDynamicTextureUseDelta({
			removedOwners: [],
			textureUses: [
				createDynamicTextureUseCommit({
					textureBatchId: "runtime-dynamic:runtime-spawn:1",
					textureDomain: "runtime-object-material",
					renderSurfaceId: 0x06000010,
					resourceId: "dynamic-visual-resource:runtime-spawn:1",
					textureUseId: "runtime-spawn:1:base:0",
				}),
				createDynamicTextureUseCommit({
					textureBatchId: "runtime-dynamic:runtime-spawn:1",
					textureDomain: "runtime-object-material",
					renderSurfaceId: 0x06000020,
					resourceId: "dynamic-visual-resource:runtime-spawn:1",
					textureUseId: "runtime-spawn:1:base:1",
				}),
			],
		});

		expect(texturePacker.jobs).toHaveLength(1);
		expect(texturePacker.jobs[0]).toMatchObject({
			cohorts: undefined,
			domain: "runtime-object-material",
			page: {
				gutterPixels: 4,
			},
		});
		expect(textureManager.createDiagnosticsReport().batches).toMatchObject([
			{
				domain: "runtime-object-material",
				texturePageCount: 2,
			},
		]);
		expect(update?.textureBindings).toEqual([
			expect.objectContaining({
				owner: {
					kind: "dynamic-visual-resource",
					resourceId: "dynamic-visual-resource:runtime-spawn:1",
				},
				rolePage: { kind: "object-base-color", slot: 0 },
				textureUseId: "runtime-spawn:1:base:0",
			}),
			expect.objectContaining({
				owner: {
					kind: "dynamic-visual-resource",
					resourceId: "dynamic-visual-resource:runtime-spawn:1",
				},
				rolePage: { kind: "object-base-color", slot: 1 },
				textureUseId: "runtime-spawn:1:base:1",
			}),
		]);
	});

	it("keeps static atlas pages leased after releasing a dynamic visual owner", async () => {
		const textureManager = new TextureManager({
			assetService: new FixtureAssetService(),
			texturePacker: new FixtureTexturePacker(),
		});

		await textureManager.applyStaticCommitDelta({
			addedDrawUnits: [],
			removedResources: [],
			revision: 1,
			staticBatchId: "batch-a",
			textureUses: [
				createTextureUseCommit({
					domain: "outdoor-detail",
					drawUnitId: "detail-a",
					renderSurfaceId: 0x06000010,
					textureUseId: "detail-a:06000010",
					usage: "rgba-color",
				}),
			],
		});
		await textureManager.applyDynamicTextureUseDelta({
			removedOwners: [],
			textureUses: [
				createDynamicTextureUseCommit({
					textureBatchId: "batch-a",
					textureDomain: "outdoor-detail",
					renderSurfaceId: 0x06000010,
					resourceId: "dynamic-windmill-part-0",
					textureUseId: "dynamic-windmill-part-0:06000010",
				}),
			],
		});

		const releaseUpdate = await textureManager.applyDynamicTextureUseDelta({
			removedOwners: [
				{
					kind: "dynamic-visual-resource",
					resourceId: "dynamic-windmill-part-0",
				},
			],
			textureUses: [],
		});

		expect(releaseUpdate).toBeNull();
		expect(
			textureManager.createDiagnosticsReport().summary.texturePageCount,
		).toBe(1);
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

	it("packs indexed and palette data uses as nearest-sampled atlas pages", async () => {
		const assetService = new FixtureAssetService();
		const texturePacker = new FixtureTexturePacker();
		const textureManager = new TextureManager({ assetService, texturePacker });

		const update = await textureManager.applyStaticCommitDelta({
			addedDrawUnits: [],
			removedResources: [],
			revision: 1,
			staticBatchId: "batch-a",
			textureUses: [
				{
					domain: "outdoor-buildings",
					owners: [{ drawUnitId: "static-a", kind: "draw-unit" }],
					samplingPolicy: {
						wrapS: "repeat",
						wrapT: "repeat",
					},
					source: {
						kind: "prepared-render-surface-texture-use",
						renderSurface: {
							kind: "render-surface",
							renderSurfaceId: 0x06000010,
						},
						usage: "index8",
					},
					staticBatchId: "batch-a",
					textureUseId: "static-a:index",
				},
				{
					domain: "outdoor-buildings",
					owners: [{ drawUnitId: "static-a", kind: "draw-unit" }],
					source: {
						firstIndex: 1,
						indexCount: 2,
						kind: "palette-texture-use",
						palette: {
							kind: "palette",
							paletteId: 0x04000010,
						},
						usage: "palette-rgba",
					},
					staticBatchId: "batch-a",
					textureUseId: "static-a:palette",
				},
			],
		});

		expect(assetService.requestedKeys).toEqual([
			{
				id: "06000010?cs=data&mips=none&out=r8&usage=raw",
				kind: "prepared-texture",
			},
			{
				id: "04000010",
				kind: "palette",
			},
		]);
		expect(texturePacker.jobs).toHaveLength(2);
		expect(texturePacker.jobs.map((job) => job.page.format).sort()).toEqual([
			"r8",
			"rgba8",
		]);
		expect(texturePacker.jobs.map((job) => job.page.gutterPixels)).toEqual([
			0, 0,
		]);
		expect(texturePacker.jobs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					page: expect.objectContaining({ format: "r8" }),
					sources: [
						expect.objectContaining({
							source: expect.objectContaining({
								format: "r8",
								pixels: new Uint8Array([255, 255]),
							}),
							textureUseId: "static-a:index",
						}),
					],
				}),
				expect.objectContaining({
					page: expect.objectContaining({ format: "rgba8" }),
					sources: [
						expect.objectContaining({
							source: expect.objectContaining({
								format: "rgba8",
								pixels: new Uint8Array([
									0x44, 0x55, 0x66, 0x80, 0xaa, 0xbb, 0xcc, 0xff,
								]),
							}),
							textureUseId: "static-a:palette",
						}),
					],
				}),
			]),
		);
		expect(update?.placements).toMatchObject([
			{
				filteringMode: "nearest",
				format: "r8",
				height: 1,
				mipmapsGenerated: false,
				rect: [0, 0, 2, 1],
				sampleClass: "index8",
				samplerPolicyKey: "sample=index8;filter=nearest;mips=off;aniso=1",
				textureUseId: "static-a:index",
				width: 2,
				wrapS: "clamp-to-edge",
				wrapT: "clamp-to-edge",
			},
			{
				filteringMode: "nearest",
				format: "rgba8",
				height: 1,
				mipmapsGenerated: false,
				rect: [0, 0, 2, 1],
				sampleClass: "palette-rgba",
				samplerPolicyKey: "sample=palette-rgba;filter=nearest;mips=off;aniso=1",
				textureUseId: "static-a:palette",
				width: 2,
				wrapS: "clamp-to-edge",
				wrapT: "clamp-to-edge",
			},
		]);
		expect(update?.textureBindings).toMatchObject([
			{
				owner: { drawUnitId: "static-a", kind: "draw-unit" },
				rolePage: { kind: "object-index", slot: 0 },
				textureUseId: "static-a:index",
			},
			{
				owner: { drawUnitId: "static-a", kind: "draw-unit" },
				rolePage: { kind: "object-palette", slot: 0 },
				textureUseId: "static-a:palette",
			},
		]);
		expect(Array.from(update?.placements[1]?.pixels ?? [])).toEqual([
			0x44, 0x55, 0x66, 0x80, 0xaa, 0xbb, 0xcc, 0xff,
		]);
	});

	it("composes packed palette data from authored subpalette replacements", async () => {
		const assetService = new FixtureAssetService();
		const texturePacker = new FixtureTexturePacker();
		const textureManager = new TextureManager({ assetService, texturePacker });

		const update = await textureManager.applyStaticCommitDelta({
			addedDrawUnits: [],
			removedResources: [],
			revision: 1,
			staticBatchId: "batch-a",
			textureUses: [
				{
					domain: "outdoor-buildings",
					owners: [{ drawUnitId: "static-a", kind: "draw-unit" }],
					source: {
						firstIndex: 0,
						indexCount: 3,
						kind: "palette-texture-use",
						palette: {
							kind: "palette",
							paletteId: 0x04000010,
						},
						subPalettes: [
							{
								firstIndex: 1,
								indexCount: 1,
								palette: {
									kind: "palette",
									paletteId: 0x04000020,
								},
							},
						],
						usage: "palette-rgba",
					},
					staticBatchId: "batch-a",
					textureUseId: "static-a:palette",
				},
			],
		});

		expect(assetService.requestedKeys).toEqual([
			{ id: "04000010", kind: "palette" },
			{ id: "04000020", kind: "palette" },
		]);
		expect(
			Array.from(update?.placements[0]?.pixels.slice(0, 12) ?? []),
		).toEqual([
			0x11, 0x22, 0x33, 0xff, 0x77, 0x88, 0x99, 0xff, 0xaa, 0xbb, 0xcc, 0xff,
		]);
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

		if (key.kind === "palette") {
			return {
				key,
				payload: createPalettePayload(key.id),
				preparedAt: "test",
				revision: 1,
				sourceAssetId: `palette/${key.id}`,
			};
		}

		const outputFormat = getPreparedTextureOutputFormat(key);
		return {
			key,
			payload: createPreparedTexturePayload(
				this.#payloadOptions
					? {
							...this.#payloadOptions,
							renderSurfaceId: getPreparedTextureRenderSurfaceId(key),
						}
					: createPreparedTexturePayloadOptionsFromKey(key, outputFormat),
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

	pruneExpiredWarmAssets(): number {
		return 0;
	}

	createSnapshot(): AssetServiceSnapshot {
		return {
			committed: [],
			pending: [],
		};
	}

	createOverviewSnapshot() {
		return {
			committedCount: 0,
			pendingCount: 0,
		};
	}
}

function createPreparedTexturePayloadOptionsFromKey(
	key: HostAssetKey,
	outputFormat: PreparedTexturePayloadOptions["outputFormat"],
): PreparedTexturePayloadOptions {
	if (outputFormat === "r8") {
		return {
			byteLength: 2,
			colorSpace: "data",
			levelFormat: "P8",
			outputFormat,
			renderSurfaceId: getPreparedTextureRenderSurfaceId(key),
			sourceFormatRaw: 0x29,
			usage: "raw",
			width: 2,
		};
	}
	if (outputFormat === "index16") {
		return {
			byteLength: 4,
			colorSpace: "data",
			levelFormat: "Index16",
			outputFormat,
			renderSurfaceId: getPreparedTextureRenderSurfaceId(key),
			sourceFormatRaw: 0x65,
			usage: "raw",
			width: 2,
		};
	}

	return {
		outputFormat,
		renderSurfaceId: getPreparedTextureRenderSurfaceId(key),
		usage: getPreparedTextureUsage(key),
	};
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
			const pagesById = new Map<
				string,
				TexturePackingResult["pages"][number]
			>();
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
					format: job.page.format,
					height: placement.pageHeight,
					pageId: placement.pageId,
					pixels: new Uint8Array(
						placement.pageWidth *
							placement.pageHeight *
							getTexturePackingFormatBytesPerPixel(job.page.format),
					),
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
					format: job.page.format,
					height: pageHeight,
					pageId: `${job.jobId}:page:0`,
					pixels:
						this.#options.pixels ??
						createFixturePagePixels(
							pageWidth,
							pageHeight,
							job.page.format,
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
	format: TexturePackingJob["page"]["format"],
	sourcePixels: Uint8Array | undefined,
): Uint8Array {
	const bytesPerPixel = getTexturePackingFormatBytesPerPixel(format);
	const pixels = new Uint8Array(width * height * bytesPerPixel);
	if (sourcePixels) {
		pixels.set(sourcePixels.subarray(0, pixels.length), 0);
	}

	return pixels;
}

function getTexturePackingFormatBytesPerPixel(
	format: TexturePackingJob["page"]["format"],
): number {
	switch (format) {
		case "rgba8":
			return 4;
		case "r8":
			return 1;
		case "rg8":
			return 2;
		default: {
			const exhaustive: never = format;
			throw new Error(`Unsupported texture packing format ${exhaustive}.`);
		}
	}
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
	readonly domain?: StaticCoordinatorCommitDelta["textureUses"][number]["domain"];
	readonly drawUnitId?: string;
	readonly outputFormat: "rgba8" | "dxt1";
	readonly renderSurfaceId?: number;
	readonly samplingPolicy?: StaticBakeTextureSamplingPolicy;
	readonly staticBatchId?: string;
	readonly textureUseId?: string;
	readonly usage?: PreparedRgbaRenderSurfaceTextureUsage;
}): StaticCoordinatorCommitDelta {
	const drawUnitId = options.drawUnitId ?? "terrain-a";
	const renderSurfaceId = options.renderSurfaceId ?? 0x06000010;
	const textureUseId =
		options.textureUseId ??
		`${drawUnitId}:prepared-texture:${renderSurfaceId.toString(16).padStart(8, "0")}`;

	return {
		addedDrawUnits: [],
		materialCoverage: [],
		removedResources: [],
		revision: 1,
		staticAuthoredDynamicSeeds: [],
		staticBatchId: options.staticBatchId ?? "batch-a",
		staticPortalGraphs: [],
		staticPortalInteriorRecords: [],
		staticSourceMappings: [],
		staticSpatialRecords: [],
		staticVisibilityRecords: [],
		textureUses: [
			createTextureUseCommit({
				domain: options.domain,
				drawUnitId,
				outputFormat: options.outputFormat,
				renderSurfaceId,
				samplingPolicy: options.samplingPolicy,
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
	readonly samplingPolicy?: StaticBakeTextureSamplingPolicy;
	readonly staticBatchId?: string;
	readonly textureUseId: string;
	readonly usage?: PreparedRgbaRenderSurfaceTextureUsage;
}): StaticCoordinatorCommitDelta["textureUses"][number] {
	return {
		domain: options.domain ?? "outdoor-terrain",
		owners: [{ drawUnitId: options.drawUnitId, kind: "draw-unit" }],
		source: {
			kind: "prepared-render-surface-texture-use",
			renderSurface: {
				kind: "render-surface",
				renderSurfaceId: options.renderSurfaceId,
			},
			usage: options.usage ?? "rgba-color",
		},
		samplingPolicy: options.samplingPolicy,
		staticBatchId: options.staticBatchId ?? "batch-a",
		textureUseId: options.textureUseId,
	};
}

function createDynamicTextureUseCommit(options: {
	readonly textureBatchId: string;
	readonly textureDomain: VisualTextureDomain;
	readonly renderSurfaceId: number;
	readonly resourceId: string;
	readonly samplingPolicy?: StaticBakeTextureSamplingPolicy;
	readonly textureUseId: string;
	readonly usage?: PreparedRgbaRenderSurfaceTextureUsage;
}): DynamicTextureUseCommit {
	return {
		textureBatchId: options.textureBatchId,
		textureDomain: options.textureDomain,
		owner: {
			kind: "dynamic-visual-resource",
			resourceId: options.resourceId,
		},
		samplingPolicy: options.samplingPolicy,
		source: {
			kind: "prepared-render-surface-texture-use",
			renderSurface: {
				kind: "render-surface",
				renderSurfaceId: options.renderSurfaceId,
			},
			usage: options.usage ?? "rgba-color",
		},
		textureUseId: options.textureUseId,
	};
}

function createTextureUse(
	renderSurfaceId: number,
): PreparedRgbaRenderSurfaceTextureUseIdentity {
	return {
		kind: "prepared-render-surface-texture-use",
		renderSurface: {
			kind: "render-surface",
			renderSurfaceId,
		},
		usage: "rgba-color",
	};
}

function createTerrainPayload(
	textureUses: readonly PreparedRgbaRenderSurfaceTextureUseIdentity[],
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
				renderSurface: texture.renderSurface,
				palette: null,
				texture: {
					kind: "surface-texture",
					surfaceTextureId: texture.renderSurface.renderSurfaceId,
				},
			})),
		},
		sourceRevision: 1,
	};
}

interface PreparedTexturePayloadOptions {
	readonly byteLength?: number;
	readonly colorSpace?: "data" | "linear";
	readonly height?: number;
	readonly levelFormat?: string;
	readonly outputFormat: "dxt1" | "index16" | "r8" | "rgba8";
	readonly renderSurfaceId?: number;
	readonly sourceFormatRaw?: number;
	readonly usage?: "color" | "detail" | "mask" | "raw";
	readonly width?: number;
}

function createPreparedTexturePayload(options: PreparedTexturePayloadOptions) {
	const bytes =
		options.byteLength === undefined
			? new Uint8Array([255, 128, 0, 255])
			: new Uint8Array(options.byteLength).fill(255);

	return {
		colorSpace: options.colorSpace ?? "linear",
		kind: "prepared-texture",
		levels: [
			{
				bytes,
				format: options.levelFormat ?? "A8R8G8B8",
				formatRaw: 0,
				height: options.height ?? 1,
				level: 0,
				width: options.width ?? 1,
			},
		],
		mipPolicy: "none",
		outputFormat: options.outputFormat,
		renderSurfaceId: options.renderSurfaceId ?? 0x06000010,
		sourceFormat: options.levelFormat ?? "A8R8G8B8",
		sourceFormatRaw: options.sourceFormatRaw ?? 0,
		usage: options.usage ?? "color",
	};
}

function createPalettePayload(id = "04000010") {
	const paletteId = Number.parseInt(id, 16);
	const colorsArgb =
		paletteId === 0x04000020
			? [0xff000000, 0xff778899, 0xffffffff]
			: [0xff112233, 0x80445566, 0xffaabbcc];
	return {
		colorCount: colorsArgb.length,
		colorsArgb: Uint32Array.from(colorsArgb),
		kind: "palette",
		paletteId,
		provenance: {
			detail: null,
			errorCode: null,
			source: "repo-local-hba",
			sourceAssetKind: "palette",
		},
		residencyKind: "unknown",
		sourceAssetKind: "palette",
	};
}

function getPreparedTextureOutputFormat(
	key: HostAssetKey,
): PreparedTexturePayloadOptions["outputFormat"] {
	if (key.id.includes("out=dxt1")) {
		return "dxt1";
	}
	if (key.id.includes("out=r8")) {
		return "r8";
	}
	if (key.id.includes("out=index16")) {
		return "index16";
	}
	return "rgba8";
}

function getPreparedTextureRenderSurfaceId(key: HostAssetKey): number {
	return Number.parseInt(key.id.slice(0, 8), 16);
}

function getPreparedTextureUsage(
	key: HostAssetKey,
): "color" | "detail" | "mask" | "raw" {
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
