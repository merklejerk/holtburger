import {
	contentStartupSnapshotSchema,
	type ContentStartupSnapshot,
} from "./content-startup-contract";

interface ContentBridge {
	snapshot(): Promise<unknown>;
	choose(): Promise<void>;
	retry(): Promise<void>;
	quit(): Promise<void>;
	listen(handler: (snapshot: unknown) => void): () => void;
}

declare global {
	interface Window {
		/** Cold startup capability; no archive, disk, or process access crosses preload. */
		holtburgerContent?: ContentBridge;
	}
}

/** Renderer startup adapter owns initial snapshot ordering and boundary validation. */
export function createContentStartupTransport() {
	const bridge = window.holtburgerContent;
	if (bridge === undefined)
		throw new Error("Content startup bridge is unavailable");
	return {
		choose: () => bridge.choose(),
		retry: () => bridge.retry(),
		quit: () => bridge.quit(),
		subscribe(
			handler: (snapshot: ContentStartupSnapshot) => void,
			failed: (error: unknown) => void,
		): () => void {
			let revision = -1;
			let active = true;
			const receive = (value: unknown) => {
				if (!active) return;
				try {
					const snapshot = contentStartupSnapshotSchema.parse(value);
					if (snapshot.revision <= revision) return;
					revision = snapshot.revision;
					handler(snapshot);
				} catch (error) {
					failed(error);
				}
			};
			const unsubscribe = bridge.listen(receive);
			void bridge.snapshot().then(receive, (error: unknown) => {
				if (active) failed(error);
			});
			return () => {
				active = false;
				unsubscribe();
			};
		},
	};
}
