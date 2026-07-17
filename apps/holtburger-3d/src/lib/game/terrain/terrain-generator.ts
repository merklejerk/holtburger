import type { TerrainGenerationResult, TerrainGenerationSource } from "./types";

/** Renderer-independent worker boundary for complete landblock terrain generation. */
export interface TerrainGenerator {
	/** Generate every pre-realized terrain variant from one canonical landblock source. */
	generate(source: TerrainGenerationSource): Promise<TerrainGenerationResult>;
	/** Stop accepting terrain jobs and release worker-pool resources. */
	destroy(): Promise<void>;
}

/** Placeholder for the runtime-owned terrain-generation worker pool adapter. */
export class WorkerTerrainGenerator implements TerrainGenerator {
	protected constructor() {}

	static async build(): Promise<WorkerTerrainGenerator> {
		return new WorkerTerrainGenerator();
	}

	async generate(
		source: TerrainGenerationSource,
	): Promise<TerrainGenerationResult> {
		void source;
		throw new Error("Terrain-generation worker transport is not implemented.");
	}

	async destroy(): Promise<void> {
		// Worker-pool termination belongs here once transport is installed.
	}
}
