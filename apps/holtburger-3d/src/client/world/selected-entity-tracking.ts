import { entityDisplayName } from "../../lib/game/entity-display-name";
import {
	selectedEntityNameColor,
	type EntityNameColorToken,
} from "./selected-entity-color";
import { canInteractItem } from "../hud/action-item";
import type { ItemStructure } from "../widgets/item-structure";
import type { ClientEntityFacts } from "./entity-mirror";
import type { ClientEntitySelection } from "./entity-selection";
import type { ClientLifecycleSession } from "../session/lifecycle-session";

/** Applicable health is distinct from absent identity/description or a non-creature. */
type ClientSelectedHealth =
	| { readonly kind: "unavailable" }
	| { readonly kind: "not-applicable" }
	| { readonly kind: "awaiting-response" }
	| { readonly kind: "known"; readonly fraction: number };

/** Selected HUD facts sampled from the semantic mirror and the effective subscription. */
export interface ClientSelectedEntityDisplay {
	/** Presentation label with an unnamed fallback; absent until description is known. */
	readonly name: string | null;
	/** Theme-overridable classification color, absent while description facts are pending. */
	readonly nameColor: EntityNameColorToken | null;
	/** Current stack quantity, absent when the selected description has none. */
	readonly stackCount: number | null;
	/** Raw structure properties sampled together with the selected name and quantity. */
	readonly structure: ItemStructure;
	/** World eligibility plus the latest matching server health response. */
	readonly health: ClientSelectedHealth;
	/** Whether selected use is available under the current frontend diagnostic policy. */
	readonly canInteract: boolean;
	/** Player targets advertise Trade through the ordinary interaction control. */
	readonly interactionLabel: "Interact" | "Trade";
}

/** Initial/pending HUD display without a synthetic name or unknown-health meter. */
export const EMPTY_CLIENT_SELECTED_DISPLAY: ClientSelectedEntityDisplay = {
	name: null,
	nameColor: null,
	stackCount: null,
	structure: { current: null, max: null },
	health: { kind: "unavailable" },
	canInteract: false,
	interactionLabel: "Interact",
};

type TrackingLifecycle = Pick<
	ClientLifecycleSession,
	"state" | "subscribe" | "queryEntityHealth" | "entities"
>;
type TrackingSelection = Pick<
	ClientEntitySelection,
	"selectedGuid" | "subscribe"
>;

interface SelectedEntityTarget {
	readonly guid: number;
	readonly worldGeneration: number;
	readonly baseline: {
		readonly instanceSequence: number;
		readonly observedAtSeconds: number;
	} | null;
	observedResponse: boolean;
}

/** Session-owned selected display and health subscription; use execution belongs to ClientItemInteractions. */
export class ClientSelectedEntityTracking {
	readonly #lifecycle: TrackingLifecycle;
	readonly #selection: TrackingSelection;
	readonly #unsubscribeSelection: () => void;
	readonly #unsubscribeLifecycle: () => void;
	readonly #onFailure: (error: unknown) => void;
	#target: SelectedEntityTarget | null = null;
	#destroyed = false;

	constructor(options: {
		readonly selection: TrackingSelection;
		readonly lifecycle: TrackingLifecycle;
		readonly onFailure: (error: unknown) => void;
	}) {
		this.#selection = options.selection;
		this.#lifecycle = options.lifecycle;
		this.#onFailure = options.onFailure;
		this.#unsubscribeSelection = options.selection.subscribe(() =>
			this.#reconcile(),
		);
		this.#unsubscribeLifecycle = options.lifecycle.subscribe((event) => {
			if (
				event.type === "entities" ||
				event.type === "current-state" ||
				event.type === "lifecycle" ||
				event.type === "resyncing" ||
				event.type === "presentation-discontinuity"
			) {
				this.#reconcile();
			}
		});
		this.#reconcile();
	}

	/** One coherent bounded HUD read; no fallback to differently aged rendered names. */
	display(unrestrictedUse: boolean): ClientSelectedEntityDisplay {
		const guid = this.#selection.selectedGuid();
		const read = this.#lifecycle.entities.read();
		if (this.#destroyed || guid === null || read.kind === "pending")
			return EMPTY_CLIENT_SELECTED_DISPLAY;
		const record = read.level.entities.get(guid);
		if (record === undefined || record.description.kind === "pending")
			return EMPTY_CLIENT_SELECTED_DISPLAY;
		const worldGeneration = this.#lifecycle.state().worldGeneration;
		const target =
			this.#target !== null &&
			this.#target.guid === guid &&
			this.#target.worldGeneration === worldGeneration
				? this.#target
				: null;
		const freshHealth =
			target !== null &&
			record.health !== null &&
			this.#hasFreshHealth(target, record.health)
				? record.health
				: null;
		return {
			name: entityDisplayName(record.description.name, guid),
			nameColor: selectedEntityNameColor(
				record.description,
				guid === read.level.playerGuid,
				record.summon !== null,
			),
			stackCount: record.description.stackCount,
			structure: record.description.structure,
			interactionLabel: record.canTrade ? "Trade" : "Interact",
			canInteract:
				canInteractItem(record, unrestrictedUse) &&
				this.#lifecycle.state().lifecycle?.kind === "in-world",
			health:
				record.description.healthQuery === "ineligible"
					? { kind: "not-applicable" }
					: freshHealth === null
						? { kind: "awaiting-response" }
						: { kind: "known", fraction: freshHealth.fraction },
		};
	}

	/** Cancel once while transport is still alive, then retire both listeners. */
	destroy(): void {
		if (this.#destroyed) return;
		this.#retireTarget();
		this.#destroyed = true;
		this.#unsubscribeSelection();
		this.#unsubscribeLifecycle();
	}

	#reconcile(): void {
		if (this.#destroyed) return;
		const guid = this.#selection.selectedGuid();
		const read = this.#lifecycle.entities.read();
		const record =
			guid !== null && read.kind === "current"
				? read.level.entities.get(guid)
				: undefined;
		const state = this.#lifecycle.state();
		const eligible =
			state.lifecycle?.kind === "in-world" &&
			record?.description.kind === "known" &&
			record.description.healthQuery === "eligible";
		if (!eligible || guid === null || record === undefined) {
			this.#retireTarget();
			return;
		}
		const worldGeneration = state.worldGeneration;
		const health = record.health;
		const incarnationReplaced =
			this.#target !== null &&
			this.#target.guid === guid &&
			this.#target.worldGeneration === worldGeneration &&
			this.#target.observedResponse &&
			health === null;
		if (
			this.#target === null ||
			this.#target.guid !== guid ||
			this.#target.worldGeneration !== worldGeneration ||
			incarnationReplaced
		) {
			this.#target = {
				guid,
				worldGeneration,
				baseline:
					health === null
						? null
						: {
								instanceSequence: health.instanceSequence,
								observedAtSeconds: health.observedAtSeconds,
							},
				observedResponse: false,
			};
			this.#issueQuery(guid);
			return;
		}
		if (health !== null && this.#hasFreshHealth(this.#target, health)) {
			this.#target.observedResponse = true;
		}
	}

	#hasFreshHealth(
		target: SelectedEntityTarget,
		health: NonNullable<ClientEntityFacts["health"]>,
	): boolean {
		return (
			target.baseline === null ||
			health.instanceSequence !== target.baseline.instanceSequence ||
			health.observedAtSeconds > target.baseline.observedAtSeconds
		);
	}

	#retireTarget(): void {
		if (this.#target === null) return;
		this.#target = null;
		this.#issueQuery(null);
	}

	#issueQuery(guid: number | null): void {
		const phase = this.#lifecycle.state().lifecycle?.kind;
		if (phase === "in-world" || (phase === "portal-space" && guid === null)) {
			void this.#lifecycle.queryEntityHealth(guid).catch(this.#onFailure);
		}
	}
}
