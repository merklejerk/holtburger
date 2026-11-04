/** Expected withdrawal of a frontend-owned asynchronous lifetime. */
export function abortError(message: string): DOMException {
	return new DOMException(message, "AbortError");
}

/** Cancellation is identified by its typed outcome, never by protocol error text. */
export function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

/** Withdraw a local wait while continuing to observe the independently owned operation. */
export function awaitWithAbort<T>(
	work: Promise<T>,
	signal: AbortSignal,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const abort = () => {
			signal.removeEventListener("abort", abort);
			reject(signal.reason);
		};
		signal.addEventListener("abort", abort, { once: true });
		void work.then(
			(value) => {
				signal.removeEventListener("abort", abort);
				resolve(value);
			},
			(error) => {
				signal.removeEventListener("abort", abort);
				reject(error);
			},
		);
		if (signal.aborted) abort();
	});
}
