import type { ClientItemInteractions } from "./client-item-interactions";

/** One compatibility query is shared by every mounted cell depicting the same item. */
interface Candidate {
	/** Current cells depicting this target; authority replies repaint only this group. */
	readonly cells: Set<HTMLElement>;
	/** Pending authority leaves physical targets at their ordinary opacity. */
	eligible: boolean | null;
	/** Retire the query when its last cell disappears or acquisition ends. */
	readonly stop: () => void;
}

/** App-local projection of authoritative combine eligibility onto mounted item/action cells. */
export class ClientCombineCells {
	readonly #candidates = new Map<number, Candidate>();
	readonly #observer: MutationObserver;
	readonly #unsubscribe: () => void;
	#generation: number | null = null;

	constructor(
		private readonly root: HTMLElement,
		private readonly interactions: ClientItemInteractions,
	) {
		this.#observer = new MutationObserver(() => this.#refresh());
		this.#observer.observe(root, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ["data-item-guid", "data-action-item"],
		});
		this.#unsubscribe = interactions.subscribe(() => this.#refresh());
		this.#refresh();
	}

	destroy(): void {
		this.#observer.disconnect();
		this.#unsubscribe();
		this.#clear();
	}

	#clear(): void {
		for (const candidate of this.#candidates.values()) candidate.stop();
		this.#candidates.clear();
		for (const cell of this.root.querySelectorAll<HTMLElement>(
			"[data-combine-dimmed]",
		))
			delete cell.dataset.combineDimmed;
	}

	#refresh(): void {
		const state = this.interactions.snapshot();
		const generation = state.kind === "acquiring" ? state.generation : null;
		if (generation !== this.#generation) {
			this.#clear();
			this.#generation = generation;
		}
		if (generation === null) return;
		const cells = this.root.querySelectorAll<HTMLElement>(
			".item-grid-cell, .action-cell",
		);
		const targets = new Set<number>();
		for (const candidate of this.#candidates.values()) candidate.cells.clear();
		for (const cell of cells) {
			const encoded = cell.dataset.itemGuid ?? cell.dataset.actionItem;
			if (encoded === undefined) {
				cell.dataset.combineDimmed = "true";
				continue;
			}
			const target = Number(encoded);
			targets.add(target);
			let candidate = this.#candidates.get(target);
			if (candidate === undefined) {
				candidate = {
					cells: new Set(),
					eligible: null,
					stop: this.interactions.observeTarget(target, (eligible) => {
						const current = this.#candidates.get(target);
						if (current === undefined)
							throw new Error("Combine target observation outlived its cell.");
						current.eligible = eligible;
						for (const cell of current.cells)
							cell.dataset.combineDimmed = String(eligible === false);
					}),
				};
				this.#candidates.set(target, candidate);
			}
			candidate.cells.add(cell);
			cell.dataset.combineDimmed = String(candidate.eligible === false);
		}
		for (const [target, candidate] of this.#candidates) {
			if (!targets.has(target)) {
				candidate.stop();
				this.#candidates.delete(target);
			}
		}
	}
}
