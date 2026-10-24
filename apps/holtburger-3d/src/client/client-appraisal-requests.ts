import type { ObjectInspectionResult } from "./client-object-inspection-contract";
import type { ClientLifecycleSessionEvent } from "./client-lifecycle-session";

/** One consumer's interest in shared appraisal work; cancellation never cancels another consumer. */
export interface AppraisalRequest {
	/** Transport acceptance or pre-dispatch cancellation; completion arrives through the callback. */
	readonly sent: Promise<void>;
	/** Retire this consumer without discarding an outstanding wire reply. */
	cancel(): void;
}

/** An identify response carries only a GUID, so all consumers share one in-flight request per GUID. */
interface PendingAppraisal {
	readonly sent: Promise<void>;
	readonly consumers: Set<(result: ObjectInspectionResult) => void>;
}

/** Session-local request routing, independent of inspector visibility or automatic consumer policy. */
export class ClientAppraisalRequests {
	readonly #send: (guid: number) => Promise<void>;
	readonly #pending = new Map<number, PendingAppraisal>();
	#playerGuid: number | null = null;

	constructor(send: (guid: number) => Promise<void>) {
		this.#send = send;
	}

	/** Subscribe before dispatch; callers handle send failures and cancel when their purpose ends. */
	request(
		guid: number,
		receive: (result: ObjectInspectionResult) => void,
	): AppraisalRequest {
		let pending = this.#pending.get(guid);
		if (pending === undefined) {
			// Deferral registers every same-turn consumer before a transport can publish a reply.
			const sent = Promise.resolve().then(() => {
				if (this.#pending.get(guid) !== current) return;
				if (current.consumers.size === 0) {
					this.#pending.delete(guid);
					return;
				}
				return this.#send(guid);
			});
			pending = { sent, consumers: new Set() };
			this.#pending.set(guid, pending);
			const current = pending;
			void sent.catch(() => {
				if (this.#pending.get(guid) === current) this.#pending.delete(guid);
				current.consumers.clear();
			});
		}
		const current = pending;
		// Each call owns a distinct subscription even if callers supply the same function.
		const consumer = (result: ObjectInspectionResult) => receive(result);
		current.consumers.add(consumer);
		return {
			sent: current.sent,
			cancel: () => {
				current.consumers.delete(consumer);
				// Keep the wire request until its reply: a later subscriber must join it rather
				// than send an indistinguishable second request whose stale reply could win.
			},
		};
	}

	/** Session routing delivers facts before presentation listeners observe the same event. */
	receive(event: ClientLifecycleSessionEvent): void {
		switch (event.type) {
			case "object-inspection-result": {
				const pending = this.#pending.get(event.result.guid);
				if (pending === undefined) return;
				this.#pending.delete(event.result.guid);
				for (const consumer of pending.consumers) consumer(event.result);
				pending.consumers.clear();
				return;
			}
			case "current-state": {
				const player = event.state.localPlayerGuid;
				if (
					event.state.lifecycle.kind !== "in-world" ||
					(this.#playerGuid !== null && player !== this.#playerGuid)
				)
					this.#reset();
				this.#playerGuid = player;
				return;
			}
			case "lifecycle":
				if (event.lifecycle.kind !== "in-world") this.#reset();
				return;
			case "resyncing":
			case "exit-requested":
				this.#reset();
		}
	}

	#reset(): void {
		for (const pending of this.#pending.values()) pending.consumers.clear();
		this.#pending.clear();
	}
}
