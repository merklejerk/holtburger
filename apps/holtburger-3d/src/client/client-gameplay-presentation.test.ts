import { rotateRenderVector } from "../lib/game/math/camera-orientation";
import { RenderSceneInterestController } from "../lib/game/runtime/render-scene-interest-controller";
import {
	resolvedJumpFixture,
	predictedJumpFixture,
} from "./client-precise-jump-fixtures";
import { emptyHousing } from "./client-housing-contract";
import {
	entityFacts,
	playerEntitySnapshot,
} from "./client-entity-mirror.test-support";
import { describe, expect, it, vi } from "vitest";

import type { ActiveRegionSource } from "../lib/assets/active-region-source";
import { landblockVector3 } from "../lib/assets/ac-frame";
import type { LandblockProfileSource } from "../lib/assets/landblock-profile-source";
import {
	cellId,
	type DynamicEntityTickBatch,
	type DynamicEntityView,
} from "../lib/game/runtime/dynamic-entity-feed";
import { AABB3, Mat4, Vec3 } from "../lib/game/math/types";
import type { MapTerrainSource } from "../lib/game/map/map-renderer";
import type { ScenePlacement } from "../lib/game/scene";
import type { NameplateContent } from "../lib/game/systems/dynamic-presentation-source";
import { createLandblockWorldOrigin } from "../lib/game/landblocks";
import type {
	ClientCameraTick,
	ClientCurrentState,
	ClientDynamicScriptCue,
	ClientDynamicSoundCue,
} from "./client-host-contract";
import type { ClientGameplayRuntime } from "./client-gameplay-presentation";
import type { SceneInterestRequest } from "../lib/game/runtime/scene-interest";
import type {
	SceneActivationReceipt,
	SceneActivationRequest,
	SceneActivationStatus,
} from "../lib/game/runtime/scene-availability";
import type { DynamicEntityRealizationDisposition } from "../lib/game/runtime/dynamic-entity-presentation";
import { ClientGameplayPresentation } from "./client-gameplay-presentation";
import { formatClientLocation } from "./client-location-command";
import {
	clientWeatherPresets,
	CLIENT_ENVIRONMENT_INTERVAL_MS,
} from "./client-environment";
import {
	clientEnvironmentFixture,
	ENVIRONMENT_FIXTURE_DAY_SECONDS,
} from "./client-environment.test-support";
import {
	CLIENT_ENVIRONMENT_OVERRIDES_DEFAULT,
	MINUTES_PER_GAME_DAY,
} from "./client-environment-settings";
import type { ResolvedSceneEnvironment } from "../lib/game/environment/scene-environment";
import type { ClientLifecycleTransport } from "./client-lifecycle-session";
import { ClientLifecycleSession } from "./client-lifecycle-session";
import { CLIENT_TUNING } from "./client-tuning";
import type { WorldIndicatorInput } from "../lib/game/renderer/renderer";
import type {
	PortalTransitionPresentationPlan,
	PortalTransitionPresentationReceipt,
} from "../lib/client/portal-transition-presentation";
import type {
	DynamicEntityPresentationFrame,
	DynamicEntityPresentationState,
} from "../lib/game/runtime/game-presentation-runtime";
import type { PrimaryCameraView } from "../lib/game/runtime/types";
import { projectClientTargetIndicator } from "./client-target-indicator";

describe("ClientGameplayPresentation", () => {
	it("invalidates a delayed portal profile before another driver can borrow the runtime", async () => {
		const state = {
			...currentState(0x01010001),
			lifecycle: portalLifecycle(1, "initial-entry"),
		};
		const lifecycle = new ClientLifecycleSession(
			new FakeClientTransport(state),
		);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		const resources = fakeOwner(runtime, activeRegion());
		const profile =
			controlledPromise<
				Awaited<ReturnType<LandblockProfileSource["loadLandblockProfile"]>>
			>();
		resources.profileSource = { loadLandblockProfile: () => profile.promise };
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			resources,
		});
		await presentation.start();
		presentation.frame(1000);
		await presentation.destroy();
		profile.resolve({ landblockId: "0x0101ffff", sceneClass: "dungeon-only" });
		await Promise.resolve();
		await Promise.resolve();
		expect(runtime.sceneRequests).toHaveLength(0);
		expect(resources.destroyed).toBe(false);
		lifecycle.stop();
	});

	it("binds scene demand when the runtime starts and unbinds it on teardown", async () => {
		const transport = new FakeClientTransport(currentState(0x0101_0001));
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		const bindMembership = vi.fn();
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			onSceneMembership: bindMembership,
			resources: fakeOwner(runtime, activeRegion()),
		});
		try {
			await presentation.start();
			expect(bindMembership).toHaveBeenLastCalledWith(runtime.sceneMembership);
		} finally {
			await presentation.destroy();
			lifecycle.stop();
		}
		expect(bindMembership).toHaveBeenLastCalledWith(null);
	});
	it("keeps the server readout true while applying pending and live overrides without replacing the owner", async () => {
		const now = vi.spyOn(performance, "now").mockReturnValue(0);
		const transport = new FakeClientTransport({
			...currentState(0x0101_0001),
			serverTime: ENVIRONMENT_FIXTURE_DAY_SECONDS * 1.9,
		});
		const lifecycle = new ClientLifecycleSession(transport);
		const runtime = new FakePresentationRuntime();
		const region = clientEnvironmentFixture();
		const preset = clientWeatherPresets(region)[0];
		if (preset === undefined) throw new Error("Fixture preset missing.");
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			resources: fakeOwner(runtime, region),
		});
		try {
			await lifecycle.start();
			presentation.setEnvironmentOverrides({
				time: { kind: "fixed", minuteOfDay: MINUTES_PER_GAME_DAY / 2 },
				weather: preset.choice,
			});
			await presentation.start();
			expect(presentation.readServerEnvironment()?.weather?.name).toBe("Rainy");
			expect(runtime.environments.at(-1)?.sky?.dayGroupName).toBe("Sunny");
			const fixed = runtime.environments.at(-1);
			now.mockReturnValue(ENVIRONMENT_FIXTURE_DAY_SECONDS * 0.2 * 1000);
			presentation.frame(performance.now());
			expect(presentation.readServerEnvironment()?.dayFraction).toBeCloseTo(
				0.1,
			);
			expect(presentation.readServerEnvironment()?.weather?.name).toBe("Sunny");
			expect(runtime.environments.at(-1)).toEqual(fixed);
			now.mockReturnValue(performance.now() + CLIENT_ENVIRONMENT_INTERVAL_MS);
			presentation.setEnvironmentOverrides(
				CLIENT_ENVIRONMENT_OVERRIDES_DEFAULT,
			);
			expect(
				runtime.environments.at(-1)?.sky?.objects[0]?.orientation,
			).not.toEqual(fixed?.sky?.objects[0]?.orientation);
		} finally {
			await presentation.destroy();
			lifecycle.stop();
			now.mockRestore();
		}
		expect(presentation.readServerEnvironment()).toBeNull();
	});
	it("decorates an opened corpse nameplate from semantic entity facts", async () => {
		const playerGuid = 0x0101_0001;
		const corpseGuid = 0x8000_0010;
		const transport = new FakeClientTransport(currentState(playerGuid));
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			resources: fakeOwner(runtime, activeRegion()),
		});
		try {
			await presentation.start();
			transport.emit("client-entity-facts-changed", {
				projectileSupply: null,
				salvage: null,
				worldContainer: null,
				upserts: [entityFacts(corpseGuid, { corpse: "opened" })],
				removed: [],
			});
			transport.emit("client-dynamic-entity", {
				kind: "upserted",
				entity: {
					...view(corpseGuid),
					display: { name: "Corpse of Drudge", level: null },
				},
			});

			expect(runtime.nameplateDecoration.get(corpseGuid)).toEqual({
				indicators: [],
				strikeThrough: true,
			});
			transport.emit("client-entity-facts-changed", {
				projectileSupply: null,
				salvage: null,
				worldContainer: null,
				upserts: [entityFacts(corpseGuid, { corpse: "unopened" })],
				removed: [],
			});
			expect(runtime.nameplateDecoration.has(corpseGuid)).toBe(false);
		} finally {
			await presentation.destroy();
			lifecycle.stop();
		}
	});

	it("delivers sound cues imperatively and rejects a prior world's packets", async () => {
		const playerGuid = 0x0101_0001;
		const transport = new FakeClientTransport(currentState(playerGuid));
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			resources: fakeOwner(runtime, activeRegion()),
		});
		await presentation.start();
		const cue = {
			guid: playerGuid,
			generation: 4,
			worldGeneration: 1,
			soundId: 0x94,
			volume: 0.8,
		};
		transport.emit("client-dynamic-sound-cue", cue);
		expect(runtime.dynamicSoundCues).toEqual([cue]);
		transport.emit("client-presentation-discontinuity", {
			kind: "forced-reposition",
			worldGeneration: 2,
		});
		expect(runtime.clearedCueCount).toBe(1);
		transport.emit("client-dynamic-sound-cue", cue);
		expect(runtime.dynamicSoundCues).toEqual([cue]);
		transport.emit("client-dynamic-sound-cue", { ...cue, worldGeneration: 2 });
		expect(runtime.dynamicSoundCues).toHaveLength(2);
		await presentation.destroy();
		lifecycle.stop();
	});

	it("forwards a generation-qualified script cue to the presentation runtime", async () => {
		const playerGuid = 0x0101_0001;
		const transport = new FakeClientTransport(currentState(playerGuid));
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			resources: fakeOwner(runtime, activeRegion()),
		});
		await presentation.start();

		transport.emit("client-dynamic-script-cue", {
			guid: playerGuid,
			generation: 4,
			cue: 7,
			intensity: 0.5,
		});

		expect(runtime.dynamicScriptCues).toEqual([
			{
				guid: playerGuid,
				generation: 4,
				cue: 7,
				intensity: 0.5,
			},
		]);
		await presentation.destroy();
	});

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
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			resources: fakeOwner(runtime, activeRegion()),
		});

		await presentation.start();
		expect(presentation.frame(1_000)).toMatchObject({
			rendered: true,
			status: { kind: "loading-player" },
		});
		expect(runtime.portalTransitionRenderTimes).toEqual([1]);
		expect(runtime.portalTransitionSounds).toEqual(["enter"]);
		await vi.waitFor(() =>
			expect(presentation.frame(1_016).rendered).toBe(true),
		);
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
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			resources: fakeOwner(runtime, activeRegion()),
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
		expect(presentation.frame(10_000).status.kind).toBe("error");
		expect(transport.acknowledgedWorldReveals).toEqual([]);
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
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			resources: fakeOwner(runtime, activeRegion()),
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
		await vi.waitFor(() => {
			expect(presentation.frame(2_000).rendered).toBe(true);
			expect(runtime.portalTransitions.at(-1)).toMatchObject({
				kind: "tunnel-to-destination",
				progress: 0,
			});
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

	it("reissues scene demand when view distance changes without moving", async () => {
		const playerGuid = 0x0101_0001;
		const lifecycle = new ClientLifecycleSession(
			new FakeClientTransport(currentState(playerGuid)),
		);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			resources: fakeOwner(runtime, activeRegion()),
		});
		try {
			await presentation.start();
			presentation.frame(1_000);
			await vi.waitFor(() => expect(runtime.sceneRequests).toHaveLength(1));
			const expanded = {
				terrainRadius: 8,
				buildingRadius: 8,
				explicitObjectRadius: 1,
				generatedObjectRadius: 2,
				envCellRadius: 1,
			};
			presentation.setSceneInterestRadii(expanded);
			presentation.frame(1_016);
			await vi.waitFor(() => expect(runtime.sceneRequests).toHaveLength(2));
			expect(runtime.sceneRequests.at(-1)).toMatchObject({ radii: expanded });
			presentation.setSceneInterestRadii(expanded);
			presentation.frame(1_032);
			expect(runtime.sceneRequests).toHaveLength(2);
		} finally {
			await presentation.destroy();
			lifecycle.stop();
		}
	});

	it("submits a new FOV clearance revision without restarting the camera", async () => {
		const playerGuid = 0x0101_0001;
		const transport = new FakeClientTransport(currentState(playerGuid));
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			resources: fakeOwner(runtime, activeRegion()),
		});
		try {
			await presentation.start();
			presentation.frame(1_000);
			await vi.waitFor(() => expect(transport.cameraStarts).toBe(1));
			presentation.setFieldOfView(90);
			presentation.frame(1_016);
			await vi.waitFor(() =>
				expect(transport.cameraClearances).toHaveLength(1),
			);
			expect(transport.cameraClearances[0]?.projectionRevision).toBe(2);
			expect(transport.cameraStarts).toBe(1);
		} finally {
			await presentation.destroy();
			lifecycle.stop();
		}
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
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			resources: fakeOwner(runtime, activeRegion()),
		});

		await presentation.start();
		expect(presentation.frame(1_000).status.kind).toBe("loading-player");
		expect(() => presentation.readLocationReport()).toThrow(
			"Player location is unavailable.",
		);

		transport.emit("client-local-player-established", { playerGuid });
		expect(() => presentation.readLocationReport()).toThrow(
			"Presented camera location is unavailable.",
		);
		await vi.waitFor(() =>
			expect(presentation.frame(1_016).rendered).toBe(true),
		);
		const player = currentState(playerGuid).dynamic.entities.find(
			(entity) => entity.identity.guid === playerGuid,
		);
		const view = runtime.primaryViews.at(-1);
		if (player?.placement.kind !== "world" || view === undefined)
			throw new Error(
				"Location fixture requires a world player and presented camera.",
			);
		expect(presentation.readLocationReport()).toBe(
			formatClientLocation(player.placement.pose, view.camera.placement),
		);
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

	it("publishes surface-map eligibility for outdoor, mixed interior, and dungeon player placements", async () => {
		const playerGuid = 0x0101_0001;
		const lifecycle = new ClientLifecycleSession(
			new FakeClientTransport(currentState(playerGuid)),
		);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			resources: fakeOwner(runtime, activeRegion()),
		});
		try {
			expect(presentation.readMinimapFrame().surfaceMapEligible).toBe(false);
			await presentation.start();
			await vi.waitFor(() =>
				expect(presentation.frame(1_016).rendered).toBe(true),
			);
			const landblockId = "0x0100ffff";
			const request: SceneInterestRequest = {
				ambientOutdoorEnvCellOwners: new Set([landblockId]),
				radii: {
					terrainRadius: 0,
					buildingRadius: 0,
					envCellRadius: 0,
					explicitObjectRadius: null,
					generatedObjectRadius: null,
				},
				target: {
					kind: "outdoor",
					requested: { kind: "outdoor", landblockId },
				},
			};
			runtime.sceneMembership.replace(request);
			expect(presentation.readMinimapFrame().surfaceMapEligible).toBe(true);
			runtime.dynamicOriginEnvCellId = "0x01000100";
			const mixed = presentation.readMinimapFrame();
			expect(mixed.surfaceMapEligible).toBe(true);
			expect(mixed.subject?.anchor.residency?.envCellId).toBe(
				runtime.dynamicOriginEnvCellId,
			);
			runtime.sceneMembership.replace({
				...request,
				target: {
					kind: "dungeon",
					requested: { kind: "automatic-landblock", landblockId },
				},
			});
			expect(presentation.readMinimapFrame().surfaceMapEligible).toBe(false);
			runtime.sceneMembership.clear();
			expect(presentation.readMinimapFrame().surfaceMapEligible).toBe(false);
		} finally {
			await presentation.destroy();
			lifecycle.stop();
		}
	});

	it("samples aim from the exact presented CSS viewport and camera identity", async () => {
		const playerGuid = 0x0101_0001;
		const transport = new FakeClientTransport(currentState(playerGuid));
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			resources: fakeOwner(runtime, activeRegion()),
		});

		await presentation.start();
		await vi.waitFor(() =>
			expect(presentation.frame(1_000).rendered).toBe(true),
		);
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

	it("forwards retained hover on startup and subsequent changes without selection", async () => {
		const lifecycle = new ClientLifecycleSession(
			new FakeClientTransport(currentState(0x0101_0001)),
		);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			resources: fakeOwner(runtime, activeRegion()),
		});
		try {
			presentation.setHoveredEntityGuid(7);
			await presentation.start();
			expect(runtime.hoveredEntityGuid).toBe(7);
			presentation.setHoveredEntityGuid(8);
			expect(runtime.hoveredEntityGuid).toBe(8);
			presentation.setHoveredEntityGuid(null);
			expect(runtime.hoveredEntityGuid).toBeNull();
		} finally {
			await presentation.destroy();
			lifecycle.stop();
		}
	});

	it("tracks the selected bound using presentation-owned facts", async () => {
		const playerGuid = 0x0101_0001;
		const transport = new FakeClientTransport(currentState(playerGuid));
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			resources: fakeOwner(runtime, activeRegion()),
		});
		await presentation.start();
		await vi.waitFor(() =>
			expect(presentation.frame(1_000).rendered).toBe(true),
		);
		await runtime.upsertDynamicEntity({
			...view(7),
			display: { level: 6, name: "Drudge" },
		});
		presentation.setSelectedEntityGuid(7);
		const primaryView = runtime.primaryViews.at(-1);
		if (primaryView === undefined)
			throw new Error("Fixture did not publish a primary view.");
		const localToLandblock = Mat4.identity();
		localToLandblock.m41 = 12;
		localToLandblock.m42 = 3;
		localToLandblock.m43 = -40;
		const entityFrame: DynamicEntityPresentationFrame = {
			guid: 7,
			localBounds: new AABB3(
				new Vec3(-0.1, -0.1, -0.1),
				new Vec3(0.1, 0.1, 0.1),
			),
			placement: {
				envCellId: null,
				landblockId: "0x0100ffff",
				localToLandblock,
				scope: { kind: "outdoor" },
			},
		};
		runtime.entityFrame = entityFrame;

		expect(presentation.readTargetIndicatorFrame()).toEqual(
			projectClientTargetIndicator({
				bounds: entityFrame.localBounds,
				cssHeight: 480,
				cssWidth: 640,
				placement: entityFrame.placement,
				tuning: CLIENT_TUNING.entitySelection.offscreenIndicator,
				view: primaryView,
			}),
		);
		expect(presentation.selectedEntityTrackingStatus(7)).toMatchObject({
			kind: "tracked",
		});
		runtime.entityPresentationState = { kind: "frontend-evicted" };
		expect(presentation.selectedEntityTrackingStatus(7)).toEqual({
			kind: "frontend-evicted",
		});
		runtime.entityPresentationState = null;
		runtime.entityFrame = null;
		expect(presentation.readTargetIndicatorFrame()).toBeNull();
		expect(presentation.selectedEntityTrackingStatus(7)).toEqual({
			kind: "temporarily-unrealized",
		});
		runtime.removeDynamicEntity(7, 1);
		await presentation.destroy();
	});

	it("tracks the auto-attack identity independently and hides when engagement ends or realization disappears", async () => {
		const engagement = {
			desired: {
				target: 7,
				profile: {
					kind: "melee" as const,
					height: "medium" as const,
					power: 0.5,
				},
			},
			state: "active" as const,
			processedIntentSequence: 0,
			refill: null,
		};
		// A snapshot accepted before presentation creation must supply the engagement without app seeding.
		const transport = new FakeClientTransport({
			...currentState(0x0101_0001),
			combat: engagement,
		});
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		const canvas = fakeCanvas();
		const presentation = new ClientGameplayPresentation({
			canvas,
			session: lifecycle,
			resources: fakeOwner(runtime, activeRegion()),
		});
		try {
			expect(presentation.readCombatTargetFrame()).toBeNull();
			await presentation.start();
			await vi.waitFor(() =>
				expect(presentation.frame(1000).rendered).toBe(true),
			);
			const view = runtime.primaryViews.at(-1);
			if (view === undefined)
				throw new Error("Fixture has no presented camera.");
			runtime.entityFrame = entityFrameInCamera(view, 7, new Vec3(0, 0, -10));
			expect(presentation.readCombatTargetFrame()?.x).toBeCloseTo(
				canvas.clientWidth / 2,
			);
			expect(presentation.readCombatTargetFrame()?.y).toBeCloseTo(
				canvas.clientHeight / 2,
			);
			const initial = presentation.readCombatTargetFrame();
			expect(initial?.combatType).toBe("melee");
			presentation.setSelectedEntityGuid(8);
			expect(presentation.readCombatTargetFrame()).toEqual(initial);
			presentation.setSelectedEntityGuid(null);
			expect(presentation.readCombatTargetFrame()).toEqual(initial);

			runtime.entityFrame = entityFrameInCamera(view, 7, new Vec3(100, 0, -10));
			const combatEdge = presentation.readCombatTargetFrame();
			expect(combatEdge?.kind).toBe("edge");
			presentation.setSelectedEntityGuid(7);
			const selectedEdge = presentation.readTargetIndicatorFrame();
			if (combatEdge === null || selectedEdge === null)
				throw new Error("Expected independent combat and selection arrows.");
			expect(selectedEdge.x).toBeGreaterThan(combatEdge.x);
			presentation.setSelectedEntityGuid(null);
			expect(presentation.readCombatTargetFrame()).toEqual(combatEdge);

			runtime.entityFrame = entityFrameInCamera(view, 9, new Vec3(2, 0, -10));
			transport.emit("client-combat-status-updated", {
				...engagement,
				desired: { ...engagement.desired, target: 9 },
			});
			expect(presentation.readCombatTargetFrame()?.x).toBeGreaterThan(
				canvas.clientWidth / 2,
			);

			const replacement = runtime.entityFrame;
			runtime.entityFrame = null;
			expect(presentation.readCombatTargetFrame()).toBeNull();
			runtime.entityFrame = replacement;
			runtime.entityPresentationState = { kind: "frontend-evicted" };
			expect(presentation.readCombatTargetFrame()).toBeNull();
			runtime.entityPresentationState = null;
			expect(presentation.readCombatTargetFrame()).not.toBeNull();

			// Cancellation retires the intent before the server finishes the attack sequence.
			transport.emit("client-combat-status-updated", {
				desired: null,
				state: "retiring",
				processedIntentSequence: 0,
				refill: null,
			});
			expect(presentation.readCombatTargetFrame()).toBeNull();
		} finally {
			await presentation.destroy();
			lifecycle.stop();
		}
	});

	it("recovers a casting recipient, follows accepted cast replacement, and clears after completion", async () => {
		const transport = new FakeClientTransport({
			...currentState(0x0101_0001),
			spellCastTarget: 7,
		});
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		const canvas = fakeCanvas();
		const presentation = new ClientGameplayPresentation({
			canvas,
			session: lifecycle,
			resources: fakeOwner(runtime, activeRegion()),
		});
		try {
			await presentation.start();
			await vi.waitFor(() =>
				expect(presentation.frame(1000).rendered).toBe(true),
			);
			const view = runtime.primaryViews.at(-1);
			if (view === undefined)
				throw new Error("Fixture has no presented camera.");
			runtime.entityFrame = entityFrameInCamera(view, 7, new Vec3(0, 0, -10));
			expect(presentation.readCombatTargetFrame()?.x).toBeCloseTo(
				canvas.clientWidth / 2,
			);
			runtime.entityFrame = entityFrameInCamera(view, 7, new Vec3(100, 0, -10));
			expect(presentation.readCombatTargetFrame()?.kind).toBe("edge");

			presentation.setSelectedEntityGuid(8);
			expect(presentation.readCombatTargetFrame()).not.toBeNull();
			transport.emit("client-spell-cast-target-updated", { target: null });
			expect(presentation.readCombatTargetFrame()).toBeNull();
			transport.emit("client-spell-cast-target-updated", { target: 7 });
			expect(presentation.readCombatTargetFrame()).not.toBeNull();
			// A non-self spell recipient takes priority over any retained auto-attack intent.
			transport.emit("client-combat-status-updated", {
				desired: {
					target: 9,
					profile: { kind: "missile", height: "medium", accuracy: 0.5 },
				},
				state: "active",
				processedIntentSequence: 0,
				refill: null,
			});
			expect(presentation.readCombatTargetFrame()?.combatType).toBe("magic");
			transport.emit("client-spell-cast-target-updated", { target: null });
			expect(presentation.readCombatTargetFrame()).toBeNull();
			runtime.entityFrame = { ...runtime.entityFrame, guid: 9 };
			expect(presentation.readCombatTargetFrame()?.combatType).toBe("missile");
			// A replacement snapshot is authoritative, including an absent cast and auto-attack.
			transport.emit("client-current-state", currentState(0x0101_0001));
			expect(presentation.readCombatTargetFrame()).toBeNull();
		} finally {
			await presentation.destroy();
			lifecycle.stop();
		}
	});

	it("projects the accepted marker and retains neutral world feedback during replacement", async () => {
		const playerGuid = 0x0101_0001;
		const transport = new FakeClientTransport(currentState(playerGuid));
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			resources: fakeOwner(runtime, activeRegion()),
		});
		await presentation.start();

		const resolved = resolvedJumpFixture(
			{ cameraGeneration: 1, entityGeneration: 1, playerGuid },
			8,
			0.5,
		);
		resolved.launch.target.anchor = 0x0100ffff;
		resolved.launch.target.committedCell = 0x01000102;
		resolved.launch.target.point = landblockVector3([10, 20, 4]);
		resolved.launch.preview.curve.anchor = 0x0100ffff;
		resolved.launch.preview.curve.origin = landblockVector3([12, 18, 1]);
		resolved.launch.preview.curve.placements = [
			{ startFraction: 0, endFraction: 1, committedCell: 0x01000102 },
		];
		const miss = predictedJumpFixture(resolved, "miss");
		miss.flight.anchor = 0x0100ffff;
		const origin = createLandblockWorldOrigin("0x0100ffff");
		presentation.setPreciseJumpPresentation({
			active: true,
			refreshing: false,
			marker: resolved,
		});
		expect(runtime.worldIndicators.at(-1)).toMatchObject({
			marker: {
				shape: "target",
				pending: true,
				position: { x: origin.x + 10, y: 4, z: origin.z - 20 },
				renderScopeKey: "0x01000102",
			},
			desiredTrajectory: { kind: "curve", style: "dashed" },
		});
		const belowHeight = {
			...resolved,
			launch: {
				...resolved.launch,
				preview: {
					kind: "below-height" as const,
					curve: resolved.launch.preview.curve,
				},
			},
		};
		presentation.setPreciseJumpPresentation({
			active: true,
			refreshing: false,
			marker: belowHeight,
		});
		expect(runtime.worldIndicators.at(-1)?.desiredTrajectory).toBeUndefined();
		expect(runtime.worldIndicators.at(-1)?.trajectory).toMatchObject({
			kind: "curve",
			style: "dashed",
		});
		presentation.setPreciseJumpPresentation({
			active: true,
			refreshing: false,
			marker: miss,
		});
		expect(runtime.worldIndicators.at(-1)).toMatchObject({
			marker: { shape: "target", pending: false },
			desiredTrajectory: { kind: "curve", style: "dashed" },
			trajectory: { kind: "polyline", style: "solid" },
			landingMarker: { shape: "miss", pending: false },
		});
		const match = predictedJumpFixture(resolved, "match");
		presentation.setPreciseJumpPresentation({
			active: true,
			refreshing: false,
			marker: match,
		});
		expect(runtime.worldIndicators.at(-1)?.landingMarker).toBeUndefined();
		expect(runtime.worldIndicators.at(-1)?.marker.color).toEqual([
			0.08, 0.48, 1, 0.9,
		]);
		const incomplete = predictedJumpFixture(resolved, "incomplete");
		presentation.setPreciseJumpPresentation({
			active: true,
			refreshing: false,
			marker: incomplete,
		});
		expect(runtime.worldIndicators.at(-1)?.landingMarker).toBeUndefined();
		expect(runtime.worldIndicators.at(-1)?.trajectory?.kind).toBe("polyline");
		presentation.setPreciseJumpPresentation({
			active: true,
			refreshing: false,
			marker: null,
		});
		expect(runtime.worldIndicators.at(-1)?.marker.pending).toBe(true);
		expect(runtime.worldIndicators.at(-1)?.trajectory).toBeUndefined();
		presentation.setPreciseJumpPresentation({
			active: false,
			refreshing: false,
			marker: null,
		});
		expect(runtime.worldIndicators.at(-1)).toBeNull();

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
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			resources: fakeOwner(runtime, activeRegion()),
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

	it("waits for delayed destination loading before acknowledging reveal", async () => {
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
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			resources: fakeOwner(runtime, activeRegion()),
		});

		await presentation.start();
		presentation.frame(1_000);
		await vi.waitFor(() => expect(runtime.sceneRequests).toHaveLength(1));

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
		await vi.waitFor(() => {
			expect(presentation.frame(9_000).rendered).toBe(true);
			expect(runtime.portalTransitions.at(-1)).toMatchObject({
				kind: "tunnel-to-destination",
				progress: 0,
			});
		});
		expect(presentation.frame(10_000).rendered).toBe(true);
		expect(runtime.portalTransitions.at(-1)?.kind).toBe(
			"destination-only-awaiting-handoff",
		);
		await vi.waitFor(() =>
			expect(transport.acknowledgedWorldReveals).toEqual([4]),
		);

		transport.emit("client-lifecycle-changed", { kind: "in-world" });

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
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			resources: fakeOwner(runtime, activeRegion()),
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

		await vi.waitFor(() => {
			expect(presentation.frame(2_000).rendered).toBe(true);
			expect(runtime.portalTransitions.at(-1)).toMatchObject({
				kind: "tunnel-to-destination",
				progress: 0,
			});
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
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			resources: fakeOwner(runtime, activeRegion()),
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
		await vi.waitFor(() =>
			expect(presentation.readDiagnostics().cameraStatus).toMatchObject({
				kind: "active",
				clearance: null,
				renderedReach: 0,
				placementOutcome: {
					kind: "fallback",
					reason: "free-sphere-query",
				},
			}),
		);
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
			const presentation = new ClientGameplayPresentation({
				canvas: fakeCanvas(),
				session: lifecycle,
				resources: fakeOwner(runtime, activeRegion()),
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

	it.each([
		{ kind: "damage", amount: 0, criticalHit: false },
		{ kind: "damage", amount: 37, criticalHit: true },
		{ kind: "evaded" },
		{ kind: "resisted" },
	] as const)(
		"forwards decoded $kind once and clears it on resync or discontinuity",
		async (outcome) => {
			const state = currentState(0x0101_0001);
			const transport = new FakeClientTransport(state);
			const lifecycle = new ClientLifecycleSession(transport);
			await lifecycle.start();
			const runtime = new FakePresentationRuntime();
			const presentation = new ClientGameplayPresentation({
				canvas: fakeCanvas(),
				session: lifecycle,
				resources: fakeOwner(runtime, activeRegion()),
			});
			await presentation.start();
			try {
				const confirmed = {
					worldGeneration: state.worldGeneration,
					attribution: { kind: "attributed", target: 42 },
					outcome,
				};
				transport.emit("client-combat-outcome", confirmed);
				expect(runtime.combatOutcomes).toHaveLength(1);
				runtime.realizationDisposition = "deferred";
				expect(presentation.frame(1000).rendered).toBe(false);
				expect(runtime.combatAdvanceTimes.at(-1)).toBe(1000);
				expect(runtime.combatOutcomes[0].slice(0, 2)).toEqual([
					confirmed.outcome,
					42,
				]);
				transport.emit("client-combat-outcome", {
					...confirmed,
					worldGeneration: state.worldGeneration + 1,
				});
				expect(runtime.combatOutcomes).toHaveLength(1);
				transport.emit("client-presentation-discontinuity", {
					worldGeneration: state.worldGeneration,
					kind: "forced-reposition",
				});
				expect(runtime.combatClearCount).toBe(1);
				transport.emit("client-presentation-discontinuity", {
					worldGeneration: state.worldGeneration + 1,
					kind: "forced-reposition",
				});
				expect(runtime.combatClearCount).toBe(2);
				transport.emit("client-combat-outcome", confirmed);
				expect(runtime.combatOutcomes).toHaveLength(1);
				transport.emit("client-state-resyncing", null);
				expect(runtime.combatClearCount).toBe(3);
				transport.emit("client-combat-outcome", {
					...confirmed,
					worldGeneration: state.worldGeneration + 1,
				});
				expect(runtime.combatOutcomes).toHaveLength(1);
			} finally {
				await presentation.destroy();
				lifecycle.stop();
			}
		},
	);

	it("replaces snapshots, forwards authority batches, and follows residency targets", async () => {
		const transport = new FakeClientTransport(currentState(0x0101_0001));
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		const owner = fakeOwner(runtime, activeRegion());
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			resources: owner,
		});

		await presentation.start();
		expect(runtime.snapshotReplacements).toHaveLength(1);
		expect(
			runtime.snapshotReplacements[0]?.map((entity) => entity.identity.guid),
		).toEqual([0x0101_0001]);

		const firstFrame = await vi.waitFor(() => {
			const frame = presentation.frame(1_000);
			expect(frame.rendered).toBe(true);
			return frame;
		});
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
		expect(owner.destroyed).toBe(false);
	});

	it("preserves accepted upserts without replacing the complete mirror", async () => {
		const playerGuid = 0x0101_0001;
		const transport = new FakeClientTransport(currentState(playerGuid));
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const runtime = new FakePresentationRuntime();
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			resources: fakeOwner(runtime, activeRegion()),
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
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			resources: fakeOwner(runtime, activeRegion()),
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
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			onError,
			resources: fakeOwner(runtime, activeRegion()),
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
		const presentation = new ClientGameplayPresentation({
			canvas: fakeCanvas(),
			session: lifecycle,
			resources: fakeOwner(runtime, activeRegion()),
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
});

class FakeClientTransport implements ClientLifecycleTransport {
	readonly handlers = new Map<string, (payload: unknown) => void>();
	readonly acknowledgedWorldReveals: number[] = [];
	readonly cameraClearances: {
		projectionRevision: number;
		clearanceRadius: number;
	}[] = [];
	cameraStarts = 0;
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
			this.cameraStarts += 1;
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
		if (command === "set_client_camera_clearance") {
			this.cameraClearances.push(
				args?.request as {
					projectionRevision: number;
					clearanceRadius: number;
				},
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
			continuitySweeps: 0,
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
			continuitySweeps: 0,
			contactPasses: 8,
		},
	};
}

class FakePresentationRuntime implements ClientGameplayRuntime {
	readonly sceneMembership = new RenderSceneInterestController();
	sceneInterestMembership() {
		return this.sceneMembership;
	}
	readonly mapGeometry = { revision: 0 } as MapTerrainSource["mapGeometry"];
	readonly terrainInstallationRevision = 0;
	readonly dynamicEntityPlacementRevision = 0;
	snapshotReplacements: DynamicEntityView[][] = [];
	upserted: DynamicEntityView[] = [];
	removed: Array<{ guid: number; generation: number }> = [];
	dynamicScriptCues: ClientDynamicScriptCue[] = [];
	dynamicSoundCues: ClientDynamicSoundCue[] = [];
	clearedCueCount = 0;
	eligibilityReevaluationCount = 0;
	advances: Array<{ batch: DynamicEntityTickBatch; receivedAtMs: number }> = [];
	sceneRequests: SceneInterestRequest[] = [];
	primaryViews: PrimaryCameraView[] = [];
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
	realizationDisposition: DynamicEntityRealizationDisposition = "installed";
	dynamicOriginEnvCellId: string | null = null;
	entityFrame: DynamicEntityPresentationFrame | null = null;
	entityPresentationState: DynamicEntityPresentationState | null = null;
	nameplateDecoration = new Map<
		number,
		Pick<NameplateContent, "indicators" | "strikeThrough">
	>();
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

	setDynamicEntityNameplateDecoration(
		guid: number,
		decoration: Pick<NameplateContent, "indicators" | "strikeThrough">,
	): void {
		if (decoration.indicators.length === 0 && !decoration.strikeThrough)
			this.nameplateDecoration.delete(guid);
		else this.nameplateDecoration.set(guid, decoration);
	}

	async replaceDynamicEntitySnapshot(
		entities: readonly DynamicEntityView[],
	): ReturnType<ClientGameplayRuntime["replaceDynamicEntitySnapshot"]> {
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
	): ReturnType<ClientGameplayRuntime["upsertDynamicEntity"]> {
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

	playDynamicEntitySoundCue(cue: ClientDynamicSoundCue): void {
		this.dynamicSoundCues.push(cue);
	}
	clearDynamicEntityCues(): void {
		this.clearedCueCount += 1;
	}

	playDynamicEntityScriptCue(cue: ClientDynamicScriptCue): void {
		this.dynamicScriptCues.push(cue);
	}

	async reevaluateDynamicEntityEligibility(): ReturnType<
		ClientGameplayRuntime["reevaluateDynamicEntityEligibility"]
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
		this.sceneMembership.follow(request);
	}

	async activateScene(
		request: SceneActivationRequest,
	): Promise<SceneActivationReceipt> {
		this.sceneRequests.push(request.target);
		this.sceneMembership.replace(request.target);
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
		this.sceneMembership.clear();
	}

	resolveViewportExtent(): { width: number; height: number } {
		return { width: 640, height: 480 };
	}

	setPrimaryView(view: PrimaryCameraView): void {
		this.primaryViews.push(view);
	}

	setWorldIndicator(indicator: WorldIndicatorInput | null): void {
		this.worldIndicators.push(indicator);
	}

	setAudioListener(listener: unknown): void {
		this.audioListeners.push(listener);
	}

	/** Applied runtime inputs prove composition independently of the HUD display path. */
	readonly environments: ResolvedSceneEnvironment[] = [];
	setSceneEnvironment(environment: ResolvedSceneEnvironment): void {
		this.environments.push(environment);
	}

	setViewerEntity(guid: number | null): void {
		this.viewerLightGuid = guid;
	}

	setSelectedEntityGuid(): void {}
	/** Last hover delivered through the presentation adapter. */
	hoveredEntityGuid: number | null = null;
	setHoveredEntityGuid(guid: number | null): void {
		this.hoveredEntityGuid = guid;
	}

	dynamicEntityPresentationState(guid: number): DynamicEntityPresentationState {
		return (
			this.entityPresentationState ??
			(this.entityFrame === null || this.entityFrame.guid !== guid
				? { kind: "temporarily-unrealized" }
				: { frame: this.entityFrame, kind: "realized" })
		);
	}

	withSpawnedEntitySelectionGeometry<T>(): T | null {
		return null;
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
		ClientGameplayRuntime["dynamicEntityOrigin"]
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

	readonly combatOutcomes: Parameters<
		ClientGameplayRuntime["acceptCombatOutcome"]
	>[] = [];
	combatClearCount = 0;
	readonly combatAdvanceTimes: number[] = [];
	advanceCombatEffects(nowMs: number): void {
		this.combatAdvanceTimes.push(nowMs);
	}
	acceptCombatOutcome(
		...args: Parameters<ClientGameplayRuntime["acceptCombatOutcome"]>
	): void {
		this.combatOutcomes.push(args);
	}
	setCombatEffectsAppearance(): void {}
	refreshCombatEffectsFontAtlas(): void {}
	clearCombatEffects(): void {
		this.combatClearCount++;
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

/** Place a rigid entity relative to the fixture's actual presented camera. */
function entityFrameInCamera(
	view: PrimaryCameraView,
	guid: number,
	cameraOffset: Vec3,
): DynamicEntityPresentationFrame {
	const origin = createLandblockWorldOrigin(view.camera.placement.landblockId);
	const offset = rotateRenderVector(
		cameraOffset,
		view.camera.placement.rotation,
	);
	const localToLandblock = Mat4.identity();
	localToLandblock.m41 = view.camera.placement.position.x - origin.x + offset.x;
	localToLandblock.m42 = view.camera.placement.position.y + offset.y;
	localToLandblock.m43 = view.camera.placement.position.z - origin.z + offset.z;
	return {
		guid,
		localBounds: new AABB3(new Vec3(-1, -1, -1), new Vec3(1, 1, 1)),
		placement: {
			envCellId: null,
			landblockId: view.camera.placement.landblockId,
			localToLandblock,
			scope: { kind: "outdoor" },
		},
	};
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
		dataset: {},
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
		characterSheet: null,
		trade: { trade: null, pending_items: [] },
		lifecycle: { kind: "in-world" },
		characterManagement: { kind: "idle" },
		playerVisualCapture: null,
		entityCollisionDisabled: false,
		canTeleportFromMap: false,
		recallDestinations: [],
		housing: emptyHousing(),
		localPlayerGuid: playerGuid,
		entities: playerEntitySnapshot(playerGuid),
		serverTime: 75,
		worldGeneration: 1,
		connection: null,
		worldName: "Leafcull",
		playerName: "Player",
		knownSpells: null,
		enchantments: null,
		appearanceOptions: null,
		gameplayPreferences: null,
		party: null,
		partyPreferences: null,
		friends: null,
		contracts: null,
		squelch: null,
		allegiance: {
			playerGuid: null,
			profile: null,
			refreshing: false,
			canSwear: false,
		},
		allegiancePreferences: null,
		friendsPreferences: null,
		combatMode: "peace",
		combat: {
			desired: null,
			state: "idle",
			processedIntentSequence: 0,
			refill: null,
		},
		spellCastTarget: null,
		vitals: [],
		characterMotion: null,
		activeConfirmation: null,
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
			placementFrame: 0,
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
			translucency: 0,
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
