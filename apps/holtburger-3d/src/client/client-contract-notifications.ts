import type { ContractMembershipChange } from "./client-contracts-contract";
import type { ClientToastScheduler } from "./client-toast-center";
import type { ClientLifecycleSessionEvent } from "./client-lifecycle-session";

/** App-owned wording and burst summaries; membership classification arrives from world/core. */
export class ClientContractNotifications {
	readonly #publish: (message: string) => void;
	readonly #scheduler: ClientToastScheduler;
	readonly #batchMs: number;
	/** A scheduled batch always owns at least one accepted activity. */
	#batch: {
		readonly changes: [ContractMembershipChange, ...ContractMembershipChange[]];
		readonly timer: number;
	} | null = null;

	constructor(options: {
		readonly publish: (message: string) => void;
		readonly scheduler: ClientToastScheduler;
		readonly batchMs: number;
	}) {
		if (!Number.isFinite(options.batchMs) || options.batchMs <= 0)
			throw new Error(
				"Contract notification batch duration must be finite and positive.",
			);
		this.#publish = options.publish;
		this.#scheduler = options.scheduler;
		this.#batchMs = options.batchMs;
	}

	/** Lifecycle delivery owns presentation cancellation; neither panel participates. */
	receive(event: ClientLifecycleSessionEvent): void {
		switch (event.type) {
			case "contract-membership-change":
				this.accept(event.change);
				break;
			case "current-state":
			case "resyncing":
			case "local-player-established":
				this.reset();
				break;
			case "lifecycle":
				if (
					event.lifecycle.kind !== "in-world" &&
					(event.lifecycle.kind !== "portal-space" ||
						event.lifecycle.cause === "initial-entry")
				)
					this.reset();
				break;
		}
	}

	/** Fixed window from the first activity; later arrivals do not postpone delivery. */
	accept(change: ContractMembershipChange): void {
		if (this.#batch !== null) {
			this.#batch.changes.push(change);
			return;
		}
		const changes: [ContractMembershipChange, ...ContractMembershipChange[]] = [
			change,
		];
		const timer = this.#scheduler.schedule(() => {
			this.#batch = null;
			const first = changes[0];
			if (changes.length === 1) {
				const name = first.name ?? `Contract #${first.id}`;
				this.#publish(
					`${first.kind === "added" ? "Added to journal" : "Removed from journal"}: ${name}`,
				);
				return;
			}
			const added = changes.filter((entry) => entry.kind === "added").length;
			const removed = changes.length - added;
			this.#publish(
				added === 0
					? `${removed} contracts removed from journal`
					: removed === 0
						? `${added} contracts added to journal`
						: `Journal updated: ${added} added, ${removed} removed`,
			);
		}, this.#batchMs);
		this.#batch = { changes, timer };
	}

	/** Recovery, character retirement, and disposal discard undelivered presentation only. */
	reset(): void {
		if (this.#batch !== null) this.#scheduler.cancel(this.#batch.timer);
		this.#batch = null;
	}
}
