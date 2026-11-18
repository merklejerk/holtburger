import { completePresentationOperations } from "./presentation-teardown";
import type { EnvCellId } from "../game-types";
import type { StaticLayerCompanionPublication } from "./static-layer-realizer";

/** Active and pending authored object groups in one published EnvCell layer. */
export class EnvCellBehaviors<TSource> {
	readonly #wanted = new Map<EnvCellId, { committed: boolean }>();

	constructor(
		private readonly cells: ReadonlyMap<EnvCellId, TSource>,
		private readonly prepare: (
			cell: EnvCellId,
			source: TSource,
		) => Promise<StaticLayerCompanionPublication>,
		private readonly retire: (cell: EnvCellId) => void,
	) {}

	/** Preserve overlapping cells' animation and script clocks across a crossing. */
	async reconcile(includes: (cell: EnvCellId) => boolean): Promise<void> {
		const pending: Promise<void>[] = [];
		for (const [cell, source] of this.cells) {
			const activation = this.#wanted.get(cell);
			if (includes(cell)) {
				if (!activation) pending.push(this.#enter(cell, source));
			} else if (activation) {
				this.#wanted.delete(cell);
				if (activation.committed) pending.push(this.#retire(cell));
			}
		}
		const failures = (await Promise.allSettled(pending)).filter(
			(result) => result.status === "rejected",
		);
		if (failures.length)
			throw new AggregateError(
				failures.map((result) => result.reason),
				"Interior object activation failed.",
			);
	}

	/** Isolate each retirement so a failed release cannot skip the remaining cells. */
	async #retire(cell: EnvCellId): Promise<void> {
		this.retire(cell);
	}

	async #enter(cell: EnvCellId, source: TSource): Promise<void> {
		const activation = { committed: false };
		this.#wanted.set(cell, activation);
		let stage: StaticLayerCompanionPublication;
		try {
			stage = await this.prepare(cell, source);
		} catch (error) {
			if (this.#wanted.get(cell) !== activation) return;
			this.#wanted.delete(cell);
			throw error;
		}
		// A cell can leave and re-enter while its old assets are preparing.
		if (this.#wanted.get(cell) !== activation) {
			stage.release();
			return;
		}
		try {
			stage.commit();
			activation.committed = true;
		} catch (error) {
			this.#wanted.delete(cell);
			// A commit spans animation, scripts, and scene nodes. Retire partial publication too.
			completePresentationOperations([
				() => {
					throw error;
				},
				() => stage.release(),
				() => this.retire(cell),
			]);
		}
	}
}
