import type { DynamicVisualBaker } from "./visual-baker";
import type {
	DynamicVisualBakeWorkerRequest,
	DynamicVisualBakeWorkerResponse,
} from "./visual-bake-protocol";

export async function handleDynamicVisualBakeWorkerRequest(
	baker: DynamicVisualBaker,
	message: DynamicVisualBakeWorkerRequest,
	postMessage: (response: DynamicVisualBakeWorkerResponse) => void,
): Promise<void> {
	try {
		const result = await baker.bake(message.input);
		postMessage({
			kind: "dynamic-visual-baked",
			requestId: message.requestId,
			result,
		});
	} catch (error: unknown) {
		postMessage({
			kind: "dynamic-visual-bake-failed",
			message: error instanceof Error ? error.message : String(error),
			requestId: message.requestId,
		});
	}
}
