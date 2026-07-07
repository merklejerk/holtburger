import type {
	LandblockSceneLodLayerDto,
	LandblockSceneLodPayloadDto,
} from "../../../lib/host/contracts";
import type {
	HostAssetKey,
	PreparedAsset,
	PreparedAssetReader,
} from "../../assets/contracts";
import {
	createLandblockSceneLodHostAssetKey,
	describeHostAssetKey,
} from "../../assets/keys";
import type {
	StaticDomain,
	StaticLandblockSceneLodLayerRequest,
	StaticLandblockSceneLodResolution,
	StaticLandblockSceneLodSourceProjectionEvent,
	StaticLandblockSceneLodSourceRequest,
	StaticLandblockSceneLodSourceResolver,
	StaticResolver,
	StaticResolverJob,
	StaticScopePayload,
} from "../contracts";
import {
	createStaticAuthoredDynamicPlacementOwner,
	createStaticAuthoredDynamicRecipe,
	createStaticAuthoredDynamicRecipeResolutionPayload,
} from "../../dynamic/static-authored-visual-recipe";
import { resolveDynamicVisualRecipe } from "../../dynamic/visual-recipe-resolver";
import { EnvCellSystemResolver } from "../env-cells/env-cell-system-resolver";
import { OutdoorStaticObjectsResolver } from "../objects/outdoor-static-objects-resolver";
import type {
	EnvCellSystemLayerSourcePayloadDto,
	LandblockOutdoorLayerSourcePayloadDto,
} from "../source-payloads";
import { TerrainStaticScopeResolver } from "../terrain/terrain-resolver";

export interface LandblockSceneLodSourceResolverOptions {
	readonly assetService: PreparedAssetReader;
}

export class LandblockSceneLodSourceResolver implements StaticLandblockSceneLodSourceResolver {
	readonly #assetService: PreparedAssetReader;

	constructor(options: LandblockSceneLodSourceResolverOptions) {
		this.#assetService = options.assetService;
	}

	async resolveSource(
		request: StaticLandblockSceneLodSourceRequest,
	): Promise<StaticLandblockSceneLodResolution> {
		const sceneAsset = await this.#assetService.requestPreparedAsset(
			createLandblockSceneLodHostAssetKey(
				request.landblockId,
				request.sourceLod,
			),
		);
		const scenePayload = requireLandblockSceneLodPayload(sceneAsset);
		validateScenePayloadForRequest(scenePayload, request);
		const recipes = [];
		const dynamicPlacements = [];
		const dynamicRecipes = [];

		for (const layerRequest of request.requestedLayers) {
			const job = createStaticResolverJob(request, layerRequest);
			const resolver = createProjectedLayerResolver({
				assetService: this.#assetService,
				layerKind: layerRequest.kind,
				sceneAsset,
				scenePayload,
			});
			const payload = await resolver.resolve(job);
			recipes.push({
				payload,
				targetOwnerKey: layerRequest.targetOwnerKey,
			});
			dynamicPlacements.push(
				...createStaticAuthoredDynamicPlacementRecords({
					owner: createStaticAuthoredDynamicPlacementOwner({
						domain: job.domain,
						targetOwnerKey: layerRequest.targetOwnerKey,
					}),
					payload,
				}),
			);
			dynamicRecipes.push(
				...(await this.#resolveStaticAuthoredDynamicRecipes({
					job,
					payload,
					targetOwnerKey: layerRequest.targetOwnerKey,
				})),
			);
		}

		return { dynamicPlacements, dynamicRecipes, recipes, request };
	}

	async resolveProjectedSources(
		request: StaticLandblockSceneLodSourceRequest,
		onProjection: (
			event: StaticLandblockSceneLodSourceProjectionEvent,
		) => void,
	): Promise<void> {
		const sceneAsset = await this.#assetService.requestPreparedAsset(
			createLandblockSceneLodHostAssetKey(
				request.landblockId,
				request.sourceLod,
			),
		);
		const scenePayload = requireLandblockSceneLodPayload(sceneAsset);
		validateScenePayloadForRequest(scenePayload, request);

		for (const layerRequest of request.requestedLayers) {
			const projectionStartedAtMs = nowMs();
			const job = createStaticResolverJob(request, layerRequest);
			const resolver = createProjectedLayerResolver({
				assetService: this.#assetService,
				layerKind: layerRequest.kind,
				sceneAsset,
				scenePayload,
			});
			const payload = await resolver.resolve(job);
			const owner = createStaticAuthoredDynamicPlacementOwner({
				domain: job.domain,
				targetOwnerKey: layerRequest.targetOwnerKey,
			});
			const dynamicPlacements = createStaticAuthoredDynamicPlacementRecords({
				owner,
				payload,
			});
			const dynamicRecipes = await this.#resolveStaticAuthoredDynamicRecipes({
				job,
				payload,
				targetOwnerKey: layerRequest.targetOwnerKey,
			});
			onProjection({
				diagnostics: {
					completedAtEpochMs: Date.now(),
					dynamicPlacementCount: dynamicPlacements.length,
					dynamicRecipeCount: dynamicRecipes.length,
					projectionMs: nowMs() - projectionStartedAtMs,
					recipeCount: 1,
				},
				kind: "landblock-scene-lod-source-projected",
				resolution: {
					dynamicPlacements,
					dynamicRecipes,
					recipes: [
						{
							payload,
							targetOwnerKey: layerRequest.targetOwnerKey,
						},
					],
					request: {
						context: request.context,
						landblockId: request.landblockId,
						requestedLayers: [layerRequest],
						sourceLod: sourceLodForSceneLayer(layerRequest.kind),
					},
				},
			});
		}
	}

	async #resolveStaticAuthoredDynamicRecipes(options: {
		readonly job: StaticResolverJob;
		readonly payload: StaticScopePayload;
		readonly targetOwnerKey: StaticLandblockSceneLodLayerRequest["targetOwnerKey"];
	}): Promise<StaticLandblockSceneLodResolution["dynamicRecipes"]> {
		const owner = createStaticAuthoredDynamicPlacementOwner({
			domain: options.job.domain,
			targetOwnerKey: options.targetOwnerKey,
		});
		const placementRecords = createStaticAuthoredDynamicPlacementRecords({
			owner,
			payload: options.payload,
		});
		return Promise.all(
			placementRecords.map(async (record) =>
				createStaticAuthoredDynamicRecipe({
					recipe: await resolveDynamicVisualRecipe({
						...createStaticAuthoredDynamicRecipeResolutionPayload(record),
						assetReader: this.#assetService,
					}),
					targetOwnerKey: options.targetOwnerKey,
				}),
			),
		);
	}
}

function nowMs(): number {
	return globalThis.performance?.now() ?? Date.now();
}

function createStaticAuthoredDynamicPlacementRecords(options: {
	readonly owner: ReturnType<typeof createStaticAuthoredDynamicPlacementOwner>;
	readonly payload: StaticScopePayload;
}) {
	const { owner, payload } = options;
	if (payload.scope.kind === "outdoor-static-objects") {
		return payload.scope.authoredDynamicPlacements.map((placement) => ({
			kind: "outdoor-static-object-dynamic-placement" as const,
			owner,
			placement,
		}));
	}
	if (payload.scope.kind === "env-cell-system") {
		return payload.scope.envCells.flatMap((envCell) =>
			envCell.authoredDynamicPlacements.map((placement) => ({
				kind: "env-cell-static-object-dynamic-placement" as const,
				owner,
				placement,
			})),
		);
	}
	return [];
}

function createProjectedLayerResolver(options: {
	readonly assetService: PreparedAssetReader;
	readonly sceneAsset: PreparedAsset;
	readonly scenePayload: LandblockSceneLodPayloadDto;
	readonly layerKind: StaticLandblockSceneLodLayerRequest["kind"];
}): StaticResolver {
	const assetService = new ProjectedSceneLodAssetReader(options);
	if (options.layerKind === "terrain") {
		return new TerrainStaticScopeResolver({ assetService });
	}
	if (options.layerKind === "env-cell-system") {
		return new EnvCellSystemResolver({ assetService });
	}
	return new OutdoorStaticObjectsResolver({ assetService });
}

class ProjectedSceneLodAssetReader implements PreparedAssetReader {
	readonly #assetService: PreparedAssetReader;
	readonly #sceneAsset: PreparedAsset;
	readonly #scenePayload: LandblockSceneLodPayloadDto;
	readonly #layerKind: StaticLandblockSceneLodLayerRequest["kind"];

	constructor(options: {
		readonly assetService: PreparedAssetReader;
		readonly sceneAsset: PreparedAsset;
		readonly scenePayload: LandblockSceneLodPayloadDto;
		readonly layerKind: StaticLandblockSceneLodLayerRequest["kind"];
	}) {
		this.#assetService = options.assetService;
		this.#sceneAsset = options.sceneAsset;
		this.#scenePayload = options.scenePayload;
		this.#layerKind = options.layerKind;
	}

	requestPreparedAsset(key: HostAssetKey): Promise<PreparedAsset> {
		if (
			key.kind === "landblock-scene-lod-outdoor-layer" &&
			isOutdoorSceneLodLayer(this.#layerKind)
		) {
			return Promise.resolve({
				...this.#sceneAsset,
				key,
				payload: createProjectedOutdoorPayload(
					this.#scenePayload,
					this.#layerKind,
				),
				sourceAssetId: describeHostAssetKey(key),
			});
		}
		if (
			key.kind === "landblock-scene-lod-env-cell-layer" &&
			this.#layerKind === "env-cell-system"
		) {
			return Promise.resolve({
				...this.#sceneAsset,
				key,
				payload: createProjectedEnvCellsPayload(this.#scenePayload),
				sourceAssetId: describeHostAssetKey(key),
			});
		}

		return this.#assetService.requestPreparedAsset(key);
	}
}

function createProjectedOutdoorPayload(
	payload: LandblockSceneLodPayloadDto,
	layerKind: Exclude<
		StaticLandblockSceneLodLayerRequest["kind"],
		"env-cell-system"
	>,
): LandblockOutdoorLayerSourcePayloadDto {
	const terrainLayer = requireSceneLodLayer(payload, "terrain");
	const layer =
		layerKind === "terrain" ? null : requireSceneLodLayer(payload, layerKind);
	return {
		buildingTransitionApertures:
			layer?.kind === "outdoor-buildings"
				? layer.buildingTransitionApertures
				: [],
		diagnostics: payload.diagnostics,
		kind: "landblock-scene-lod-outdoor-layer",
		landblockId: payload.landblockId,
		outdoorBvh: layerKind === "terrain" ? null : (layer?.outdoorBvh ?? null),
		provenance: payload.provenance,
		regionId: payload.regionId,
		regionNumber: payload.regionNumber,
		statics: layerKind === "terrain" ? [] : (layer?.statics ?? []),
		terrain: terrainLayer.terrain,
	};
}

function createProjectedEnvCellsPayload(
	payload: LandblockSceneLodPayloadDto,
): EnvCellSystemLayerSourcePayloadDto {
	const layer = requireSceneLodLayer(payload, "env-cell-system");
	return {
		diagnostics: layer.diagnostics,
		envCells: layer.envCells,
		kind: "landblock-scene-lod-env-cell-layer",
		envCellSystemBvh: layer.envCellSystemBvh,
		landblockId: payload.landblockId,
		landblockInfoId: layer.landblockInfoId,
		portalApertureResources: layer.portalApertureResources,
		portalConnectivityGraph: layer.portalConnectivityGraph,
		portalLinks: layer.portalLinks,
		provenance: payload.provenance,
		regionId: payload.regionId,
		regionNumber: payload.regionNumber,
	};
}

function createStaticResolverJob(
	request: StaticLandblockSceneLodSourceRequest,
	layerRequest: StaticLandblockSceneLodLayerRequest,
): StaticResolverJob {
	return {
		domain: staticDomainForSceneLodLayer(layerRequest.kind),
		scope: {
			kind: "landblock",
			landblockId: request.landblockId,
		},
	};
}

function staticDomainForSceneLodLayer(
	kind: StaticLandblockSceneLodLayerRequest["kind"],
): StaticDomain {
	switch (kind) {
		case "terrain":
			return "outdoor-terrain";
		case "outdoor-buildings":
			return "outdoor-buildings";
		case "outdoor-explicit-objects":
			return "outdoor-explicit-objects";
		case "outdoor-generated-scenery":
			return "outdoor-generated-scenery";
		case "env-cell-system":
			return "env-cell-system";
	}
}

function sourceLodForSceneLayer(
	kind: StaticLandblockSceneLodLayerRequest["kind"],
): StaticLandblockSceneLodSourceRequest["sourceLod"] {
	switch (kind) {
		case "terrain":
			return 0;
		case "outdoor-buildings":
			return 1;
		case "outdoor-explicit-objects":
			return 2;
		case "outdoor-generated-scenery":
			return 3;
		case "env-cell-system":
			return 4;
	}
}

function requireLandblockSceneLodPayload(
	asset: PreparedAsset,
): LandblockSceneLodPayloadDto {
	const payload = asset.payload as Partial<LandblockSceneLodPayloadDto> | null;
	if (!payload || payload.kind !== "landblock-scene-lod") {
		throw new Error(
			`Prepared asset ${asset.sourceAssetId} was not a landblock scene LoD payload.`,
		);
	}
	return payload as LandblockSceneLodPayloadDto;
}

function validateScenePayloadForRequest(
	payload: LandblockSceneLodPayloadDto,
	request: StaticLandblockSceneLodSourceRequest,
): void {
	if (payload.landblockId !== request.landblockId) {
		throw new Error(
			`Scene LoD payload landblock 0x${formatHex32(payload.landblockId)} did not match request 0x${formatHex32(request.landblockId)}.`,
		);
	}
	if (payload.source.context !== request.context) {
		throw new Error(
			`Scene LoD payload context ${payload.source.context} did not match request ${request.context}.`,
		);
	}
	if (payload.source.level < request.sourceLod) {
		throw new Error(
			`Scene LoD payload level ${payload.source.level} did not satisfy requested LoD ${request.sourceLod}.`,
		);
	}
}

function requireSceneLodLayer<TKind extends LandblockSceneLodLayerDto["kind"]>(
	payload: LandblockSceneLodPayloadDto,
	kind: TKind,
): Extract<LandblockSceneLodLayerDto, { readonly kind: TKind }> {
	const layer = payload.layers.find((candidate) => candidate.kind === kind);
	if (!layer) {
		throw new Error(
			`Scene LoD ${payload.source.level} for 0x${formatHex32(payload.landblockId)} did not include ${kind}.`,
		);
	}
	return layer as Extract<LandblockSceneLodLayerDto, { readonly kind: TKind }>;
}

function isOutdoorSceneLodLayer(
	kind: StaticLandblockSceneLodLayerRequest["kind"],
): kind is Exclude<
	StaticLandblockSceneLodLayerRequest["kind"],
	"env-cell-system"
> {
	return kind !== "env-cell-system";
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
