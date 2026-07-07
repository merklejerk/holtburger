/// <reference lib="webworker" />

import type { PreparedAssetReader } from "../../assets/contracts";
import type {
	StaticResolver,
	StaticLandblockSceneLodResolution,
	StaticLandblockSceneLodSourceProjectionEvent,
	StaticLandblockSceneLodSourceRequest,
	StaticLandblockSceneLodSourceResolver,
	StaticResolverJob,
	StaticScopePayload,
} from "../contracts";
import { OutdoorStaticObjectsResolver } from "../objects/outdoor-static-objects-resolver";
import { TerrainStaticScopeResolver } from "../terrain/terrain-resolver";
import { LandblockSceneLodSourceResolver } from "./landblock-scene-lod-source-resolver";
import { installStaticResolverWorkerHandler } from "./worker-handler";
import type { StaticResolverWorkerGlobalPort } from "./protocol";
import { createRequestScopedPreparedAssetReader } from "../../workers/prepared-asset-service";

const workerPort = self as unknown as StaticResolverWorkerGlobalPort;

class StaticResolverRouter
	implements StaticResolver, StaticLandblockSceneLodSourceResolver
{
	readonly #terrainResolver: StaticResolver;
	readonly #outdoorStaticObjectsResolver: StaticResolver;
	readonly #landblockSceneLodSourceResolver: StaticLandblockSceneLodSourceResolver;

	constructor(options: {
		readonly terrainResolver: StaticResolver;
		readonly outdoorStaticObjectsResolver: StaticResolver;
		readonly landblockSceneLodSourceResolver: StaticLandblockSceneLodSourceResolver;
	}) {
		this.#terrainResolver = options.terrainResolver;
		this.#outdoorStaticObjectsResolver = options.outdoorStaticObjectsResolver;
		this.#landblockSceneLodSourceResolver =
			options.landblockSceneLodSourceResolver;
	}

	resolve(job: StaticResolverJob): Promise<StaticScopePayload> {
		if (job.domain === "outdoor-terrain") {
			return this.#terrainResolver.resolve(job);
		}
		if (
			job.domain === "outdoor-buildings" ||
			job.domain === "outdoor-explicit-objects" ||
			job.domain === "outdoor-generated-scenery"
		) {
			return this.#outdoorStaticObjectsResolver.resolve(job);
		}
		return Promise.reject(
			new Error(`Static resolver worker does not support ${job.domain}.`),
		);
	}

	resolveSource(
		request: StaticLandblockSceneLodSourceRequest,
	): Promise<StaticLandblockSceneLodResolution> {
		return this.#landblockSceneLodSourceResolver.resolveSource(request);
	}

	resolveProjectedSources(
		request: StaticLandblockSceneLodSourceRequest,
		onProjection: (
			event: StaticLandblockSceneLodSourceProjectionEvent,
		) => void,
	): Promise<void> {
		if (!this.#landblockSceneLodSourceResolver.resolveProjectedSources) {
			throw new Error("Landblock scene LoD source resolver cannot stream.");
		}
		return this.#landblockSceneLodSourceResolver.resolveProjectedSources(
			request,
			onProjection,
		);
	}
}

function createStaticResolver(
	assetReader: PreparedAssetReader,
): StaticResolver {
	return new StaticResolverRouter({
		landblockSceneLodSourceResolver: new LandblockSceneLodSourceResolver({
			assetService: assetReader,
		}),
		outdoorStaticObjectsResolver: new OutdoorStaticObjectsResolver({
			assetService: assetReader,
		}),
		terrainResolver: new TerrainStaticScopeResolver({
			assetService: assetReader,
		}),
	});
}

installStaticResolverWorkerHandler(
	(context) =>
		createStaticResolver(createRequestScopedPreparedAssetReader(context)),
	workerPort,
);
