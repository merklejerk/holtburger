import { describe, expect, it, vi } from "vitest";
import type { LandblockEnvCellsPayloadDto } from "../../../lib/host/contracts";
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
import { selectVisibleEnvCells } from "./env-cell-visibility";
import { LandblockEnvCellsResolver } from "./landblock-env-cells-resolver";

describe("V2 landblock env-cell resolver", () => {
	it("requests one landblock env-cell bundle and maps it into runtime source facts", async () => {
		const assetService = new FixtureAssetService([
			createPreparedAsset(
				createHostAssetKey("landblock-env-cells", 0xda55ffff),
				createLandblockEnvCellsPayload(),
			),
		]);

		const payload = await new LandblockEnvCellsResolver({
			assetService,
		}).resolve(createEnvCellRequest());

		expect(assetService.requestedKeys).toEqual([
			createHostAssetKey("landblock-env-cells", 0xda55ffff),
		]);
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
				kind: "region-render-profile",
				regionNumber: 1,
			},
			residencySpatial: {
				landblockEnvCellBvhItemCount: 2,
				landblockEnvCellBvhNodeCount: 0,
			},
		});
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

	it("only issues the landblock env-cell bundle host request", async () => {
		const assetService = new FixtureAssetService([
			createPreparedAsset(
				createHostAssetKey("landblock-env-cells", 0xda55ffff),
				createLandblockEnvCellsPayload(),
			),
		]);

		await new LandblockEnvCellsResolver({ assetService }).resolve(
			createEnvCellRequest(),
		);

		expect(
			assetService.requestedKeys.map((key) => describeHostAssetKey(key)),
		).toEqual(["landblock-env-cells:da55ffff"]);
	});

	it("uses the same env-cell source path without topology classification", async () => {
		const assetService = new FixtureAssetService([
			createPreparedAsset(
				createHostAssetKey("landblock-env-cells", 0xda55ffff),
				createLandblockEnvCellsPayload(),
			),
		]);

		const payload = await new LandblockEnvCellsResolver({
			assetService,
		}).resolve(createEnvCellRequest());

		expect(payload.scope.kind).toBe("landblock-env-cells");
		if (payload.scope.kind !== "landblock-env-cells") {
			throw new Error("expected landblock env-cell payload");
		}
		expect(assetService.requestedKeys).toEqual([
			createHostAssetKey("landblock-env-cells", 0xda55ffff),
		]);
	});

	it("warns when env cells are omitted from the landblock BVH because they have no bounds", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const assetService = new FixtureAssetService([
			createPreparedAsset(
				createHostAssetKey("landblock-env-cells", 0xda55ffff),
				createLandblockEnvCellsPayload({ omitSecondBvhItem: true }),
			),
		]);

		await new LandblockEnvCellsResolver({ assetService }).resolve(
			createEnvCellRequest(),
		);

		expect(warn).toHaveBeenCalledWith(
			"[holtburger-3d][v2][landblock-env-cells-bvh]",
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
				createHostAssetKey("landblock-env-cells", 0xda55ffff),
				{
					kind: "landblock-outdoor",
				},
			),
		]);

		await expect(
			new LandblockEnvCellsResolver({ assetService }).resolve(
				createEnvCellRequest(),
			),
		).rejects.toThrow(
			"Prepared asset landblock/da55ffff/env-cells was landblock-outdoor, expected landblock-env-cells.",
		);
	});

	it("keeps host route strings out of runtime env-cell identity and spatial facts", async () => {
		const assetService = new FixtureAssetService([
			createPreparedAsset(
				createHostAssetKey("landblock-env-cells", 0xda55ffff),
				createLandblockEnvCellsPayload(),
			),
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

	pruneExpiredWarmAssets(): void {}

	createSnapshot(): AssetServiceSnapshot {
		return {
			committed: [],
			failures: [],
			pending: [],
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
		sourceAssetId: formatHostAssetId(key),
	};
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
	localSpatial: {
			localBvh: createLocalBvh(),
			localBvhItemCount: 0,
			localBvhNodeCount: 0,
		},
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
	options: { readonly omitSecondBvhItem?: boolean } = {},
): LandblockEnvCellsPayloadDto {
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
				memberId: "cell-0",
				staticSourceAssetId: "gfx-obj/01000010",
				visibleEnvCellIds: [0xda550101],
			}),
			createEnvCellPayload({
				envCellId: 0xda550101,
				memberId: "cell-1",
				staticSourceAssetId: "setup-model/02000010",
				visibleEnvCellIds: [],
			}),
		],
		kind: "landblock-env-cells",
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
		residencyKind: "landblock",
		sourceAssetKind: "landblock-env-cells",
	};
}

function createEnvCellPayload(input: {
	readonly envCellId: number;
	readonly memberId: string;
	readonly visibleEnvCellIds: readonly number[];
	readonly staticSourceAssetId: string;
}): LandblockEnvCellsPayloadDto["envCells"][number] {
	return {
		cellBsp: createCellBsp(),
		cellStructureId: 0x0d000020,
		diagnostics: createDiagnostics(),
		environmentId: 0x0d000010,
		envCellId: input.envCellId,
		localBvh: createLocalBvh(),
		localPlacement: createPlacement(),
		memberId: input.memberId,
		portalApertures: [],
		portals: [],
		renderGeometry: createRenderGeometry(input.envCellId),
		restrictionObjectId: null,
		seenOutside: null,
		statics: [
			{
				instanceBounds: createBounds(),
				instanceId: "static-0",
				localPlacement: createPlacement(),
				sourceAssetId: input.staticSourceAssetId,
				sourceBounds: createBounds(),
				sourceDid: Number.parseInt(input.staticSourceAssetId.slice(-8), 16),
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

function createPlacement() {
	return {
		orientation: { w: 1, x: 0, y: 0, z: 0 },
		origin: { x: 0, y: 0, z: 0 },
	};
}

function createBounds() {
	return {
		max: { x: 1, y: 1, z: 1 },
		min: { x: 0, y: 0, z: 0 },
	};
}

function createRenderGeometry(sourceId: number) {
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

function createCellBsp() {
	return {
		index: 0,
		kind: "leaf" as const,
		polyIds: [],
		solid: 0,
		sphere: null,
	};
}

function createLocalBvh() {
	return {
		items: [],
		nodes: [],
	};
}

function createDiagnostics() {
	return {
		errors: [],
		omissions: [],
		sourceRecords: [],
	};
}

function createProvenance() {
	return {
		detail: null,
		errorCode: null,
		source: "repo-local-hba" as const,
		sourceAssetKind: "landblock-env-cells",
	};
}
