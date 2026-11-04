import type {
	ClosedWorkerRequest,
	ClosedWorkerResponse,
} from "../../workers/closed-worker";
import {
	runAtlasLayoutWorkerJob,
	type AtlasLayoutWorkerJob,
	type AtlasLayoutWorkerResult,
} from "./layout-worker";

const worker = self as unknown as {
	onmessage:
		| ((event: MessageEvent<ClosedWorkerRequest<AtlasLayoutWorkerJob>>) => void)
		| null;
	postMessage(message: unknown, transfer?: readonly Transferable[]): void;
};

worker.onmessage = (
	event: MessageEvent<ClosedWorkerRequest<AtlasLayoutWorkerJob>>,
) => {
	const { id, input } = event.data;
	try {
		const result = runAtlasLayoutWorkerJob(input);
		worker.postMessage({
			id,
			ok: true,
			result,
		} satisfies ClosedWorkerResponse<AtlasLayoutWorkerResult>);
	} catch (cause) {
		worker.postMessage({
			error: cause instanceof Error ? cause.message : String(cause),
			id,
			ok: false,
		} satisfies ClosedWorkerResponse<never>);
	}
};
