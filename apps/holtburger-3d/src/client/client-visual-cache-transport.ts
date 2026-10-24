import { z } from "zod";
import {
	characterVisualReadSchema,
	type CharacterVisualRead,
} from "./client-visual-cache-contract";
import {
	playerVisualCaptureSchema,
	type PlayerVisualCapture,
} from "./client-object-preview-contract";

/** Narrow local capability; endpoint identity and write debounce belong to Electron main. */
export interface ClientVisualCacheTransport {
	read(guid: number): Promise<CharacterVisualRead>;
	stage(capture: PlayerVisualCapture): Promise<void>;
	listenFailures(handler: (message: string) => void): () => void;
}

interface ElectronVisualCacheBridge {
	read(guid: number): Promise<unknown>;
	stage(capture: PlayerVisualCapture): Promise<void>;
	listenFailures(handler: (message: unknown) => void): () => void;
}

declare global {
	interface Window {
		holtburgerVisualCache?: ElectronVisualCacheBridge;
	}
}

/** Validate both sides of the preload boundary before admitting local visual facts. */
export function createElectronVisualCacheTransport(): ClientVisualCacheTransport {
	const bridge = globalThis.window?.holtburgerVisualCache;
	if (bridge === undefined)
		throw new Error("Electron character visual cache bridge is unavailable");
	return {
		async read(guid) {
			const result = characterVisualReadSchema.parse(await bridge.read(guid));
			if (result.kind === "ready" && result.capture.guid !== guid)
				throw new Error(
					"Saved appearance response belongs to a different character.",
				);
			return result;
		},
		stage(capture) {
			return bridge.stage(playerVisualCaptureSchema.parse(capture));
		},
		listenFailures(handler) {
			return bridge.listenFailures((message) =>
				handler(z.string().parse(message)),
			);
		},
	};
}
