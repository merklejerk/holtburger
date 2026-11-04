import { z } from "zod";
import {
	updateSnapshotSchema,
	pregameRegistrationStatusSchema,
	type UpdateSnapshot,
} from "./app-update-contract";
import {
	subscribeNativeSnapshot,
	type NativeSnapshotSource,
} from "./native-snapshot";

/** The desktop bridge exposes visibility and one confirmed action, never arbitrary network access. */
export interface AppUpdateBridge extends NativeSnapshotSource {
	/** Register one mounted launcher/pregame footer with its initial visibility. */
	registerPregame(visible: boolean): Promise<unknown>;
	/** Publish cold document visibility changes for that footer. */
	setPregameVisible(token: string, visible: boolean): Promise<unknown>;
	/** Retire a footer when its frontend page unmounts. */
	releasePregame(token: string): Promise<unknown>;
	/** Open the downloads page retained by the native update owner. */
	openDownloads(): Promise<void>;
}

declare global {
	interface Window {
		/** Absent in Explorer and ordinary browser sessions. */
		holtburgerUpdates?: AppUpdateBridge;
	}
}

/** Boundary validation and snapshot ordering stay outside the Svelte presentation component. */
export function createAppUpdateTransport(bridge: AppUpdateBridge) {
	return {
		async registerPregame(visible: boolean): Promise<string> {
			return z.uuid().parse(await bridge.registerPregame(visible));
		},
		async setPregameVisible(token: string, visible: boolean) {
			return pregameRegistrationStatusSchema.parse(
				await bridge.setPregameVisible(token, visible),
			);
		},
		async releasePregame(token: string) {
			return pregameRegistrationStatusSchema.parse(
				await bridge.releasePregame(token),
			);
		},
		openDownloads: () => bridge.openDownloads(),
		subscribe(
			handler: (snapshot: UpdateSnapshot) => void,
			failed: (error: unknown) => void,
		): () => void {
			return subscribeNativeSnapshot(
				bridge,
				(value) => updateSnapshotSchema.parse(value),
				handler,
				failed,
			);
		},
	};
}
