import { describe, expect, it } from "vitest";
import { landblockVector3 } from "../lib/assets/ac-frame";
import { Vec3 } from "../lib/game/math/types";
import type { ClientLifecycleSessionEvent } from "./client-lifecycle-session";
import {
	ClientEntitySelection,
	type ClientEntitySelectionLifecyclePort,
	type ClientEntitySelectionPresentationPort,
} from "./client-entity-selection";
import type { ClientEntitySelectionQueryRequest } from "./client-host-contract";
import type { ClientSelectedEntityTrackingStatus } from "./client-selection-tracking";

describe("ClientEntitySelection", () => {
	it("correlates acquisition and publishes one exact winner", async () => {
		const lifecycle = new FakeLifecycle();
		const presentation = new FakePresentation();
		const selection = new ClientEntitySelection({
			lifecycle,
			presentation: () => presentation,
		});
		const changes: Array<number | null> = [];
		selection.subscribe((guid) => changes.push(guid));

		selection.acquireViewportPoint(40, 20);
		await Promise.resolve();
		expect(lifecycle.requests).toHaveLength(1);
		lifecycle.emit(available(lifecycle.requests[0]!.sequence, [8, 4]));

		expect(selection.selectedGuid()).toBe(4);
		expect(changes).toEqual([4]);
		expect(presentation.refinedCandidates).toEqual([[8, 4]]);
		selection.destroy();
	});

	it("invalidates an older viewport result when minimap selection wins", async () => {
		const lifecycle = new FakeLifecycle();
		const selection = new ClientEntitySelection({
			lifecycle,
			presentation: () => new FakePresentation(),
		});

		selection.acquireViewportPoint(1, 2);
		await Promise.resolve();
		const oldSequence = lifecycle.requests[0]!.sequence;
		selection.select(77);
		lifecycle.emit(available(oldSequence, [4]));

		expect(selection.selectedGuid()).toBe(77);
		selection.destroy();
	});

	it("preserves selection on unavailable and failed submissions", async () => {
		const lifecycle = new FakeLifecycle();
		const failures: unknown[] = [];
		const selection = new ClientEntitySelection({
			lifecycle,
			presentation: () => new FakePresentation(),
			onSelectionSubmissionFailed: (error) => failures.push(error),
		});
		selection.select(12);

		selection.acquireViewportPoint(1, 2);
		await Promise.resolve();
		lifecycle.emit({
			result: {
				reason: "collision-coordinator-unavailable",
				sequence: lifecycle.requests[0]!.sequence,
				status: "unavailable",
			},
			type: "entity-selection-query-result",
		});
		lifecycle.rejectNext = true;
		selection.acquireViewportPoint(1, 2);
		await Promise.resolve();

		expect(selection.selectedGuid()).toBe(12);
		expect(failures).toEqual([expect.any(Error)]);
		selection.destroy();
	});

	it("backpressures hover sampling and publishes exact hover without selecting", async () => {
		const lifecycle = new FakeLifecycle();
		const selection = new ClientEntitySelection({
			lifecycle,
			presentation: () => new FakePresentation(),
		});
		const hoverChanges: Array<number | null> = [];
		selection.subscribeHovered((guid) => hoverChanges.push(guid));

		selection.acquireViewportHover(1, 2);
		selection.acquireViewportHover(3, 4);
		await Promise.resolve();
		expect(lifecycle.requests).toHaveLength(1);
		lifecycle.emit(available(lifecycle.requests[0]!.sequence, [8, 4]));

		expect(selection.hoveredGuid()).toBe(4);
		expect(selection.selectedGuid()).toBeNull();
		expect(hoverChanges).toEqual([4]);

		selection.acquireViewportHover(3, 4);
		await Promise.resolve();
		expect(lifecycle.requests).toHaveLength(2);
		lifecycle.emit(available(lifecycle.requests[1]!.sequence, []));
		expect(selection.hoveredGuid()).toBeNull();
		expect(hoverChanges).toEqual([4, null]);
		selection.destroy();
	});

	it("routes interleaved hover and click results only to their own identities", async () => {
		const lifecycle = new FakeLifecycle();
		const selection = new ClientEntitySelection({
			lifecycle,
			presentation: () => new FakePresentation(),
		});

		selection.acquireViewportHover(1, 2);
		selection.acquireViewportPoint(3, 4);
		await Promise.resolve();
		const hoverSequence = lifecycle.requests[0]!.sequence;
		const clickSequence = lifecycle.requests[1]!.sequence;
		lifecycle.emit(available(clickSequence, [7]));
		lifecycle.emit(available(hoverSequence, [9]));

		expect(selection.selectedGuid()).toBe(7);
		expect(selection.hoveredGuid()).toBe(9);
		selection.acquireViewportHover(5, 6);
		await Promise.resolve();
		lifecycle.emit(available(hoverSequence, [3]));
		expect(selection.hoveredGuid()).toBe(9);
		expect(selection.selectedGuid()).toBe(7);
		lifecycle.emit(available(lifecycle.requests[2]!.sequence, [5]));
		expect(selection.hoveredGuid()).toBe(5);
		expect(selection.selectedGuid()).toBe(7);
		selection.destroy();
	});

	it("clears an unavailable hover without changing selection", async () => {
		const lifecycle = new FakeLifecycle();
		const selection = new ClientEntitySelection({
			lifecycle,
			presentation: () => new FakePresentation(),
		});
		selection.select(12);
		selection.acquireViewportHover(1, 2);
		await Promise.resolve();
		lifecycle.emit(available(lifecycle.requests[0]!.sequence, [4]));
		selection.acquireViewportHover(1, 2);
		await Promise.resolve();
		lifecycle.emit({
			result: {
				reason: "collision-coordinator-unavailable",
				sequence: lifecycle.requests[1]!.sequence,
				status: "unavailable",
			},
			type: "entity-selection-query-result",
		});

		expect(selection.hoveredGuid()).toBeNull();
		expect(selection.selectedGuid()).toBe(12);
		selection.destroy();
	});

	it("clears only on an accepted removal without cancelling an independent click", async () => {
		const lifecycle = new FakeLifecycle();
		const selection = new ClientEntitySelection({
			lifecycle,
			presentation: () => new FakePresentation(),
		});
		selection.select(12);
		selection.acquireViewportPoint(1, 2);
		await Promise.resolve();
		const pendingClickSequence = lifecycle.requests[0]!.sequence;
		lifecycle.emit({
			event: { generation: 3, guid: 9, kind: "removed" },
			type: "dynamic",
		});
		expect(selection.selectedGuid()).toBe(12);
		lifecycle.emit({
			event: { generation: 3, guid: 12, kind: "removed" },
			type: "dynamic",
		});
		lifecycle.emit(available(pendingClickSequence, [9]));
		expect(selection.selectedGuid()).toBe(9);
		selection.destroy();
	});

	it("clears hover when its entity is authoritatively removed", async () => {
		const lifecycle = new FakeLifecycle();
		const selection = new ClientEntitySelection({
			lifecycle,
			presentation: () => new FakePresentation(),
		});
		selection.acquireViewportHover(1, 2);
		await Promise.resolve();
		lifecycle.emit(available(lifecycle.requests[0]!.sequence, [12]));
		lifecycle.emit({
			event: { generation: 3, guid: 12, kind: "removed" },
			type: "dynamic",
		});

		expect(selection.hoveredGuid()).toBeNull();
		selection.destroy();
	});

	it("clears selection and matching hover after frontend residency eviction without cancelling independent queries", async () => {
		const lifecycle = new FakeLifecycle();
		const presentation = new FakePresentation();
		const selection = new ClientEntitySelection({
			lifecycle,
			presentation: () => presentation,
		});
		selection.select(12);
		selection.acquireViewportHover(1, 2);
		await Promise.resolve();
		lifecycle.emit(available(lifecycle.requests[0]!.sequence, [12]));
		selection.acquireViewportHover(1, 2);
		selection.acquireViewportPoint(3, 4);
		await Promise.resolve();
		const pendingHoverSequence = lifecycle.requests[1]!.sequence;
		const pendingClickSequence = lifecycle.requests[2]!.sequence;
		presentation.trackingStatus = { kind: "frontend-evicted" };

		selection.maintainSelection();
		lifecycle.emit(available(pendingHoverSequence, [9]));
		lifecycle.emit(available(pendingClickSequence, [9]));

		expect(selection.selectedGuid()).toBe(9);
		expect(selection.hoveredGuid()).toBe(9);
		selection.destroy();
	});

	it("applies the one-landblock range leash without treating transient gaps as eviction", () => {
		const lifecycle = new FakeLifecycle();
		const presentation = new FakePresentation();
		const selection = new ClientEntitySelection({
			lifecycle,
			presentation: () => presentation,
		});
		selection.select(12);
		presentation.trackingStatus = { distance: 192, kind: "tracked" };
		selection.maintainSelection();
		expect(selection.selectedGuid()).toBe(12);

		presentation.trackingStatus = { kind: "temporarily-unrealized" };
		selection.maintainSelection();
		expect(selection.selectedGuid()).toBe(12);

		presentation.trackingStatus = { distance: 192.01, kind: "tracked" };
		selection.maintainSelection();
		expect(selection.selectedGuid()).toBeNull();
		selection.destroy();
	});
});

class FakeLifecycle implements ClientEntitySelectionLifecyclePort {
	readonly requests: ClientEntitySelectionQueryRequest[] = [];
	readonly #listeners = new Set<(event: ClientLifecycleSessionEvent) => void>();
	rejectNext = false;

	async queryEntitySelectionCandidates(
		request: ClientEntitySelectionQueryRequest,
	): Promise<void> {
		this.requests.push(request);
		if (this.rejectNext) {
			this.rejectNext = false;
			throw new Error("host offline");
		}
	}

	subscribe(
		listener: (event: ClientLifecycleSessionEvent) => void,
	): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	emit(event: ClientLifecycleSessionEvent): void {
		for (const listener of this.#listeners) listener(event);
	}
}

class FakePresentation implements ClientEntitySelectionPresentationPort {
	readonly refinedCandidates: number[][] = [];
	trackingStatus: ClientSelectedEntityTrackingStatus = {
		distance: 1,
		kind: "tracked",
	};

	samplePresentedCameraRay() {
		return {
			query: {
				anchor: 0x0100_ffff,
				camera: {
					cameraGeneration: 1,
					entityGeneration: 2,
					playerGuid: 3,
				},
				direction: [0, 0, 1] as const,
				previousCell: null,
				start: landblockVector3([0, 0, 0]),
			},
			refinement: {
				direction: new Vec3(0, 0, 1),
				start: Vec3.zero(),
			},
		};
	}

	refineEntitySelection(_ray: unknown, candidateGuids: readonly number[]) {
		this.refinedCandidates.push([...candidateGuids]);
		const selectedGuid =
			candidateGuids.length === 0 ? null : Math.min(...candidateGuids);
		return {
			distance: selectedGuid === null ? null : 1,
			selectedGuid,
		};
	}

	selectedEntityTrackingStatus() {
		return this.trackingStatus;
	}
}

function available(
	sequence: number,
	candidateGuids: readonly number[],
): ClientLifecycleSessionEvent {
	return {
		result: {
			candidateGuids: [...candidateGuids],
			sequence,
			staticLimitDistance: 30,
			status: "available",
		},
		type: "entity-selection-query-result",
	};
}
