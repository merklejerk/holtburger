import type { WindowDisplayRequest } from "./window-display-contract";

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
