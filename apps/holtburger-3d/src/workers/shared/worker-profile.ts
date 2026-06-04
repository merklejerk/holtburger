export interface WorkerProfileSample {
	label: string;
	durationMs: number;
}

export function measureWorkerProfile<T>(
	label: string,
	action: () => T,
	samples: WorkerProfileSample[],
): T {
	const startedAt = workerNowMs();
	try {
		return action();
	} finally {
		samples.push({ label, durationMs: workerNowMs() - startedAt });
	}
}

export async function measureWorkerProfileAsync<T>(
	label: string,
	action: () => Promise<T>,
	samples: WorkerProfileSample[],
): Promise<T> {
	const startedAt = workerNowMs();
	try {
		return await action();
	} finally {
		samples.push({ label, durationMs: workerNowMs() - startedAt });
	}
}

function workerNowMs(): number {
	return globalThis.performance?.now() ?? Date.now();
}
