import type { TerrainGenerationResult, TerrainGenerationSource } from "./types";

/** Complete closed terrain job transferred to the dedicated worker. */
export type TerrainWorkerJob = TerrainGenerationSource;

/** Complete generated result transferred back from the dedicated worker. */
export type TerrainWorkerResult = TerrainGenerationResult;

/** Every newly allocated result buffer whose ownership returns to the runtime. */
export function terrainWorkerResultTransferables(
	result: TerrainWorkerResult,
): Transferable[] {
	return [
		result.geometry.positions.buffer,
		result.geometry.normals.buffer,
		result.geometry.textureCoordinates.buffer,
		result.geometry.terrainColorCodes.buffer,
		result.geometry.indices.buffer,
		result.surfaceField.cellPcodes.buffer,
	];
}
