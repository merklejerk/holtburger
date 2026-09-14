import { selectedEntityNameColor } from "./client-selected-entity-color";
import type { HexRgbaColor } from "../lib/frontend-color";
import type { ItemStructure } from "../app/item-structure";
import type { ClientEntitySelection } from "./client-entity-selection";
import type { ClientLifecycleSession } from "./client-lifecycle-session";

/** Applicable health is distinct from absent identity/description or a non-creature. */
type ClientSelectedHealth =
	| { readonly kind: "unavailable" }
	| { readonly kind: "not-applicable" }
	| { readonly kind: "awaiting-response" }
	| { readonly kind: "known"; readonly fraction: number };

/** Selected HUD facts sampled from the semantic mirror and the effective subscription. */
export interface ClientSelectedEntityDisplay {
	/** Current accepted name, absent until description is known. */
	readonly name: string | null;
	/** App-owned classification color, absent while description facts are pending. */
	readonly nameColor: HexRgbaColor | null;
	/** Current stack quantity, absent when the selected description has none. */
	readonly stackCount: number | null;
	/** Raw structure properties sampled together with the selected name and quantity. */
	readonly structure: ItemStructure;
	/** World eligibility plus the latest matching server health response. */
	readonly health: ClientSelectedHealth;
	/** Whether selected use is available under the current frontend diagnostic policy. */
	readonly canInteract: boolean;
}

/** Initial/pending HUD display without a synthetic name or unknown-health meter. */
export const EMPTY_CLIENT_SELECTED_DISPLAY: ClientSelectedEntityDisplay = {
	name: null,
	nameColor: null,
	stackCount: null,
	structure: { current: null, max: null },
	health: { kind: "unavailable" },
	canInteract: false,
};

type TrackingLifecycle = Pick<
	ClientLifecycleSession,
	"state" | "subscribe" | "queryEntityHealth" | "entities"
>;
type TrackingSelection = Pick<
	ClientEntitySelection,
	"selectedGuid" | "subscribe"
>;

/** Session-owned selected display and health subscription; use execution belongs to ClientItemInteractions. */
export class ClientSelectedEntityTracking {
	readonly #lifecycle: TrackingLifecycle;
	readonly #selection: TrackingSelection;
	readonly #unsubscribeSelection: () => void;
	readonly #unsubscribeLifecycle: () => void;
	readonly #onFailure: (error: unknown) => void;
	#target: {
		readonly guid: number;
		readonly healthFraction: number | null;
	} | null = null;
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
				event.type === "entity-health" &&
				this.#target?.guid === event.health.guid
			) {
				this.#target = {
					guid: event.health.guid,
					healthFraction: event.health.healthFraction,
				};
			} else if (
				event.type === "entities" ||
				event.type === "current-state" ||
				event.type === "lifecycle" ||
				event.type === "resyncing"
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
		const fraction =
			this.#target?.guid === guid ? this.#target.healthFraction : null;
		return {
			name: record.description.name,
			nameColor: selectedEntityNameColor(
				record.description,
				guid === read.level.playerGuid,
			),
			stackCount: record.description.stackCount,
			structure: record.description.structure,
			canInteract:
				(record.description.useCapability === "direct" ||
					record.description.useCapability === "targeted" ||
					(unrestrictedUse &&
						record.description.useCapability === "unsupported")) &&
				this.#lifecycle.state().lifecycle?.kind === "in-world",
			health:
				record.description.healthQuery === "ineligible"
					? { kind: "not-applicable" }
					: fraction === null
						? { kind: "awaiting-response" }
						: { kind: "known", fraction },
		};
	}

	/** Cancel once while transport is still alive, then retire both listeners. */
	destroy(): void {
		if (this.#destroyed) return;
		this.#replaceTarget(null);
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
		const eligible =
			this.#lifecycle.state().lifecycle?.kind === "in-world" &&
			record?.description.kind === "known" &&
			record.description.healthQuery === "eligible";
		this.#replaceTarget(eligible ? guid : null);
	}

	#replaceTarget(guid: number | null): void {
		if (guid === (this.#target?.guid ?? null)) return;
		this.#target = guid === null ? null : { guid, healthFraction: null };
		const phase = this.#lifecycle.state().lifecycle?.kind;
		if (phase === "in-world" || (phase === "portal-space" && guid === null)) {
			void this.#lifecycle.queryEntityHealth(guid).catch(this.#onFailure);
		}
	}
}
