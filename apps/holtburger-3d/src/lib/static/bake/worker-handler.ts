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
	if (message.kind !== "bake-static-job") {
		return;
	}

	try {
		postMessage({
			kind: "static-job-bake-started",
			requestId: message.requestId,
		});
		const result = await runWithStaticBakeWorkerTraceSink(
			(event) =>
				postMessage({
					event,
					kind: "static-job-bake-trace",
					requestId: message.requestId,
				}),
			() => baker.bake(message.input),
		);
		postMessage({
			kind: "static-job-baked",
			requestId: message.requestId,
			result,
		});
	} catch (error: unknown) {
		postMessage({
			kind: "static-job-bake-failed",
			message: error instanceof Error ? error.message : String(error),
			requestId: message.requestId,
		});
	}
}
