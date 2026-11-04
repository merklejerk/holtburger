import {
	contentStartupSnapshotSchema,
	type ContentStartupSnapshot,
} from "./content-startup-contract";

import {
	subscribeNativeSnapshot,
	type NativeSnapshotSource,
} from "./native-snapshot";

interface ContentBridge extends NativeSnapshotSource {
	choose(): Promise<void>;
	retry(): Promise<void>;
	quit(): Promise<void>;
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
			return subscribeNativeSnapshot(
				bridge,
				(value) => contentStartupSnapshotSchema.parse(value),
				handler,
				failed,
			);
		},
	};
}
