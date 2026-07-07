import type { RegionRenderProfilePayloadDto } from "../../../lib/host/contracts";
import type { ResolverLandblockEnvCellLayerPayloadDto } from "../../assets/preparation/env-cell-views";
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
	EnvCellSystemStaticScopePayload,
	EnvCellStaticObjectDynamicPlacementFacts,
	StaticMaterialSourceIdentity,
	StaticObjectInstanceIdentity,
	StaticObjectSourceAssetFacts,
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

type EnvCellSystemPreparedPayload =
	| ResolverLandblockEnvCellLayerPayloadDto
	| RegionRenderProfilePayloadDto;

interface LoadedPayload<
	TKind extends EnvCellSystemPreparedPayload["kind"] =
		EnvCellSystemPreparedPayload["kind"],
> {
	readonly asset: PreparedAsset;
	readonly payload: Extract<
		EnvCellSystemPreparedPayload,
		{ readonly kind: TKind }
	>;
}

export interface EnvCellSystemResolverOptions {
	readonly assetService: PreparedAssetReader;
}

export class EnvCellSystemResolver {
	readonly #assetService: PreparedAssetReader;

	constructor(options: EnvCellSystemResolverOptions) {
		this.#assetService = options.assetService;
	}

	async resolve(job: StaticResolverJob): Promise<StaticScopePayload> {
		if (job.domain !== "env-cell-system" || job.scope.kind !== "landblock") {
			throw new Error(
				`Landblock env-cell resolver only supports landblock env-cell jobs. Received ${job.scope.kind}/${job.domain}.`,
			);
		}

		const landblock = await this.#loadPayload(
			createHostAssetKey(
				"landblock-scene-lod-env-cell-layer",
				job.scope.landblockId,
			),
			"landblock-scene-lod-env-cell-layer",
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
		const sourceByKey = new Map(
			sourceClosure.sourceAssets.map(
				(source) => [createSourceCacheKey(source.identity), source] as const,
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
		const scope: EnvCellSystemStaticScopePayload = {
			acceptedEnvCellIds: envCells
				.map((cell) => cell.identity.envCellId)
				.sort(compareNumeric),
			envCells,
			kind: "env-cell-system",
			landblock: {
				kind: "landblock-source",
				landblockId: landblock.payload.landblockId,
				source: "env-cells",
			},
			materialSources: sourceClosure.materialSources,
			missingRefs,
			paletteSources: [...paletteSources.values()],
			portalApertureResources: landblock.payload.portalApertureResources,
			portalConnectivityGraph: landblock.payload.portalConnectivityGraph,
			portalLinks: landblock.payload.portalLinks,
			regionRenderProfile: {
				detailRoles,
				identity: {
					kind: "region-render-profile",
					regionNumber: landblock.payload.regionNumber,
				},
			},
			residencySpatial: {
				envCellSystemBvhItemCount:
					landblock.payload.envCellSystemBvh.items.length,
				envCellSystemBvhNodeCount:
					landblock.payload.envCellSystemBvh.nodes.length,
				envCellSystemBvh: {
					items: landblock.payload.envCellSystemBvh.items.map((item) => ({
						bounds: item.bounds,
						identity: {
							envCellId: item.envCellId,
							kind: "env-cell-source",
						},
						memberId: item.memberId,
						source: item.source,
					})),
					nodes: landblock.payload.envCellSystemBvh.nodes,
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

	async #loadPayload<TKind extends EnvCellSystemPreparedPayload["kind"]>(
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
	payload: ResolverLandblockEnvCellLayerPayloadDto,
): readonly number[] {
	return payload.envCells.flatMap((cell) =>
		cell.surfaces.map(
			(surface) =>
				createStaticMaterialSourceIdentity(surface.materialAssetId).materialId,
		),
	);
}

function reportUnboundedEnvCells(
	payload: ResolverLandblockEnvCellLayerPayloadDto,
): void {
	const boundedEnvCellIds = new Set(
		payload.envCellSystemBvh.items.map((item) => item.envCellId),
	);
	const omittedEnvCellIds = payload.envCells
		.map((cell) => cell.envCellId)
		.filter((envCellId) => !boundedEnvCellIds.has(envCellId));
	if (omittedEnvCellIds.length === 0) {
		return;
	}

	console.warn("[holtburger-3d][browser][env-cell-system-bvh]", {
		landblockId: payload.landblockId,
		message:
			"Resolved env cells without landblock BVH bounds were omitted from the envCellSystemBvh broad phase.",
		omittedEnvCellIds,
	});
}

function reportOmittedStaticSeeds(options: {
	readonly landblockId: number;
	readonly payload: ResolverLandblockEnvCellLayerPayloadDto;
	readonly sourceByKey: ReadonlyMap<string, StaticObjectSourceAssetFacts>;
}): void {
	const omittedPlacements = options.payload.envCells.flatMap((cell) =>
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
	if (omittedPlacements.length === 0) {
		return;
	}

	console.warn(
		"[holtburger-3d][browser][landblock-env-cell-static-placements]",
		{
			landblockId: options.landblockId,
			message:
				"Omitted env-cell static placements because their top-level source assets could not be resolved.",
			omittedPlacements,
		},
	);
}

function createLandblockEnvCellStaticFacts(options: {
	readonly landblockId: number;
	readonly cell: ResolverLandblockEnvCellLayerPayloadDto["envCells"][number];
	readonly sourceByKey: ReadonlyMap<string, StaticObjectSourceAssetFacts>;
}): LandblockEnvCellStaticFacts {
	const { cell, landblockId, sourceByKey } = options;
	const staticPlacements = cell.statics.flatMap((staticSeed) => {
		const source = createStaticObjectSourceIdentity(
			parseHostAssetId(staticSeed.sourceAssetId),
		);
		const sourceAsset = sourceByKey.get(createSourceCacheKey(source));
		if (!sourceAsset) {
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
				sourceAsset,
				sourceIndex: staticSeed.sourceIndex,
				sourceScale: staticSeed.sourceScale,
			},
		];
	});
	const authoredDynamicPlacements = staticPlacements.flatMap((placement) =>
		createEnvCellDynamicPlacement({
			cell,
			landblockId,
			placement,
		}),
	);
	const authoredDynamicKeys = new Set(
		authoredDynamicPlacements.map((placement) =>
			createObjectInstanceKey(placement.object),
		),
	);
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
		authoredDynamicPlacements,
		staticObjectPlacements: staticPlacements
			.filter(
				(placement) =>
					!authoredDynamicKeys.has(createObjectInstanceKey(placement.identity)),
			)
			.map((placement) => ({
				debug: placement.debug,
				identity: placement.identity,
				localPlacement: placement.localPlacement,
				source: placement.source,
				sourceIndex: placement.sourceIndex,
				sourceScale: placement.sourceScale,
			})),
		surfaces: cell.surfaces.map((surface) => ({
			material: createStaticMaterialSourceIdentity(surface.materialAssetId),
			slotId: surface.slotId,
			surfaceId: surface.surfaceId,
		})),
		visibleEnvCellIds: [...cell.visibleEnvCellIds].sort(compareNumeric),
	};
}

function createEnvCellDynamicPlacement(options: {
	readonly landblockId: number;
	readonly cell: ResolverLandblockEnvCellLayerPayloadDto["envCells"][number];
	readonly placement: LandblockEnvCellStaticFacts["staticObjectPlacements"][number] & {
		readonly sourceAsset: StaticObjectSourceAssetFacts;
	};
}): readonly EnvCellStaticObjectDynamicPlacementFacts[] {
	const { cell, landblockId, placement } = options;
	if (
		placement.sourceAsset.sourceAssetKind !== "setup-model" ||
		placement.sourceAsset.defaultAnimation === null
	) {
		return [];
	}

	return [
		{
			classificationReason: "setup-default-animation",
			defaultAnimationId: placement.sourceAsset.defaultAnimation,
			envCellId: cell.envCellId,
			landblockId,
			localPlacement: placement.localPlacement,
			object: placement.identity,
			setupModelId: placement.sourceAsset.identity.sourceDid,
			source: placement.source,
			sourceAssetId: placement.sourceAsset.debug.sourceAssetId,
			sourceResidence: {
				kind: "landblock-source",
				landblockId,
				source: "env-cells",
			},
			sourceScale: placement.sourceScale ?? { x: 1, y: 1, z: 1 },
		},
	];
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

function createObjectInstanceKey(
	identity: StaticObjectInstanceIdentity,
): string {
	return `${identity.landblockId}:${identity.objectKind}:${identity.instanceId}`;
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
	TKind extends EnvCellSystemPreparedPayload["kind"],
>(
	asset: PreparedAsset,
	expectedKind: TKind,
): Extract<EnvCellSystemPreparedPayload, { readonly kind: TKind }> {
	const payload = asset.payload as Partial<EnvCellSystemPreparedPayload> | null;
	if (!payload || payload.kind !== expectedKind) {
		throw new Error(
			`Prepared asset ${asset.sourceAssetId} was ${String(
				payload?.kind,
			)}, expected ${expectedKind}.`,
		);
	}

	return payload as Extract<
		EnvCellSystemPreparedPayload,
		{ readonly kind: TKind }
	>;
}

function compareNumeric(left: number, right: number): number {
	return left - right;
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
