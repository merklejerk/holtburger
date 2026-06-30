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
	StaticLandblockSceneLodSourceRequest,
	StaticLandblockSceneLodSourceResolver,
	StaticResolver,
	StaticResolverJob,
} from "../contracts";
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

		for (const layerRequest of request.requestedLayers) {
			const job = createStaticResolverJob(request, layerRequest);
			const resolver = createProjectedLayerResolver({
				assetService: this.#assetService,
				layerKind: layerRequest.kind,
				sceneAsset,
				scenePayload,
			});
			recipes.push({
				payload: await resolver.resolve(job),
				targetOwnerKey: layerRequest.targetOwnerKey,
			});
		}

		return { recipes, request };
	}
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
		buildingTransitionApertures: layer.buildingTransitionApertures,
		diagnostics: layer.diagnostics,
		envCells: layer.envCells,
		kind: "landblock-scene-lod-env-cell-layer",
		envCellSystemBvh: layer.envCellSystemBvh,
		landblockId: payload.landblockId,
		landblockInfoId: layer.landblockInfoId,
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
