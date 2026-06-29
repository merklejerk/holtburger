/// <reference lib="webworker" />

import type { PreparedAssetReader } from "../../assets/contracts";
import type {
	StaticResolver,
	StaticResolverJob,
	StaticScopePayload,
} from "../contracts";
import { LandblockEnvCellsResolver } from "../env-cells/landblock-env-cells-resolver";
import { OutdoorStaticObjectsResolver } from "../objects/outdoor-static-objects-resolver";
import { TerrainStaticScopeResolver } from "../terrain/terrain-resolver";
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

class StaticResolverRouter implements StaticResolver {
	readonly #terrainResolver: StaticResolver;
	readonly #outdoorStaticObjectsResolver: StaticResolver;
	readonly #landblockEnvCellsResolver: StaticResolver;

	constructor(options: {
		readonly terrainResolver: StaticResolver;
		readonly outdoorStaticObjectsResolver: StaticResolver;
		readonly landblockEnvCellsResolver: StaticResolver;
	}) {
		this.#terrainResolver = options.terrainResolver;
		this.#outdoorStaticObjectsResolver = options.outdoorStaticObjectsResolver;
		this.#landblockEnvCellsResolver = options.landblockEnvCellsResolver;
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
		if (job.domain === "landblock-env-cells") {
			return this.#landblockEnvCellsResolver.resolve(job);
		}

		return Promise.reject(
			new Error(`Static resolver worker does not support ${job.domain}.`),
		);
	}
}

const workerAssetReader = new StaticResolverWorkerPreparedAssetReader(
	workerPort,
);

function createStaticResolver(
	assetReader: PreparedAssetReader,
): StaticResolver {
	return new StaticResolverRouter({
		landblockEnvCellsResolver: new LandblockEnvCellsResolver({
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
