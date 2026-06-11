import type { StaticBakerClient } from "../contracts";
import type {
	StaticBakeWorkerMainMessage,
	StaticBakeWorkerResponse,
} from "./protocol";

export async function handleStaticBakeWorkerRequest(
	baker: StaticBakerClient,
	message: StaticBakeWorkerMainMessage,
	postMessage: (response: StaticBakeWorkerResponse) => void,
): Promise<void> {
	if (message.kind !== "bake-static-batch") {
		return;
	}

	try {
		const result = await baker.bake(message.input);
		postMessage({
			kind: "static-batch-baked",
			requestId: message.requestId,
			result,
		});
	} catch (error: unknown) {
		postMessage({
			kind: "static-batch-bake-failed",
			message: error instanceof Error ? error.message : String(error),
			requestId: message.requestId,
		});
	}
}
