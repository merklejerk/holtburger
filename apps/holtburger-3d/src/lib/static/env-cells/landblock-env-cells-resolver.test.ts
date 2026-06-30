import { describe, expect, it, vi } from "vitest";
import type {
	GfxObjPayloadDto,
	MaterialRecipePayloadDto,
	PalettePayloadDto,
	RegionRenderProfilePayloadDto,
	RenderSurfacePayloadDto,
	SetupAppearancePayloadDto,
	SetupModelPayloadDto,
	SurfaceTexturePayloadDto,
} from "../../../lib/host/contracts";
import type { ResolverLandblockEnvCellLayerPayloadDto } from "../../assets/preparation/env-cell-views";
import { omitRenderGeometryVertexBuffers } from "../../assets/preparation/render-geometry-views";
import type {
	AssetService,
	AssetServiceSnapshot,
	HostAssetKey,
	PreparedAsset,
	PreparedAssetLease,
} from "../../assets/contracts";
import {
	createHostAssetKey,
	describeHostAssetKey,
	formatHostAssetId,
} from "../../assets/keys";
import type {
	LandblockEnvCellsStaticScopePayload,
	StaticResolverJob,
} from "../contracts";
import type { LandblockEnvCellsLayerSourcePayloadDto } from "../source-payloads";
import { selectVisibleEnvCells } from "./env-cell-visibility";
import { LandblockEnvCellsResolver } from "./landblock-env-cells-resolver";

describe("browser landblock env-cell resolver", () => {
	it("resolves env-cell static seed source closure without cell-structure vertex buffers", async () => {
		const assetService = new FixtureAssetService(createResolverAssets());

		const payload = await new LandblockEnvCellsResolver({
			assetService,
		}).resolve(createEnvCellRequest());

		expect(describeHostAssetKey(assetService.requestedKeys[0])).toBe(
			"landblock-scene-lod-env-cell-layer:da55ffff",
		);
		expect(
			assetService.requestedKeys.map((key) => describeHostAssetKey(key)),
		).toEqual(
			expect.arrayContaining([
				"gfx-obj:01000010",
				"gfx-obj:01000020",
				"material:08000010",
				"material:08000011",
				"setup-appearance:02000010",
				"setup-model:02000010",
			]),
		);
		expect(
			assetService.requestedKeys
				.map((key) => describeHostAssetKey(key))
				.filter((key) => key === "material:08000010"),
		).toEqual(["material:08000010"]);
		expect(payload.scope.kind).toBe("landblock-env-cells");
		if (payload.scope.kind !== "landblock-env-cells") {
			throw new Error("expected landblock env-cell payload");
		}

		expect(payload.scope).toMatchObject({
			acceptedEnvCellIds: [0xda550100, 0xda550101],
			landblock: {
				kind: "landblock-source",
				landblockId: 0xda55ffff,
				source: "env-cells",
			},
			regionRenderProfile: {
				detailRoles: [],
				identity: {
					kind: "region-render-profile",
					regionNumber: 1,
				},
			},
			residencySpatial: {
				landblockEnvCellBvhItemCount: 2,
				landblockEnvCellBvhNodeCount: 0,
			},
		});
		expect(payload.scope.sourceAssets).toEqual([
			expect.objectContaining({
				identity: {
					kind: "static-object-source",
					sourceAssetKind: "gfx-obj",
					sourceDid: 0x01000010,
				},
				partCount: 1,
			}),
			expect.objectContaining({
				identity: {
					kind: "static-object-source",
					sourceAssetKind: "setup-model",
					sourceDid: 0x02000010,
				},
				partCount: 1,
			}),
		]);
		expect(payload.scope.sourceAssets[0]?.parts[0]).not.toHaveProperty(
			"positions",
		);
		const setupSource = payload.scope.sourceAssets.find(
			(source) => source.identity.sourceAssetKind === "setup-model",
		);
		expect(setupSource?.parts[0]?.defaultPlacements).toEqual([
			createPlacement({ x: 3, y: 4, z: 5 }),
		]);
		expect(
			payload.scope.materialSources.map((source) => source.identity),
		).toEqual([
			{ kind: "static-material-source", materialId: 0x08000010 },
			{ kind: "static-material-source", materialId: 0x08000011 },
		]);
		expect(payload.scope.textureRefs.map((ref) => ref.role)).toEqual([
			"surface-texture",
			"render-surface",
		]);
		expect(payload.scope.paletteSources).toEqual([
			{
				colorCount: 256,
				palette: { kind: "palette", paletteId: 0x04000010 },
			},
		]);
		expect(payload.scope.missingRefs).toEqual([]);
		expect(payload.scope.envCells[0]).toMatchObject({
			cellStructure: {
				cellStructureId: 0x0d000020,
				kind: "cell-structure",
			},
			environment: {
				environmentId: 0x0d000010,
				kind: "environment",
			},
			identity: {
				envCellId: 0xda550100,
				kind: "env-cell-source",
			},
			staticObjectSeeds: [
				{
					identity: {
						instanceId: "da550100:static-0",
						kind: "static-object-instance",
						landblockId: 0xda55ffff,
						objectKind: "explicit-object",
					},
					source: {
						kind: "static-object-source",
						sourceAssetKind: "gfx-obj",
						sourceDid: 0x01000010,
					},
				},
			],
			surfaces: [
				{
					material: {
						kind: "static-material-source",
						materialId: 0x08000010,
					},
					slotId: 0,
					surfaceId: 10,
				},
			],
		});
	});

	it("requests resolver metadata for static seeds but not standalone env-cell assets", async () => {
		const assetService = new FixtureAssetService(createResolverAssets());

		await new LandblockEnvCellsResolver({ assetService }).resolve(
			createEnvCellRequest(),
		);

		expect(
			assetService.requestedKeys.map((key) => describeHostAssetKey(key)),
		).not.toContain("env-cell:da550100");
	});

	it("records missing static seed sources without dropping cell-structure facts", async () => {
		const assetService = new FixtureAssetService([
			createPreparedAsset(
				createHostAssetKey("landblock-scene-lod-env-cell-layer", 0xda55ffff),
				createLandblockEnvCellsPayload(),
			),
			createRegionRenderProfileAsset(),
		]);

		const payload = await new LandblockEnvCellsResolver({
			assetService,
		}).resolve(createEnvCellRequest());

		expect(payload.scope.kind).toBe("landblock-env-cells");
		if (payload.scope.kind !== "landblock-env-cells") {
			throw new Error("expected landblock env-cell payload");
		}

		expect(payload.scope.envCells).toHaveLength(2);
		expect(payload.scope.envCells[0]?.cellStructure).toEqual({
			cellStructureId: 0x0d000020,
			kind: "cell-structure",
		});
		expect(
			payload.scope.envCells.flatMap((cell) => cell.staticObjectSeeds),
		).toEqual([]);
		expect(payload.scope.sourceAssets).toEqual([]);
		expect(payload.scope.missingRefs).toEqual([
			{
				kind: "static-object-source",
				sourceAssetKind: "gfx-obj",
				sourceDid: 0x01000010,
			},
			{
				kind: "static-object-source",
				sourceAssetKind: "setup-model",
				sourceDid: 0x02000010,
			},
			{
				kind: "static-material-source",
				materialId: 0x08000010,
			},
		]);
	});

	it("resolves cell-structure material closure without static seed sources", async () => {
		const assetService = new FixtureAssetService([
			createPreparedAsset(
				createHostAssetKey("landblock-scene-lod-env-cell-layer", 0xda55ffff),
				createLandblockEnvCellsPayload({ omitStatics: true }),
			),
			createRegionRenderProfileAsset(),
			createPreparedAsset(
				createHostAssetKey("material", 0x08000010),
				createMaterialPayload({ materialId: 0x08000010 }),
			),
			createPreparedAsset(
				createHostAssetKey("surface-texture", 0x05000010),
				createSurfaceTexturePayload(),
			),
			createPreparedAsset(
				createHostAssetKey("render-surface", 0x06000010),
				createRenderSurfacePayload(),
			),
			createPreparedAsset(
				createHostAssetKey("palette", 0x04000010),
				createPalettePayload(),
			),
		]);

		const payload = await new LandblockEnvCellsResolver({
			assetService,
		}).resolve(createEnvCellRequest());

		expect(payload.scope.kind).toBe("landblock-env-cells");
		if (payload.scope.kind !== "landblock-env-cells") {
			throw new Error("expected landblock env-cell payload");
		}
		expect(
			assetService.requestedKeys.map((key) => describeHostAssetKey(key)),
		).toEqual([
			"landblock-scene-lod-env-cell-layer:da55ffff",
			"region-render-profile:1",
			"material:08000010",
			"surface-texture:05000010",
			"render-surface:06000010",
			"palette:04000010",
		]);
		expect(payload.scope.sourceAssets).toEqual([]);
		expect(
			payload.scope.envCells.flatMap((cell) => cell.staticObjectSeeds),
		).toEqual([]);
		expect(
			payload.scope.materialSources.map((source) => source.identity),
		).toEqual([{ kind: "static-material-source", materialId: 0x08000010 }]);
		expect(payload.scope.textureRefs.map((ref) => ref.role)).toEqual([
			"surface-texture",
			"render-surface",
		]);
		expect(payload.scope.paletteSources).toEqual([
			{
				colorCount: 256,
				palette: { kind: "palette", paletteId: 0x04000010 },
			},
		]);
		expect(payload.scope.missingRefs).toEqual([]);
	});

	it("deduplicates repeated env-cell static seed source closure", async () => {
		const assetService = new FixtureAssetService([
			createPreparedAsset(
				createHostAssetKey("landblock-scene-lod-env-cell-layer", 0xda55ffff),
				createLandblockEnvCellsPayload({
					secondStaticSourceAssetId: "gfx-obj/01000010",
				}),
			),
			createRegionRenderProfileAsset(),
			createPreparedAsset(
				createHostAssetKey("gfx-obj", 0x01000010),
				createGfxObjPayload({
					gfxObjId: 0x01000010,
					materialId: 0x08000010,
				}),
			),
			createPreparedAsset(
				createHostAssetKey("material", 0x08000010),
				createMaterialPayload({ materialId: 0x08000010 }),
			),
			createPreparedAsset(
				createHostAssetKey("surface-texture", 0x05000010),
				createSurfaceTexturePayload(),
			),
			createPreparedAsset(
				createHostAssetKey("render-surface", 0x06000010),
				createRenderSurfacePayload(),
			),
			createPreparedAsset(
				createHostAssetKey("palette", 0x04000010),
				createPalettePayload(),
			),
		]);

		const payload = await new LandblockEnvCellsResolver({
			assetService,
		}).resolve(createEnvCellRequest());

		expect(payload.scope.kind).toBe("landblock-env-cells");
		if (payload.scope.kind !== "landblock-env-cells") {
			throw new Error("expected landblock env-cell payload");
		}

		expect(
			assetService.requestedKeys
				.map((key) => describeHostAssetKey(key))
				.filter((key) => key === "gfx-obj:01000010"),
		).toEqual(["gfx-obj:01000010"]);
		expect(
			assetService.requestedKeys
				.map((key) => describeHostAssetKey(key))
				.filter((key) => key === "material:08000010"),
		).toEqual(["material:08000010"]);
		expect(payload.scope.sourceAssets).toHaveLength(1);
		expect(
			payload.scope.envCells.flatMap((cell) => cell.staticObjectSeeds),
		).toHaveLength(2);
	});

	it("preserves resolver-light cell-structure geometry metadata supplied by the resolver asset bridge", async () => {
		const payload = createLandblockEnvCellsPayload({
			heavyRenderGeometry: true,
		});
		const resolverPayload = {
			...payload,
			envCells: payload.envCells.map((cell) => ({
				...cell,
				renderGeometry: omitRenderGeometryVertexBuffers(cell.renderGeometry),
			})),
		} satisfies ResolverLandblockEnvCellLayerPayloadDto;
		const assetService = new FixtureAssetService([
			createPreparedAsset(
				createHostAssetKey("landblock-scene-lod-env-cell-layer", 0xda55ffff),
				resolverPayload,
			),
			createRegionRenderProfileAsset(),
		]);

		const result = await new LandblockEnvCellsResolver({
			assetService,
		}).resolve(createEnvCellRequest());

		expect(result.scope.kind).toBe("landblock-env-cells");
		if (result.scope.kind !== "landblock-env-cells") {
			throw new Error("expected landblock env-cell payload");
		}
		const renderGeometry = result.scope.envCells[0]?.renderGeometry;
		expect(renderGeometry).toMatchObject({
			triangleCount: 1,
			vertexCount: 3,
		});
		expect(renderGeometry).not.toHaveProperty("normals");
		expect(renderGeometry).not.toHaveProperty("positions");
		expect(renderGeometry).not.toHaveProperty("uvs");
		expect(renderGeometry?.triangles).toEqual([
			{
				firstVertex: 0,
				materialVariantSignature: "variant-a",
				polygonId: 17,
				surfaceId: 10,
			},
		]);
	});

	it("uses the same env-cell source path without topology classification", async () => {
		const assetService = new FixtureAssetService(createResolverAssets());

		const payload = await new LandblockEnvCellsResolver({
			assetService,
		}).resolve(createEnvCellRequest());

		expect(payload.scope.kind).toBe("landblock-env-cells");
		if (payload.scope.kind !== "landblock-env-cells") {
			throw new Error("expected landblock env-cell payload");
		}
		expect(
			payload.scope.envCells.map((cell) => cell.identity.envCellId),
		).toEqual([0xda550100, 0xda550101]);
	});

	it("warns when env cells are omitted from the landblock BVH because they have no bounds", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const assetService = new FixtureAssetService([
			createPreparedAsset(
				createHostAssetKey("landblock-scene-lod-env-cell-layer", 0xda55ffff),
				createLandblockEnvCellsPayload({ omitSecondBvhItem: true }),
			),
			createRegionRenderProfileAsset(),
		]);

		await new LandblockEnvCellsResolver({ assetService }).resolve(
			createEnvCellRequest(),
		);

		expect(warn).toHaveBeenCalledWith(
			"[holtburger-3d][browser][landblock-env-cells-bvh]",
			expect.objectContaining({
				landblockId: 0xda55ffff,
				omittedEnvCellIds: [0xda550101],
			}),
		);
		warn.mockRestore();
	});

	it("rejects prepared assets with the wrong payload kind", async () => {
		const assetService = new FixtureAssetService([
			createPreparedAsset(
				createHostAssetKey("landblock-scene-lod-env-cell-layer", 0xda55ffff),
				{
					kind: "setup-model",
				},
			),
		]);

		await expect(
			new LandblockEnvCellsResolver({ assetService }).resolve(
				createEnvCellRequest(),
			),
		).rejects.toThrow(
			"Prepared asset landblock-scene-lod-env-cell-layer:da55ffff was setup-model, expected landblock-scene-lod-env-cell-layer.",
		);
	});

	it("keeps host route strings out of runtime env-cell identity and spatial facts", async () => {
		const assetService = new FixtureAssetService([
			createPreparedAsset(
				createHostAssetKey("landblock-scene-lod-env-cell-layer", 0xda55ffff),
				createLandblockEnvCellsPayload(),
			),
			createRegionRenderProfileAsset(),
		]);

		const payload = await new LandblockEnvCellsResolver({
			assetService,
		}).resolve(createEnvCellRequest());
		const semanticScope = {
			...payload.scope,
			envCells:
				payload.scope.kind === "landblock-env-cells"
					? payload.scope.envCells.map((cell) => ({
							...cell,
							staticObjectSeeds: cell.staticObjectSeeds.map((seed) => ({
								...seed,
								debug: null,
							})),
						}))
					: [],
			sourceAssets:
				payload.scope.kind === "landblock-env-cells"
					? payload.scope.sourceAssets.map((source) => ({
							...source,
							debug: null,
						}))
					: [],
		};

		expect(JSON.stringify(semanticScope)).not.toContain("landblock/");
		expect(JSON.stringify(semanticScope)).not.toContain("env-cell/");
		expect(JSON.stringify(semanticScope)).not.toContain("material/");
		expect(JSON.stringify(semanticScope)).not.toContain("gfx-obj/");
	});

	it("selects visible env cells deterministically without grouping cells", () => {
		const bundle = createVisibilityBundle();

		expect(
			selectVisibleEnvCells(bundle, {
				focusEnvCellId: 0xda550100,
				maxDepth: 1,
			}),
		).toEqual({
			acceptedEnvCellIds: [0xda550100, 0xda550101, 0xda550103],
			diagnostics: [
				{
					kind: "missing-visible-cell",
					sourceEnvCellId: 0xda550100,
					targetEnvCellId: 0xda550199,
				},
				{
					kind: "traversal-cutoff",
					maxDepth: 1,
					sourceEnvCellId: 0xda550101,
					targetEnvCellId: 0xda550102,
				},
			],
		});
	});
});

class FixtureAssetService implements AssetService {
	readonly requestedKeys: HostAssetKey[] = [];
	readonly #assets = new Map<string, PreparedAsset>();

	constructor(assets: readonly PreparedAsset[]) {
		for (const asset of assets) {
			this.#assets.set(describeHostAssetKey(asset.key), asset);
		}
	}

	async requestPreparedAsset(key: HostAssetKey): Promise<PreparedAsset> {
		this.requestedKeys.push(key);
		const asset = this.#assets.get(describeHostAssetKey(key));
		if (!asset) {
			throw new Error(`Missing fixture asset ${describeHostAssetKey(key)}.`);
		}

		return asset;
	}

	acquirePreparedAssetLease(key: HostAssetKey): PreparedAssetLease {
		throw new Error(
			`FixtureAssetService does not support leases for ${describeHostAssetKey(
				key,
			)}.`,
		);
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

function createPreparedAsset(
	key: HostAssetKey,
	payload: PreparedAsset["payload"],
): PreparedAsset {
	return {
		key,
		payload,
		preparedAt: "2026-06-13T00:00:00.000Z",
		revision: 1,
		sourceAssetId: formatPreparedSourceAssetId(key),
	};
}

function formatPreparedSourceAssetId(key: HostAssetKey): string {
	if (
		key.kind === "landblock-scene-lod-outdoor-layer" ||
		key.kind === "landblock-scene-lod-env-cell-layer"
	) {
		return describeHostAssetKey(key);
	}

	return formatHostAssetId(key);
}

function createRegionRenderProfileAsset(
	options: Parameters<typeof createRegionRenderProfilePayload>[0] = {},
): PreparedAsset {
	return createPreparedAsset(
		createHostAssetKey("region-render-profile", 1),
		createRegionRenderProfilePayload(options),
	);
}

function createResolverAssets(): readonly PreparedAsset[] {
	return [
		createPreparedAsset(
			createHostAssetKey("landblock-scene-lod-env-cell-layer", 0xda55ffff),
			createLandblockEnvCellsPayload(),
		),
		createRegionRenderProfileAsset(),
		createPreparedAsset(
			createHostAssetKey("gfx-obj", 0x01000010),
			createGfxObjPayload({
				gfxObjId: 0x01000010,
				materialId: 0x08000010,
			}),
		),
		createPreparedAsset(
			createHostAssetKey("setup-model", 0x02000010),
			createSetupModelPayload(),
		),
		createPreparedAsset(
			createHostAssetKey("setup-appearance", 0x02000010),
			createSetupAppearancePayload(),
		),
		createPreparedAsset(
			createHostAssetKey("gfx-obj", 0x01000020),
			createGfxObjPayload({
				gfxObjId: 0x01000020,
				materialId: 0x08000011,
			}),
		),
		createPreparedAsset(
			createHostAssetKey("material", 0x08000010),
			createMaterialPayload({ materialId: 0x08000010 }),
		),
		createPreparedAsset(
			createHostAssetKey("material", 0x08000011),
			createMaterialPayload({ materialId: 0x08000011 }),
		),
		createPreparedAsset(
			createHostAssetKey("surface-texture", 0x05000010),
			createSurfaceTexturePayload(),
		),
		createPreparedAsset(
			createHostAssetKey("render-surface", 0x06000010),
			createRenderSurfacePayload(),
		),
		createPreparedAsset(
			createHostAssetKey("palette", 0x04000010),
			createPalettePayload(),
		),
	];
}

function createEnvCellRequest(): StaticResolverJob {
	return {
		domain: "landblock-env-cells",
		scope: {
			kind: "landblock",
			landblockId: 0xda55ffff,
		},
	};
}

function createRegionRenderProfilePayload(
	options: {
		readonly environmentDetail?: boolean;
	} = {},
): RegionRenderProfilePayloadDto {
	const environmentDetailRole = {
		fadeFar: 256,
		fadeNear: 128,
		role: "environment" as const,
		sourceTerrainDescIndex: 0,
		textureAssetId: "surface-texture/05000020",
		textureDid: 0x05000020,
		tiling: 8,
	};

	return {
		dependencies: {
			paletteAssetIds: [],
			renderSurfaceAssetIds: options.environmentDetail
				? ["render-surface/06000020"]
				: [],
			surfaceTextureAssetIds: options.environmentDetail
				? ["surface-texture/05000020"]
				: [],
		},
		detailRoles: {
			building: null,
			environment: options.environmentDetail ? environmentDetailRole : null,
			landscape: null,
			object: null,
		},
		kind: "region-render-profile",
		provenance: createProvenance(),
		regionId: 1,
		regionNumber: 1,
		residencyKind: "unknown",
		sourceAssetKind: "region-render-profile",
	};
}

function createVisibilityBundle(): Pick<
	LandblockEnvCellsStaticScopePayload,
	"envCells" | "portalLinks"
> {
	return {
		envCells: [
			createRuntimeEnvCell(0xda550100, [0xda550101, 0xda550199]),
			createRuntimeEnvCell(0xda550101, [0xda550102]),
			createRuntimeEnvCell(0xda550102, []),
			createRuntimeEnvCell(0xda550103, []),
		],
		portalLinks: [
			{
				flags: 0,
				linkId: "portal-link-0",
				polygonId: null,
				source: {
					envCellId: 0xda550100,
					kind: "env-cell",
					portalId: "portal-0",
				},
				sourceIndex: 0,
				target: {
					envCellId: 0xda550103,
					kind: "env-cell",
					portalId: "portal-1",
				},
			},
		],
	};
}

function createRuntimeEnvCell(
	envCellId: number,
	visibleEnvCellIds: readonly number[],
): LandblockEnvCellsStaticScopePayload["envCells"][number] {
	return {
		cellBsp: createCellBsp(),
		cellStructure: {
			cellStructureId: 0x0d000020,
			kind: "cell-structure",
		},
		environment: {
			environmentId: 0x0d000010,
			kind: "environment",
		},
		identity: {
			envCellId,
			kind: "env-cell-source",
		},
		landblockId: 0xda55ffff,
		localPlacement: createPlacement(),
		memberId: `member-${envCellId.toString(16)}`,
		portalApertures: [],
		portals: [],
		renderGeometry: createRenderGeometry(envCellId),
		restrictionObjectId: null,
		seenOutside: null,
		staticObjectSeeds: [],
		surfaces: [],
		visibleEnvCellIds,
	};
}

function createLandblockEnvCellsPayload(
	options: {
		readonly heavyRenderGeometry?: boolean;
		readonly omitSecondBvhItem?: boolean;
		readonly omitStatics?: boolean;
		readonly secondStaticSourceAssetId?: string;
	} = {},
): LandblockEnvCellsLayerSourcePayloadDto {
	return {
		diagnostics: createDiagnostics(),
		landblockEnvCellBvh: {
			items: [
				{
					bounds: createBounds(),
					envCellId: 0xda550100,
					memberId: "cell-0",
					source: "env-cell-root",
				},
				...(options.omitSecondBvhItem
					? []
					: [
							{
								bounds: createBounds(),
								envCellId: 0xda550101,
								memberId: "cell-1",
								source: "env-cell-root" as const,
							},
						]),
			],
			nodes: [],
		},
		envCells: [
			createEnvCellPayload({
				envCellId: 0xda550100,
				heavyRenderGeometry: options.heavyRenderGeometry,
				memberId: "cell-0",
				staticSourceAssetId: options.omitStatics ? null : "gfx-obj/01000010",
				visibleEnvCellIds: [0xda550101],
			}),
			createEnvCellPayload({
				envCellId: 0xda550101,
				heavyRenderGeometry: options.heavyRenderGeometry,
				memberId: "cell-1",
				staticSourceAssetId: options.omitStatics
					? null
					: (options.secondStaticSourceAssetId ?? "setup-model/02000010"),
				visibleEnvCellIds: [],
			}),
		],
		kind: "landblock-scene-lod-env-cell-layer",
		landblockId: 0xda55ffff,
		landblockInfoId: 0xda55fffe,
		portalLinks: [
			{
				flags: 0,
				linkId: "link-0",
				otherCellId: 0,
				otherPortalId: 0,
				polygonId: null,
				source: {
					envCellId: 0xda550100,
					kind: "env-cell",
					portalId: "portal-0",
				},
				sourceIndex: 0,
				target: {
					envCellId: 0xda550101,
					kind: "env-cell",
					portalId: "portal-1",
				},
			},
		],
		provenance: createProvenance(),
		regionId: 1,
		regionNumber: 1,
	};
}

function createEnvCellPayload(input: {
	readonly envCellId: number;
	readonly heavyRenderGeometry?: boolean;
	readonly memberId: string;
	readonly visibleEnvCellIds: readonly number[];
	readonly staticSourceAssetId: string | null;
}): LandblockEnvCellsLayerSourcePayloadDto["envCells"][number] {
	return {
		cellBsp: createCellBsp(),
		cellStructureId: 0x0d000020,
		diagnostics: createDiagnostics(),
		environmentId: 0x0d000010,
		envCellId: input.envCellId,
		localPlacement: createPlacement(),
		memberId: input.memberId,
		portalApertures: [],
		portals: [],
		renderGeometry: createRenderGeometry(input.envCellId, {
			heavy: input.heavyRenderGeometry ?? false,
		}),
		restrictionObjectId: null,
		seenOutside: null,
		statics:
			input.staticSourceAssetId === null
				? []
				: [
						{
							instanceId: "static-0",
							localPlacement: createPlacement(),
							sourceAssetId: input.staticSourceAssetId,
							sourceDid: Number.parseInt(
								input.staticSourceAssetId.slice(-8),
								16,
							),
							sourceIndex: 0,
							sourceScale: { x: 1, y: 1, z: 1 },
						},
					],
		surfaces: [
			{
				materialAssetId: "material/08000010",
				slotId: 0,
				surfaceId: 10,
			},
		],
		visibleEnvCellIds: [...input.visibleEnvCellIds],
	};
}

function createPlacement(origin = { x: 0, y: 0, z: 0 }) {
	return {
		orientation: { w: 1, x: 0, y: 0, z: 0 },
		origin,
	};
}

function createBounds() {
	return {
		max: { x: 1, y: 1, z: 1 },
		min: { x: 0, y: 0, z: 0 },
	};
}

function createRenderGeometry(
	sourceId: number,
	options: { readonly heavy?: boolean } = {},
) {
	if (options.heavy) {
		return {
			bounds: createBounds(),
			invalidPolygons: [],
			normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
			positions: [1, 2, 3, 4, 5, 6, 7, 8, 9],
			skippedPolygonCount: 0,
			sourceId,
			surfaceIds: [10],
			triangleCount: 1,
			triangles: [
				{
					firstVertex: 0,
					materialVariantSignature: "variant-a",
					polygonId: 17,
					surfaceId: 10,
				},
			],
			uvs: [0, 0, 1, 0, 0, 1],
			vertexCount: 3,
		};
	}

	return {
		bounds: null,
		invalidPolygons: [],
		normals: [],
		positions: [],
		skippedPolygonCount: 0,
		sourceId,
		surfaceIds: [],
		triangleCount: 0,
		triangles: [],
		uvs: [],
		vertexCount: 0,
	};
}

function createGfxObjPayload(options: {
	readonly gfxObjId: number;
	readonly materialId: number;
}): GfxObjPayloadDto {
	return {
		dependencies: {
			materialAssetIds: [
				`material/${options.materialId.toString(16).padStart(8, "0")}`,
			],
		},
		didDegrade: null,
		drawingBsp: null,
		drawingPolygons: [],
		flags: null,
		gfxObjId: options.gfxObjId,
		kind: "gfx-obj",
		physicsWitness: { hasBsp: false, polygonCount: 1, rootKind: null },
		provenance: createProvenance(),
		renderGeometry: {
			bounds: createBounds(),
			invalidPolygons: [],
			normals: [],
			positions: [],
			skippedPolygonCount: 0,
			sourceId: options.gfxObjId,
			surfaceIds: [options.materialId],
			triangleCount: 1,
			triangles: [
				{
					firstVertex: 0,
					materialVariantSignature: null,
					polygonId: 7,
					surfaceId: options.materialId,
				},
			],
			uvs: [],
			vertexCount: 3,
		},
		residencyKind: "unknown",
		sortCenter: null,
		sourceAssetKind: "gfx-obj",
		surfaceIds: [options.materialId],
		vertexArray: { vertices: [] },
	};
}

function createSetupModelPayload(): SetupModelPayloadDto {
	return {
		collisionWitness: { cylSphereCount: 0, sphereCount: 0 },
		connectionPoints: [],
		defaultAnimation: null,
		defaultMotionTable: null,
		defaultScript: null,
		defaultScriptTable: null,
		defaultSoundTable: null,
		dependencies: { gfxObjAssetIds: ["gfx-obj/01000020"] },
		flags: null,
		height: null,
		holdingLocations: [],
		kind: "setup-model",
		lights: [],
		parts: [
			{
				gfxObjAssetId: "gfx-obj/01000020",
				gfxObjId: 0x01000020,
				parentIndex: null,
				partIndex: 0,
				scale: null,
			},
		],
		placementSets: [
			{
				hookCount: 0,
				key: 0,
				localPlacements: [createPlacement({ x: 30, y: 40, z: 50 })],
				textureVelocities: [],
			},
			{
				hookCount: 0,
				key: 0x65,
				localPlacements: [createPlacement({ x: 3, y: 4, z: 5 })],
				textureVelocities: [],
			},
		],
		provenance: createProvenance(),
		radius: null,
		residencyKind: "unknown",
		selectionSphere: null,
		setupModelId: 0x02000010,
		sortingSphere: null,
		sourceAssetKind: "setup-model",
		stepDown: null,
		stepUp: null,
	};
}

function createSetupAppearancePayload(): SetupAppearancePayloadDto {
	return {
		animPartChanges: [],
		appearanceKey: "setup-appearance/02000010",
		dependencies: {
			materialAssetIds: ["material/08000011"],
			paletteAssetIds: [],
		},
		kind: "setup-appearance",
		paletteId: null,
		parts: [
			{
				gfxObjAssetId: "gfx-obj/01000020",
				gfxObjId: 0x01000020,
				materialSlots: [
					{
						materialAssetId: "material/08000011",
						slotIndex: 0,
						surfaceId: 0x08000011,
					},
				],
				partIndex: 0,
			},
		],
		provenance: createProvenance(),
		residencyKind: "unknown",
		setupModelId: 0x02000010,
		sourceAssetKind: "setup-appearance",
		subPalettes: [],
		textureChanges: [],
	};
}

function createMaterialPayload(options: {
	readonly materialId: number;
}): MaterialRecipePayloadDto {
	return {
		dependencies: {
			paletteAssetIds: ["palette/04000010"],
			renderSurfaceAssetIds: ["render-surface/06000010"],
			surfaceTextureAssetIds: ["surface-texture/05000010"],
		},
		diffuse: 1,
		kind: "material-recipe",
		luminosity: 0,
		provenance: createProvenance(),
		residencyKind: "unknown",
		source: {
			kind: "texture",
			paletteId: null,
			renderSurfaceDefaultPaletteIds: [0x04000010],
			selectedRenderSurfaceId: 0x06000010,
			surfaceTextureId: 0x05000010,
		},
		sourceAssetKind: "material-recipe",
		surfaceId: options.materialId,
		surfaceType: 0,
		translucency: 0,
	};
}

function createSurfaceTexturePayload(): SurfaceTexturePayloadDto {
	return {
		dependencies: { renderSurfaceAssetIds: ["render-surface/06000010"] },
		kind: "surface-texture",
		provenance: createProvenance(),
		renderSurfaceIds: [0x06000010],
		residencyKind: "unknown",
		selectedRenderSurfaceId: 0x06000010,
		sourceAssetKind: "surface-texture",
		surfaceTextureId: 0x05000010,
		textureType: 0,
		unknown: 0,
	};
}

function createRenderSurfacePayload(): RenderSurfacePayloadDto {
	return {
		defaultPaletteId: 0x04000010,
		dependencies: { paletteAssetIds: ["palette/04000010"] },
		format: "p8",
		formatRaw: 1,
		height: 1,
		kind: "render-surface",
		provenance: createProvenance(),
		renderSurfaceId: 0x06000010,
		residencyKind: "unknown",
		sourceAssetKind: "render-surface",
		sourceByteLength: 1,
		sourceBytes: new Uint8Array([0]),
		unknown: 0,
		width: 1,
	};
}

function createPalettePayload(): PalettePayloadDto {
	return {
		colorCount: 256,
		kind: "palette",
		paletteId: 0x04000010,
		provenance: createProvenance(),
		residencyKind: "unknown",
		sourceAssetKind: "palette",
	};
}

function createCellBsp() {
	return {
		index: 0,
		kind: "leaf" as const,
		polyIds: [],
		solid: 0,
		sphere: null,
	};
}

function createDiagnostics() {
	return {
		errors: [],
		omissions: [],
		sourceRecords: [],
	};
}

function createProvenance(sourceAssetKind = "landblock-scene-lod-env-cell-layer") {
	return {
		detail: null,
		errorCode: null,
		source: "repo-local-hba" as const,
		sourceAssetKind,
	};
}
