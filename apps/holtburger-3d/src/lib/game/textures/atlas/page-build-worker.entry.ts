import type {
	ClosedWorkerRequest,
	ClosedWorkerResponse,
} from "../../workers/closed-worker";
import { runAtlasPageBuildWorkerJob } from "./page-build-worker";
import type { AtlasPageBuildJob, AtlasPageBuildResult } from "./page-build";

const worker = self as unknown as {
	onmessage:
		| ((event: MessageEvent<ClosedWorkerRequest<AtlasPageBuildJob>>) => void)
		| null;
	postMessage(message: unknown, transfer?: readonly Transferable[]): void;
};

worker.onmessage = (
	event: MessageEvent<ClosedWorkerRequest<AtlasPageBuildJob>>,
) => {
	const { id, input } = event.data;
	try {
		const result = runAtlasPageBuildWorkerJob(input);
		worker.postMessage(
			{
				id,
				ok: true,
				result,
			} satisfies ClosedWorkerResponse<AtlasPageBuildResult>,
			[result.pageBits.buffer],
		);
	} catch (cause) {
		worker.postMessage({
			error: cause instanceof Error ? cause.message : String(cause),
			id,
			ok: false,
		} satisfies ClosedWorkerResponse<never>);
	}
};
