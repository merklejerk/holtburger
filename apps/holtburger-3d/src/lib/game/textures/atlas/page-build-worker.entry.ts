import type {
	ClosedWorkerRequest,
	ClosedWorkerResponse,
} from "../../workers/closed-worker";
import {
	atlasPageWorkerResultTransfer,
	runAtlasPageBuildWorkerJob,
	type AtlasPageWorkerJob,
	type AtlasPageWorkerResult,
} from "./page-build-worker";

const worker = self as unknown as {
	onmessage:
		| ((event: MessageEvent<ClosedWorkerRequest<AtlasPageWorkerJob>>) => void)
		| null;
	postMessage(message: unknown, transfer?: readonly Transferable[]): void;
};

worker.onmessage = (
	event: MessageEvent<ClosedWorkerRequest<AtlasPageWorkerJob>>,
) => {
	const { id, input } = event.data;
	try {
		const result = runAtlasPageBuildWorkerJob(input);
		worker.postMessage(
			{
				id,
				ok: true,
				result,
			} satisfies ClosedWorkerResponse<AtlasPageWorkerResult>,
			atlasPageWorkerResultTransfer(result),
		);
	} catch (cause) {
		worker.postMessage({
			error: cause instanceof Error ? cause.message : String(cause),
			id,
			ok: false,
		} satisfies ClosedWorkerResponse<never>);
	}
};
