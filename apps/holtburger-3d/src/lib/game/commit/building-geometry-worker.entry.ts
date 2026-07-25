import {
	bakeBuildingGeometry,
	type BuildingGeometryJob,
	type BuildingGeometryResult,
} from "./building-geometry-worker";
import type { ClosedWorkerRequest, ClosedWorkerResponse } from "./closed-worker";

const worker = self as unknown as {
	onmessage: ((event: MessageEvent<ClosedWorkerRequest<BuildingGeometryJob>>) => void) | null;
	postMessage(message: unknown, transfer?: readonly Transferable[]): void;
};

worker.onmessage = (event: MessageEvent<ClosedWorkerRequest<BuildingGeometryJob>>) => {
	const { id, input } = event.data;
	try {
		const result = bakeBuildingGeometry(input);
		const response: ClosedWorkerResponse<BuildingGeometryResult | null> = { id, ok: true, result };
		worker.postMessage(response, result ? geometryResultTransferables(result) : []);
	} catch (cause) {
		worker.postMessage({
			error: cause instanceof Error ? cause.message : String(cause),
			id,
			ok: false,
		} satisfies ClosedWorkerResponse<never>);
	}
};

function geometryResultTransferables(result: BuildingGeometryResult): Transferable[] {
	return [
		result.geometry.geometry.positions.buffer,
		result.geometry.geometry.normals.buffer,
		result.geometry.geometry.textureCoordinates.buffer,
		result.geometry.geometry.indices.buffer,
	];
}
