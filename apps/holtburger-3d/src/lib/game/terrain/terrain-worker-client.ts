import { AABB3, Vec3 } from "../math/types";
import {
	BoundedClosedWorkerPool,
	type ClosedWorkerPoolDiagnostics,
	type ClosedWorkerPort,
} from "../workers/closed-worker";
import type { TerrainGenerator } from "./terrain-generator";
import { validateTerrainGenerationTransport } from "./terrain-generation-validation";
import type {
	TerrainWorkerJob,
	TerrainWorkerResult,
} from "./terrain-worker-contract";
import type { TerrainGenerationResult, TerrainGenerationSource } from "./types";

/** Dedicated one-slot terrain executor; transport contains no generation policy. */
export class WorkerTerrainGenerator implements TerrainGenerator {
	readonly #pool: BoundedClosedWorkerPool<
		TerrainWorkerJob,
		TerrainWorkerResult
	>;

	constructor(options: { readonly createWorker: () => ClosedWorkerPort }) {
		this.#pool = new BoundedClosedWorkerPool({
			createWorker: options.createWorker,
			workerCount: 1,
		});
	}

	static build(): WorkerTerrainGenerator {
		return new WorkerTerrainGenerator({
			createWorker: () =>
				new Worker(new URL("./terrain-worker.entry.ts", import.meta.url), {
					type: "module",
				}) as unknown as ClosedWorkerPort,
		});
	}

	async generate(
		source: TerrainGenerationSource,
	): Promise<TerrainGenerationResult> {
		const job = copyTerrainJob(source);
		const result = await this.#pool.dispatch(job, terrainJobTransferables(job));
		validateTerrainGenerationTransport(result);
		return hydrateTerrainResult(result);
	}

	getDiagnostics(): ClosedWorkerPoolDiagnostics {
		return this.#pool.getDiagnostics();
	}

	async destroy(): Promise<void> {
		this.#pool.destroy();
	}
}

/** Copy retained runtime buffers before worker transfer can detach them. */
function copyTerrainJob(source: TerrainGenerationSource): TerrainWorkerJob {
	return {
		...source,
		cellDiagonals: source.cellDiagonals.slice(),
		heightIndices: source.heightIndices.slice(),
		heights: source.heights.slice(),
		terrainSamples: source.terrainSamples.slice(),
	};
}

function terrainJobTransferables(job: TerrainWorkerJob): Transferable[] {
	return [
		job.cellDiagonals.buffer,
		job.heightIndices.buffer,
		job.heights.buffer,
		job.terrainSamples.buffer,
	];
}

function hydrateTerrainResult(
	result: TerrainWorkerResult,
): TerrainGenerationResult {
	return {
		...result,
		bounds: new AABB3(
			new Vec3(result.bounds.min.x, result.bounds.min.y, result.bounds.min.z),
			new Vec3(result.bounds.max.x, result.bounds.max.y, result.bounds.max.z),
		),
	};
}
