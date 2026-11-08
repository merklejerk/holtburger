import {
	windowDisplaySnapshotSchema,
	type WindowDisplayRequest,
	type WindowDisplaySnapshot,
} from "./window-display-contract";

/** Isolated preload capability; desktop window state never passes through the Rust sidecar. */
interface WindowDisplayBridge {
	snapshot(): Promise<unknown>;
	change(request: WindowDisplayRequest): Promise<void>;
	onState(handler: (snapshot: unknown) => void): () => void;
}
declare global {
	interface Window {
		holtburgerDisplay?: WindowDisplayBridge;
	}
}

/** Browser-only settings surfaces have no native window controls. */
export function windowDisplayBridge(): WindowDisplayBridge | undefined {
	return globalThis.window?.holtburgerDisplay;
}

/** Subscribe before bootstrap; newer native events win and retired consumers receive no late reply. */
export function observeWindowDisplay(
	bridge: WindowDisplayBridge,
	accept: (snapshot: WindowDisplaySnapshot) => void,
	report: (error: unknown) => void,
): () => void {
	let active = true;
	let revision = 0;
	const publish = (value: unknown) => {
		if (!active) return;
		try {
			accept(windowDisplaySnapshotSchema.parse(value));
		} catch (error) {
			report(error);
		}
	};
	const unsubscribe = bridge.onState((value) => {
		revision++;
		publish(value);
	});
	const initialRevision = revision;
	void bridge
		.snapshot()
		.then((value) => {
			if (revision === initialRevision) publish(value);
		})
		.catch((error: unknown) => {
			if (active) report(error);
		});
	return () => {
		active = false;
		unsubscribe();
	};
}
