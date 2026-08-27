import { describe, expect, it, vi } from "vitest";

import type { ActiveRegionSource } from "../lib/assets/active-region-source";
import type { LandblockProfileSource } from "../lib/assets/landblock-profile-source";
import {
	cellId,
	type DynamicEntityAdvanceBatch,
	type DynamicEntityView,
} from "../lib/game/runtime/dynamic-entity-feed";
import { Vec3 } from "../lib/game/math/types";
import type {
	ClientCameraTick,
	ClientCurrentState,
} from "./client-host-contract";
import type { ClientPresentationRuntime } from "./client-presentation-session";
import type { SceneInterestRequest } from "../lib/game/runtime/scene-interest";
import type {
	SceneActivationReceipt,
	SceneActivationRequest,
	SceneActivationStatus,
} from "../lib/game/runtime/scene-availability";
import {
	ClientPresentationSession,
	resolveClientEnvironmentSelection,
} from "./client-presentation-session";
import type { ClientLifecycleTransport } from "./client-lifecycle-session";
import { ClientLifecycleSession } from "./client-lifecycle-session";

describe("resolveClientEnvironmentSelection", () => {
	it("uses synchronized portal-year time and the archive calendar offset", () => {
		const source = activeRegion({
			dayLength: 100,
			zeroTimeOfYear: 25,
		});

		expect(resolveClientEnvironmentSelection(source, 75)).toEqual({
			dayGroupOverride: null,
			dayIndex: 1,
			timeOfDay: 0,
		});
	});

	it("rejects a server time before the archive calendar", () => {
		expect(() =>
			resolveClientEnvironmentSelection(
				activeRegion({ dayLength: 100, zeroTimeOfYear: 0 }),
				-1,
			),
		).toThrow("precedes");
	});
});

describe("ClientPresentationSession", () => {
	it("installs before identity and binds possession from the authority edge", async () => {
		const playerGuid = 0x0101_0001;
		const transport = new FakeClientTransport({
			...currentState(playerGuid),
			localPlayerGuid: null,
		});
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		const presentation = new ClientPresentationSession({
			canvas: fakeCanvas(),
			hostTransport: {} as never,
			session: lifecycle,
			ownerFactory: async () => fakeOwner(runtime, activeRegion()),
		});

		await presentation.start();
		expect(presentation.frame(1_000).status.kind).toBe("loading-player");

		transport.emit("client-local-player-established", { playerGuid });
		expect(presentation.frame(1_016).rendered).toBe(true);
		expect(runtime.viewerLightGuid).toBe(playerGuid);
		await presentation.destroy();
	});

	it("retains activation for duplicate portal state and replaces only on generation change", async () => {
		const playerGuid = 0x0101_0001;
		const transport = new FakeClientTransport({
			...currentState(playerGuid),
			lifecycle: portalLifecycle(4),
			worldGeneration: 4,
		});
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		const presentation = new ClientPresentationSession({
			canvas: fakeCanvas(),
			hostTransport: {} as never,
			session: lifecycle,
			ownerFactory: async () => fakeOwner(runtime, activeRegion()),
		});

		await presentation.start();
		presentation.frame(1_000);
		await vi.waitFor(() => expect(runtime.sceneRequests).toHaveLength(1));
		presentation.frame(1_016);

		transport.emit("client-lifecycle-changed", portalLifecycle(4));
		presentation.frame(1_032);
		expect(runtime.sceneRequests).toHaveLength(1);
		expect(runtime.completedActivations).toEqual([]);

		transport.emit("client-lifecycle-changed", { kind: "in-world" });
		expect(presentation.frame(1_040).status.kind).toBe("ready");
		expect(runtime.completedActivations).toEqual([4]);

		transport.emit("client-lifecycle-changed", portalLifecycle(5));
		presentation.frame(1_048);
		await vi.waitFor(() => expect(runtime.sceneRequests).toHaveLength(2));
		expect(runtime.completedActivations).toEqual([4]);
		await presentation.destroy();
	});

	it("reconciles snapshots, forwards authority batches, and follows residency targets", async () => {
		const transport = new FakeClientTransport(currentState(0x0101_0001));
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		const owner = fakeOwner(runtime, activeRegion());
		const presentation = new ClientPresentationSession({
			canvas: fakeCanvas(),
			hostTransport: {} as never,
			session: lifecycle,
			ownerFactory: async () => owner,
		});

		await presentation.start();
		expect(runtime.reconciled).toHaveLength(1);
		expect(
			runtime.reconciled[0]?.map((entity) => entity.identity.guid),
		).toEqual([0x0101_0001]);

		const firstFrame = presentation.frame(1_000);
		expect(firstFrame.rendered).toBe(true);
		await vi.waitFor(() => expect(runtime.sceneRequests).toHaveLength(1));
		expect(runtime.sceneRequests[0]?.target.requested).toMatchObject({
			kind: "env-cell",
			landblockId: "0x0101ffff",
			envCellId: "0x01010100",
		});
		const readyFrame = presentation.frame(1_016);
		expect(readyFrame.status.kind).toBe("ready");
		expect(runtime.viewerLightGuid).toBe(0x0101_0001);
		expect(runtime.primaryViews).toHaveLength(2);
		expect(runtime.audioListeners).toHaveLength(2);

		const batch = advanceBatch(0x0101_0001);
		transport.emit("client-dynamic-entity", { kind: "advanced", batch });
		await vi.waitFor(() => expect(runtime.advances).toHaveLength(1));
		expect(runtime.advances[0]?.batch).toEqual(batch);
		expect(runtime.advances[0]?.receivedAtMs).toBeTypeOf("number");

		transport.emit("client-presentation-discontinuity", {
			worldGeneration: 2,
			kind: "forced-reposition",
		});
		await vi.waitFor(() => expect(runtime.clearCount).toBe(1));
		const teleport = advanceBatch(0x0101_0001, 0x0100_0001, "teleport", 77);
		transport.emit("client-dynamic-entity", {
			kind: "advanced",
			batch: teleport,
		});
		await vi.waitFor(() => expect(runtime.advances).toHaveLength(2));
		expect(runtime.advances[1]?.batch.advances[0]?.kind).toBe("teleport");
		presentation.frame(1_032);
		await vi.waitFor(() => expect(runtime.sceneRequests).toHaveLength(2));
		expect(runtime.sceneRequests[1]?.target.requested).toMatchObject({
			kind: "automatic-landblock",
			landblockId: "0x0100ffff",
		});

		await presentation.destroy();
		expect(owner.destroyed).toBe(true);
	});

	it("holds rendering and rejects lagged advances during mirror recovery", async () => {
		const transport = new FakeClientTransport(currentState(0x0100_0001));
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		const presentation = new ClientPresentationSession({
			canvas: fakeCanvas(),
			hostTransport: {} as never,
			session: lifecycle,
			ownerFactory: async () => fakeOwner(runtime, activeRegion()),
		});
		await presentation.start();
		presentation.frame(1_000);

		transport.setCurrentState(currentState(0x0100_0002));
		transport.setEmitLaggedAdvance(true);
		const requestsBefore = runtime.advances.length;
		await lifecycle.requestCurrentState();
		await vi.waitFor(() =>
			expect(runtime.reconciled.length).toBeGreaterThan(1),
		);
		expect(runtime.advances).toHaveLength(requestsBefore);
		expect(presentation.frame(1_016).status.kind).toBe("loading-player");
		await presentation.destroy();
	});

	it("cancels presentation construction when the client exits during startup", async () => {
		const transport = new FakeClientTransport(currentState(0x0100_0001));
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		let observedSignal: AbortSignal | undefined;
		const presentation = new ClientPresentationSession({
			canvas: fakeCanvas(),
			hostTransport: {} as never,
			session: lifecycle,
			ownerFactory: async ({ signal }) => {
				observedSignal = signal;
				return await new Promise<never>((_resolve, reject) => {
					signal?.addEventListener("abort", () => {
						const error = new Error("cancelled");
						error.name = "AbortError";
						reject(error);
					});
				});
			},
		});

		const started = presentation.start();
		await presentation.destroy();

		await expect(started).resolves.toBeUndefined();
		expect(observedSignal?.aborted).toBe(true);
	});

	it("reports owner release failures after marking the session stopped", async () => {
		const transport = new FakeClientTransport(currentState(0x0100_0001));
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		const owner = fakeOwner(runtime, activeRegion());
		owner.destroy = async () => {
			throw new Error("owner release failed");
		};
		const presentation = new ClientPresentationSession({
			canvas: fakeCanvas(),
			hostTransport: {} as never,
			session: lifecycle,
			ownerFactory: async () => owner,
		});

		await presentation.start();
		await expect(presentation.destroy()).rejects.toMatchObject({
			message: "Client presentation shutdown failed for: presentation-owner.",
		});
		expect(presentation.status().kind).toBe("stopped");
	});
});

class FakeClientTransport implements ClientLifecycleTransport {
	readonly handlers = new Map<string, (payload: unknown) => void>();
	#currentState: ClientCurrentState;
	#emitLaggedAdvance = false;
	#cameraGeneration = 0;

	constructor(currentState: ClientCurrentState) {
		this.#currentState = currentState;
	}

	async listen(
		event: string,
		handler: (payload: unknown) => void,
	): Promise<() => void> {
		this.handlers.set(event, handler);
		return () => this.handlers.delete(event);
	}

	async invoke(command: string, args?: Record<string, unknown>): Promise<void> {
		if (command === "start_client_camera") {
			const request = args?.request as {
				playerGuid: number;
				entityGeneration: number;
			};
			this.#cameraGeneration += 1;
			const identity = {
				cameraGeneration: this.#cameraGeneration,
				playerGuid: request.playerGuid,
				entityGeneration: request.entityGeneration,
			};
			this.emit("client-camera-started", identity);
			this.emit("client-camera", cameraTick(identity));
			return;
		}
		if (command !== "request_client_current_state") return;
		if (this.#emitLaggedAdvance) {
			this.emit("client-dynamic-entity", {
				kind: "advanced",
				batch: advanceBatch(this.#currentState.localPlayerGuid ?? 0),
			});
		}
		this.emit("client-current-state", this.#currentState);
	}

	setCurrentState(state: ClientCurrentState): void {
		this.#currentState = state;
	}

	setEmitLaggedAdvance(enabled: boolean): void {
		this.#emitLaggedAdvance = enabled;
	}

	emit(event: string, payload: unknown): void {
		this.handlers.get(event)?.(payload);
	}
}

function cameraTick(identity: {
	readonly cameraGeneration: number;
	readonly playerGuid: number;
	readonly entityGeneration: number;
}): ClientCameraTick {
	const point = {
		landblockId: 0x0100_ffff,
		coords: { x: 12, y: 3, z: 2 },
	};
	return {
		kind: "reseeded",
		...identity,
		sequence: 1,
		durationMs: 30,
		targetSphereRole: "primary",
		clearance: { projectionRevision: 1, radius: 0.2 },
		desiredReach: 4.5,
		renderedReach: 4.5,
		path: {
			initial: { position: point, visualPivot: point },
			legs: [{ endFraction: 1, end: { position: point, visualPivot: point } }],
		},
		reason: "initial-placement",
		diagnostics: {
			controlLegs: 0,
			clearanceSweeps: 0,
			transitSubsteps: 0,
			contactPasses: 0,
		},
	};
}

class FakePresentationRuntime implements ClientPresentationRuntime {
	reconciled: DynamicEntityView[][] = [];
	advances: Array<{ batch: DynamicEntityAdvanceBatch; receivedAtMs: number }> =
		[];
	sceneRequests: SceneInterestRequest[] = [];
	primaryViews: unknown[] = [];
	audioListeners: unknown[] = [];
	viewerLightGuid: number | null = null;
	clearCount = 0;
	portalTransitions: unknown[] = [];
	completedActivations: number[] = [];

	async reconcileDynamicEntities(
		entities: readonly DynamicEntityView[],
	): Promise<void> {
		this.reconciled.push([...entities]);
	}

	applyDynamicEntityAdvances(
		batch: DynamicEntityAdvanceBatch,
		receivedAtMs: number,
	): void {
		this.advances.push({ batch, receivedAtMs });
	}

	updateSceneInterest(request: SceneInterestRequest): void {
		this.sceneRequests.push(request);
	}

	async activateScene(
		request: SceneActivationRequest,
	): Promise<SceneActivationReceipt> {
		this.sceneRequests.push(request.target);
		return {
			generation: request.generation,
			revision: 1 as never,
			requiredLayers: new Map(),
		};
	}

	sceneActivationStatus(
		receipt: SceneActivationReceipt,
	): SceneActivationStatus {
		return { kind: "ready", receipt };
	}

	completeSceneActivation(generation: number): void {
		this.completedActivations.push(generation);
	}

	clearSceneInterest(): void {
		this.clearCount += 1;
	}

	resolveViewportExtent(): { width: number; height: number } {
		return { width: 640, height: 480 };
	}

	setPrimaryView(view: unknown): void {
		this.primaryViews.push(view);
	}

	setAudioListener(listener: unknown): void {
		this.audioListeners.push(listener);
	}

	setSceneEnvironment(): void {}

	setViewerLightCarrier(guid: number | null): void {
		this.viewerLightGuid = guid;
	}

	setPortalTransition(transition: unknown): void {
		this.portalTransitions.push(transition);
	}

	dynamicEntityOrigin(): ReturnType<
		ClientPresentationRuntime["dynamicEntityOrigin"]
	> {
		return {
			envCellId: null,
			landblockId: "0x0100ffff",
			landblockOrigin: new Vec3(12, 3, -4),
			scope: { kind: "outdoor" },
		};
	}

	hasEnvCellScope(): boolean {
		return true;
	}

	tick(): void {}

	render(): void {}
}

function fakeOwner(
	runtime: FakePresentationRuntime,
	region: ActiveRegionSource,
): {
	activeRegion: ActiveRegionSource;
	profileSource: LandblockProfileSource;
	runtime: FakePresentationRuntime;
	destroyed: boolean;
	destroy(): Promise<void>;
} {
	const owner = {
		activeRegion: region,
		profileSource: {
			loadLandblockProfile: async (landblockId: `0x${string}`) => ({
				landblockId,
				sceneClass: "outdoor-only" as const,
			}),
		},
		runtime,
		destroyed: false,
		async destroy() {
			this.destroyed = true;
		},
	};
	return owner;
}

function fakeCanvas(): HTMLCanvasElement {
	return { clientWidth: 640, clientHeight: 480 } as HTMLCanvasElement;
}

function activeRegion(
	calendar: {
		readonly dayLength?: number;
		readonly zeroTimeOfYear?: number;
	} = {},
): ActiveRegionSource {
	return {
		data: {
			calendar: {
				dayLength: calendar.dayLength ?? 100,
				zeroTimeOfYear: calendar.zeroTimeOfYear ?? 0,
				daysPerYear: 360,
				zeroYear: 0,
				timesOfDay: [],
				daysOfTheWeek: [],
				seasons: [],
				yearSpec: "P.Y.",
			},
			sky: null,
			sound: null,
			scenes: null,
			terrain: null,
			land: {
				numBlockLength: 0,
				numBlockWidth: 0,
				squareLength: 0,
				landblockLength: 0,
				verticesPerCell: 0,
				maxObjectHeight: 0,
				roadWidth: 0,
			},
			misc: null,
		},
		landHeightTable: new Float32Array(),
		provenance: {
			sourceRecordId: "0x00000000",
			number: 0,
			version: 0,
			name: "test",
			partsMask: 0,
		},
	} as ActiveRegionSource;
}

function currentState(playerGuid: number): ClientCurrentState {
	const landblockId = playerGuid === 0x0101_0001 ? 0x0101_0100 : 0x0100_0001;
	return {
		lifecycle: { kind: "in-world" },
		localPlayerGuid: playerGuid,
		serverTime: 75,
		worldGeneration: 1,
		dynamic: {
			hostTime: { seconds: 75 },
			entities: [view(playerGuid, landblockId)],
		},
	};
}

function portalLifecycle(
	worldGeneration: number,
): ClientCurrentState["lifecycle"] {
	return {
		kind: "portal-space",
		worldGeneration,
		cause: "teleport",
	};
}

function view(guid: number, landblockId = 0x0101_0100): DynamicEntityView {
	return {
		generation: 1,
		identity: { guid, wcid: 42, name: "Player" },
		presentation: {
			content: {
				motionTableDid: null,
				setupDid: 0x0200_0001,
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
			radar: { blipColor: "Default", behavior: null, obviousRange: null },
		},
		physics: {
			semanticMask: 0,
			participation: "pose-only",
			noDraw: false,
			hidden: false,
			cloaked: false,
			lighting: false,
			defaultAnimation: false,
			defaultScript: false,
		},
		placement: {
			kind: "world",
			pose: {
				landblockId: cellId(landblockId),
				coords: { x: 4, y: 5, z: 6 },
				rotation: { w: 1, x: 0, y: 0, z: 0 },
			},
			spatialMembership: {
				reachesOutdoors: false,
				reachedEnvCellIds: [cellId(0x0101_0001)],
			},
			velocity: { x: 0, y: 0, z: 0 },
			acceleration: { x: 0, y: 0, z: 0 },
			omega: { x: 0, y: 0, z: 0 },
			contact: "grounded",
			sampleMode: "authoritative-only",
		},
		playingClip: null,
	};
}

function advanceBatch(
	guid: number,
	landblockId = 0x0101_0100,
	kind: "integrated" | "teleport" | "reset" = "integrated",
	hostTime = 76,
): DynamicEntityAdvanceBatch {
	const entity = view(guid, landblockId);
	if (entity.placement.kind !== "world")
		throw new Error("test view must be world placed");
	const endpoint = {
		pose: entity.placement.pose,
		spatialMembership: entity.placement.spatialMembership,
	};
	return {
		hostTime: { seconds: hostTime },
		durationMs: 100,
		advances: [
			{
				entity,
				kind,
				path: { initial: endpoint, legs: [{ endFraction: 1, end: endpoint }] },
			},
		],
	};
}
