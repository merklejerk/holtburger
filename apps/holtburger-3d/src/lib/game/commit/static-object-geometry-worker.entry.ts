import {
	prepareStaticObjectGeometry,
	type StaticObjectGeometryPreparationJob,
	type StaticObjectGeometryPreparationResult,
} from "./static-object-geometry-worker";
import type {
	ClosedWorkerRequest,
	ClosedWorkerResponse,
} from "../workers/closed-worker";

const worker = self as unknown as {
	onmessage:
		| ((
				event: MessageEvent<
					ClosedWorkerRequest<StaticObjectGeometryPreparationJob>
				>,
		  ) => void)
		| null;
	postMessage(message: unknown, transfer?: readonly Transferable[]): void;
};

worker.onmessage = (
	event: MessageEvent<ClosedWorkerRequest<StaticObjectGeometryPreparationJob>>,
) => {
	const { id, input } = event.data;
	try {
		const result = prepareStaticObjectGeometry(input);
		const response: ClosedWorkerResponse<StaticObjectGeometryPreparationResult | null> =
			{
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
	result: StaticObjectGeometryPreparationResult,
): Transferable[] {
	return result.geometry.flatMap(({ geometry }) => [
		geometry.positions.buffer,
		geometry.normals.buffer,
		geometry.textureCoordinates.buffer,
		geometry.indices.buffer,
		...(geometry.bakedLight ? [geometry.bakedLight.buffer] : []),
		...(geometry.materials ? [geometry.materials.selectors.buffer] : []),
	]);
}
