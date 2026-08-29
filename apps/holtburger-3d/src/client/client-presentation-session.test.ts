import { describe, expect, it, vi } from "vitest";

import type { ActiveRegionSource } from "../lib/assets/active-region-source";
import type { LandblockProfileSource } from "../lib/assets/landblock-profile-source";
import {
	cellId,
	type DynamicEntityTickBatch,
	type DynamicEntityView,
} from "../lib/game/runtime/dynamic-entity-feed";
import { Mat4, Vec3 } from "../lib/game/math/types";
import type { MapTerrainSource } from "../lib/game/map/map-renderer";
import type { ScenePlacement } from "../lib/game/scene";
import { createLandblockWorldOrigin } from "../lib/game/landblocks";
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
import type { DynamicEntityRealizationDisposition } from "../lib/game/runtime/dynamic-entity-presentation";
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
		const landblockOrigin = createLandblockWorldOrigin("0x0100ffff");
		expect(presentation.readMapPanelFrame()).toMatchObject({
			anchor: {
				residency: { envCellId: null, landblockId: "0x0100ffff" },
				worldX: landblockOrigin.x + 12,
				worldY: landblockOrigin.y + 3,
				worldZ: landblockOrigin.z - 4,
			},
			presentedEntityRevision: 0,
			source: runtime,
		});
		expect(presentation.readDiagnostics()).toMatchObject({
			playerGuid,
			playerResidency: {
				envCellId: null,
				landblockId: "0x0100ffff",
			},
			cameraResidency: {
				envCellId: null,
				landblockId: "0x0100ffff",
			},
			cameraStatus: { kind: "active" },
			renderedFrameCount: 1,
			draw: null,
		});
		await presentation.destroy();
	});

	it("retains activation for duplicate portal state and replaces it on generation change", async () => {
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

	it("replaces same-generation destination convergence and reveals only an installed player", async () => {
		const playerGuid = 0x0101_0001;
		const transport = new FakeClientTransport({
			...currentState(playerGuid),
			lifecycle: portalLifecycle(4),
			worldGeneration: 4,
		});
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		runtime.realizationDisposition = "deferred";
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
		await vi.waitFor(() =>
			expect(runtime.snapshotReplacements).toHaveLength(1),
		);
		expect(presentation.frame(1_032).status.kind).toBe("loading-player");
		expect(transport.acknowledgedWorldReveals).toEqual([]);
		transport.emit("client-dynamic-entity", {
			kind: "ticked",
			batch: advanceBatch(playerGuid),
		});
		await vi.waitFor(() => expect(runtime.advances).toHaveLength(1));
		expect(runtime.snapshotReplacements).toHaveLength(1);
		const eligibilityReevaluationsBefore = runtime.eligibilityReevaluationCount;

		runtime.realizationDisposition = "installed";
		transport.emit("client-dynamic-entity", {
			kind: "upserted",
			entity: view(playerGuid, 0x0100_0001),
		});
		presentation.frame(1_048);
		await vi.waitFor(() => expect(runtime.sceneRequests).toHaveLength(2));
		expect(runtime.completedActivations).toEqual([4]);
		presentation.frame(1_064);
		await vi.waitFor(() =>
			expect(runtime.eligibilityReevaluationCount).toBeGreaterThan(
				eligibilityReevaluationsBefore,
			),
		);
		expect(runtime.upserted).toHaveLength(1);

		expect(presentation.frame(2_000).rendered).toBe(true);
		expect(presentation.frame(4_100).rendered).toBe(true);
		await vi.waitFor(() =>
			expect(transport.acknowledgedWorldReveals).toEqual([4]),
		);
		await presentation.destroy();
	});

	it("reveals a portal destination from a current fallback camera placement", async () => {
		const playerGuid = 0x0101_0001;
		const transport = new FakeClientTransport({
			...currentState(playerGuid),
			lifecycle: portalLifecycle(4),
			worldGeneration: 4,
		});
		transport.setCameraOutput("fallback");
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
		await vi.waitFor(() =>
			expect(runtime.snapshotReplacements).toHaveLength(1),
		);
		await vi.waitFor(() =>
			expect(presentation.frame(1_032).rendered).toBe(true),
		);
		expect(presentation.readDiagnostics().cameraStatus).toMatchObject({
			kind: "active",
			clearance: null,
			renderedReach: 0,
			placementOutcome: {
				kind: "fallback",
				reason: "free-sphere-query",
			},
		});
		expect(presentation.frame(4_100).rendered).toBe(true);
		await vi.waitFor(() =>
			expect(transport.acknowledgedWorldReveals).toEqual([4]),
		);
		await presentation.destroy();
	});

	it.each(["none", "wrong-generation"] as const)(
		"keeps a portal destination hidden for %s camera output",
		async (cameraOutput) => {
			const playerGuid = 0x0101_0001;
			const transport = new FakeClientTransport({
				...currentState(playerGuid),
				lifecycle: portalLifecycle(4),
				worldGeneration: 4,
			});
			transport.setCameraOutput(cameraOutput);
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
			await vi.waitFor(() =>
				expect(runtime.snapshotReplacements).toHaveLength(1),
			);
			await vi.waitFor(() =>
				expect(presentation.frame(1_032).status.kind).toBe(
					"loading-activation",
				),
			);
			expect(presentation.frame(4_100).rendered).toBe(false);
			expect(transport.acknowledgedWorldReveals).toEqual([]);
			await presentation.destroy();
		},
	);

	it("replaces snapshots, forwards authority batches, and follows residency targets", async () => {
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
		expect(runtime.snapshotReplacements).toHaveLength(1);
		expect(
			runtime.snapshotReplacements[0]?.map((entity) => entity.identity.guid),
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
		transport.emit("client-dynamic-entity", { kind: "ticked", batch });
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
			kind: "ticked",
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

	it("preserves accepted upserts without replacing the complete mirror", async () => {
		const playerGuid = 0x0101_0001;
		const transport = new FakeClientTransport(currentState(playerGuid));
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
		expect(runtime.snapshotReplacements).toHaveLength(1);
		for (const guid of [0x0101_0002, 0x0101_0003, 0x0101_0004]) {
			transport.emit("client-dynamic-entity", {
				kind: "upserted",
				entity: view(guid),
			});
		}
		await vi.waitFor(() => expect(runtime.upserted).toHaveLength(3));

		expect(runtime.snapshotReplacements).toHaveLength(1);
		expect(runtime.upserted.map((entity) => entity.identity.guid)).toEqual([
			0x0101_0002, 0x0101_0003, 0x0101_0004,
		]);
		await presentation.destroy();
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
			expect(runtime.snapshotReplacements.length).toBeGreaterThan(1),
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
	readonly acknowledgedWorldReveals: number[] = [];
	#currentState: ClientCurrentState;
	#emitLaggedAdvance = false;
	#cameraGeneration = 0;
	#cameraOutput: "proven" | "fallback" | "none" | "wrong-generation" = "proven";

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
		if (command === "acknowledge_client_world_reveal") {
			const worldGeneration = args?.worldGeneration;
			if (typeof worldGeneration !== "number") {
				throw new Error("World reveal acknowledgement omitted its generation.");
			}
			this.acknowledgedWorldReveals.push(worldGeneration);
			return;
		}
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
			if (this.#cameraOutput === "none") return;
			const tickIdentity =
				this.#cameraOutput === "wrong-generation"
					? { ...identity, cameraGeneration: identity.cameraGeneration + 1 }
					: identity;
			this.emit(
				"client-camera",
				this.#cameraOutput === "fallback"
					? fallbackCameraTick(tickIdentity)
					: cameraTick(tickIdentity),
			);
			return;
		}
		if (command !== "request_client_current_state") return;
		if (this.#emitLaggedAdvance) {
			this.emit("client-dynamic-entity", {
				kind: "ticked",
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

	setCameraOutput(
		output: "proven" | "fallback" | "none" | "wrong-generation",
	): void {
		this.#cameraOutput = output;
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
			collisionProof: { status: "covered" },
			controlLegs: 0,
			clearanceSweeps: 0,
			transitSubsteps: 0,
			contactPasses: 0,
		},
	};
}

function fallbackCameraTick(identity: {
	readonly cameraGeneration: number;
	readonly playerGuid: number;
	readonly entityGeneration: number;
}): ClientCameraTick {
	const point = {
		landblockId: 0x0100_ffff,
		coords: { x: 12, y: 3, z: 2 },
	};
	return {
		kind: "fallback",
		...identity,
		sequence: 1,
		durationMs: 30,
		targetSphereRole: "primary",
		desiredReach: 4.5,
		path: {
			initial: { position: point, visualPivot: point },
			legs: [{ endFraction: 1, end: { position: point, visualPivot: point } }],
		},
		reason: "free-sphere-query",
		diagnostics: {
			collisionProof: { status: "covered" },
			controlLegs: 0,
			clearanceSweeps: 0,
			transitSubsteps: 0,
			contactPasses: 8,
		},
	};
}

class FakePresentationRuntime implements ClientPresentationRuntime {
	readonly mapGeometry = { revision: 0 } as MapTerrainSource["mapGeometry"];
	readonly terrainInstallationRevision = 0;
	readonly dynamicEntityPlacementRevision = 0;
	snapshotReplacements: DynamicEntityView[][] = [];
	upserted: DynamicEntityView[] = [];
	removed: Array<{ guid: number; generation: number }> = [];
	eligibilityReevaluationCount = 0;
	advances: Array<{ batch: DynamicEntityTickBatch; receivedAtMs: number }> = [];
	sceneRequests: SceneInterestRequest[] = [];
	primaryViews: unknown[] = [];
	audioListeners: unknown[] = [];
	viewerLightGuid: number | null = null;
	clearCount = 0;
	portalTransitions: unknown[] = [];
	completedActivations: number[] = [];
	realizationDisposition: DynamicEntityRealizationDisposition = "installed";
	#activationRevision = 0;
	readonly #desired = new Map<number, DynamicEntityView>();

	async replaceDynamicEntitySnapshot(
		entities: readonly DynamicEntityView[],
	): ReturnType<ClientPresentationRuntime["replaceDynamicEntitySnapshot"]> {
		this.snapshotReplacements.push([...entities]);
		this.#desired.clear();
		for (const entity of entities)
			this.#desired.set(entity.identity.guid, entity);
		return new Map(
			entities.map((entity) => [
				entity.identity.guid,
				this.realizationDisposition,
			]),
		);
	}

	async upsertDynamicEntity(
		entity: DynamicEntityView,
	): ReturnType<ClientPresentationRuntime["upsertDynamicEntity"]> {
		this.upserted.push(entity);
		this.#desired.set(entity.identity.guid, entity);
		return this.realizationDisposition;
	}

	removeDynamicEntity(guid: number, generation: number): void {
		this.removed.push({ generation, guid });
		if (this.#desired.get(guid)?.generation === generation)
			this.#desired.delete(guid);
	}

	async reevaluateDynamicEntityEligibility(): ReturnType<
		ClientPresentationRuntime["reevaluateDynamicEntityEligibility"]
	> {
		this.eligibilityReevaluationCount += 1;
		return new Map(
			[...this.#desired.values()].map((entity) => [
				entity.identity.guid,
				this.realizationDisposition,
			]),
		);
	}

	applyDynamicEntityTick(
		batch: DynamicEntityTickBatch,
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
		this.#activationRevision += 1;
		return {
			generation: request.generation,
			revision: this.#activationRevision as never,
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
		if (this.realizationDisposition === "deferred") return null;
		return {
			envCellId: null,
			landblockId: "0x0100ffff",
			landblockOrigin: new Vec3(12, 3, -4),
			scope: { kind: "outdoor" },
		};
	}

	spawnedEntityPlacement(): ScenePlacement | null {
		const localTransform = Mat4.identity();
		localTransform.m41 = 12;
		localTransform.m42 = 3;
		localTransform.m43 = -4;
		return {
			envCellId: null,
			landblockId: "0x0100ffff",
			localTransform,
		};
	}

	listPresentedSpawnedEntities(): [] {
		return [];
	}

	listInstalledTerrain(): [] {
		return [];
	}

	terrainColorPalette(): null {
		return null;
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
		worldName: "Leafcull",
		playerName: "Player",
		vitals: [],
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
			category: "other",
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
			contact: "grounded",
			sampleMode: "authoritative-only",
		},
		playingClip: null,
	};
}

function advanceBatch(
	guid: number,
	landblockId = 0x0101_0100,
	kind: "integrated" | "correction-snap" | "teleport" | "reset" = "integrated",
	hostTime = 76,
): DynamicEntityTickBatch {
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
		updates: [],
	};
}
