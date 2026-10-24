import { objectPreviewSourceForRendering } from "./client-object-preview-contract";
import type { ObjectPreviewSource } from "../lib/game/runtime/object-preview-source";
import type { ClientVisualCacheTransport } from "./client-visual-cache-transport";

/** Each published state identifies its subject, so stale data cannot borrow another roster name. */
export type CharacterPreviewState =
	| { readonly kind: "none" }
	| { readonly kind: "loading" | "missing"; readonly guid: number }
	| {
			readonly kind: "unavailable";
			readonly guid: number;
			readonly message: string;
	  }
	| {
			readonly kind: "ready";
			readonly guid: number;
			readonly source: ObjectPreviewSource;
	  };

/** Selected-only cache reads; resource preparation/currentness stays with the shared preview. */
export class ClientCharacterPreview {
	readonly #cache: ClientVisualCacheTransport;
	readonly #publish: (state: CharacterPreviewState) => void;
	#guid: number | null = null;
	#revision = 0;
	#closed = false;

	constructor(
		cache: ClientVisualCacheTransport,
		publish: (state: CharacterPreviewState) => void,
	) {
		this.#cache = cache;
		this.#publish = publish;
	}

	/** Withdraw the previous identity before asynchronous read/preparation of the next subject. */
	select(guid: number | null): void {
		if (this.#closed || this.#guid === guid) return;
		this.#guid = guid;
		const revision = ++this.#revision;
		this.#publish(guid === null ? { kind: "none" } : { kind: "loading", guid });
		if (guid === null) return;
		void this.#cache
			.read(guid)
			.then((result) => {
				if (this.#closed || revision !== this.#revision) return;
				if (result.kind === "ready") {
					if (result.capture.guid !== guid)
						throw new Error(
							"Saved appearance belongs to a different character.",
						);
					this.#publish({
						kind: "ready",
						guid,
						source: objectPreviewSourceForRendering(result.capture.source),
					});
				} else this.#publish({ ...result, guid });
			})
			.catch((error: unknown) => {
				if (this.#closed || revision !== this.#revision) return;
				this.#publish({
					kind: "unavailable",
					guid,
					message: error instanceof Error ? error.message : String(error),
				});
			});
	}

	/** Invalidates outstanding reads without requiring filesystem cancellation support. */
	destroy(): void {
		this.#closed = true;
		this.#revision++;
	}
}
