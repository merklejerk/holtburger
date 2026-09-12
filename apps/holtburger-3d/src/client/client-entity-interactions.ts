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
	/** Current stack quantity, absent when the selected description has none. */
	readonly stackCount: number | null;
	/** Raw structure properties sampled together with the selected name and quantity. */
	readonly structure: ItemStructure;
	/** World eligibility plus the latest matching server health response. */
	readonly health: ClientSelectedHealth;
	/** First-cut use remains available for known non-owned targets only. */
	readonly canInteract: boolean;
}

/** Initial/pending HUD display without a synthetic name or unknown-health meter. */
export const EMPTY_CLIENT_SELECTED_DISPLAY: ClientSelectedEntityDisplay = {
	name: null,
	stackCount: null,
	structure: { current: null, max: null },
	health: { kind: "unavailable" },
	canInteract: false,
};

type InteractionLifecycle = Pick<
	ClientLifecycleSession,
	"state" | "subscribe" | "queryEntityHealth" | "useEntity" | "entities"
>;
type InteractionSelection = Pick<
	ClientEntitySelection,
	"selectedGuid" | "subscribe"
>;

/** Existing session-owned interaction controller; selection and network target are different facts. */
export class ClientEntityInteractions {
	readonly #lifecycle: InteractionLifecycle;
	readonly #selection: InteractionSelection;
	readonly #unsubscribeSelection: () => void;
	readonly #unsubscribeLifecycle: () => void;
	readonly #onFailure: (error: unknown) => void;
	#target: {
		readonly guid: number;
		readonly healthFraction: number | null;
	} | null = null;
	#destroyed = false;

	constructor(options: {
		readonly selection: InteractionSelection;
		readonly lifecycle: InteractionLifecycle;
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
	display(): ClientSelectedEntityDisplay {
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
			stackCount: record.description.stackCount,
			structure: record.description.structure,
			canInteract:
				!record.ownedByPlayer &&
				this.#lifecycle.state().lifecycle?.kind === "in-world",
			health:
				record.description.healthQuery === "ineligible"
					? { kind: "not-applicable" }
					: fraction === null
						? { kind: "awaiting-response" }
						: { kind: "known", fraction },
		};
	}

	/** Use reads selected identity, independently of whether it supports creature health. */
	interact(unrestricted: boolean): void {
		const guid = this.#selection.selectedGuid();
		if (this.#destroyed || guid === null || !this.display().canInteract) return;
		void this.#lifecycle.useEntity(guid, unrestricted).catch(this.#onFailure);
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
