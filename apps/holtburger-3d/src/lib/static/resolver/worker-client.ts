import type { PreparedAssetReader } from "../../assets/contracts";
import type {
	StaticLandblockSceneLodResolution,
	StaticLandblockSceneLodSourceRequest,
	StaticLandblockSceneLodSourceResolver,
	StaticResolverJob,
	StaticResolver,
	StaticScopePayload,
} from "../contracts";
import type {
	StaticResolverWorkerInput,
	StaticResolverWorkerOutput,
	StaticResolverWorkerPort,
} from "./protocol";
import {
	createPreparedAssetServiceHandler,
	type PreparedAssetServiceRequest,
	type PreparedAssetServiceResponse,
} from "../../workers/prepared-asset-service";
import { StandardWorkerPool } from "../../workers/pool";

export class WorkerPoolStaticResolver
	implements StaticResolver, StaticLandblockSceneLodSourceResolver
{
	readonly #pool: StandardStaticResolverPool;

	constructor(options: {
		readonly assetReader: PreparedAssetReader;
		readonly createWorker: () => StaticResolverWorkerPort;
		readonly workerCount: number;
	}) {
		this.#pool = new StandardStaticResolverPool(options);
	}

	async resolve(job: StaticResolverJob): Promise<StaticScopePayload> {
		const output = await this.#pool.submit({
			job,
			kind: "resolve-static-scope",
		});
		if (output.kind !== "static-scope-resolved") {
			throw new Error("Static resolver worker returned a source resolution.");
		}
		return output.payload;
	}

	async resolveSource(
		request: StaticLandblockSceneLodSourceRequest,
	): Promise<StaticLandblockSceneLodResolution> {
		const output = await this.#pool.submit({
			kind: "resolve-landblock-scene-lod-source",
			sourceRequest: request,
		});
		if (output.kind !== "landblock-scene-lod-source-resolved") {
			throw new Error("Static resolver worker returned a scope payload.");
		}
		return output.resolution;
	}

	dispose(): void {
		this.#pool.dispose();
	}
}

class StandardStaticResolverPool {
	readonly #pool: StandardWorkerPool<
		StaticResolverWorkerInput,
		StaticResolverWorkerOutput,
		never,
		PreparedAssetServiceRequest,
		PreparedAssetServiceResponse
	>;

	constructor(options: {
		readonly assetReader: PreparedAssetReader;
		readonly createWorker: () => StaticResolverWorkerPort;
		readonly workerCount: number;
	}) {
		this.#pool = new StandardWorkerPool({
			createWorker: options.createWorker,
			requestIdPrefix: "resolver-job",
			serviceHandler: createPreparedAssetServiceHandler(options.assetReader),
			size: options.workerCount,
		});
	}

	submit(
		input: StaticResolverWorkerInput,
	): Promise<StaticResolverWorkerOutput> {
		return this.#pool.submit(input);
	}

	dispose(): void {
		this.#pool.dispose();
	}
}
