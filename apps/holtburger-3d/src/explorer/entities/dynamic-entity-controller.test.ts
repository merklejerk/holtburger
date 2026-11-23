import { describe, expect, it, vi } from "vitest";
import { cellId } from "../../lib/game/runtime/dynamic-entity-feed";
import type { HostTransport } from "../../lib/host/host-transport";
import { ExplorerDynamicEntityController } from "./dynamic-entity-controller";
import type {
	ExplorerSelectionStatus,
	ExplorerWorldPose,
} from "./entity-commands";
import type { ExplorerEntitySelection } from "./entity-panel-state";

interface Deferred<T> {
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
	readonly reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function poseAt(x: number): ExplorerWorldPose {
	return {
		landblockId: cellId(0xda550001),
		coords: { x, y: 2, z: 3 },
		rotation: { w: 1, x: 0, y: 0, z: 0 },
	};
}

function sampleEntity(guid: number, generation = 1, x = 1) {
	return {
		generation,
		motion: null,
		identity: { guid, wcid: 42 },
		display: { name: "Drudge", level: null },
		presentation: {
			placementFrame: 0,
			entityClass: "other" as const,
			content: {
				motionTableDid: null,
				setupDid: 0x02000001,
				soundTableDid: null,
				physicsEffectTableDid: null,
			},
			appearance: {
				paletteDid: null,
				subPalettes: [],
				textureChanges: [],
				partChanges: [],
			},
			objectScale: 1,
			radar: {
				behavior: null,
				category: "other" as const,
				obviousRange: null,
			},
		},
		physics: {
			flags: {
				reportCollisions: false,
				gravity: true,
				ethereal: false,
				ignoreCollisions: false,
				missile: false,
				inelastic: false,
				edgeSlide: false,
				frozen: false,
			},
			participation: "physical" as const,
			noDraw: false,
			hidden: false,
			cloaked: false,
			translucency: 0,
			lighting: false,
			defaultAnimation: false,
			defaultScript: false,
		},
		placement: {
			kind: "world" as const,
			spatialMembership: {
				reachesOutdoors: true,
				reachedEnvCellIds: [],
			},
			pose: poseAt(x),
			contact: "unknown" as const,
			sampleMode: "authoritative-only" as const,
		},
	};
}

async function createControllerHarness() {
	const handlers = new Map<string, (payload: unknown) => void>();
	const invokeImpl = vi.fn<
		(command: string, args?: Record<string, unknown>) => Promise<unknown>
	>(async (command) => {
		if (command === "request_explorer_dynamic_entity_snapshot") {
			handlers.get("explorer-dynamic-entity")?.({
				kind: "snapshot",
				snapshot: {
					hostTime: { seconds: 1 },
					entities: [sampleEntity(2, 1, 1)],
				},
			});
			return undefined;
		}
		if (command === "explorer_catalog_capability") {
			return {
				status: "available",
				path: "weenies.hwc",
				recordCount: 1,
			};
		}
		return undefined;
	});

	const hostTransport = {
		listen: vi.fn(
			async (event: string, handler: (payload: unknown) => void) => {
				handlers.set(event, handler);
				return () => {
					handlers.delete(event);
				};
			},
		),
		invoke: invokeImpl,
	} as unknown as HostTransport;

	let selected: ExplorerEntitySelection | null = { guid: 2, generation: 1 };
	const statuses: ExplorerSelectionStatus[] = [];
	const errors: Array<string | null> = [];

	const controller = new ExplorerDynamicEntityController({
		hostTransport,
		isActivationReady: () => false,
		hasPresentedCameraPlacement: () => true,
		resolveSpawnAuthority: async () => ({
			placement: {
				position: { x: 0, y: 0, z: 0 },
				residency: { landblockId: "0xda55ffff", envCellId: null },
			} as never,
			viewDirection: [1, 0, 0],
		}),
		onBeginPossessionCamera: async () => undefined,
		onEndPossessionCamera: async () => undefined,
		onSetPossessedControlScheme: () => undefined,
		onRestoreNonPossessionControlScheme: () => undefined,
		onBoomFrame: () => undefined,
		onBoomTranslationIntent: () => undefined,
		onPhysicalCameraError: () => undefined,
		onEntityCatalogChange: () => undefined,
		onSpawnedEntitiesChange: () => undefined,
		onSpawnedEntityPresentationErrorChange: (error) => errors.push(error),
		onExplorerPossessionChange: () => undefined,
		onPossessedControlsChange: () => undefined,
		readSelectedEntity: () => selected,
		onClearSelectedEntity: () => {
			selected = null;
		},
		onSelectionStatusChange: (status) => statuses.push(status),
	});

	await controller.start();
	let tickHostSeconds = 1;
	return {
		controller,
		handlers,
		invokeImpl,
		statuses,
		errors,
		setSelected: (next: ExplorerEntitySelection | null) => {
			selected = next;
		},
		emitTeleport: (guid: number, generation: number, x: number) => {
			const moved = sampleEntity(guid, generation, x);
			const endpoint = {
				pose: moved.placement.pose,
				spatialMembership: moved.placement.spatialMembership,
			};
			handlers.get("explorer-dynamic-entity")?.({
				kind: "ticked",
				batch: {
					hostTime: { seconds: ++tickHostSeconds },
					durationMs: 0,
					advances: [
						{
							kind: "teleport",
							entity: moved,
							path: {
								initial: endpoint,
								legs: [{ endFraction: 1, end: endpoint }],
							},
						},
					],
					updates: [],
				},
			});
		},
		emitUpsert: (guid: number, generation: number, x: number) => {
			handlers.get("explorer-dynamic-entity")?.({
				kind: "upserted",
				entity: sampleEntity(guid, generation, x),
			});
		},
	};
}

describe("ExplorerDynamicEntityController transform & selection races", () => {
	it("dispatches Escape revert after an in-flight transform and never wedges subsequent drags", async () => {
		const h = await createControllerHarness();
		const firstGate = deferred<{ guid: number; generation: number }>();
		const sentXs: number[] = [];

		h.invokeImpl.mockImplementation(async (command, args) => {
			if (command === "set_explorer_entity_transform") {
				const request = args?.request as { pose: ExplorerWorldPose };
				sentXs.push(request.pose.coords.x);
				if (sentXs.length === 1) {
					const receipt = await firstGate.promise;
					h.emitTeleport(2, 1, request.pose.coords.x);
					return receipt;
				}
				h.emitTeleport(2, 1, request.pose.coords.x);
				return { guid: 2, generation: 1 };
			}
			return undefined;
		});

		// Drag step 1 is in flight; Escape cancels pending queue and schedules revertPose (x=1).
		h.controller.scheduleEntityTransform(2, 1, poseAt(10));
		h.controller.scheduleEntityTransform(2, 1, poseAt(15));
		h.controller.cancelPendingTransform();
		h.controller.scheduleEntityTransform(2, 1, poseAt(1));

		expect(sentXs).toEqual([10]);
		firstGate.resolve({ guid: 2, generation: 1 });
		await vi.waitFor(() => {
			expect(sentXs).toEqual([10, 1]);
		});

		// Subsequent drag after Escape still dispatches cleanly (transformInFlight did not wedge).
		h.controller.scheduleEntityTransform(2, 1, poseAt(25));
		await vi.waitFor(() => {
			expect(sentXs).toEqual([10, 1, 25]);
		});
	});

	it("prevents an older in-flight selection status response from clobbering launchQueued", async () => {
		const h = await createControllerHarness();
		const selectGate = deferred<ExplorerSelectionStatus>();

		h.invokeImpl.mockImplementation(async (command) => {
			if (command === "set_explorer_selected_entity") {
				return selectGate.promise;
			}
			if (command === "launch_explorer_entity") {
				h.emitUpsert(2, 1, 1);
				return { guid: 2, generation: 1, queued: true };
			}
			return undefined;
		});

		const selectPromise = h.controller.setSelectedExplorerEntity({
			guid: 2,
			generation: 1,
		});
		await h.controller.launchExplorerEntity(sampleEntity(2, 1));

		expect(h.statuses[h.statuses.length - 1]).toEqual({
			suspended: true,
			launchQueued: true,
		});

		// Late resolution of the earlier selection call must not overwrite launchQueued back to false.
		selectGate.resolve({ suspended: true, launchQueued: false });
		await selectPromise;
		expect(h.statuses[h.statuses.length - 1]).toEqual({
			suspended: true,
			launchQueued: true,
		});
	});

	it("refreshes selectionStatus from host when possessExplorerEntity fails", async () => {
		const h = await createControllerHarness();
		h.invokeImpl.mockImplementation(async (command) => {
			if (command === "possess_explorer_entity") {
				throw new Error("outside landscape");
			}
			if (command === "set_explorer_selected_entity") {
				return { suspended: true, launchQueued: true };
			}
			return undefined;
		});

		await expect(h.controller.possessExplorerEntity(2)).rejects.toThrow(
			"outside landscape",
		);
		expect(h.statuses[h.statuses.length - 1]).toEqual({
			suspended: true,
			launchQueued: true,
		});
	});
});
