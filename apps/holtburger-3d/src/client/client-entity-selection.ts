import type { ClientEntityMirror } from "./client-entity-mirror";
import type { ClientLifecycleSessionEvent } from "./client-lifecycle-session";
import type { ClientSelectedEntityTrackingStatus } from "./client-selection-tracking";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../lib/game/landblocks";

/** Identity facts and lifecycle; acquisition transports belong to their controllers. */
export interface ClientEntitySelectionLifecyclePort {
	/** Accepted identity and ownership facts, independent of rendered geometry. */
	readonly entities: Pick<ClientEntityMirror, "read">;
	subscribe(listener: (event: ClientLifecycleSessionEvent) => void): () => void;
}

/** Selected-target retention evidence, independent of acquisition radius. */
export interface ClientEntitySelectionPresentationPort {
	selectedEntityTrackingStatus(
		guid: number,
	): ClientSelectedEntityTrackingStatus;
}

/** Sole selected-identity owner and arbiter of competing acquisition intents. */
export class ClientEntitySelection {
	readonly #lifecycle: ClientEntitySelectionLifecyclePort;
	readonly #presentation: () => ClientEntitySelectionPresentationPort | null;
	readonly #listeners = new Set<(guid: number | null) => void>();
	readonly #externalListeners = new Set<() => void>();
	readonly #unsubscribe: () => void;
	#selectedGuid: number | null = null;
	#intent = Symbol("initial selection");
	#destroyed = false;

	constructor(options: {
		readonly lifecycle: ClientEntitySelectionLifecyclePort;
		readonly presentation: () => ClientEntitySelectionPresentationPort | null;
	}) {
		this.#lifecycle = options.lifecycle;
		this.#presentation = options.presentation;
		this.#unsubscribe = options.lifecycle.subscribe((event) => {
			const lifecycle =
				event.type === "current-state"
					? event.state.lifecycle
					: event.type === "lifecycle"
						? event.lifecycle
						: null;
			if (lifecycle !== null && lifecycle.kind !== "in-world")
				this.select(null);
			if (event.type === "resyncing" || event.type === "current-state")
				this.beginAcquisition("external");
			if (event.type === "entities" || event.type === "current-state")
				this.maintainSelection();
		});
	}

	selectedGuid(): number | null {
		return this.#selectedGuid;
	}

	subscribe(listener: (guid: number | null) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** External intent resets cycling even when selected identity does not change. */
	subscribeExternalIntent(listener: () => void): () => void {
		this.#externalListeners.add(listener);
		return () => this.#externalListeners.delete(listener);
	}

	/** Supersede old work before sampling; a no-result action still expresses newer intent. */
	beginAcquisition(source: "external" | "cycle"): symbol {
		this.#intent = Symbol(source);
		if (!this.#destroyed && source === "external")
			for (const listener of this.#externalListeners) listener();
		return this.#intent;
	}

	isCurrentAcquisition(intent: symbol): boolean {
		return !this.#destroyed && intent === this.#intent;
	}

	commitAcquisition(intent: symbol, guid: number | null): void {
		if (this.isCurrentAcquisition(intent)) this.#publish(guid);
	}

	select(guid: number | null): void {
		if (this.#destroyed) return;
		this.commitAcquisition(this.beginAcquisition("external"), guid);
	}

	/** Select the authoritative local identity, including when it is not realized. */
	selectSelf(): void {
		if (this.#destroyed) return;
		const intent = this.beginAcquisition("external");
		const read = this.#lifecycle.entities.read();
		if (read.kind === "current" && read.level.playerGuid !== null)
			this.commitAcquisition(intent, read.level.playerGuid);
	}

	/** Check an inventory click against accepted facts, not the sampled cell. */
	selectInventoryItem(guid: number): void {
		if (this.#destroyed) return;
		this.beginAcquisition("external");
		const read = this.#lifecycle.entities.read();
		if (read.kind === "pending") return;
		const entity = read.level.entities.get(guid);
		if (
			entity?.description.kind === "known" &&
			(entity.ownedByPlayer || guid === read.level.playerGuid)
		)
			this.#publish(this.#selectedGuid === guid ? null : guid);
	}

	/** Maintain identity from semantic facts; presentation contributes measured distance only. */
	maintainSelection(): void {
		if (this.#destroyed || this.#selectedGuid === null) return;
		const read = this.#lifecycle.entities.read();
		if (read.kind === "pending") return;
		const guid = this.#selectedGuid;
		const entity = read.level.entities.get(guid);
		if (entity?.ownedByPlayer) return;
		if (entity === undefined || entity.scenePlacement === "unavailable") {
			this.#publish(null);
			return;
		}
		const status = this.#presentation()?.selectedEntityTrackingStatus(guid);
		if (
			status?.kind === "tracked" &&
			status.distance > OUTDOOR_LANDBLOCK_WORLD_SIZE
		)
			this.#publish(null);
	}

	destroy(): void {
		this.#destroyed = true;
		this.#unsubscribe();
		this.#listeners.clear();
		this.#externalListeners.clear();
	}

	#publish(guid: number | null): void {
		if (guid === this.#selectedGuid) return;
		this.#selectedGuid = guid;
		for (const listener of this.#listeners) listener(guid);
	}
}
