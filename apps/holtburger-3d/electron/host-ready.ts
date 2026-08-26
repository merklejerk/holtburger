/** One-shot readiness gate shared by the browser IPC bridge and host startup. */
export interface HostReadyGate<T> {
	readonly promise: Promise<T>;
	resolve(value: T): void;
	reject(reason: unknown): void;
}

export function createHostReadyGate<T>(): HostReadyGate<T> {
	let resolvePromise!: (value: T) => void;
	let rejectPromise!: (reason: unknown) => void;
	const promise = new Promise<T>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return {
		promise,
		resolve: resolvePromise,
		reject: rejectPromise,
	};
}
