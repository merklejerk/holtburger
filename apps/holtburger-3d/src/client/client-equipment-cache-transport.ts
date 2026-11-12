import { z } from "zod";
import {
	equipmentCacheSnapshotSchema,
	equipmentCacheStageSchema,
	type EquipmentCacheEntry,
	type EquipmentCacheSnapshot,
} from "./client-equipment-cache-contract";

interface ElectronEquipmentCacheBridge {
	readAll(): Promise<unknown>;
	stage(entry: unknown): Promise<void>;
	listenFailures(handler: (message: unknown) => void): () => void;
}

declare global {
	interface Window {
		holtburgerEquipmentCache?: ElectronEquipmentCacheBridge;
	}
}

/** Client-side persistence seam for known equipment cantrip tiers. */
export interface ClientEquipmentCacheTransport {
	readAll(): Promise<EquipmentCacheSnapshot>;
	stage(entry: EquipmentCacheEntry): void;
	listenFailures(handler: (message: string) => void): () => void;
}

/** Adapts Electron Main's per-server equipment cantrip cache to a typed client interface. */
export function createElectronEquipmentCacheTransport(): ClientEquipmentCacheTransport {
	const bridge = globalThis.window?.holtburgerEquipmentCache;
	if (bridge === undefined) {
		throw new Error("Electron equipment cantrip cache bridge is unavailable");
	}
	const failureListeners = new Set<(message: string) => void>();
	const notifyFailure = (message: string) => {
		for (const listener of failureListeners) listener(message);
	};
	return {
		async readAll() {
			return equipmentCacheSnapshotSchema.parse(await bridge.readAll());
		},
		stage(entry) {
			void bridge
				.stage(equipmentCacheStageSchema.parse(entry))
				.catch((error: unknown) => {
					const detail = error instanceof Error ? error.message : String(error);
					notifyFailure(
						`Equipment cantrip cache could not be updated: ${detail}`,
					);
				});
		},
		listenFailures(handler) {
			failureListeners.add(handler);
			const unsubscribeIpc = bridge.listenFailures((message) =>
				handler(z.string().parse(message)),
			);
			return () => {
				failureListeners.delete(handler);
				unsubscribeIpc();
			};
		},
	};
}
