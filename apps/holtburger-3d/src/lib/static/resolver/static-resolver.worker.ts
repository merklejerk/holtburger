/// <reference lib="webworker" />

import type { PreparedAssetReader } from "../../assets/contracts";
import type {
	StaticResolver,
	StaticLandblockSceneLodResolution,
	StaticLandblockSceneLodSourceRequest,
	StaticLandblockSceneLodSourceResolver,
	StaticResolverJob,
	StaticScopePayload,
} from "../contracts";
import { OutdoorStaticObjectsResolver } from "../objects/outdoor-static-objects-resolver";
import { TerrainStaticScopeResolver } from "../terrain/terrain-resolver";
import { LandblockSceneLodSourceResolver } from "./landblock-scene-lod-source-resolver";
import { handleStaticResolverWorkerRequest } from "./worker-handler";
import type {
	StaticResolverWorkerGlobalPort,
	StaticResolverWorkerMainMessage,
} from "./protocol";
import {
	RequestScopedPreparedAssetReader,
	StaticResolverWorkerPreparedAssetReader,
} from "./worker-asset-reader";

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
			job.domain === "outdoor-generated-scenery" ||
			job.domain === "outdoor-detail"
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
}

const workerAssetReader = new StaticResolverWorkerPreparedAssetReader(
	workerPort,
);

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

workerPort.addEventListener(
	"message",
	(event: MessageEvent<StaticResolverWorkerMainMessage>) => {
		void handleStaticResolverWorkerRequest(
			() =>
				createStaticResolver(
					new RequestScopedPreparedAssetReader(workerAssetReader),
				),
			event.data,
			(response) => workerPort.postMessage(response),
		);
	},
);
