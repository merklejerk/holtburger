import { lookupAsset as lookupTauriAsset } from "../../lib/host/tauri";
import type { HostAssetKey, PreparedAsset } from "../assets/contracts";
import {
	createHostAssetLookupRequest,
	prepareHostAssetResponse,
} from "../assets/preparation";
import type { RuntimeHost, RuntimeHostSnapshot } from "./contracts";

declare global {
	interface Window {
		__TAURI_INTERNALS__?: object;
	}
}

export class TauriRuntimeHost implements RuntimeHost {
	#lastFailure: string | null = null;
	#nextRequestIndex = 1;

	async lookupAsset(
		key: HostAssetKey,
		revision: number,
	): Promise<PreparedAsset> {
		const requestId = `v2-asset-${this.#nextRequestIndex++}`;
		const request = createHostAssetLookupRequest(key, requestId);

		try {
			const response = await lookupTauriAsset(request);
			this.#lastFailure = null;
			return prepareHostAssetResponse({
				key,
				requestId,
				response,
				revision,
			});
		} catch (error) {
			this.#lastFailure = error instanceof Error ? error.message : String(error);
			throw error;
		}
	}

	createSnapshot(): RuntimeHostSnapshot {
		return {
			failure: this.#lastFailure,
			isAvailable: isTauriRuntime(),
		};
	}
}

export class UnavailableRuntimeHost implements RuntimeHost {
	constructor(private readonly message = "Tauri host is unavailable.") {}

	lookupAsset(): Promise<PreparedAsset> {
		return Promise.reject(new Error(this.message));
	}

	createSnapshot(): RuntimeHostSnapshot {
		return {
			failure: this.message,
			isAvailable: false,
		};
	}
}

export function createBrowserRuntimeHost(): RuntimeHost {
	return isTauriRuntime()
		? new TauriRuntimeHost()
		: new UnavailableRuntimeHost(
				"Tauri host unavailable. Launch through npm run tauri:dev:v2 for asset-backed V2 work.",
			);
}

function isTauriRuntime(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof window.__TAURI_INTERNALS__ !== "undefined"
	);
}
