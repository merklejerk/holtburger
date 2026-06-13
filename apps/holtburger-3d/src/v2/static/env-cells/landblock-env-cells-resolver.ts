import type { LandblockEnvCellsPayloadDto } from "../../../lib/host/contracts";
import type {
	AssetService,
	HostAssetKey,
	PreparedAsset,
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
	StaticObjectSourceIdentity,
	StaticResolverJob,
	StaticScopePayload,
} from "../contracts";

interface LoadedLandblockEnvCellsPayload {
	readonly asset: PreparedAsset;
	readonly payload: LandblockEnvCellsPayloadDto;
}

export interface LandblockEnvCellsResolverOptions {
	readonly assetService: AssetService;
}

export class LandblockEnvCellsResolver {
	readonly #assetService: AssetService;

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
		);
		const envCells = landblock.payload.envCells.map((cell) =>
			createLandblockEnvCellStaticFacts(landblock.payload.landblockId, cell),
		);
		const scope: LandblockEnvCellsStaticScopePayload = {
			acceptedEnvCellIds: envCells
				.map((cell) => cell.identity.envCellId)
				.sort(compareNumeric),
			classification: landblock.payload.classification,
			envCells,
			kind: "landblock-env-cells",
			landblock: {
				kind: "landblock-source",
				landblockId: landblock.payload.landblockId,
				source: "env-cells",
			},
			missingRefs: [],
			portalLinks: landblock.payload.portalLinks,
			regionRenderProfile: {
				kind: "region-render-profile",
				regionNumber: landblock.payload.regionNumber,
			},
			residencySpatial: {
				coordinateSpace: "landblock-env-cell-residency",
				envCellResidencyBvhItemCount:
					landblock.payload.envCellResidencyBvh.items.length,
				envCellResidencyBvhNodeCount:
					landblock.payload.envCellResidencyBvh.nodes.length,
				residencyBvh: {
					coordinateSpace: "landblock-env-cell-residency",
					items: landblock.payload.envCellResidencyBvh.items.map((item) => ({
						identity: {
							envCellId: item.envCellId,
							kind: "env-cell-source",
						},
						memberId: item.memberId,
						source: item.source,
					})),
					nodes: landblock.payload.envCellResidencyBvh.nodes,
				},
			},
			visibilityDiagnostics: [],
		};

		return {
			job,
			scope,
			sourceRevision: landblock.asset.revision,
		};
	}

	async #loadPayload(
		key: HostAssetKey,
	): Promise<LoadedLandblockEnvCellsPayload> {
		const asset = await this.#assetService.requestPreparedAsset(key);
		const payload = requirePreparedPayloadKind(asset, "landblock-env-cells");
		return { asset, payload };
	}
}

function createLandblockEnvCellStaticFacts(
	landblockId: number,
	cell: LandblockEnvCellsPayloadDto["envCells"][number],
): LandblockEnvCellStaticFacts {
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
		localSpatial: {
			coordinateSpace: "env-cell-local",
			localBvh: cell.localBvh,
			localBvhItemCount: cell.localBvh.items.length,
			localBvhNodeCount: cell.localBvh.nodes.length,
		},
		memberId: cell.memberId,
		portalApertures: cell.portalApertures,
		portals: cell.portals,
		renderGeometry: cell.renderGeometry,
		restrictionObjectId: cell.restrictionObjectId,
		seenOutside: cell.seenOutside,
		staticObjectSeeds: cell.statics.map((staticSeed) => ({
			debug: { sourceAssetId: staticSeed.sourceAssetId },
			identity: createEnvCellStaticObjectInstanceIdentity({
				envCellId: cell.envCellId,
				instanceId: staticSeed.instanceId,
				landblockId,
			}),
			instanceBounds: staticSeed.instanceBounds,
			localPlacement: staticSeed.localPlacement,
			source: createStaticObjectSourceIdentity(staticSeed.sourceAssetId),
			sourceBounds: staticSeed.sourceBounds,
			sourceIndex: staticSeed.sourceIndex,
			sourceScale: staticSeed.sourceScale,
		})),
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
		instanceId: `${formatHex32(input.envCellId)}:${input.instanceId}`,
		kind: "static-object-instance",
		landblockId: input.landblockId,
		objectKind: "explicit-object",
	};
}

function createStaticObjectSourceIdentity(
	assetId: string,
): StaticObjectSourceIdentity {
	const key = parseHostAssetId(assetId);
	if (
		key.kind !== "gfx-obj" &&
		key.kind !== "setup-model" &&
		key.kind !== "setup-appearance"
	) {
		throw new Error(
			`Env-cell static object source must be gfx-obj, setup-model, or setup-appearance, got ${describeHostAssetKey(
				key,
			)} from ${assetId}.`,
		);
	}

	return {
		kind: "static-object-source",
		sourceAssetKind: key.kind,
		sourceDid: parseHex32KeyId(key, assetId),
	};
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

function requirePreparedPayloadKind(
	asset: PreparedAsset,
	expectedKind: "landblock-env-cells",
): LandblockEnvCellsPayloadDto {
	const payload = asset.payload as Partial<LandblockEnvCellsPayloadDto> | null;
	if (!payload || payload.kind !== expectedKind) {
		throw new Error(
			`Prepared asset ${asset.sourceAssetId} was ${String(
				payload?.kind,
			)}, expected ${expectedKind}.`,
		);
	}

	return payload as LandblockEnvCellsPayloadDto;
}

function compareNumeric(left: number, right: number): number {
	return left - right;
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
