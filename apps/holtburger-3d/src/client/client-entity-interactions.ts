import type { ClientEntitySelection } from "./client-entity-selection";
import type { ClientLifecycleSession } from "./client-lifecycle-session";

/** App-local selected-target display facts, sampled together at the HUD's display cadence. */
export interface ClientSelectedEntityDisplay {
	/** Current presentation name, absent while the selected entity is unrealized. */
	readonly name: string | null;
	/** Server-reported health, absent until an update arrives for this selection. */
	readonly healthFraction: number | null;
}

/** Session-owned health subscription and use intent; HUD lifetime never owns network work. */
export class ClientEntityInteractions {
	readonly #lifecycle: Pick<
		ClientLifecycleSession,
		"state" | "subscribe" | "queryEntityHealth" | "useEntity"
	>;
	readonly #unsubscribeSelection: () => void;
	readonly #unsubscribeHealth: () => void;
	readonly #onFailure: (error: unknown) => void;
	#target: {
		readonly guid: number;
		readonly healthFraction: number | null;
	} | null = null;
	#destroyed = false;

	constructor(options: {
		readonly selection: Pick<
			ClientEntitySelection,
			"selectedGuid" | "subscribe"
		>;
		readonly lifecycle: Pick<
			ClientLifecycleSession,
			"state" | "subscribe" | "queryEntityHealth" | "useEntity"
		>;
		readonly onFailure: (error: unknown) => void;
	}) {
		this.#lifecycle = options.lifecycle;
		this.#onFailure = options.onFailure;
		this.#unsubscribeSelection = options.selection.subscribe((guid) =>
			this.#select(guid),
		);
		this.#unsubscribeHealth = options.lifecycle.subscribe((event) => {
			if (
				event.type === "entity-health" &&
				this.#target?.guid === event.health.guid
			) {
				this.#target = {
					guid: event.health.guid,
					healthFraction: event.health.healthFraction,
				};
			}
		});
		this.#select(options.selection.selectedGuid());
	}

	/** Unknown and zero health remain distinct; no world-state cache is maintained here. */
	healthFraction(): number | null {
		return this.#target === null ? null : this.#target.healthFraction;
	}

	/** Capture the current selected identity at the button edge. Core owns use/busy semantics. */
	interact(): void {
		if (
			this.#destroyed ||
			this.#target === null ||
			this.#lifecycle.state().lifecycle?.kind !== "in-world"
		)
			return;
		void this.#lifecycle.useEntity(this.#target.guid).catch(this.#onFailure);
	}

	/** Release the server subscription before the surrounding client transport is torn down. */
	destroy(): void {
		if (this.#destroyed) return;
		this.#select(null);
		this.#destroyed = true;
		this.#unsubscribeSelection();
		this.#unsubscribeHealth();
	}

	#select(guid: number | null): void {
		if (
			this.#destroyed ||
			guid === (this.#target === null ? null : this.#target.guid)
		)
			return;
		this.#target = guid === null ? null : { guid, healthFraction: null };
		const phase = this.#lifecycle.state().lifecycle?.kind;
		// Portal entry still has a live connection on which to cancel the old target.
		if (phase === "in-world" || (phase === "portal-space" && guid === null)) {
			void this.#lifecycle.queryEntityHealth(guid).catch(this.#onFailure);
		}
	}
}
