import { ClientConfirmationSuppression } from "./client-confirmation-suppression";
import type { AppraisalRequest } from "./client-appraisal-requests";
import { nextInventoryPreviewSequence } from "./client-inventory-contract";
import type { ClientLifecycle } from "./client-host-contract";
import type {
	LocalConfirmationRequest,
	LocalDialogSource,
} from "./client-dialogs";
import type {
	ClientLifecycleSession,
	ClientLifecycleSessionEvent,
} from "./client-lifecycle-session";
import type {
	SalvageEvaluation,
	SalvagePreviewRequest,
	SalvageReview,
	SalvageSubmitRequest,
} from "./client-salvage-contract";

/** Accepted frontend draft; failed proposals never replace this value. */
interface Draft {
	readonly tool: number;
	readonly items: readonly number[];
	readonly evaluation: SalvageEvaluation;
}
/** The dialog and submission each retain their exact reviewed draft. */
type State =
	| { readonly kind: "closed" }
	| { readonly kind: "editing"; readonly draft: Draft }
	| {
			readonly kind: "confirming";
			readonly draft: Draft;
			readonly review: SalvageReview;
			readonly question: LocalConfirmationRequest;
	  }
	| {
			readonly kind: "submitting";
			readonly draft: Draft;
			readonly request: SalvageSubmitRequest;
	  };
type Action =
	| { readonly kind: "tool"; readonly tool: number }
	| { readonly kind: "add" | "remove"; readonly item: number }
	| { readonly kind: "clear" | "refresh" };
interface PendingPreview {
	readonly sequence: number;
	readonly action: Action;
	readonly items: readonly number[];
	readonly dependencies: string;
}
/** Narrow semantic session surface; synthetic tests need no renderer or transport socket. */
export interface SalvageSession extends Pick<
	ClientLifecycleSession,
	"entities" | "subscribe" | "previewSalvage" | "submitSalvage" | "appraisals"
> {
	state(): { readonly lifecycle: ClientLifecycle | null };
}
/** One attempt per pending source; successful responses trigger a fresh authoritative preview. */
type AppraisalProgress =
	| { readonly kind: "loading"; readonly request: AppraisalRequest }
	| { readonly kind: "received" }
	| { readonly kind: "failed"; readonly reason: string };

/** Bounded window display, separate from the session's producer-rate entity payloads. */
export interface SalvageView {
	readonly items: readonly number[];
	readonly evaluation: SalvageEvaluation;
	readonly pending: boolean;
	readonly locked: boolean;
	readonly problem: string | null;
	readonly canSalvage: boolean;
	/** Item-specific failures displayed beside Retry; automatic appraisal never opens inspection. */
	readonly appraisalFailures: readonly {
		readonly guid: number;
		readonly reason: string;
	}[];
}
/** Session-owned local draft and confirmation policy over shared Rust evaluation. */
export class ClientSalvageState implements LocalDialogSource {
	readonly #session: SalvageSession;
	readonly #notice: (message: string) => void;
	readonly #showInventory: () => void;
	readonly #unsubscribe: () => void;
	readonly #listeners = new Set<() => void>();
	#state: State = { kind: "closed" };
	#focusRevision = 0;
	readonly #confirmation = new ClientConfirmationSuppression();
	#pending: PendingPreview | null = null;
	#actions: Action[] = [];
	readonly #appraisals = new Map<number, AppraisalProgress>();
	#dependencies = "";
	#problem: string | null = null;
	#destroyed = false;

	constructor(
		session: SalvageSession,
		notice: (message: string) => void,
		showInventory: () => void,
	) {
		this.#session = session;
		this.#notice = notice;
		this.#showInventory = showInventory;
		this.#unsubscribe = session.subscribe((event) => this.#receive(event));
	}
	get visible(): boolean {
		return this.#state.kind !== "closed";
	}
	get focusRevision(): number {
		return this.#focusRevision;
	}
	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}
	question(): LocalConfirmationRequest | null {
		return this.#state.kind === "confirming" ? this.#state.question : null;
	}
	/** Selection is captured by the caller; lack of an Ust does not hide this action. */
	canQueue(item: number): boolean {
		const read = this.#session.entities.read();
		if (read.kind !== "current") return false;
		const candidate = read.level.entities.get(item)?.salvage;
		return candidate !== undefined && candidate.kind !== "ineligible";
	}

	/** Eligible duplicates are accepted as no-ops; membership does not make a source ineligible. */
	acceptsDrop(item: number): boolean {
		return this.#state.kind === "editing" && this.canQueue(item);
	}
	openTool(tool: number): void {
		this.#enqueue({ kind: "tool", tool });
	}
	add(item: number): void {
		this.#enqueue({ kind: "add", item });
	}
	/** Capture the accepted draft so a late drag cannot remove an entry from a replacement queue. */
	captureRemoval(item: number): (() => void) | null {
		this.#sync();
		const state = this.#state;
		if (state.kind !== "editing" || !state.draft.items.includes(item))
			return null;
		const draft = state.draft;
		return () => {
			this.#sync();
			if (this.#state.kind === "editing" && this.#state.draft === draft)
				this.remove(item);
		};
	}
	remove(item: number): void {
		this.#enqueue({ kind: "remove", item });
	}
	clear(): void {
		this.#enqueue({ kind: "clear" });
	}
	close(): void {
		this.#retireAppraisals([]);
		this.#pending = null;
		this.#actions = [];
		this.#state = { kind: "closed" };
		this.#dependencies = "";
		this.#problem = null;
		this.#notify();
	}
	destroy(): void {
		this.close();
		this.#destroyed = true;
		this.#unsubscribe();
		this.#listeners.clear();
	}
	/** Sampling compares only world-produced salvage dependencies, not the global entity revision. */
	read(): SalvageView | null {
		this.#sync();
		this.#pumpAppraisals();
		const state = this.#state;
		if (state.kind === "closed") return null;
		return {
			items: state.draft.items,
			evaluation: state.draft.evaluation,
			pending: this.#pending !== null || this.#actions.length > 0,
			locked: state.kind !== "editing",
			problem: this.#problem,
			appraisalFailures: [...this.#appraisals].flatMap(([guid, progress]) =>
				progress.kind === "failed" ? [{ guid, reason: progress.reason }] : [],
			),
			canSalvage:
				state.kind === "editing" &&
				this.#pending === null &&
				this.#actions.length === 0 &&
				state.draft.items.length > 0 &&
				state.draft.evaluation.kind === "ready",
		};
	}
	/** Failed items remain queued; retry only their missing appraisal work on explicit intent. */
	retryDetails(): void {
		this.#sync();
		if (this.#state.kind !== "editing") return;
		for (const [guid, progress] of this.#appraisals)
			if (progress.kind === "failed") this.#appraisals.delete(guid);
		this.#pumpAppraisals();
		this.#notify();
	}

	confirm(): void {
		const view = this.read();
		const state = this.#state;
		if (
			!view?.canSalvage ||
			state.kind !== "editing" ||
			state.draft.evaluation.kind !== "ready"
		)
			return;
		if (this.#confirmation.active) {
			this.#submit(state.draft, state.draft.evaluation.review);
			return;
		}
		this.#state = {
			kind: "confirming",
			draft: state.draft,
			review: state.draft.evaluation.review,
			question: {
				requestId: `salvage-${nextInventoryPreviewSequence()}`,
				text: `Destroy these ${state.draft.items.length} queued items to produce salvage? Entire stacks are included.`,
				acceptLabel: "Salvage",
				cancelLabel: "Cancel",
				suppressionLabel: "Suppress confirmation for the next hour",
			},
		};
		this.#notify();
	}
	respond(id: string, accepted: boolean, suppress?: boolean): void {
		this.#sync();
		const state = this.#state;
		if (state.kind !== "confirming" || state.question.requestId !== id) return;
		if (!accepted) {
			this.#state = { kind: "editing", draft: state.draft };
			this.#notify();
			return;
		}
		if (suppress === true) this.#confirmation.suppressForHour();
		this.#submit(state.draft, state.review);
	}
	#submit(draft: Draft, review: SalvageReview): void {
		const request = { sequence: nextInventoryPreviewSequence(), review };
		this.#state = { kind: "submitting", draft, request };
		this.#notify();
		void this.#session.submitSalvage(request).catch((error: unknown) => {
			if (
				this.#state.kind !== "submitting" ||
				this.#state.request.sequence !== request.sequence
			)
				return;
			this.#state = { kind: "editing", draft };
			this.#problem = String(error);
			this.#notice(String(error));
			this.#notify();
		});
	}
	#enqueue(action: Action): void {
		if (this.#destroyed) return;
		if (
			this.#state.kind === "confirming" ||
			this.#state.kind === "submitting"
		) {
			this.#notice("Finish or cancel the current salvage operation first.");
			return;
		}
		this.#actions.push(action);
		this.#drain();
	}
	#drain(): void {
		if (
			this.#pending !== null ||
			this.#destroyed ||
			this.#state.kind === "confirming" ||
			this.#state.kind === "submitting"
		)
			return;
		const action = this.#actions.shift();
		if (action === undefined) return;
		const read = this.#session.entities.read();
		if (
			read.kind !== "current" ||
			read.level.playerGuid === null ||
			this.#session.state().lifecycle?.kind !== "in-world"
		) {
			this.#notice("Salvaging requires current world information.");
			this.close();
			return;
		}
		const draft = this.#state.kind === "editing" ? this.#state.draft : null;
		let items = draft?.items ?? [];
		if (action.kind === "add") {
			if (items.includes(action.item)) {
				this.#raise();
				this.#drain();
				return;
			}
			if (!this.canQueue(action.item)) {
				const candidate = read.level.entities.get(action.item)?.salvage;
				this.#notice(
					candidate?.kind === "ineligible"
						? candidate.reason
						: "Item details are unavailable.",
				);
				this.#drain();
				return;
			}
			// RETAIL DIVERGENCE: acclient.c:241722 gmSalvageUI::IsItemSuitable gates mixed
			// materials on SalvageMultiple. We allow them so every queued material can be
			// reviewed together. Restoring the gate would reject valid batches: census found
			// one retail suitability gate and no option check in ACE HandleSalvaging.
			items = [...items, action.item];
		} else if (action.kind === "remove")
			items = items.filter((item) => item !== action.item);
		else if (action.kind === "clear") items = [];
		else if (action.kind === "refresh" && draft === null) {
			this.#drain();
			return;
		}
		let tool: SalvagePreviewRequest["tool"];
		if (action.kind === "tool") tool = { kind: "exact", guid: action.tool };
		else if (action.kind === "add")
			tool = { kind: "discover", preferred: draft?.tool ?? null };
		else {
			if (draft === null) {
				this.#drain();
				return;
			}
			tool = { kind: "exact", guid: draft.tool };
		}
		const request: SalvagePreviewRequest = {
			sequence: nextInventoryPreviewSequence(),
			player: read.level.playerGuid,
			tool,
			items: [...items],
		};
		const pending: PendingPreview = {
			sequence: request.sequence,
			action,
			items,
			dependencies: this.#dependencyKey(items),
		};
		this.#pending = pending;
		void this.#session.previewSalvage(request).catch((error: unknown) => {
			if (this.#pending !== pending) return;
			this.#pending = null;
			const reason = `Could not load the salvage estimate: ${String(error)}. Use your Ust to retry.`;
			if (pending.action.kind === "refresh" && this.#state.kind === "editing") {
				this.#state = {
					kind: "editing",
					draft: {
						...this.#state.draft,
						evaluation: { kind: "rejected", reason },
					},
				};
			} else this.#problem = reason;
			this.#notice(reason);
			this.#notify();
			this.#drain();
		});
	}
	#retireAppraisals(items: readonly number[]): void {
		for (const [guid, progress] of this.#appraisals) {
			if (items.includes(guid)) continue;
			if (progress.kind === "loading") progress.request.cancel();
			this.#appraisals.delete(guid);
		}
	}
	#reconcileAppraisals(evaluation: SalvageEvaluation): void {
		const pending =
			evaluation.kind === "pending-details" ? evaluation.items : [];
		this.#retireAppraisals(pending);
		for (const [guid, progress] of this.#appraisals) {
			if (progress.kind === "received")
				this.#appraisals.set(guid, {
					kind: "failed",
					reason:
						"The appraisal did not provide the details needed for salvage.",
				});
		}
	}
	#pumpAppraisals(): void {
		const state = this.#state;
		if (
			state.kind !== "editing" ||
			state.draft.evaluation.kind !== "pending-details" ||
			this.#pending !== null ||
			this.#actions.length > 0 ||
			[...this.#appraisals.values()].some(
				(progress) =>
					progress.kind === "loading" || progress.kind === "received",
			)
		)
			return;
		const guid = state.draft.evaluation.items.find(
			(item) => state.draft.items.includes(item) && !this.#appraisals.has(item),
		);
		if (guid === undefined) return;
		const request = this.#session.appraisals.request(guid, (result) => {
			const progress = this.#appraisals.get(guid);
			if (progress?.kind !== "loading" || progress.request !== request) return;
			if (result.outcome.kind === "ready") {
				this.#appraisals.set(guid, { kind: "received" });
				// Core has applied the appraisal; evaluate again rather than deriving yield or
				// depending on whether its entity delta arrived before the response callback.
				this.#enqueue({ kind: "refresh" });
			} else {
				const reason =
					result.outcome.kind === "rejected"
						? "The item could not be appraised."
						: result.outcome.kind === "missing"
							? "The item is no longer available."
							: `Appraisal unavailable: ${result.outcome.reason}`;
				this.#appraisals.set(guid, { kind: "failed", reason });
				this.#pumpAppraisals();
				this.#notify();
			}
		});
		this.#appraisals.set(guid, { kind: "loading", request });
		void request.sent.catch((error: unknown) => {
			const progress = this.#appraisals.get(guid);
			if (progress?.kind !== "loading" || progress.request !== request) return;
			this.#appraisals.set(guid, {
				kind: "failed",
				reason: `Could not request appraisal: ${String(error)}`,
			});
			this.#pumpAppraisals();
			this.#notify();
		});
	}

	#dependencyKey(items: readonly number[]): string {
		const read = this.#session.entities.read();
		if (read.kind !== "current") return "pending";
		return JSON.stringify([
			read.level.playerGuid,
			read.level.salvage,
			items.map((item) => read.level.entities.get(item)?.salvage ?? null),
		]);
	}
	#sync(): void {
		const state = this.#state;
		if (state.kind === "closed") return;
		const read = this.#session.entities.read();
		if (
			read.kind !== "current" ||
			this.#session.state().lifecycle?.kind !== "in-world"
		) {
			this.close();
			return;
		}
		if (read.level.entities.get(state.draft.tool)?.ownedByPlayer !== true) {
			this.#notice("The salvage tool is no longer available.");
			this.close();
			return;
		}
		if (state.kind === "submitting") return;
		const key = this.#dependencyKey(state.draft.items);
		if (key === this.#dependencies) return;
		this.#dependencies = key;
		const items = state.draft.items.filter((item) => this.canQueue(item));
		this.#retireAppraisals(items);
		if (items.length !== state.draft.items.length)
			this.#notice("Unavailable items were removed from the salvage queue.");
		this.#state = { kind: "editing", draft: { ...state.draft, items } };
		if (!this.#actions.some((action) => action.kind === "refresh"))
			this.#actions.push({ kind: "refresh" });
		this.#notify();
		this.#drain();
	}
	#receive(event: ClientLifecycleSessionEvent): void {
		this.#confirmation.receive(event);
		if (
			event.type === "resyncing" ||
			event.type === "current-state" ||
			(event.type === "lifecycle" && event.lifecycle.kind !== "in-world")
		) {
			this.close();
		} else if (event.type === "salvage-preview") {
			const pending = this.#pending;
			if (pending === null || pending.sequence !== event.result.sequence)
				return;
			this.#pending = null;
			if (pending.dependencies !== this.#dependencyKey(pending.items)) {
				this.#actions.unshift(pending.action);
				this.#drain();
				return;
			}
			const evaluation = event.result.evaluation;
			if (evaluation.kind === "rejected") {
				this.#notice(evaluation.reason);
				if (
					pending.action.kind === "refresh" &&
					this.#state.kind === "editing"
				) {
					this.#state = {
						kind: "editing",
						draft: { ...this.#state.draft, evaluation },
					};
					this.#problem = null;
				}
			} else {
				const tool =
					evaluation.kind === "ready"
						? evaluation.review.tool
						: evaluation.tool;
				this.#state = {
					kind: "editing",
					draft: { tool: tool.guid, items: pending.items, evaluation },
				};
				this.#reconcileAppraisals(evaluation);
				this.#dependencies = this.#dependencyKey(pending.items);
				this.#problem = null;
				if (pending.action.kind === "add" || pending.action.kind === "tool")
					this.#raise();
			}
			this.#notify();
			this.#drain();
			this.#pumpAppraisals();
		} else if (event.type === "salvage-result") {
			const state = this.#state;
			if (
				state.kind !== "submitting" ||
				state.request.sequence !== event.result.sequence
			)
				return;
			this.#state = { kind: "editing", draft: state.draft };
			const outcome = event.result.outcome;
			if (outcome.kind === "dispatched") {
				this.#state = { kind: "editing", draft: { ...state.draft, items: [] } };
				this.#dependencies = this.#dependencyKey([]);
				this.#actions.push({ kind: "refresh" });
			} else {
				this.#problem =
					outcome.kind === "rejected"
						? outcome.reason
						: "The salvage inputs changed. Review the batch again.";
				this.#notice(this.#problem);
				if (outcome.kind === "changed") this.#actions.push({ kind: "refresh" });
			}
			this.#notify();
			this.#drain();
		}
	}
	#raise(): void {
		this.#focusRevision++;
		this.#showInventory();
		this.#notify();
	}
	#notify(): void {
		for (const listener of this.#listeners) listener();
	}
}
