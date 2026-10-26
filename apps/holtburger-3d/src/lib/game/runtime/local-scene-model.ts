import type { ModelFit } from "../geometry/model-fit";
import type { SceneSpatialPlacement } from "../scene";
import type { ObjectPreviewSource } from "./object-preview-source";

/** Resolved body and direct equipment only; scene background belongs to the world driver. */
export type LocalSceneModelSource = Pick<
	ObjectPreviewSource,
	"body" | "attachments"
>;

/** Cold replacement state while the last-good same-subject composition remains installed. */
type LocalSceneModelUpdate =
	| { readonly kind: "settled" | "loading" }
	| { readonly kind: "failed"; readonly message: string };

/** Surface-owned diagnostics; these never participate in world-scene readiness. */
export type LocalSceneModelStatus =
	| { readonly kind: "empty" }
	| { readonly kind: "loading"; readonly subjectId: string }
	| {
			readonly kind: "failed";
			readonly subjectId: string;
			readonly message: string;
	  }
	| {
			readonly kind: "ready";
			/** Identity of the installed visual, independent of runtime resource ownership. */
			readonly subjectId: string;
			/** Animated body support in object-local space; attached equipment does not affect framing. */
			readonly fit: ModelFit;
			/** Latest same-subject edit can load/fail without withdrawing the installed visual. */
			readonly replacement: LocalSceneModelUpdate;
	  };

/** Each source request settles, including requests displaced by newer input or withdrawal. */
export type LocalSceneModelReplacement =
	| { readonly kind: "installed" | "superseded" }
	| { readonly kind: "failed"; readonly message: string };

/** Complete staging result; committing is synchronous after all dependencies and links validate. */
export interface PreparedLocalSceneModel {
	/** Support from this exact prepared body, excluding attached equipment. */
	readonly fit: ModelFit;
	/** Install against the latest placement/visibility without restarting world presentation. */
	commit(placement: SceneSpatialPlacement, visible: boolean): void;
	/** Release uncommitted resources; committing transfers their lifetime to the runtime owner. */
	release(): void;
}

/** Runtime-owned scene operations, injected so source races can be tested without a browser device. */
export interface LocalSceneModelPort {
	/** May prepare an appearance edit or a complete replacement; the old group remains usable. */
	prepare(
		source: LocalSceneModelSource,
		placement: SceneSpatialPlacement,
	): Promise<PreparedLocalSceneModel>;
	/** Only the body moves; attached equipment inherits its placement. */
	setPlacement(placement: SceneSpatialPlacement): void;
	/** Normal scene visibility hides the entire composition and its routed particles. */
	setVisible(visible: boolean): void;
	/** Immediately invalidate staged work and retire the installed group. */
	withdraw(): void;
}

/** One latest source publication, retained as a token rather than inventing another numeric generation. */
interface SourceRequest {
	/** Subject identity makes a roster switch stricter than a same-character appearance edit. */
	readonly subjectId: string;
	/** Immutable resolved source facts owned by this request. */
	readonly source: LocalSceneModelSource;
	/** Completes the caller's request even when it never reaches preparation. */
	readonly complete: (result: LocalSceneModelReplacement) => void;
}

/** One local visual lifetime with coalesced preparation and immediate identity withdrawal. */
export class LocalSceneModelHandle {
	readonly #port: LocalSceneModelPort;
	readonly #onRetired: () => void;
	readonly #listeners = new Set<(status: LocalSceneModelStatus) => void>();
	/** Latest root placement; pointer-rate changes never enter reactive UI state. */
	#placement: SceneSpatialPlacement;
	#visible = true;
	#status: LocalSceneModelStatus = { kind: "empty" };
	#latest: SourceRequest | null = null;
	#task: Promise<void> | null = null;
	#retirement: Promise<void> | null = null;
	#closed = false;
	/** Cleanup failures remain observable to the owner joining retirement, including stale work. */
	readonly #cleanupFailures: unknown[] = [];

	constructor(
		port: LocalSceneModelPort,
		placement: SceneSpatialPlacement,
		onRetired: () => void,
	) {
		this.#onRetired = onRetired;
		this.#port = port;
		this.#placement = placement;
	}

	status(): LocalSceneModelStatus {
		return this.#status;
	}

	/** Only loading/installation/failure changes publish; animation and placement do not. */
	subscribe(listener: (status: LocalSceneModelStatus) => void): () => void {
		this.#listeners.add(listener);
		listener(this.#status);
		return () => this.#listeners.delete(listener);
	}

	replace(
		subjectId: string,
		source: LocalSceneModelSource,
	): Promise<LocalSceneModelReplacement> {
		this.#requireOpen();
		if (this.#status.kind !== "empty" && this.#status.subjectId !== subjectId)
			this.withdraw();
		this.#latest?.complete({ kind: "superseded" });
		const completion = new Promise<LocalSceneModelReplacement>((complete) => {
			this.#latest = { subjectId, source, complete };
		});
		this.#publish(
			this.#status.kind === "ready"
				? { ...this.#status, replacement: { kind: "loading" } }
				: { kind: "loading", subjectId },
		);
		this.#start();
		return completion;
	}

	setPlacement(placement: SceneSpatialPlacement): void {
		this.#requireOpen();
		this.#placement = placement;
		this.#port.setPlacement(placement);
	}

	setVisible(visible: boolean): void {
		this.#requireOpen();
		this.#visible = visible;
		this.#port.setVisible(visible);
	}

	withdraw(): void {
		this.#latest?.complete({ kind: "superseded" });
		this.#latest = null;
		try {
			this.#port.withdraw();
		} finally {
			this.#publish({ kind: "empty" });
		}
	}

	destroy(): Promise<void> {
		return (this.#retirement ??= this.#destroy().finally(this.#onRetired));
	}

	#start(): void {
		if (this.#task !== null) return;
		this.#task = this.#prepareLatest()
			.catch((cause) => {
				this.#cleanupFailures.push(cause);
				try {
					this.#port.withdraw();
				} catch (withdrawal) {
					this.#cleanupFailures.push(withdrawal);
				}
				const request = this.#latest;
				this.#latest = null;
				if (request !== null) {
					const message =
						cause instanceof Error ? cause.message : String(cause);
					this.#publish({
						kind: "failed",
						subjectId: request.subjectId,
						message,
					});
					request.complete({ kind: "failed", message });
				} else this.#publish({ kind: "empty" });
			})
			.finally(() => {
				this.#task = null;
				if (!this.#closed && this.#latest !== null) this.#start();
			});
	}

	async #prepareLatest(): Promise<void> {
		while (!this.#closed && this.#latest !== null) {
			const request = this.#latest;
			let prepared: PreparedLocalSceneModel;
			try {
				prepared = await this.#port.prepare(request.source, this.#placement);
			} catch (cause) {
				if (this.#latest === request) this.#fail(request, cause);
				continue;
			}
			if (this.#closed || this.#latest !== request) {
				prepared.release();
				continue;
			}
			try {
				prepared.commit(this.#placement, this.#visible);
			} finally {
				prepared.release();
			}
			this.#latest = null;
			this.#publish({
				kind: "ready",
				subjectId: request.subjectId,
				fit: prepared.fit,
				replacement: { kind: "settled" },
			});
			request.complete({ kind: "installed" });
		}
	}

	#fail(request: SourceRequest, cause: unknown): void {
		const message = cause instanceof Error ? cause.message : String(cause);
		this.#latest = null;
		this.#publish(
			this.#status.kind === "ready"
				? { ...this.#status, replacement: { kind: "failed", message } }
				: { kind: "failed", subjectId: request.subjectId, message },
		);
		request.complete({ kind: "failed", message });
	}

	#publish(status: LocalSceneModelStatus): void {
		this.#status = status;
		for (const listener of this.#listeners) listener(status);
	}

	#requireOpen(): void {
		if (this.#closed)
			throw new Error("Cannot update a retired local scene model.");
	}

	async #destroy(): Promise<void> {
		this.#closed = true;
		try {
			this.withdraw();
		} catch (cause) {
			this.#cleanupFailures.push(cause);
		}
		await this.#task;
		this.#listeners.clear();
		if (this.#cleanupFailures.length > 0)
			throw new AggregateError(
				this.#cleanupFailures,
				"Local scene model could not retire every resource.",
			);
	}
}
