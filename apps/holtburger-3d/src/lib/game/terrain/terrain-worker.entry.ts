import { generateTerrain } from "./terrain-generator";
import { validateTerrainGenerationValues } from "./terrain-generation-validation";
import {
	terrainWorkerResultTransferables,
	type TerrainWorkerJob,
	type TerrainWorkerResult,
} from "./terrain-worker-contract";
import type {
	ClosedWorkerRequest,
	ClosedWorkerResponse,
} from "../workers/closed-worker";

const worker = self as unknown as {
	onmessage:
		| ((event: MessageEvent<ClosedWorkerRequest<TerrainWorkerJob>>) => void)
		| null;
	postMessage(message: unknown, transfer?: readonly Transferable[]): void;
};

worker.onmessage = (
	event: MessageEvent<ClosedWorkerRequest<TerrainWorkerJob>>,
) => {
	const { id, input } = event.data;
	try {
		const result = generateTerrain(input);
		validateTerrainGenerationValues(result);
		worker.postMessage(
			{
				id,
				ok: true,
				result,
			} satisfies ClosedWorkerResponse<TerrainWorkerResult>,
			terrainWorkerResultTransferables(result),
		);
	} catch (cause) {
		worker.postMessage({
			error: cause instanceof Error ? cause.message : String(cause),
			id,
			ok: false,
		} satisfies ClosedWorkerResponse<never>);
	}
};
