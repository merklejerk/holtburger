import type { ClientInventoryState } from "./client-inventory-state";
import { nextInventoryPreviewSequence } from "./client-inventory-contract";
import type { ClientEntityFacts } from "./client-entity-mirror";

type SplittableInventoryItem = ClientEntityFacts & {
	readonly description: Extract<
		ClientEntityFacts["description"],
		{ readonly kind: "known" }
	>;
};

/** A stack is locally eligible when the mounted inventory can resolve more than one item. */
export function isSplittableInventoryItem(
	item: ClientEntityFacts | undefined,
): item is SplittableInventoryItem {
	return (
		item?.description.kind === "known" &&
		item.description.stackCount !== null &&
		item.description.stackCount > 1
	);
}

/** One explicit request handed from another HUD surface to the mounted inventory panel. */
export interface InventorySplitStart {
	/** Selected owned stack identity. */
	readonly item: number;
	/** Focus target restored after the inventory-owned modal closes. */
	readonly source: HTMLElement;
}

/** Preflighted dialog bounds; submission still re-evaluates current inventory facts. */
export interface InventorySplitRequest {
	/** Source identity, retained while the amount is edited. */
	readonly item: number;
	/** Accessible item name for the dialog. */
	readonly name: string;
	/** Current total quantity; submitting the whole stack is a core-owned no-op. */
	readonly maxAmount: number;
}

/** The source focus handle belongs to an open dialog, not to a completed request. */
type SplitInteraction =
	| {
			readonly kind: "checking";
			readonly sequence: number;
			readonly item: number;
			readonly name: string;
			readonly source: HTMLElement;
	  }
	| {
			readonly kind: "editing";
			readonly request: InventorySplitRequest;
			readonly source: HTMLElement;
	  };

/** Panel-owned split interaction; core owns destination allocation and execution. */
export class ClientInventorySplit {
	readonly #unsubscribe: () => void;
	#interaction: SplitInteraction | null = null;

	constructor(
		readonly root: HTMLElement,
		readonly inventory: ClientInventoryState,
		readonly onChange: (request: InventorySplitRequest | null) => void,
	) {
		this.#unsubscribe = inventory.interactions.subscribe((event) => {
			const interaction = this.#interaction;
			if (
				event.type === "inventory-preview" &&
				interaction?.kind === "checking" &&
				event.result.sequence === interaction.sequence
			) {
				this.#interaction = null;
				if (event.result.preview.kind === "split") {
					const request = {
						item: interaction.item,
						name: interaction.name,
						maxAmount: event.result.preview.max_amount,
					};
					this.#interaction = {
						kind: "editing",
						request,
						source: interaction.source,
					};
					root.dataset.inventoryModal = "true";
					onChange(request);
				} else if (event.result.preview.kind === "rejected") {
					inventory.reportFailure(event.result.preview.reason);
				} else if (event.result.preview.kind !== "noop") {
					inventory.reportFailure(
						`Unexpected split preview: ${event.result.preview.kind}`,
					);
				}
			} else if (
				event.type === "resyncing" ||
				event.type === "exit-requested" ||
				(event.type === "lifecycle" && event.lifecycle.kind !== "in-world")
			)
				this.#cancel();
		});
	}

	/** Preflight a known stack and report whether this gesture started a request. */
	begin(itemGuid: number, source: HTMLElement): boolean {
		if (
			this.#interaction?.kind === "editing" ||
			this.root.dataset.inventoryDragging === "true"
		)
			return false;
		this.#interaction = null;
		const item = this.inventory.readItem(itemGuid);
		if (!isSplittableInventoryItem(item)) return false;
		const sequence = nextInventoryPreviewSequence();
		this.#interaction = {
			kind: "checking",
			sequence,
			item: itemGuid,
			name: item.description.name,
			source,
		};
		void this.inventory.interactions
			.previewInventory({
				sequence,
				intent: { item: itemGuid, target: { kind: "split", amount: 1 } },
			})
			.catch((error: unknown) => {
				if (
					this.#interaction?.kind !== "checking" ||
					this.#interaction.sequence !== sequence
				)
					return;
				this.close();
				this.inventory.reportFailure(
					`Inventory request failed: ${String(error)}`,
				);
			});
		return true;
	}

	/** Retire preflight or editing state when selection no longer names its source stack. */
	cancelForSelection(selectedGuid: number | null): void {
		const interaction = this.#interaction;
		if (interaction === null) return;
		const item =
			interaction.kind === "checking"
				? interaction.item
				: interaction.request.item;
		if (item !== selectedGuid) this.#cancel();
	}

	submit(amount: number): void {
		const interaction = this.#interaction;
		if (interaction?.kind !== "editing") return;
		const { request } = interaction;
		if (!Number.isInteger(amount) || amount < 1 || amount > request.maxAmount)
			return;
		this.close();
		void this.inventory.interactions
			.submitInventory({
				item: request.item,
				target: { kind: "split", amount },
			})
			.catch((error: unknown) =>
				this.inventory.reportFailure(
					`Inventory request failed: ${String(error)}`,
				),
			);
	}

	close(): void {
		this.#retire(true);
	}

	/** Lifecycle cancellation must not reclaim focus from the replacement interaction. */
	#cancel(): void {
		this.#retire(false);
	}

	#retire(restoreFocus: boolean): void {
		const interaction = this.#interaction;
		this.#interaction = null;
		if (interaction?.kind !== "editing") return;
		delete this.root.dataset.inventoryModal;
		this.onChange(null);
		if (!restoreFocus) return;
		// Wait for Svelte to remove inert before restoring the dialog's source focus.
		queueMicrotask(() => {
			if (this.#interaction === null && interaction.source.isConnected)
				interaction.source.focus();
		});
	}

	destroy(): void {
		this.#cancel();
		this.#unsubscribe();
	}
}
