import type { RegionRenderProfilePayloadDto } from "../../../lib/host/contracts";
import type { ResolverLandblockEnvCellsPayloadDto } from "../../assets/preparation/env-cell-views";
import type {
	HostAssetKey,
	PreparedAsset,
	PreparedAssetReader,
} from "../../assets/contracts";
import {
	createHostAssetKey,
	describeHostAssetKey,
	parseHostAssetId,
} from "../../assets/keys";
import type {
	LandblockEnvCellStaticFacts,
	LandblockEnvCellsStaticScopePayload,
	StaticMaterialSourceIdentity,
	StaticObjectInstanceIdentity,
	StaticObjectPaletteSourceFacts,
	StaticObjectTextureRefFacts,
	StaticResolverJob,
	StaticScopePayload,
	StaticResourceIdentity,
	RegionDetailRoleFacts,
} from "../contracts";
import {
	createPaletteCacheKey,
	createSourceCacheKey,
	createStaticObjectSourceIdentity,
	createTextureRefCacheKey,
	resolveStaticObjectAndMaterialSourceClosure,
	resolveStaticObjectSurfaceTextureRef,
} from "../objects/static-object-source-closure";
import { createSurfaceTextureIdentity } from "../terrain/terrain-identities";

type LandblockEnvCellsPreparedPayload =
	| ResolverLandblockEnvCellsPayloadDto
	| RegionRenderProfilePayloadDto;

interface LoadedPayload<
	TKind extends LandblockEnvCellsPreparedPayload["kind"] =
		LandblockEnvCellsPreparedPayload["kind"],
> {
	readonly asset: PreparedAsset;
	readonly payload: Extract<
		LandblockEnvCellsPreparedPayload,
		{ readonly kind: TKind }
	>;
}

export interface LandblockEnvCellsResolverOptions {
	readonly assetService: PreparedAssetReader;
}

export class LandblockEnvCellsResolver {
	readonly #assetService: PreparedAssetReader;

	constructor(options: LandblockEnvCellsResolverOptions) {
		this.#assetService = options.assetService;
	}

	async resolve(job: StaticResolverJob): Promise<StaticScopePayload> {
		if (
			job.domain !== "landblock-env-cells" ||
			job.scope.kind !== "landblock"
		) {
			throw new Error(
				`Landblock env-cell resolver only supports landblock env-cell jobs. Received ${job.scope.kind}/${job.domain}.`,
			);
		}

		const landblock = await this.#loadPayload(
			createHostAssetKey("landblock-env-cells", job.scope.landblockId),
			"landblock-env-cells",
		);
		const regionRenderProfile = await this.#loadPayload(
			createHostAssetKey(
				"region-render-profile",
				landblock.payload.regionNumber,
			),
			"region-render-profile",
		);
		const sourceClosure = await resolveStaticObjectAndMaterialSourceClosure({
			assetService: this.#assetService,
			materialIds: collectCellStructureMaterialIds(landblock.payload),
			sourceAssetIds: landblock.payload.envCells.flatMap((cell) =>
				cell.statics.map((staticSeed) => staticSeed.sourceAssetId),
			),
		});
		const paletteSources = new Map(
			sourceClosure.paletteSources.map((source) => [
				createPaletteCacheKey(source.palette),
				source,
			]),
		);
		const textureRefs = new Map(
			sourceClosure.textureRefs.map((ref) => [
				createTextureRefCacheKey(ref),
				ref,
			]),
		);
		const missingRefs = [...sourceClosure.missingRefs];
		const detailRoles = createRegionDetailRoles(regionRenderProfile.payload);
		const detailTextureRevision = await this.#resolveRegionDetailTextureRefs({
			detailRoles: detailRoles.filter((role) => role.role === "environment"),
			missingRefs,
			paletteSources,
			textureRefs,
		});
		const sourceByKey = new Set(
			sourceClosure.sourceAssets.map((source) =>
				createSourceCacheKey(source.identity),
			),
		);
		reportOmittedStaticSeeds({
			landblockId: landblock.payload.landblockId,
			payload: landblock.payload,
			sourceByKey,
		});
		const envCells = landblock.payload.envCells.map((cell) =>
			createLandblockEnvCellStaticFacts({
				cell,
				landblockId: landblock.payload.landblockId,
				sourceByKey,
			}),
		);
		reportUnboundedEnvCells(landblock.payload);
		const scope: LandblockEnvCellsStaticScopePayload = {
			acceptedEnvCellIds: envCells
				.map((cell) => cell.identity.envCellId)
				.sort(compareNumeric),
			envCells,
			kind: "landblock-env-cells",
			landblock: {
				kind: "landblock-source",
				landblockId: landblock.payload.landblockId,
				source: "env-cells",
			},
			materialSources: sourceClosure.materialSources,
			missingRefs,
			paletteSources: [...paletteSources.values()],
			portalLinks: landblock.payload.portalLinks,
			regionRenderProfile: {
				detailRoles,
				identity: {
					kind: "region-render-profile",
					regionNumber: landblock.payload.regionNumber,
				},
			},
			residencySpatial: {
				landblockEnvCellBvhItemCount:
					landblock.payload.landblockEnvCellBvh.items.length,
				landblockEnvCellBvhNodeCount:
					landblock.payload.landblockEnvCellBvh.nodes.length,
				landblockEnvCellBvh: {
					items: landblock.payload.landblockEnvCellBvh.items.map((item) => ({
						bounds: item.bounds,
						identity: {
							envCellId: item.envCellId,
							kind: "env-cell-source",
						},
						memberId: item.memberId,
						source: item.source,
					})),
					nodes: landblock.payload.landblockEnvCellBvh.nodes,
				},
			},
			sourceAssets: sourceClosure.sourceAssets,
			textureRefs: [...textureRefs.values()],
			visibilityDiagnostics: [],
		};

		return {
			job,
			scope,
			sourceRevision: Math.max(
				landblock.asset.revision,
				regionRenderProfile.asset.revision,
				sourceClosure.sourceRevision,
				detailTextureRevision,
			),
		};
	}

	async #resolveRegionDetailTextureRefs(options: {
		readonly detailRoles: readonly RegionDetailRoleFacts[];
		readonly paletteSources: Map<string, StaticObjectPaletteSourceFacts>;
		readonly textureRefs: Map<string, StaticObjectTextureRefFacts>;
		readonly missingRefs: StaticResourceIdentity[];
	}): Promise<number> {
		let sourceRevision = 0;
		for (const role of options.detailRoles) {
			sourceRevision = Math.max(
				sourceRevision,
				await resolveStaticObjectSurfaceTextureRef({
					assetService: this.#assetService,
					missingRefs: options.missingRefs,
					palette: null,
					paletteSources: options.paletteSources,
					selectedRenderSurfaceId: null,
					texture: role.texture,
					textureRefs: options.textureRefs,
				}),
			);
		}
		return sourceRevision;
	}

	async #loadPayload<TKind extends LandblockEnvCellsPreparedPayload["kind"]>(
		key: HostAssetKey,
		expectedKind: TKind,
	): Promise<LoadedPayload<TKind>> {
		const asset = await this.#assetService.requestPreparedAsset(key);
		const payload = requirePreparedPayloadKind(asset, expectedKind);
		return { asset, payload };
	}
}

function createRegionDetailRoles(
	profile: RegionRenderProfilePayloadDto,
): readonly RegionDetailRoleFacts[] {
	return Object.entries(profile.detailRoles).flatMap(([role, entry]) => {
		if (!entry) {
			return [];
		}

		return [
			{
				fadeFar: entry.fadeFar,
				fadeNear: entry.fadeNear,
				role: role as RegionDetailRoleFacts["role"],
				texture: createSurfaceTextureIdentity(entry.textureDid),
				tiling: entry.tiling,
			},
		];
	});
}

function collectCellStructureMaterialIds(
	payload: ResolverLandblockEnvCellsPayloadDto,
): readonly number[] {
	return payload.envCells.flatMap((cell) =>
		cell.surfaces.map(
			(surface) =>
				createStaticMaterialSourceIdentity(surface.materialAssetId).materialId,
		),
	);
}

function reportUnboundedEnvCells(
	payload: ResolverLandblockEnvCellsPayloadDto,
): void {
	const boundedEnvCellIds = new Set(
		payload.landblockEnvCellBvh.items.map((item) => item.envCellId),
	);
	const omittedEnvCellIds = payload.envCells
		.map((cell) => cell.envCellId)
		.filter((envCellId) => !boundedEnvCellIds.has(envCellId));
	if (omittedEnvCellIds.length === 0) {
		return;
	}

	console.warn("[holtburger-3d][browser][landblock-env-cells-bvh]", {
		landblockId: payload.landblockId,
		message:
			"Resolved env cells without landblock BVH bounds were omitted from the landblockEnvCellBvh broad phase.",
		omittedEnvCellIds,
	});
}

function reportOmittedStaticSeeds(options: {
	readonly landblockId: number;
	readonly payload: ResolverLandblockEnvCellsPayloadDto;
	readonly sourceByKey: ReadonlySet<string>;
}): void {
	const omittedSeeds = options.payload.envCells.flatMap((cell) =>
		cell.statics.flatMap((staticSeed) => {
			const source = createStaticObjectSourceIdentity(
				parseHostAssetId(staticSeed.sourceAssetId),
			);
			if (options.sourceByKey.has(createSourceCacheKey(source))) {
				return [];
			}

			return [
				{
					envCellId: cell.envCellId,
					instanceId: staticSeed.instanceId,
					sourceAssetId: staticSeed.sourceAssetId,
				},
			];
		}),
	);
	if (omittedSeeds.length === 0) {
		return;
	}

	console.warn("[holtburger-3d][browser][landblock-env-cell-static-seeds]", {
		landblockId: options.landblockId,
		message:
			"Omitted env-cell static seeds because their top-level source assets could not be resolved.",
		omittedSeeds,
	});
}

function createLandblockEnvCellStaticFacts(options: {
	readonly landblockId: number;
	readonly cell: ResolverLandblockEnvCellsPayloadDto["envCells"][number];
	readonly sourceByKey: ReadonlySet<string>;
}): LandblockEnvCellStaticFacts {
	const { cell, landblockId, sourceByKey } = options;
	return {
		cellBsp: cell.cellBsp,
		cellStructure: {
			cellStructureId: cell.cellStructureId,
			kind: "cell-structure",
		},
		environment: {
			environmentId: cell.environmentId,
			kind: "environment",
		},
		identity: {
			envCellId: cell.envCellId,
			kind: "env-cell-source",
		},
		landblockId,
		localPlacement: cell.localPlacement,
		memberId: cell.memberId,
		portalApertures: cell.portalApertures,
		portals: cell.portals,
		renderGeometry: cell.renderGeometry,
		restrictionObjectId: cell.restrictionObjectId,
		seenOutside: cell.seenOutside,
		staticObjectSeeds: cell.statics.flatMap((staticSeed) => {
			const source = createStaticObjectSourceIdentity(
				parseHostAssetId(staticSeed.sourceAssetId),
			);
			if (!sourceByKey.has(createSourceCacheKey(source))) {
				return [];
			}

			return [
				{
					debug: { sourceAssetId: staticSeed.sourceAssetId },
					identity: createEnvCellStaticObjectInstanceIdentity({
						envCellId: cell.envCellId,
						instanceId: staticSeed.instanceId,
						landblockId,
					}),
					localPlacement: staticSeed.localPlacement,
					source,
					sourceIndex: staticSeed.sourceIndex,
					sourceScale: staticSeed.sourceScale,
				},
			];
		}),
		surfaces: cell.surfaces.map((surface) => ({
			material: createStaticMaterialSourceIdentity(surface.materialAssetId),
			slotId: surface.slotId,
			surfaceId: surface.surfaceId,
		})),
		visibleEnvCellIds: [...cell.visibleEnvCellIds].sort(compareNumeric),
	};
}

function createEnvCellStaticObjectInstanceIdentity(input: {
	readonly landblockId: number;
	readonly envCellId: number;
	readonly instanceId: string;
}): StaticObjectInstanceIdentity {
	return {
		instanceId: createEnvCellStaticObjectInstanceId(input),
		kind: "static-object-instance",
		landblockId: input.landblockId,
		objectKind: "explicit-object",
	};
}

function createEnvCellStaticObjectInstanceId(input: {
	readonly envCellId: number;
	readonly instanceId: string;
}): string {
	return `${formatHex32(input.envCellId)}:${input.instanceId}`;
}

function createStaticMaterialSourceIdentity(
	assetId: string,
): StaticMaterialSourceIdentity {
	const key = parseHostAssetId(assetId);
	if (key.kind !== "material") {
		throw new Error(
			`Env-cell surface material source must be material, got ${describeHostAssetKey(
				key,
			)} from ${assetId}.`,
		);
	}

	return {
		kind: "static-material-source",
		materialId: parseHex32KeyId(key, assetId),
	};
}

function parseHex32KeyId(key: HostAssetKey, sourceAssetId: string): number {
	if (!/^[0-9a-fA-F]{8}$/.test(key.id)) {
		throw new Error(
			`Host asset ${sourceAssetId} parsed as ${describeHostAssetKey(
				key,
			)} but did not carry a hex32 id.`,
		);
	}

	return Number.parseInt(key.id, 16) >>> 0;
}

function requirePreparedPayloadKind<
	TKind extends LandblockEnvCellsPreparedPayload["kind"],
>(
	asset: PreparedAsset,
	expectedKind: TKind,
): Extract<LandblockEnvCellsPreparedPayload, { readonly kind: TKind }> {
	const payload =
		asset.payload as Partial<LandblockEnvCellsPreparedPayload> | null;
	if (!payload || payload.kind !== expectedKind) {
		throw new Error(
			`Prepared asset ${asset.sourceAssetId} was ${String(
				payload?.kind,
			)}, expected ${expectedKind}.`,
		);
	}

	return payload as Extract<
		LandblockEnvCellsPreparedPayload,
		{ readonly kind: TKind }
	>;
}

function compareNumeric(left: number, right: number): number {
	return left - right;
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
