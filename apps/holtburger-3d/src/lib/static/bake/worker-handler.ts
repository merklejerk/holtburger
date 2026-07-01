import type { StaticBaker } from "../contracts";
import type {
	StaticBakeWorkerMainMessage,
	StaticBakeWorkerResponse,
} from "./protocol";
import { runWithStaticBakeWorkerTraceSink } from "./worker-trace";

export async function handleStaticBakeWorkerRequest(
	baker: StaticBaker,
	message: StaticBakeWorkerMainMessage,
	postMessage: (response: StaticBakeWorkerResponse) => void,
): Promise<void> {
	if (message.kind !== "bake-static-batch") {
		return;
	}

	try {
		postMessage({
			kind: "static-batch-bake-started",
			requestId: message.requestId,
		});
		const result = await runWithStaticBakeWorkerTraceSink(
			(event) =>
				postMessage({
					event,
					kind: "static-batch-bake-trace",
					requestId: message.requestId,
				}),
			() => baker.bake(message.input),
		);
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
