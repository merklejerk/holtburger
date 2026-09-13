import type { ClientEntitySelection } from "./client-entity-selection";
import type {
	ClientEntitySelectionQueryRequest,
	ClientEntitySelectionQueryResult,
} from "./client-host-contract";
import type { ClientLifecycleSessionEvent } from "./client-lifecycle-session";
import type { ClientPresentedCameraRay } from "./client-presentation-session";
import type { EntitySelectionRefinement } from "../lib/game/selection/entity-selection-intersection";

/** Transport-only authority port; selection state stays outside the lifecycle session. */
export interface ClientPointerSelectionLifecyclePort {
	/** Submit a correlated host broad-phase query. */
	queryEntitySelectionCandidates(
		request: ClientEntitySelectionQueryRequest,
	): Promise<void>;
	subscribe(listener: (event: ClientLifecycleSessionEvent) => void): () => void;
}

/** Current-camera and current-pose reads owned by presentation. */
export interface ClientPointerSelectionPresentationPort {
	samplePresentedCameraRay(
		clientX: number,
		clientY: number,
	): ClientPresentedCameraRay | null;
	refineEntitySelection(
		ray: ClientPresentedCameraRay["refinement"],
		candidateGuids: readonly number[],
		staticLimitDistance: number,
	): EntitySelectionRefinement;
}

/** Correlated viewport query geometry shared by click and hover acquisition. */
interface PendingViewportQuery {
	readonly sequence: number;
	readonly ray: ClientPresentedCameraRay["refinement"];
}

/** A click can publish only while its selected-identity intent is current. */
interface PendingClickQuery extends PendingViewportQuery {
	/** Token issued by the single selection owner. */
	readonly intent: symbol;
}

/** Pointer acquisition and hover; selected identity belongs to the selection owner. */
export class ClientPointerSelectionController {
	readonly #lifecycle: ClientPointerSelectionLifecyclePort;
	readonly #presentation: () => ClientPointerSelectionPresentationPort | null;
	readonly #onSelectionSubmissionFailed: (error: unknown) => void;
	readonly #selection: ClientEntitySelection;
	readonly #hoverListeners = new Set<(hoveredGuid: number | null) => void>();
	readonly #unsubscribe: () => void;
	#hoveredGuid: number | null = null;
	#nextSequence = 1;
	#pendingSelection: PendingClickQuery | null = null;
	#pendingHover: PendingViewportQuery | null = null;
	#destroyed = false;

	constructor(options: {
		readonly selection: ClientEntitySelection;
		readonly lifecycle: ClientPointerSelectionLifecyclePort;
		readonly presentation: () => ClientPointerSelectionPresentationPort | null;
		readonly onSelectionSubmissionFailed: (error: unknown) => void;
	}) {
		this.#selection = options.selection;
		this.#lifecycle = options.lifecycle;
		this.#presentation = options.presentation;
		this.#onSelectionSubmissionFailed = options.onSelectionSubmissionFailed;
		this.#unsubscribe = options.lifecycle.subscribe((event) =>
			this.#receive(event),
		);
	}

	hoveredGuid(): number | null {
		return this.#hoveredGuid;
	}

	subscribeHovered(listener: (hoveredGuid: number | null) => void): () => void {
		this.#hoverListeners.add(listener);
		return () => this.#hoverListeners.delete(listener);
	}

	/** Begin the shared viewport-point path used by real gestures and the browser harness. */
	acquireViewportPoint(clientX: number, clientY: number): void {
		if (this.#destroyed) return;
		const intent = this.#selection.beginAcquisition("external");
		const presentation = this.#presentation();
		const sampled =
			presentation?.samplePresentedCameraRay(clientX, clientY) ?? null;
		if (sampled === null) {
			this.#pendingSelection = null;
			return;
		}
		const sequence = this.#allocateSequence();
		const pending: PendingClickQuery = {
			intent,
			ray: sampled.refinement,
			sequence,
		};
		this.#pendingSelection = pending;
		void this.#lifecycle
			.queryEntitySelectionCandidates({ ...sampled.query, sequence })
			.catch((error: unknown) => {
				if (
					this.#pendingSelection !== pending ||
					!this.#selection.isCurrentAcquisition(intent)
				)
					return;
				this.#pendingSelection = null;
				this.#onSelectionSubmissionFailed(error);
			});
	}

	/** Sample one hover point unless the preceding hover query still supplies backpressure. */
	acquireViewportHover(clientX: number, clientY: number): void {
		if (this.#destroyed || this.#pendingHover !== null) return;
		const presentation = this.#presentation();
		const sampled =
			presentation?.samplePresentedCameraRay(clientX, clientY) ?? null;
		if (sampled === null) {
			this.#publishHover(null);
			return;
		}
		const sequence = this.#allocateSequence();
		const pending: PendingViewportQuery = {
			ray: sampled.refinement,
			sequence,
		};
		this.#pendingHover = pending;
		void this.#lifecycle
			.queryEntitySelectionCandidates({ ...sampled.query, sequence })
			.catch(() => {
				if (this.#pendingHover !== pending) return;
				this.#pendingHover = null;
				this.#publishHover(null);
			});
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#pendingSelection = null;
		this.#pendingHover = null;
		this.#unsubscribe();
		this.#hoverListeners.clear();
	}

	#receive(event: ClientLifecycleSessionEvent): void {
		if (this.#destroyed) return;
		const lifecycle =
			event.type === "current-state"
				? event.state.lifecycle
				: event.type === "lifecycle"
					? event.lifecycle
					: null;
		if (lifecycle !== null && lifecycle.kind !== "in-world") {
			this.#pendingSelection = null;
			this.#pendingHover = null;
			this.#publishHover(null);
			return;
		}
		if (event.type === "entity-selection-query-result") {
			if (event.result.sequence === this.#pendingSelection?.sequence) {
				this.#receiveSelectionQueryResult(event.result);
				return;
			}
			if (event.result.sequence === this.#pendingHover?.sequence)
				this.#receiveHoverQueryResult(event.result);
			return;
		}
		if (event.type === "resyncing" || event.type === "current-state") {
			this.#pendingSelection = null;
			this.#pendingHover = null;
			this.#publishHover(null);
			return;
		}
		if (event.type !== "dynamic") return;
		if (event.event.kind === "removed") {
			if (this.#hoveredGuid === event.event.guid) this.#publishHover(null);
			return;
		}

		if (
			event.event.kind === "snapshot" &&
			this.#hoveredGuid !== null &&
			!event.event.snapshot.entities.some(
				(entity) => entity.identity.guid === this.#hoveredGuid,
			)
		)
			this.#publishHover(null);
	}

	#receiveSelectionQueryResult(result: ClientEntitySelectionQueryResult): void {
		const pending = this.#pendingSelection;
		if (pending === null || result.sequence !== pending.sequence) return;
		this.#pendingSelection = null;
		if (!this.#selection.isCurrentAcquisition(pending.intent)) return;
		if (result.status === "unavailable") return;
		const presentation = this.#presentation();
		if (presentation === null) return;
		const refinement = presentation.refineEntitySelection(
			pending.ray,
			result.candidateGuids,
			result.staticLimitDistance,
		);
		this.#selection.commitAcquisition(pending.intent, refinement.selectedGuid);
	}

	#receiveHoverQueryResult(result: ClientEntitySelectionQueryResult): void {
		const pending = this.#pendingHover;
		if (pending === null || result.sequence !== pending.sequence) return;
		this.#pendingHover = null;
		if (result.status === "unavailable") {
			this.#publishHover(null);
			return;
		}
		const presentation = this.#presentation();
		if (presentation === null) {
			this.#publishHover(null);
			return;
		}
		const refinement = presentation.refineEntitySelection(
			pending.ray,
			result.candidateGuids,
			result.staticLimitDistance,
		);
		this.#publishHover(refinement.selectedGuid);
	}

	#publishHover(hoveredGuid: number | null): void {
		if (hoveredGuid === this.#hoveredGuid) return;
		this.#hoveredGuid = hoveredGuid;
		for (const listener of this.#hoverListeners) listener(hoveredGuid);
	}

	#allocateSequence(): number {
		const sequence = this.#nextSequence;
		this.#nextSequence =
			sequence === Number.MAX_SAFE_INTEGER ? 1 : sequence + 1;
		return sequence;
	}
}
