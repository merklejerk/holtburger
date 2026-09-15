import {
	ClientPointerSelectionController,
	type ClientPointerSelectionPresentationPort,
	type ClientViewportTargetResult,
} from "./client-pointer-selection-controller";
import {
	ClientEntityMirror,
	type ClientEntityFacts,
} from "./client-entity-mirror";
import { entityFacts } from "./client-entity-mirror.test-support";
import { OUTDOOR_LANDBLOCK_WORLD_SIZE } from "../lib/game/landblocks";
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
	it("retains exactly one distinct selection and retires history on removal or clear", () => {
		const lifecycle = new FakeLifecycle();
		const selection = new ClientEntitySelection({
			lifecycle,
			presentation: () => null,
		});
		selection.select(7);
		selection.select(12);
		selection.select(12);
		expect(selection.previousGuid()).toBe(7);
		lifecycle.update([], [7]);
		expect(selection.previousGuid()).toBeNull();
		expect(selection.selectedGuid()).toBe(12);
		selection.select(8);
		expect(selection.previousGuid()).toBe(12);
		selection.select(null);
		expect(selection.previousGuid()).toBeNull();
		selection.select(8);
		selection.select(12);
		lifecycle.update([], [12]);
		expect(selection.selectedGuid()).toBeNull();
		expect(selection.previousGuid()).toBeNull();
		selection.destroy();
	});

	it("correlates acquisition and publishes one exact winner", async () => {
		const lifecycle = new FakeLifecycle();
		const presentation = new FakePresentation();
		const selection = new ClientEntitySelection({
			lifecycle,
			presentation: () => presentation,
		});
		const pointer = new ClientPointerSelectionController({
			lifecycle,
			presentation: () => presentation,
			selection,
			onSelectionSubmissionFailed: (error) => {
				throw error;
			},
		});
		const changes: Array<number | null> = [];
		selection.subscribe((guid) => changes.push(guid));

		pointer.acquireViewportPoint(40, 20);
		await Promise.resolve();
		expect(lifecycle.requests).toHaveLength(1);
		lifecycle.emit(available(lifecycle.requests[0]!.sequence, [8, 4]));

		expect(selection.selectedGuid()).toBe(4);
		expect(changes).toEqual([4]);
		expect(presentation.refinedCandidates).toEqual([[8, 4]]);
		pointer.destroy();
		selection.destroy();
	});

	it("resolves interaction targets without changing selection and discards cancelled picks", () => {
		const lifecycle = new FakeLifecycle();
		const presentation = new FakePresentation();
		const selection = new ClientEntitySelection({
			lifecycle,
			presentation: () => presentation,
		});
		const pointer = new ClientPointerSelectionController({
			lifecycle,
			presentation: () => presentation,
			selection,
			onSelectionSubmissionFailed: (error) => {
				throw error;
			},
		});
		selection.select(77);
		let current = true;
		const targets: Array<number | null> = [];
		const destination = {
			isCurrent: () => current,
			commit: (result: ClientViewportTargetResult) => {
				if (result.kind !== "unavailable")
					targets.push(result.kind === "entity" ? result.guid : null);
			},
		};
		const reply = () => {
			const request = lifecycle.requests.at(-1);
			if (request === undefined) throw new Error("Expected pick request");
			lifecycle.emit(available(request.sequence, [8, 4]));
		};
		pointer.acquireTarget(40, 20, destination);
		reply();
		expect(targets).toEqual([4]);
		expect(selection.selectedGuid()).toBe(77);
		pointer.acquireTarget(40, 20, destination);
		current = false;
		reply();
		expect(targets).toEqual([4]);
		expect(presentation.refinedCandidates).toHaveLength(1);
		pointer.destroy();
		selection.destroy();
	});

	it("completes unavailable and superseded interaction picks without selecting", async () => {
		const lifecycle = new FakeLifecycle();
		const presentation = new FakePresentation();
		const selection = new ClientEntitySelection({
			lifecycle,
			presentation: () => presentation,
		});
		selection.select(77);
		const results: ClientViewportTargetResult[] = [];
		const pointer = new ClientPointerSelectionController({
			lifecycle,
			presentation: () => presentation,
			selection,
			onSelectionSubmissionFailed: () => {
				throw new Error("Interaction owns its failure notice");
			},
		});
		const destination = {
			isCurrent: () => true,
			commit: (result: ClientViewportTargetResult) => results.push(result),
		};
		pointer.acquireTarget(1, 2, destination);
		pointer.acquireTarget(3, 4, destination);
		expect(results).toEqual([
			{ kind: "unavailable", reason: "World picking was superseded." },
		]);
		const request = lifecycle.requests.at(-1);
		if (request === undefined) throw new Error("Expected query");
		lifecycle.emit({
			type: "entity-selection-query-result",
			result: {
				sequence: request.sequence,
				status: "unavailable",
				reason: "collision-coordinator-unavailable",
			},
		});
		expect(results.at(-1)?.kind).toBe("unavailable");
		lifecycle.rejectNext = true;
		pointer.acquireTarget(1, 2, destination);
		await Promise.resolve();
		expect(results.at(-1)).toEqual({
			kind: "unavailable",
			reason: "Error: host offline",
		});
		expect(selection.selectedGuid()).toBe(77);
		pointer.destroy();
		selection.destroy();
	});

	it("invalidates an older viewport result when minimap selection wins", async () => {
		const lifecycle = new FakeLifecycle();
		const selection = new ClientEntitySelection({
			lifecycle,
			presentation: () => new FakePresentation(),
		});
		const pointer = new ClientPointerSelectionController({
			lifecycle,
			presentation: () => new FakePresentation(),
			selection,
			onSelectionSubmissionFailed: (error) => {
				throw error;
			},
		});

		pointer.acquireViewportPoint(1, 2);
		await Promise.resolve();
		const oldSequence = lifecycle.requests[0]!.sequence;
		selection.select(77);
		lifecycle.emit(available(oldSequence, [4]));

		expect(selection.selectedGuid()).toBe(77);
		pointer.destroy();
		selection.destroy();
	});

	it("preserves selection on unavailable and failed submissions", async () => {
		const lifecycle = new FakeLifecycle();
		const failures: unknown[] = [];
		const selection = new ClientEntitySelection({
			lifecycle,
			presentation: () => new FakePresentation(),
		});
		const pointer = new ClientPointerSelectionController({
			lifecycle,
			presentation: () => new FakePresentation(),
			selection,
			onSelectionSubmissionFailed: (error) => failures.push(error),
		});
		selection.select(12);

		pointer.acquireViewportPoint(1, 2);
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
		pointer.acquireViewportPoint(1, 2);
		await Promise.resolve();

		expect(selection.selectedGuid()).toBe(12);
		expect(failures).toEqual([expect.any(Error)]);
		pointer.destroy();
		selection.destroy();
	});

	it("backpressures hover sampling and publishes exact hover without selecting", async () => {
		const lifecycle = new FakeLifecycle();
		const selection = new ClientEntitySelection({
			lifecycle,
			presentation: () => new FakePresentation(),
		});
		const pointer = new ClientPointerSelectionController({
			lifecycle,
			presentation: () => new FakePresentation(),
			selection,
			onSelectionSubmissionFailed: (error) => {
				throw error;
			},
		});
		const hoverChanges: Array<number | null> = [];
		pointer.subscribeHovered((guid) => hoverChanges.push(guid));

		pointer.acquireViewportHover(1, 2);
		pointer.acquireViewportHover(3, 4);
		await Promise.resolve();
		expect(lifecycle.requests).toHaveLength(1);
		lifecycle.emit(available(lifecycle.requests[0]!.sequence, [8, 4]));

		expect(pointer.hoveredGuid()).toBe(4);
		expect(selection.selectedGuid()).toBeNull();
		expect(hoverChanges).toEqual([4]);

		pointer.acquireViewportHover(3, 4);
		await Promise.resolve();
		expect(lifecycle.requests).toHaveLength(2);
		lifecycle.emit(available(lifecycle.requests[1]!.sequence, []));
		expect(pointer.hoveredGuid()).toBeNull();
		expect(hoverChanges).toEqual([4, null]);
		pointer.destroy();
		selection.destroy();
	});

	it("routes interleaved hover and click results only to their own identities", async () => {
		const lifecycle = new FakeLifecycle();
		const selection = new ClientEntitySelection({
			lifecycle,
			presentation: () => new FakePresentation(),
		});
		const pointer = new ClientPointerSelectionController({
			lifecycle,
			presentation: () => new FakePresentation(),
			selection,
			onSelectionSubmissionFailed: (error) => {
				throw error;
			},
		});

		pointer.acquireViewportHover(1, 2);
		pointer.acquireViewportPoint(3, 4);
		await Promise.resolve();
		const hoverSequence = lifecycle.requests[0]!.sequence;
		const clickSequence = lifecycle.requests[1]!.sequence;
		lifecycle.emit(available(clickSequence, [7]));
		lifecycle.emit(available(hoverSequence, [9]));

		expect(selection.selectedGuid()).toBe(7);
		expect(pointer.hoveredGuid()).toBe(9);
		pointer.acquireViewportHover(5, 6);
		await Promise.resolve();
		lifecycle.emit(available(hoverSequence, [3]));
		expect(pointer.hoveredGuid()).toBe(9);
		expect(selection.selectedGuid()).toBe(7);
		lifecycle.emit(available(lifecycle.requests[2]!.sequence, [5]));
		expect(pointer.hoveredGuid()).toBe(5);
		expect(selection.selectedGuid()).toBe(7);
		pointer.destroy();
		selection.destroy();
	});

	it("clears an unavailable hover without changing selection", async () => {
		const lifecycle = new FakeLifecycle();
		const selection = new ClientEntitySelection({
			lifecycle,
			presentation: () => new FakePresentation(),
		});
		const pointer = new ClientPointerSelectionController({
			lifecycle,
			presentation: () => new FakePresentation(),
			selection,
			onSelectionSubmissionFailed: (error) => {
				throw error;
			},
		});
		selection.select(12);
		pointer.acquireViewportHover(1, 2);
		await Promise.resolve();
		lifecycle.emit(available(lifecycle.requests[0]!.sequence, [4]));
		pointer.acquireViewportHover(1, 2);
		await Promise.resolve();
		lifecycle.emit({
			result: {
				reason: "collision-coordinator-unavailable",
				sequence: lifecycle.requests[1]!.sequence,
				status: "unavailable",
			},
			type: "entity-selection-query-result",
		});

		expect(pointer.hoveredGuid()).toBeNull();
		expect(selection.selectedGuid()).toBe(12);
		pointer.destroy();
		selection.destroy();
	});

	it("clears on semantic removal without cancelling an independent click", async () => {
		const lifecycle = new FakeLifecycle();
		const selection = new ClientEntitySelection({
			lifecycle,
			presentation: () => new FakePresentation(),
		});
		const pointer = new ClientPointerSelectionController({
			lifecycle,
			presentation: () => new FakePresentation(),
			selection,
			onSelectionSubmissionFailed: (error) => {
				throw error;
			},
		});
		selection.select(12);
		pointer.acquireViewportPoint(1, 2);
		await Promise.resolve();
		const pendingClickSequence = lifecycle.requests[0]!.sequence;
		lifecycle.emit({
			event: { generation: 3, guid: 9, kind: "removed" },
			type: "dynamic",
		});
		expect(selection.selectedGuid()).toBe(12);
		lifecycle.update([], [12]);
		expect(selection.selectedGuid()).toBeNull();
		lifecycle.emit(available(pendingClickSequence, [9]));
		expect(selection.selectedGuid()).toBe(9);
		pointer.destroy();
		selection.destroy();
	});

	it("clears hover when its entity is authoritatively removed", async () => {
		const lifecycle = new FakeLifecycle();
		const selection = new ClientEntitySelection({
			lifecycle,
			presentation: () => new FakePresentation(),
		});
		const pointer = new ClientPointerSelectionController({
			lifecycle,
			presentation: () => new FakePresentation(),
			selection,
			onSelectionSubmissionFailed: (error) => {
				throw error;
			},
		});
		pointer.acquireViewportHover(1, 2);
		await Promise.resolve();
		lifecycle.emit(available(lifecycle.requests[0]!.sequence, [12]));
		lifecycle.emit({
			event: { generation: 3, guid: 12, kind: "removed" },
			type: "dynamic",
		});

		expect(pointer.hoveredGuid()).toBeNull();
		pointer.destroy();
		selection.destroy();
	});

	it("keeps semantic selection through frontend eviction while independent queries complete", async () => {
		const lifecycle = new FakeLifecycle();
		const presentation = new FakePresentation();
		const selection = new ClientEntitySelection({
			lifecycle,
			presentation: () => presentation,
		});
		const pointer = new ClientPointerSelectionController({
			lifecycle,
			presentation: () => presentation,
			selection,
			onSelectionSubmissionFailed: (error) => {
				throw error;
			},
		});
		selection.select(12);
		pointer.acquireViewportHover(1, 2);
		await Promise.resolve();
		lifecycle.emit(available(lifecycle.requests[0]!.sequence, [12]));
		pointer.acquireViewportHover(1, 2);
		pointer.acquireViewportPoint(3, 4);
		await Promise.resolve();
		const pendingHoverSequence = lifecycle.requests[1]!.sequence;
		const pendingClickSequence = lifecycle.requests[2]!.sequence;
		presentation.trackingStatus = { kind: "frontend-evicted" };

		selection.maintainSelection();
		expect(selection.selectedGuid()).toBe(12);
		lifecycle.emit(available(pendingHoverSequence, [9]));
		lifecycle.emit(available(pendingClickSequence, [9]));

		expect(selection.selectedGuid()).toBe(9);
		expect(pointer.hoveredGuid()).toBe(9);
		pointer.destroy();
		selection.destroy();
	});

	it.each(["render-first", "facts-first"])(
		"preserves pickup selection with %s delivery",
		(order) => {
			const lifecycle = new FakeLifecycle();
			const presentation = new FakePresentation();
			const selection = new ClientEntitySelection({
				lifecycle,
				presentation: () => presentation,
			});
			selection.select(12);
			const facts = () =>
				lifecycle.update(
					[
						entityFacts(12, {
							ownedByPlayer: true,
							scenePlacement: "unavailable",
							location: {
								kind: "contained",
								parentGuid: 1,
								slot: { kind: "item", index: 0 },
							},
						}),
					],
					[],
				);
			const render = () => {
				lifecycle.emit({
					type: "dynamic",
					event: { kind: "removed", guid: 12, generation: 3 },
				});
				presentation.trackingStatus = { kind: "frontend-evicted" };
				selection.maintainSelection();
			};
			if (order === "render-first") {
				render();
				facts();
			} else {
				facts();
				render();
			}
			expect(selection.selectedGuid()).toBe(12);
			lifecycle.update([], [12]);
			expect(selection.selectedGuid()).toBeNull();
			selection.destroy();
		},
	);

	it.each(["contained", "equipped"] as const)(
		"preserves a selected %s item through separately delivered drop updates",
		(origin) => {
			const lifecycle = new FakeLifecycle();
			const presentation = new FakePresentation();
			const selection = new ClientEntitySelection({
				lifecycle,
				presentation: () => presentation,
			});
			lifecycle.update(
				[
					entityFacts(12, {
						ownedByPlayer: true,
						scenePlacement: "unavailable",
						location:
							origin === "contained"
								? {
										kind: "contained",
										parentGuid: 1,
										slot: { kind: "item", index: 0 },
									}
								: { kind: "equipped", wearerGuid: 1, mask: null },
					}),
				],
				[],
			);
			const changes: Array<number | null> = [];
			selection.subscribe((guid) => changes.push(guid));
			selection.selectInventoryItem(12, "toggle");
			lifecycle.update(
				[entityFacts(12, { scenePlacement: "unavailable" })],
				[],
			);
			presentation.trackingStatus = { kind: "frontend-evicted" };
			selection.maintainSelection();
			expect(selection.selectedGuid()).toBe(12);
			lifecycle.update([entityFacts(12, { canPickUp: true })], []);
			expect(selection.selectedGuid()).toBe(12);
			expect(changes).toEqual([12]);
			presentation.trackingStatus = {
				kind: "tracked",
				distance: OUTDOOR_LANDBLOCK_WORLD_SIZE * 2,
			};
			selection.maintainSelection();
			expect(selection.selectedGuid()).toBeNull();
			selection.destroy();
		},
	);

	it("checks inventory acquisition against current hydration and recovery", () => {
		const lifecycle = new FakeLifecycle();
		const selection = new ClientEntitySelection({
			lifecycle,
			presentation: () => null,
		});
		const owned = entityFacts(12, {
			ownedByPlayer: true,
			scenePlacement: "unavailable",
			location: { kind: "contained", parentGuid: 1, slot: { kind: "pending" } },
		});
		lifecycle.update([{ ...owned, description: { kind: "pending" } }], []);
		selection.selectInventoryItem(12, "toggle");
		expect(selection.selectedGuid()).toBeNull();
		lifecycle.update([owned], []);
		selection.selectInventoryItem(12, "select");
		expect(selection.selectedGuid()).toBe(12);
		selection.selectInventoryItem(12, "select");
		expect(selection.selectedGuid()).toBe(12);
		selection.selectInventoryItem(12, "toggle");
		expect(selection.selectedGuid()).toBeNull();
		selection.selectInventoryItem(12, "toggle");
		expect(selection.selectedGuid()).toBe(12);
		lifecycle.entities.awaitSnapshot();
		lifecycle.emit({ type: "resyncing" });
		selection.maintainSelection();
		selection.selectInventoryItem(7, "toggle");
		expect(selection.selectedGuid()).toBe(12);
		selection.destroy();
	});

	it("preserves selection across equipment, reordering, and a drop placement gap", () => {
		const lifecycle = new FakeLifecycle();
		const presentation = new FakePresentation();
		const selection = new ClientEntitySelection({
			lifecycle,
			presentation: () => presentation,
		});
		presentation.trackingStatus = {
			kind: "tracked",
			distance: OUTDOOR_LANDBLOCK_WORLD_SIZE * 2,
		};
		lifecycle.update(
			[
				entityFacts(12, {
					ownedByPlayer: true,
					scenePlacement: "unavailable",
					location: {
						kind: "contained",
						parentGuid: 1,
						slot: { kind: "item", index: 0 },
					},
				}),
			],
			[],
		);
		selection.selectInventoryItem(12, "toggle");
		lifecycle.update(
			[
				entityFacts(12, {
					ownedByPlayer: true,
					scenePlacement: "available",
					location: { kind: "equipped", wearerGuid: 1, mask: null },
				}),
			],
			[],
		);
		selection.maintainSelection();
		expect(selection.selectedGuid()).toBe(12);
		lifecycle.update(
			[
				entityFacts(12, {
					ownedByPlayer: true,
					scenePlacement: "unavailable",
					location: {
						kind: "contained",
						parentGuid: 1,
						slot: { kind: "item", index: 3 },
					},
				}),
			],
			[],
		);
		expect(selection.selectedGuid()).toBe(12);
		lifecycle.update([entityFacts(12, { scenePlacement: "unavailable" })], []);
		expect(selection.selectedGuid()).toBe(12);
		presentation.trackingStatus = {
			kind: "tracked",
			distance: OUTDOOR_LANDBLOCK_WORLD_SIZE / 2,
		};
		lifecycle.update([entityFacts(12)], []);
		expect(selection.selectedGuid()).toBe(12);
		lifecycle.update([], [12]);
		expect(selection.selectedGuid()).toBeNull();
		selection.destroy();
	});

	it("supersedes unchanged selections and retires acquisition tokens during recovery", () => {
		const lifecycle = new FakeLifecycle();
		const selection = new ClientEntitySelection({
			lifecycle,
			presentation: () => null,
		});
		selection.select(12);
		const pending = selection.beginAcquisition("external");
		selection.select(12);
		selection.commitAcquisition(pending, 7);
		expect(selection.selectedGuid()).toBe(12);
		const recovering = selection.beginAcquisition("cycle");
		lifecycle.emit({ type: "resyncing" });
		selection.commitAcquisition(recovering, 7);
		expect(selection.selectedGuid()).toBe(12);
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
		presentation.trackingStatus = {
			distance: OUTDOOR_LANDBLOCK_WORLD_SIZE,
			kind: "tracked",
		};
		selection.maintainSelection();
		expect(selection.selectedGuid()).toBe(12);

		presentation.trackingStatus = { kind: "temporarily-unrealized" };
		selection.maintainSelection();
		expect(selection.selectedGuid()).toBe(12);

		presentation.trackingStatus = {
			distance: OUTDOOR_LANDBLOCK_WORLD_SIZE + 0.01,
			kind: "tracked",
		};
		selection.maintainSelection();
		expect(selection.selectedGuid()).toBeNull();
		selection.destroy();
	});
});

class FakeLifecycle implements ClientEntitySelectionLifecyclePort {
	readonly entities = new ClientEntityMirror();
	constructor() {
		this.entities.commit(
			this.entities.prepareSnapshot(
				{ entities: [1, 4, 7, 8, 9, 12, 77].map((guid) => entityFacts(guid)) },
				1,
			),
		);
	}
	update(upserts: ClientEntityFacts[], removed: number[]): void {
		const prepared = this.entities.prepareDelta({ upserts, removed });
		if (prepared === null) throw new Error("Fixture requires current state.");
		this.entities.commit(prepared);
		this.emit({ type: "entities" });
	}
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

class FakePresentation
	implements
		ClientEntitySelectionPresentationPort,
		ClientPointerSelectionPresentationPort
{
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
			complete: true,
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
