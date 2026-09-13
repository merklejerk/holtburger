import type { ClientInventoryState } from "./client-inventory-state";
import { nextInventoryPreviewSequence } from "./client-inventory-contract";

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
	readonly #abort = new AbortController();
	readonly #unsubscribe: () => void;
	#interaction: SplitInteraction | null = null;

	constructor(
		readonly root: HTMLElement,
		readonly inventory: ClientInventoryState,
		readonly onChange: (request: InventorySplitRequest | null) => void,
	) {
		root.addEventListener("contextmenu", this.#context, {
			signal: this.#abort.signal,
		});
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
				this.close();
		});
	}

	#context = (event: MouseEvent): void => {
		event.preventDefault();
		if (
			this.#interaction?.kind === "editing" ||
			this.inventory.read().pending ||
			this.root.dataset.inventoryDragging === "true"
		)
			return;
		this.#interaction = null;
		const cell =
			event.target instanceof Element
				? event.target.closest<HTMLElement>(
						".item-grid-cell[data-item-guid]:not(:disabled)",
					)
				: null;
		if (cell === null || !this.root.contains(cell)) return;
		const view = this.inventory.read();
		const guid = Number(cell.dataset.itemGuid);
		const item = [
			...view.sections.flatMap((section) => section.items),
			...view.equipment.rows.flatMap((row) =>
				row.item === null ? [] : [row.item],
			),
		].find((item) => item.guid === guid);
		if (
			item?.description.kind !== "known" ||
			item.description.stackCount === null ||
			item.description.stackCount <= 1
		)
			return;
		const sequence = nextInventoryPreviewSequence();
		this.#interaction = {
			kind: "checking",
			sequence,
			item: guid,
			name: item.description.name,
			source: cell,
		};
		void this.inventory.interactions
			.previewInventory({
				sequence,
				intent: { item: guid, target: { kind: "split", amount: 1 } },
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
	};

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
		const interaction = this.#interaction;
		this.#interaction = null;
		if (interaction?.kind !== "editing") return;
		delete this.root.dataset.inventoryModal;
		this.onChange(null);
		// Wait for Svelte to remove inert before restoring the dialog's source focus.
		queueMicrotask(() => {
			if (this.#interaction === null && interaction.source.isConnected)
				interaction.source.focus();
		});
	}

	destroy(): void {
		this.close();
		this.#abort.abort();
		this.#unsubscribe();
	}
}
