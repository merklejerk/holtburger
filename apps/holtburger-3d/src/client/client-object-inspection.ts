import type {
	ObjectInspection,
	ObjectInspectionResult,
} from "./client-object-inspection-contract";
import type {
	ClientLifecycleSession,
	ClientLifecycleSessionEvent,
} from "./client-lifecycle-session";

/** Latest-target presentation retained independently of mutable selection and entity mirrors. */
export type ClientObjectInspectionState =
	| { readonly kind: "idle" }
	| { readonly kind: "pending"; readonly guid: number }
	| {
			readonly kind: "ready";
			readonly guid: number;
			readonly inspection: ObjectInspection;
	  };

/**
 * Owns the one-request/one-window inspection lifetime for a client session.
 *
 * The protocol echoes only a GUID, so a currently requested GUID is the complete correlation key.
 * Selection and entity residency intentionally do not participate in this state machine.
 */
export class ClientObjectInspection {
	readonly #session: Pick<
		ClientLifecycleSession,
		"examineEntity" | "subscribe" | "state"
	>;
	readonly #reportFailure: (message: string) => void;
	readonly #listeners = new Set<(state: ClientObjectInspectionState) => void>();
	readonly #unsubscribe: () => void;
	#state: ClientObjectInspectionState = { kind: "idle" };
	#playerGuid: number | null;
	#destroyed = false;

	constructor(
		session: Pick<
			ClientLifecycleSession,
			"examineEntity" | "subscribe" | "state"
		>,
		reportFailure: (message: string) => void,
	) {
		this.#session = session;
		this.#reportFailure = reportFailure;
		this.#playerGuid = session.state().playerGuid;
		this.#unsubscribe = session.subscribe((event) => this.#receive(event));
	}

	read(): ClientObjectInspectionState {
		return this.#state;
	}

	subscribe(
		listener: (state: ClientObjectInspectionState) => void,
	): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Close any open result, suppress duplicate pending requests, and capture this exact GUID. */
	async examine(guid: number): Promise<void> {
		if (this.#destroyed) throw new Error("Object inspection is unavailable.");
		if (this.#state.kind === "pending" && this.#state.guid === guid) return;
		this.#replace({ kind: "pending", guid });
		try {
			await this.#session.examineEntity(guid);
		} catch (error) {
			if (this.#state.kind !== "pending" || this.#state.guid !== guid) return;
			this.#replace({ kind: "idle" });
			this.#reportFailure(failureText(error));
		}
	}

	/** Close presentation only; no server command and no selection mutation occurs. */
	close(): void {
		this.#replace({ kind: "idle" });
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#unsubscribe();
		this.#replace({ kind: "idle" });
		this.#listeners.clear();
	}

	#receive(event: ClientLifecycleSessionEvent): void {
		switch (event.type) {
			case "object-inspection-result":
				this.#accept(event.result);
				return;
			case "resyncing":
				this.close();
				return;
			case "current-state": {
				const replacementPlayer = event.state.localPlayerGuid;
				if (
					event.state.lifecycle.kind !== "in-world" ||
					(this.#playerGuid !== null && replacementPlayer !== this.#playerGuid)
				)
					this.close();
				this.#playerGuid = replacementPlayer;
				return;
			}
			case "lifecycle":
				if (event.lifecycle.kind !== "in-world") this.close();
				return;
			case "exit-requested":
				this.close();
				return;
			default:
				return;
		}
	}

	#accept(result: ObjectInspectionResult): void {
		if (this.#state.kind !== "pending" || result.guid !== this.#state.guid)
			return;
		const guid = this.#state.guid;
		switch (result.outcome.kind) {
			case "ready":
				if (result.outcome.inspection.guid !== guid) {
					this.#replace({ kind: "idle" });
					this.#reportFailure(
						"The examination response had mismatched identities.",
					);
					return;
				}
				this.#replace({
					kind: "ready",
					guid,
					inspection: result.outcome.inspection,
				});
				return;
			case "rejected":
				this.#replace({ kind: "idle" });
				this.#reportFailure("You could not examine that object.");
				return;
			case "missing":
				this.#replace({ kind: "idle" });
				this.#reportFailure("That object is no longer available.");
		}
	}

	#replace(state: ClientObjectInspectionState): void {
		if (this.#state.kind === "idle" && state.kind === "idle") return;
		this.#state = state;
		for (const listener of this.#listeners) listener(state);
	}
}

function failureText(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0)
		return error.message;
	if (typeof error === "string" && error.trim().length > 0) return error;
	return "The examination request could not be sent.";
}
