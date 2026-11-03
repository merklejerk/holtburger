/** Native snapshot response and events can arrive in either order during document startup. */
export interface NativeSnapshotSource {
	/** Read the current native state after subscribing to publications. */
	snapshot(): Promise<unknown>;
	/** Register a document-local event handler and return its synchronous cleanup. */
	listen(handler: (snapshot: unknown) => void): () => void;
}

/** Share cold IPC ordering/teardown between content startup and update presentation. */
export function subscribeNativeSnapshot<
	T extends { readonly revision: number },
>(
	source: NativeSnapshotSource,
	decode: (value: unknown) => T,
	handler: (snapshot: T) => void,
	failed: (error: unknown) => void,
): () => void {
	let revision = -1;
	let active = true;
	const receive = (value: unknown) => {
		if (!active) return;
		try {
			const snapshot = decode(value);
			if (snapshot.revision <= revision) return;
			revision = snapshot.revision;
			handler(snapshot);
		} catch (error) {
			failed(error);
		}
	};
	const unsubscribe = source.listen(receive);
	void source.snapshot().then(receive, (error: unknown) => {
		if (active) failed(error);
	});
	return () => {
		active = false;
		unsubscribe();
	};
}
