import {
	bakeStaticObjectGeometry,
	type StaticObjectGeometryJob,
	type StaticObjectGeometryResult,
} from "./static-object-geometry-worker";
import type {
	ClosedWorkerRequest,
	ClosedWorkerResponse,
} from "../workers/closed-worker";

const worker = self as unknown as {
	onmessage:
		| ((
				event: MessageEvent<ClosedWorkerRequest<StaticObjectGeometryJob>>,
		  ) => void)
		| null;
	postMessage(message: unknown, transfer?: readonly Transferable[]): void;
};

worker.onmessage = (
	event: MessageEvent<ClosedWorkerRequest<StaticObjectGeometryJob>>,
) => {
	const { id, input } = event.data;
	try {
		const result = bakeStaticObjectGeometry(input);
		const response: ClosedWorkerResponse<StaticObjectGeometryResult | null> = {
			id,
			ok: true,
			result,
		};
		worker.postMessage(
			response,
			result ? geometryResultTransferables(result) : [],
		);
	} catch (cause) {
		worker.postMessage({
			error: cause instanceof Error ? cause.message : String(cause),
			id,
			ok: false,
		} satisfies ClosedWorkerResponse<never>);
	}
};

function geometryResultTransferables(
	result: StaticObjectGeometryResult,
): Transferable[] {
	return [
		result.geometry.geometry.positions.buffer,
		result.geometry.geometry.normals.buffer,
		result.geometry.geometry.textureCoordinates.buffer,
		result.geometry.geometry.indices.buffer,
	];
}
