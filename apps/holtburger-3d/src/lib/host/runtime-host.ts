import {
	lookupAsset as lookupTauriAsset,
	usesBinaryAssetLookup,
} from "./tauri";
import type { HostAssetKey, PreparedAsset } from "../assets/contracts";
import {
	createHostAssetLookupRequest,
	prepareHostAssetResponse,
} from "../assets/preparation";
import type {
	RuntimeHost,
	RuntimeHostAssetResponse,
	RuntimeHostSnapshot,
} from "./runtime-contracts";
import {
	assetLookupResponseDtoSchema,
	type AssetLookupResponseDto,
} from "./contracts";
import { decodeBinaryAssetBatchEnvelope } from "./binary-asset-envelope";

declare global {
	interface Window {
		__TAURI_INTERNALS__?: object;
	}
}

class TauriRuntimeHost implements RuntimeHost {
	#lastFailure: string | null = null;
	#nextRequestIndex = 1;

	async lookupAsset(
		key: HostAssetKey,
		revision: number,
	): Promise<PreparedAsset> {
		const { requestId, response } = await this.lookupAssetResponse(key);
		return prepareHostAssetResponse({
			key,
			requestId,
			response,
			revision,
		});
	}

	async lookupAssetResponse(key: HostAssetKey): Promise<RuntimeHostAssetResponse> {
		const requestId = `asset-${this.#nextRequestIndex++}`;
		const request = createHostAssetLookupRequest(key, requestId);

		try {
			const response = await lookupTauriAsset(request);
			this.#lastFailure = null;
			return {
				requestId,
				response,
			};
		} catch (error) {
			this.#lastFailure =
				error instanceof Error ? error.message : String(error);
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

class UnavailableRuntimeHost implements RuntimeHost {
	constructor(private readonly message = "Tauri host is unavailable.") {}

	lookupAsset(): Promise<PreparedAsset> {
		return Promise.reject(new Error(this.message));
	}

	lookupAssetResponse(): Promise<RuntimeHostAssetResponse> {
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
	const assetHostUrl = getHarnessAssetHostUrl();
	if (assetHostUrl) {
		return new HttpRuntimeHost(assetHostUrl);
	}

	return isTauriRuntime()
		? new TauriRuntimeHost()
		: new UnavailableRuntimeHost(
				"Tauri host unavailable. Launch through npm run tauri:dev for asset-backed browser work.",
			);
}

class HttpRuntimeHost implements RuntimeHost {
	#lastFailure: string | null = null;
	#nextRequestIndex = 1;
	readonly #baseUrl: string;

	constructor(baseUrl: string) {
		this.#baseUrl = baseUrl.replace(/\/+$/, "");
	}

	async lookupAsset(
		key: HostAssetKey,
		revision: number,
	): Promise<PreparedAsset> {
		const { requestId, response } = await this.lookupAssetResponse(key);
		return prepareHostAssetResponse({
			key,
			requestId,
			response,
			revision,
		});
	}

	async lookupAssetResponse(key: HostAssetKey): Promise<RuntimeHostAssetResponse> {
		const requestId = `asset-${this.#nextRequestIndex++}`;
		const request = createHostAssetLookupRequest(key, requestId);

		try {
			const response = usesBinaryAssetLookup(request.assetId)
				? await this.#lookupBinaryAsset(request)
				: await this.#lookupJsonAsset(request);
			this.#lastFailure = null;
			return {
				requestId,
				response,
			};
		} catch (error) {
			this.#lastFailure =
				error instanceof Error ? error.message : String(error);
			throw error;
		}
	}

	createSnapshot(): RuntimeHostSnapshot {
		return {
			failure: this.#lastFailure,
			isAvailable: true,
		};
	}

	async #lookupJsonAsset(
		request: ReturnType<typeof createHostAssetLookupRequest>,
	): Promise<AssetLookupResponseDto> {
		const response = await fetch(`${this.#baseUrl}/lookup-asset`, {
			body: JSON.stringify(request),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		if (!response.ok) {
			throw new Error(
				`HTTP asset lookup failed for ${request.assetId}: ${response.status} ${await response.text()}`,
			);
		}
		return assetLookupResponseDtoSchema.parse(await response.json());
	}

	async #lookupBinaryAsset(
		request: ReturnType<typeof createHostAssetLookupRequest>,
	): Promise<AssetLookupResponseDto> {
		const response = await fetch(`${this.#baseUrl}/lookup-assets-binary`, {
			body: JSON.stringify({ requests: [request] }),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		if (!response.ok) {
			throw new Error(
				`HTTP binary asset lookup failed for ${request.assetId}: ${response.status} ${await response.text()}`,
			);
		}
		const [assetResponse] = decodeBinaryAssetBatchEnvelope(
			await response.arrayBuffer(),
		);
		if (!assetResponse) {
			throw new Error(
				`No binary lookup response returned for ${request.assetId}.`,
			);
		}
		return assetLookupResponseDtoSchema.parse(assetResponse);
	}
}

function getHarnessAssetHostUrl(): string | null {
	if (typeof window === "undefined") {
		return null;
	}
	const value = new URL(window.location.href).searchParams.get("assetHost");
	return value && value.length > 0 ? value : null;
}

function isTauriRuntime(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof window.__TAURI_INTERNALS__ !== "undefined"
	);
}
