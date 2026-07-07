import type {
	StaticBakerTraceDetails,
	StaticBakerTraceEvent,
} from "../contracts";

type StaticBakeWorkerTraceSink = (event: StaticBakerTraceEvent) => void;

let activeTraceSink: StaticBakeWorkerTraceSink | null = null;

export async function runWithStaticBakeWorkerTraceSink<T>(
	traceSink: StaticBakeWorkerTraceSink,
	operation: () => Promise<T>,
): Promise<T> {
	const previousTraceSink = activeTraceSink;
	activeTraceSink = traceSink;
	try {
		return await operation();
	} finally {
		activeTraceSink = previousTraceSink;
	}
}

export function emitStaticBakeWorkerTrace(
	stage: string,
	details: StaticBakerTraceDetails = {},
): void {
	activeTraceSink?.({
		atMs: performance.now(),
		details,
		stage,
	});
}
