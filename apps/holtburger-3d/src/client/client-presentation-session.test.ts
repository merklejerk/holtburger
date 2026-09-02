import { describe, expect, it, vi } from "vitest";

import type { ActiveRegionSource } from "../lib/assets/active-region-source";
import { landblockVector3 } from "../lib/assets/ac-frame";
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
import { CLIENT_TUNING } from "./client-tuning";
import type { WorldIndicatorInput } from "../lib/game/renderer/renderer";
import type {
	PortalTransitionPresentationPlan,
	PortalTransitionPresentationReceipt,
} from "../lib/client/portal-transition-presentation";

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
	it("presents portal space before local-player identity exists", async () => {
		const playerGuid = 0x0101_0001;
		const transport = new FakeClientTransport({
			...currentState(playerGuid),
			lifecycle: portalLifecycle(4),
			localPlayerGuid: null,
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
		expect(presentation.frame(1_000)).toMatchObject({
			rendered: true,
			status: { kind: "loading-player" },
		});
		expect(runtime.portalTransitionRenderTimes).toEqual([1]);
		expect(runtime.portalTransitionSounds).toEqual(["enter"]);
		expect(presentation.frame(1_016).rendered).toBe(true);
		expect(runtime.portalTransitionSounds).toEqual(["enter"]);
		await presentation.destroy();
	});

	it("clears portal pixels to black when destination activation fails", async () => {
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
		runtime.activationFailure = "Destination scene failed.";
		expect(presentation.frame(1_016)).toMatchObject({
			rendered: false,
			status: { kind: "error", diagnostic: "Destination scene failed." },
		});
		expect(runtime.clearPresentationCount).toBe(1);
		expect(runtime.portalTransitions.at(-1)).toBeUndefined();
		await presentation.destroy();
	});

	it("keeps presenting the tunnel until the destination EnvCell scope exists", async () => {
		const playerGuid = 0x0101_0001;
		const transport = new FakeClientTransport({
			...currentState(playerGuid),
			lifecycle: portalLifecycle(4),
			worldGeneration: 4,
		});
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		runtime.dynamicOriginEnvCellId = "0x01000100";
		runtime.envCellScopeAvailable = false;
		const presentation = new ClientPresentationSession({
			canvas: fakeCanvas(),
			hostTransport: {} as never,
			session: lifecycle,
			ownerFactory: async () => fakeOwner(runtime, activeRegion()),
		});

		await presentation.start();
		presentation.frame(1_000);
		await vi.waitFor(() => expect(runtime.sceneRequests).toHaveLength(1));
		await vi.waitFor(() => {
			expect(presentation.frame(1_016)).toMatchObject({
				rendered: true,
				status: { kind: "loading-activation" },
			});
		});
		expect(runtime.portalTransitions.at(-1)?.kind).toBe("tunnel-only");
		expect(transport.acknowledgedWorldReveals).toEqual([]);

		runtime.envCellScopeAvailable = true;
		expect(presentation.frame(2_000).rendered).toBe(true);
		expect(runtime.portalTransitions.at(-1)).toMatchObject({
			kind: "tunnel-to-destination",
			progress: 0,
		});
		expect(transport.acknowledgedWorldReveals).toEqual([]);

		const portalOnlyFramesAtExit = runtime.portalTransitionRenderTimes.length;
		runtime.envCellScopeAvailable = false;
		expect(presentation.frame(2_500).rendered).toBe(true);
		expect(runtime.portalTransitions.at(-1)).toMatchObject({
			kind: "tunnel-to-destination",
			progress: 0.5,
		});
		expect(runtime.portalTransitionRenderTimes).toHaveLength(
			portalOnlyFramesAtExit,
		);
		expect(runtime.worldRenderCount).toBe(2);
		await presentation.destroy();
	});

	it("retains frame settings across owner construction and applies later changes", async () => {
		const playerGuid = 0x0101_0001;
		const lifecycle = new ClientLifecycleSession(
			new FakeClientTransport(currentState(playerGuid)),
		);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		const hiddenSettings = {
			...CLIENT_TUNING.frameSettings,
			showRetailHiddenGeometry: false,
		};
		const visibleSettings = {
			...CLIENT_TUNING.frameSettings,
			showRetailHiddenGeometry: true,
		};
		let constructedWith: Parameters<
			ClientPresentationRuntime["setFrameSettings"]
		>[0] = hiddenSettings;
		const presentation = new ClientPresentationSession({
			canvas: fakeCanvas(),
			hostTransport: {} as never,
			session: lifecycle,
			ownerFactory: async (dependencies) => {
				constructedWith = dependencies.frameSettings;
				return fakeOwner(runtime, activeRegion());
			},
		});
		presentation.setFrameSettings(visibleSettings);

		await presentation.start();
		expect(constructedWith.showRetailHiddenGeometry).toBe(true);
		presentation.setFrameSettings(hiddenSettings);
		expect(runtime.frameSettings.at(-1)?.showRetailHiddenGeometry).toBe(false);
		await presentation.destroy();
	});

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
		expect(presentation.readMinimapFrame()).toMatchObject({
			subject: {
				anchor: {
					residency: { envCellId: null, landblockId: "0x0100ffff" },
					worldX: landblockOrigin.x + 12,
					worldY: landblockOrigin.y + 3,
					worldZ: landblockOrigin.z - 4,
				},
				guid: playerGuid,
				kind: "controlled-entity",
			},
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

	it("samples aim from the exact presented CSS viewport and camera identity", async () => {
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
		expect(presentation.frame(1_000).rendered).toBe(true);
		const center = presentation.samplePreciseJumpRay(420, 290);
		const right = presentation.samplePreciseJumpRay(740, 290);

		expect(center).toMatchObject({
			anchor: 0x0100_ffff,
			camera: {
				cameraGeneration: 1,
				playerGuid,
				entityGeneration: 1,
			},
			maximumDistance: CLIENT_TUNING.preciseJump.maximumAimDistance,
		});
		expect(Math.hypot(...(center?.direction ?? []))).toBeCloseTo(1);
		expect(right?.direction).not.toEqual(center?.direction);
		await presentation.destroy();
	});

	it("projects an accepted evaluation into one scoped render-axis marker", async () => {
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

		presentation.setPreciseJumpMarker({
			evaluationId: 4,
			camera: { cameraGeneration: 1, entityGeneration: 1, playerGuid },
			sequence: 8,
			status: "reachable",
			target: {
				anchor: 0x0100_ffff,
				committedCell: 0x0100_0102,
				normal: [0, 0, 1],
				point: landblockVector3([10, 20, 4]),
			},
			trajectory: {
				anchor: 0x0100_ffff,
				origin: landblockVector3([12, 18, 1]),
				velocity: [-2, 0, 5],
				acceleration: [0, 0, -9.8],
				durationSeconds: 1,
				placements: [
					{
						startFraction: 0,
						endFraction: 1,
						committedCell: 0x0100_0102,
					},
				],
			},
			diagnostics: {
				evaluatedCandidates: 2,
				generatedCandidates: 6,
				solverTicks: 30,
			},
		});

		const origin = createLandblockWorldOrigin("0x0100ffff");
		expect(runtime.worldIndicators.at(-1)).toMatchObject({
			marker: {
				color: [0.08, 0.48, 1, 0.9],
				normal: [0, 1, -0],
				position: { x: origin.x + 10, y: 4, z: origin.z - 20 },
				renderScopeKey: "0x01000102",
			},
			trajectory: {
				origin: { x: origin.x + 12, y: 1, z: origin.z - 18 },
				velocity: [-2, 5, -0],
				acceleration: [0, -9.8, -0],
				placements: [{ renderScopeKey: "0x01000102" }],
			},
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

		transport.emit("client-lifecycle-changed", portalLifecycle(5));
		presentation.frame(1_040);
		await vi.waitFor(() => expect(runtime.sceneRequests).toHaveLength(2));
		expect(runtime.completedActivations).toEqual([4]);
		expect(runtime.portalTransitionSounds).toEqual(["enter", "enter"]);
		await presentation.destroy();
	});

	it("keeps the portal presentation active across authority grace until neutral handoff", async () => {
		const playerGuid = 0x0101_0001;
		const transport = new FakeClientTransport({
			...currentState(playerGuid),
			lifecycle: portalLifecycle(4, "initial-entry"),
			worldGeneration: 4,
		});
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		runtime.dynamicOriginEnvCellId = "0x01000100";
		runtime.envCellScopeAvailable = false;
		const releaseSceneActivation = runtime.holdNextSceneActivation();
		const presentation = new ClientPresentationSession({
			canvas: fakeCanvas(),
			hostTransport: {} as never,
			session: lifecycle,
			ownerFactory: async () => fakeOwner(runtime, activeRegion()),
		});

		await presentation.start();
		presentation.frame(1_000);
		await vi.waitFor(() => expect(runtime.sceneRequests).toHaveLength(1));
		transport.emit("client-lifecycle-changed", { kind: "in-world" });

		expect(presentation.frame(8_016)).toMatchObject({
			rendered: true,
			status: { kind: "loading-activation" },
		});
		expect(runtime.portalTransitions.at(-1)?.kind).toBe("tunnel-only");
		expect(runtime.completedActivations).toEqual([]);
		expect(runtime.clearPresentationCount).toBe(0);
		expect(runtime.worldRenderCount).toBe(0);

		releaseSceneActivation();
		await vi.waitFor(() => {
			expect(presentation.frame(8_032).status.kind).toBe("loading-activation");
			expect(runtime.eligibilityReevaluationCount).toBeGreaterThan(0);
		});
		runtime.envCellScopeAvailable = true;
		expect(presentation.frame(9_000).rendered).toBe(true);
		expect(runtime.portalTransitions.at(-1)).toMatchObject({
			kind: "tunnel-to-destination",
			progress: 0,
		});
		expect(presentation.frame(10_000).rendered).toBe(true);
		expect(runtime.portalTransitions.at(-1)?.kind).toBe(
			"destination-only-awaiting-handoff",
		);
		await vi.waitFor(() =>
			expect(transport.acknowledgedWorldReveals).toEqual([4]),
		);

		expect(presentation.frame(10_016)).toMatchObject({
			rendered: true,
			status: { kind: "ready" },
		});
		expect(runtime.portalTransitions.at(-1)).toBeUndefined();
		expect(runtime.completedActivations).toEqual([4]);
		expect(runtime.clearPresentationCount).toBe(0);
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
		expect(runtime.portalTransitions.at(-1)).toMatchObject({
			kind: "tunnel-to-destination",
			progress: 0,
		});
		expect(runtime.portalTransitionSounds).toEqual(["enter", "exit"]);
		expect(presentation.frame(2_500).rendered).toBe(true);
		expect(runtime.portalTransitionSounds).toEqual(["enter", "exit"]);
		expect(runtime.portalTransitions.at(-1)).toMatchObject({
			kind: "tunnel-to-destination",
			progress: 0.5,
		});
		expect(transport.acknowledgedWorldReveals).toEqual([]);
		expect(presentation.frame(3_000).rendered).toBe(true);
		expect(runtime.portalTransitions.at(-1)).toMatchObject({
			kind: "destination-only-awaiting-handoff",
		});
		await vi.waitFor(() =>
			expect(transport.acknowledgedWorldReveals).toEqual([4]),
		);
		await presentation.destroy();
	});

	it("keeps portal space visible for an unsettled fallback camera", async () => {
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
		expect(presentation.frame(5_100).rendered).toBe(true);
		expect(presentation.frame(6_100).rendered).toBe(true);
		expect(presentation.frame(6_101).rendered).toBe(true);
		expect(transport.acknowledgedWorldReveals).toEqual([]);
		expect(runtime.portalTransitionRenderTimes.length).toBeGreaterThan(0);
		await presentation.destroy();
	});

	it.each(["none", "wrong-generation"] as const)(
		"keeps portal space presenting for %s camera output",
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
			expect(presentation.frame(4_100).rendered).toBe(true);
			expect(runtime.portalTransitionRenderTimes.length).toBeGreaterThan(0);
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

	it("applies a later tick while an unrelated entity realization remains pending", async () => {
		const playerGuid = 0x0101_0001;
		const transport = new FakeClientTransport(currentState(playerGuid));
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		const releaseRealization = runtime.holdNextUpsertRealization();
		const presentation = new ClientPresentationSession({
			canvas: fakeCanvas(),
			hostTransport: {} as never,
			session: lifecycle,
			ownerFactory: async () => fakeOwner(runtime, activeRegion()),
		});
		await presentation.start();
		const now = vi.spyOn(performance, "now");
		let clockMs = 1_000;
		now.mockImplementation(() => clockMs);

		try {
			transport.emit("client-dynamic-entity", {
				kind: "upserted",
				entity: view(0x0101_0002),
			});
			expect(runtime.upserted).toHaveLength(1);

			const batch = advanceBatch(playerGuid);
			transport.emit("client-dynamic-entity", { kind: "ticked", batch });
			transport.emit("client-dynamic-entity", {
				kind: "removed",
				guid: 0x0101_0002,
				generation: 1,
			});
			clockMs = 2_000;

			expect(runtime.advances).toEqual([{ batch, receivedAtMs: 1_000 }]);
			expect(runtime.removed).toEqual([{ guid: 0x0101_0002, generation: 1 }]);
		} finally {
			releaseRealization();
			now.mockRestore();
			await presentation.destroy();
		}
	});

	it("reports an upsert realization failure without blocking later ticks", async () => {
		const playerGuid = 0x0101_0001;
		const transport = new FakeClientTransport(currentState(playerGuid));
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		const failure = new Error("visual realization failed");
		runtime.failNextUpsertRealization(failure);
		const onError = vi.fn();
		const presentation = new ClientPresentationSession({
			canvas: fakeCanvas(),
			hostTransport: {} as never,
			session: lifecycle,
			onError,
			ownerFactory: async () => fakeOwner(runtime, activeRegion()),
		});
		await presentation.start();

		try {
			transport.emit("client-dynamic-entity", {
				kind: "upserted",
				entity: view(0x0101_0002),
			});
			const batch = advanceBatch(playerGuid);
			transport.emit("client-dynamic-entity", { kind: "ticked", batch });

			expect(runtime.advances).toEqual([
				{ batch, receivedAtMs: expect.any(Number) },
			]);
			await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
			expect(onError).toHaveBeenCalledTimes(1);
			expect(presentation.status()).toEqual({
				kind: "error",
				diagnostic: "visual realization failed",
			});
		} finally {
			await presentation.destroy();
		}
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
		convergence: "settled",
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
		convergence: "converging",
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
	portalTransitions: Array<PortalTransitionPresentationPlan | undefined> = [];
	portalTransitionRenderTimes: number[] = [];
	portalTransitionSounds: Array<"enter" | "exit"> = [];
	clearPresentationCount = 0;
	worldRenderCount = 0;
	activationFailure: string | null = null;
	worldIndicators: Array<WorldIndicatorInput | null> = [];
	completedActivations: number[] = [];
	frameSettings: Parameters<
		ClientPresentationRuntime["setFrameSettings"]
	>[0][] = [];
	realizationDisposition: DynamicEntityRealizationDisposition = "installed";
	dynamicOriginEnvCellId: string | null = null;
	envCellScopeAvailable = true;
	#activationRevision = 0;
	readonly #desired = new Map<number, DynamicEntityView>();
	#nextUpsertRealization:
		| { readonly kind: "completion"; readonly completion: Promise<void> }
		| { readonly kind: "failure"; readonly error: Error }
		| null = null;
	#nextSceneActivationCompletion: Promise<void> | null = null;

	holdNextSceneActivation(): () => void {
		const controlled = controlledPromise<void>();
		this.#nextSceneActivationCompletion = controlled.promise;
		return () => controlled.resolve(undefined);
	}

	holdNextUpsertRealization(): () => void {
		const controlled = controlledPromise<void>();
		this.#nextUpsertRealization = {
			kind: "completion",
			completion: controlled.promise,
		};
		return () => controlled.resolve(undefined);
	}

	failNextUpsertRealization(error: Error): void {
		this.#nextUpsertRealization = { kind: "failure", error };
	}

	setFrameSettings(
		settings: Parameters<ClientPresentationRuntime["setFrameSettings"]>[0],
	): void {
		this.frameSettings.push(settings);
	}

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
		const outcome = this.#nextUpsertRealization;
		this.#nextUpsertRealization = null;
		if (outcome?.kind === "completion") await outcome.completion;
		if (outcome?.kind === "failure") throw outcome.error;
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
		const completion = this.#nextSceneActivationCompletion;
		this.#nextSceneActivationCompletion = null;
		if (completion !== null) await completion;
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
		if (this.activationFailure !== null) {
			return {
				kind: "failed",
				receipt,
				diagnostic: this.activationFailure,
			};
		}
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

	setWorldIndicator(indicator: WorldIndicatorInput | null): void {
		this.worldIndicators.push(indicator);
	}

	setAudioListener(listener: unknown): void {
		this.audioListeners.push(listener);
	}

	setSceneEnvironment(): void {}

	setViewerEntity(guid: number | null): void {
		this.viewerLightGuid = guid;
	}

	setPortalTransition(
		transition: PortalTransitionPresentationPlan | undefined,
	): void {
		this.portalTransitions.push(transition);
	}

	pollPortalTransitionLoading(): void {}

	playPortalTransitionSound(kind: "enter" | "exit"): void {
		this.portalTransitionSounds.push(kind);
	}

	renderPortalTransition(
		timeSeconds: number,
	): PortalTransitionPresentationReceipt | null {
		this.portalTransitionRenderTimes.push(timeSeconds);
		const transition = this.portalTransitions.at(-1);
		return transition?.kind === "tunnel-only"
			? { kind: transition.kind, generation: transition.generation }
			: null;
	}

	clearPresentation(): void {
		this.clearPresentationCount += 1;
	}

	dynamicEntityOrigin(): ReturnType<
		ClientPresentationRuntime["dynamicEntityOrigin"]
	> {
		if (this.realizationDisposition === "deferred") return null;
		return {
			envCellId: this.dynamicOriginEnvCellId,
			landblockId: "0x0100ffff",
			landblockOrigin: new Vec3(12, 3, -4),
			scope:
				this.dynamicOriginEnvCellId === null
					? { kind: "outdoor" }
					: {
							kind: "env-cell",
							envCellId: this.dynamicOriginEnvCellId,
							landblockId: "0x0100ffff",
						},
		};
	}

	spawnedEntityPlacement(): ScenePlacement | null {
		const localTransform = Mat4.identity();
		localTransform.m41 = 12;
		localTransform.m42 = 3;
		localTransform.m43 = -4;
		return {
			envCellId: this.dynamicOriginEnvCellId,
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
		return this.envCellScopeAvailable;
	}

	tick(): void {}

	render(): PortalTransitionPresentationReceipt | null {
		this.worldRenderCount += 1;
		const transition = this.portalTransitions.at(-1);
		return transition?.kind === "destination-only-awaiting-handoff"
			? { kind: transition.kind, generation: transition.generation }
			: null;
	}
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
	return {
		clientWidth: 640,
		clientHeight: 480,
		width: 1_280,
		height: 960,
		getBoundingClientRect: () => ({
			bottom: 530,
			height: 480,
			left: 100,
			right: 740,
			top: 50,
			width: 640,
			x: 100,
			y: 50,
			toJSON: () => undefined,
		}),
	} as HTMLCanvasElement;
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
		characterMotion: null,
		dynamic: {
			hostTime: { seconds: 75 },
			entities: [view(playerGuid, landblockId)],
		},
	};
}

function portalLifecycle(
	worldGeneration: number,
	cause: "initial-entry" | "teleport" = "teleport",
): Extract<ClientCurrentState["lifecycle"], { kind: "portal-space" }> {
	return {
		kind: "portal-space",
		worldGeneration,
		cause,
	};
}

function view(guid: number, landblockId = 0x0101_0100): DynamicEntityView {
	return {
		generation: 1,
		identity: { guid, wcid: 42 },
		display: { name: "Player", level: null },
		presentation: {
			entityClass: "other",
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
			radar: {
				behavior: null,
				category: "other",
				obviousRange: null,
			},
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
		motion: null,
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

function controlledPromise<T>(): {
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
} {
	let resolve: (value: T) => void = () => {
		throw new Error("Controlled promise was not initialized.");
	};
	const promise = new Promise<T>((accept) => {
		resolve = accept;
	});
	return { promise, resolve: (value) => resolve(value) };
}
