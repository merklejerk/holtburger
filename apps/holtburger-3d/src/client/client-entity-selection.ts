import type {
	ClientEntitySelectionQueryRequest,
	ClientEntitySelectionQueryResult,
} from "./client-host-contract";
import type { ClientLifecycleSessionEvent } from "./client-lifecycle-session";
import type { ClientPresentedCameraRay } from "./client-presentation-session";
import type { EntitySelectionRefinement } from "../lib/game/selection/entity-selection-intersection";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../lib/game/landblocks";
import type { ClientSelectedEntityTrackingStatus } from "./client-selection-tracking";

/** Transport-only authority port; selection state stays outside the lifecycle session. */
export interface ClientEntitySelectionLifecyclePort {
	queryEntitySelectionCandidates(
		request: ClientEntitySelectionQueryRequest,
	): Promise<void>;
	subscribe(listener: (event: ClientLifecycleSessionEvent) => void): () => void;
}

/** Current-camera and current-pose reads owned by presentation. */
export interface ClientEntitySelectionPresentationPort {
	samplePresentedCameraRay(
		clientX: number,
		clientY: number,
	): ClientPresentedCameraRay | null;
	refineEntitySelection(
		ray: ClientPresentedCameraRay["refinement"],
		candidateGuids: readonly number[],
		staticLimitDistance: number,
	): EntitySelectionRefinement;
	selectedEntityTrackingStatus(
		guid: number,
	): ClientSelectedEntityTrackingStatus;
}

interface PendingViewportQuery {
	readonly sequence: number;
	readonly ray: ClientPresentedCameraRay["refinement"];
}

/** Sole app-local owner of selected entity identity and replaceable viewport acquisition. */
export class ClientEntitySelection {
	readonly #lifecycle: ClientEntitySelectionLifecyclePort;
	readonly #presentation: () => ClientEntitySelectionPresentationPort | null;
	readonly #onSelectionSubmissionFailed: (error: unknown) => void;
	readonly #listeners = new Set<(selectedGuid: number | null) => void>();
	readonly #hoverListeners = new Set<(hoveredGuid: number | null) => void>();
	readonly #unsubscribe: () => void;
	#selectedGuid: number | null = null;
	#hoveredGuid: number | null = null;
	#nextSequence = 1;
	#pendingSelection: PendingViewportQuery | null = null;
	#pendingHover: PendingViewportQuery | null = null;
	#destroyed = false;

	constructor(options: {
		readonly lifecycle: ClientEntitySelectionLifecyclePort;
		readonly presentation: () => ClientEntitySelectionPresentationPort | null;
		readonly onSelectionSubmissionFailed?: (error: unknown) => void;
	}) {
		this.#lifecycle = options.lifecycle;
		this.#presentation = options.presentation;
		this.#onSelectionSubmissionFailed =
			options.onSelectionSubmissionFailed ?? (() => undefined);
		this.#unsubscribe = options.lifecycle.subscribe((event) =>
			this.#receive(event),
		);
	}

	selectedGuid(): number | null {
		return this.#selectedGuid;
	}

	hoveredGuid(): number | null {
		return this.#hoveredGuid;
	}

	subscribe(listener: (selectedGuid: number | null) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	subscribeHovered(listener: (hoveredGuid: number | null) => void): () => void {
		this.#hoverListeners.add(listener);
		return () => this.#hoverListeners.delete(listener);
	}

	/** Begin the shared viewport-point path used by real gestures and the browser harness. */
	acquireViewportPoint(clientX: number, clientY: number): void {
		if (this.#destroyed) return;
		const presentation = this.#presentation();
		const sampled =
			presentation?.samplePresentedCameraRay(clientX, clientY) ?? null;
		if (sampled === null) {
			this.#pendingSelection = null;
			return;
		}
		const sequence = this.#allocateSequence();
		const pending: PendingViewportQuery = {
			ray: sampled.refinement,
			sequence,
		};
		this.#pendingSelection = pending;
		void this.#lifecycle
			.queryEntitySelectionCandidates({ ...sampled.query, sequence })
			.catch((error: unknown) => {
				if (this.#pendingSelection !== pending) return;
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

	/** Apply a minimap selection or explicit clear and invalidate any older viewport result. */
	select(selectedGuid: number | null): void {
		if (this.#destroyed) return;
		this.#pendingSelection = null;
		this.#publish(selectedGuid);
	}

	/** Clear a selected identity that left frontend residency or the acquisition-distance leash. */
	maintainSelection(): void {
		if (this.#destroyed || this.#selectedGuid === null) return;
		const guid = this.#selectedGuid;
		const status = this.#presentation()?.selectedEntityTrackingStatus(guid);
		if (
			status === undefined ||
			status.kind === "temporarily-unrealized" ||
			(status.kind === "tracked" &&
				status.distance <= OUTDOOR_LANDBLOCK_WORLD_SIZE)
		)
			return;
		this.#invalidateEntity(guid);
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#pendingSelection = null;
		this.#pendingHover = null;
		this.#unsubscribe();
		this.#listeners.clear();
		this.#hoverListeners.clear();
	}

	#receive(event: ClientLifecycleSessionEvent): void {
		if (this.#destroyed) return;
		if (event.type === "entity-selection-query-result") {
			if (event.result.sequence === this.#pendingSelection?.sequence) {
				this.#receiveSelectionQueryResult(event.result);
				return;
			}
			if (event.result.sequence === this.#pendingHover?.sequence)
				this.#receiveHoverQueryResult(event.result);
			return;
		}
		if (event.type !== "dynamic") return;
		if (event.event.kind === "removed") {
			this.#invalidateEntity(event.event.guid);
			return;
		}
		if (
			event.event.kind === "snapshot" &&
			this.#selectedGuid !== null &&
			!event.event.snapshot.entities.some(
				(entity) => entity.identity.guid === this.#selectedGuid,
			)
		)
			this.#invalidateEntity(this.#selectedGuid);
		if (
			event.event.kind === "snapshot" &&
			this.#hoveredGuid !== null &&
			!event.event.snapshot.entities.some(
				(entity) => entity.identity.guid === this.#hoveredGuid,
			)
		)
			this.#invalidateEntity(this.#hoveredGuid);
	}

	/** Clear only an invalid identity; independently ordered queries may still resolve. */
	#invalidateEntity(guid: number): void {
		if (guid !== this.#selectedGuid && guid !== this.#hoveredGuid) return;
		if (guid === this.#selectedGuid) this.#publish(null);
		if (guid === this.#hoveredGuid) this.#publishHover(null);
	}

	#receiveSelectionQueryResult(result: ClientEntitySelectionQueryResult): void {
		const pending = this.#pendingSelection;
		if (pending === null || result.sequence !== pending.sequence) return;
		this.#pendingSelection = null;
		if (result.status === "unavailable") return;
		const presentation = this.#presentation();
		if (presentation === null) return;
		const refinement = presentation.refineEntitySelection(
			pending.ray,
			result.candidateGuids,
			result.staticLimitDistance,
		);
		this.#publish(refinement.selectedGuid);
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

	#publish(selectedGuid: number | null): void {
		if (selectedGuid === this.#selectedGuid) return;
		this.#selectedGuid = selectedGuid;
		for (const listener of this.#listeners) listener(selectedGuid);
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
