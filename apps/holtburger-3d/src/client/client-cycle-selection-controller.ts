import type { ClientEntitySelection } from "./client-entity-selection";
import {
	rankCycleCandidates,
	type CycleCandidate,
	type CycleFilter,
	type RankedCycleCandidates,
} from "./client-target-acquisition";

/**
 * Input-owned traversal history over app-local target acquisition.
 *
 * Geometry, semantic admission, ordering, and immediate resolution live in
 * `client-target-acquisition`; this controller retains only the cursor and last-consumed
 * Smart Tab winner, whose lifetimes follow input acquisitions rather than presentation.
 */
export class ClientCycleSelectionController {
	readonly #selection: ClientEntitySelection;
	readonly #sample: () => readonly CycleCandidate[] | null;
	readonly #unsubscribe: () => void;
	/** Last acquisition winner, shared by all binding filters. */
	#cursor: number | null = null;
	/**
	 * Smart Tab immediate consumed by the last Smart acquisition; a changed winner takes priority
	 * over traversal. Passive previews never write this history.
	 */
	#lastConsumedSmartImmediate: number | null = null;
	#destroyed = false;

	constructor(options: {
		readonly selection: ClientEntitySelection;
		readonly sample: () => readonly CycleCandidate[] | null;
	}) {
		this.#selection = options.selection;
		this.#sample = options.sample;
		this.#unsubscribe = options.selection.subscribeExternalIntent(() =>
			this.#reset(),
		);
	}

	cycle(filter: CycleFilter, direction: 1 | -1): void {
		if (this.#destroyed) return;
		const intent = this.#selection.beginAcquisition("cycle");
		const sampled = this.#candidates(filter);
		if (sampled === null) return;
		const { immediate, matching } = sampled;
		const changedImmediate =
			filter === "smart-combat" &&
			immediate !== undefined &&
			immediate.guid !== this.#lastConsumedSmartImmediate;
		if (filter === "smart-combat")
			this.#lastConsumedSmartImmediate = immediate?.guid ?? null;
		if (matching.length === 0) return;
		const selected = this.#selection.selectedGuid();
		const cursorIndex = matching.findIndex(
			(candidate) => candidate.guid === this.#cursor,
		);
		let start = direction === 1 ? -1 : 0;
		if (cursorIndex >= 0) start = cursorIndex;
		if (immediate !== undefined && (cursorIndex < 0 || changedImmediate)) {
			// The immediate leads the ring; traversal skips it if already selected.
			start = -direction;
		}
		for (let step = 1; step <= matching.length; step++) {
			const index =
				(((start + direction * step) % matching.length) + matching.length) %
				matching.length;
			const candidate = matching[index];
			if (candidate === undefined)
				throw new Error("Cycle index must name an eligible target.");
			if (candidate.guid !== selected || matching.length === 1) {
				this.#cursor = candidate.guid;
				this.#selection.commitAcquisition(intent, candidate.guid);
				return;
			}
		}
	}

	/** Hold reacquires the nearest target allowed by the filter and seeds subsequent traversal. */
	selectImmediate(filter: CycleFilter): void {
		if (this.#destroyed) return;
		const intent = this.#selection.beginAcquisition("external");
		const sampled = this.#candidates(filter);
		if (sampled === null) return;
		const { immediate } = sampled;
		if (filter === "smart-combat")
			this.#lastConsumedSmartImmediate = immediate?.guid ?? null;
		if (immediate === undefined) return;
		this.#cursor = immediate.guid;
		this.#selection.commitAcquisition(intent, immediate.guid);
	}

	destroy(): void {
		this.#destroyed = true;
		this.#reset();
		this.#unsubscribe();
	}

	#candidates(filter: CycleFilter): RankedCycleCandidates | null {
		const candidates = this.#sample();
		if (candidates === null) {
			this.#reset();
			return null;
		}
		return rankCycleCandidates(candidates, filter);
	}

	#reset(): void {
		this.#cursor = null;
		this.#lastConsumedSmartImmediate = null;
	}
}
