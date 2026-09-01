import { describe, expect, it, vi } from "vitest";
import { sceneVec3 } from "../lib/assets/ac-frame";
import type { GamePresentationRuntime } from "../lib/game/runtime/game-presentation-runtime";
import type { SceneAvailabilityEvent } from "../lib/game/runtime/scene-availability";
import type {
	SceneActivationReceipt,
	SceneActivationRequest,
	SceneActivationStatus,
} from "../lib/game/runtime/scene-availability";
import { LandblockLayerKind } from "../lib/game/runtime/scene-interest";
import type { SceneInterestRadii } from "../lib/game/runtime/types";
import { createProjectionClearanceRevision } from "../lib/game/camera/projection-clearance";
import { AABB3, Vec3 } from "../lib/game/math/types";
import type { ScenePointResidencyCandidates } from "../lib/game/scene";
import type { ResolvedSceneInterestTarget } from "../lib/game/runtime/scene-target";
import type { ExplorerCameraInputController as FreeFlyCameraController } from "./explorer-camera-input-controller";
import type { ExplorerResidencyResolution } from "./explorer-residency";
import { ExplorerCameraCoordinator } from "./explorer-camera-coordinator";

const TEST_RADII: SceneInterestRadii = {
	buildingRadius: 0,
	envCellRadius: 0,
	explicitObjectRadius: 0,
	generatedObjectRadius: 0,
	terrainRadius: 0,
};
const TEST_PROJECTION = createProjectionClearanceRevision(
	1,
	{ fov: 75, near: 0.5 },
	{ height: 720, width: 1_280 },
);

function resolvedFromResidency(residency: {
	readonly envCellId: string | null;
	readonly landblockId: string;
}): ResolvedSceneInterestTarget {
	return {
		kind: "outdoor",
		requested:
			residency.envCellId === null
				? { kind: "outdoor", landblockId: residency.landblockId }
				: {
						envCellId: residency.envCellId,
						kind: "env-cell",
						landblockId: residency.landblockId,
					},
	};
}

function dungeonTarget(
	requested:
		| { readonly kind: "automatic-landblock"; readonly landblockId: string }
		| {
				readonly kind: "env-cell";
				readonly envCellId: string;
				readonly landblockId: string;
		  },
): ResolvedSceneInterestTarget {
	return { kind: "dungeon", requested } as ResolvedSceneInterestTarget;
}

describe("ExplorerCameraCoordinator", () => {
	it("waits for exact installation readiness before applying the camera focus", async () => {
		const setAutomaticPose = vi.fn();
		let activationStatus: SceneActivationStatus;
		const activationReceipt: SceneActivationReceipt = {
			generation: 9,
			revision: 1 as never,
			requiredLayers: new Map(),
		};
		activationStatus = { kind: "pending", receipt: activationReceipt };
		const { runtime } = createRuntime({
			activateScene: vi.fn(async () => activationReceipt),
			sceneActivationStatus: () => activationStatus,
			completeSceneActivation: vi.fn(),
			queryEnvCellBounds: () =>
				new AABB3(new Vec3(10, 20, 30), new Vec3(30, 40, 50)),
			queryEnvCellPointContainment: () => true,
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{ setAutomaticPose } as unknown as FreeFlyCameraController,
			vi.fn(),
		);

		await coordinator.requestSceneInterest(
			{
				ambientOutdoorEnvCellOwners: new Set(),
				radii: TEST_RADII,
				target: resolvedFromResidency({
					envCellId: "0x01020001",
					landblockId: "0x0102ffff",
				}),
			},
			9,
		);
		expect(setAutomaticPose).not.toHaveBeenCalled();

		activationStatus = { kind: "ready", receipt: activationReceipt };
		coordinator.pollSceneActivation();
		expect(setAutomaticPose).toHaveBeenCalledWith({
			pitchRadians: 0,
			position: new Vec3(20, 30, 40),
			yawRadians: 0,
		});
		coordinator.completeSceneActivation();
		coordinator.dispose();
	});

	it("logs activation failure and terminates the portal presentation", async () => {
		const diagnostic =
			"No source content is available for env-cells at 0x0102ffff.";
		const activationReceipt: SceneActivationReceipt = {
			generation: 9,
			revision: 1 as never,
			requiredLayers: new Map(),
		};
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const statuses: string[] = [];
		let activationStatus: SceneActivationStatus = {
			kind: "pending",
			receipt: activationReceipt,
		};
		const { runtime } = createRuntime({
			activateScene: vi.fn(async () => activationReceipt),
			sceneActivationStatus: () => activationStatus,
			completeSceneActivation: vi.fn(),
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{ setAutomaticPose: vi.fn() } as unknown as FreeFlyCameraController,
			(status) => statuses.push(status),
		);

		await coordinator.requestSceneInterest(
			{
				ambientOutdoorEnvCellOwners: new Set(),
				radii: TEST_RADII,
				target: resolvedFromResidency({
					envCellId: null,
					landblockId: "0x0102ffff",
				}),
			},
			9,
		);
		expect(coordinator.advancePortalTransition(0, false)).toBeDefined();

		activationStatus = {
			diagnostic,
			kind: "failed",
			receipt: activationReceipt,
		};
		coordinator.pollSceneActivation();

		expect(consoleError).toHaveBeenCalledOnce();
		expect(consoleError).toHaveBeenCalledWith({
			diagnostic,
			generation: 9,
			kind: "explorer-scene-activation-failed",
			revision: 1,
		});
		expect(statuses.at(-1)).toBe(
			`Initial camera placement failed: ${diagnostic}`,
		);
		expect(coordinator.activationPending()).toBe(false);
		expect(coordinator.advancePortalTransition(1, false)).toBeUndefined();
		coordinator.dispose();
		consoleError.mockRestore();
	});

	it("ignores a superseded activation completion and installs only the current generation", async () => {
		const setAutomaticPose = vi.fn();
		const resolveActivation = new Map<
			number,
			(receipt: SceneActivationReceipt) => void
		>();
		const { runtime } = createRuntime({
			activateScene: (request) =>
				new Promise((resolve) => {
					resolveActivation.set(request.generation, resolve);
				}),
			queryOutdoorTerrainSurface: () => ({
				height: 0,
				landblockId: "0x0102ffff",
			}),
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{ setAutomaticPose } as unknown as FreeFlyCameraController,
			vi.fn(),
		);
		const request = (generation: number, landblockId: string) =>
			coordinator.requestSceneInterest(
				{
					ambientOutdoorEnvCellOwners: new Set(),
					radii: TEST_RADII,
					target: resolvedFromResidency({ envCellId: null, landblockId }),
				},
				generation,
			);
		const receipt = (generation: number): SceneActivationReceipt => ({
			generation,
			revision: generation as never,
			requiredLayers: new Map(),
		});

		const first = request(1, "0x0101ffff");
		const second = request(2, "0x0102ffff");
		resolveActivation.get(1)?.(receipt(1));
		await first;
		expect(setAutomaticPose).not.toHaveBeenCalled();

		resolveActivation.get(2)?.(receipt(2));
		await second;
		expect(setAutomaticPose).toHaveBeenCalledOnce();
		expect(coordinator.advancePortalTransition(0, false)?.generation).toBe(2);
		coordinator.dispose();
	});

	it("focuses a bare dungeon owner at deterministic EnvCell 0x0100", async () => {
		const setAutomaticPose = vi.fn();
		const statuses: string[] = [];
		const { runtime } = createRuntime({
			queryEnvCellBounds: () =>
				new AABB3(new Vec3(10, 20, 30), new Vec3(30, 40, 50)),
			queryEnvCellPointContainment: () => true,
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{ setAutomaticPose } as unknown as FreeFlyCameraController,
			(status) => statuses.push(status),
		);

		await coordinator.requestSceneInterest(
			{
				ambientOutdoorEnvCellOwners: new Set(),
				radii: { ...TEST_RADII, envCellRadius: null },
				target: dungeonTarget({
					kind: "automatic-landblock",
					landblockId: "0x0005ffff",
				}),
			},
			1,
		);

		expect(setAutomaticPose).toHaveBeenCalledWith({
			pitchRadians: 0,
			position: new Vec3(20, 30, 40),
			yawRadians: 0,
		});
		expect(statuses).toEqual([
			"Loading dungeon environment-cell topology for initial camera placement.",
			"Initial camera placement applied.",
		]);
		expect(coordinator.sceneInterest()?.residency).toEqual({
			envCellId: "0x00050100",
			landblockId: "0x0005ffff",
		});
		coordinator.dispose();
	});

	it("focuses an explicitly selected valid EnvCell at its contained bounds center", async () => {
		const setAutomaticPose = vi.fn();
		const statuses: string[] = [];
		const { runtime } = createRuntime({
			queryEnvCellBounds: () =>
				new AABB3(new Vec3(10, 20, 30), new Vec3(30, 40, 50)),
			queryEnvCellPointContainment: () => true,
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{ setAutomaticPose } as unknown as FreeFlyCameraController,
			(status) => statuses.push(status),
		);

		await coordinator.requestSceneInterest(
			{
				ambientOutdoorEnvCellOwners: new Set(),
				radii: TEST_RADII,
				target: resolvedFromResidency({
					envCellId: "0x01020001",
					landblockId: "0x0102ffff",
				}),
			},
			1,
		);

		expect(setAutomaticPose).toHaveBeenCalledWith({
			pitchRadians: 0,
			position: new Vec3(20, 30, 40),
			yawRadians: 0,
		});
		expect(statuses).toEqual([
			"Waiting for environment-cell topology for initial camera placement.",
			"Initial camera placement applied.",
		]);
		coordinator.dispose();
	});

	it("keeps a dungeon owner sticky when camera containment is lost", async () => {
		let candidates: ScenePointResidencyCandidates | null = {
			envCells: [
				{
					containsPoint: true,
					envCellId: "0x00050100",
					landblockId: "0x0005ffff",
				},
			],
			outdoor: { envCellId: null, landblockId: "0x0005ffff" },
		};
		const { runtime } = createRuntime({
			queryWorldPointResidencyCandidates: () => candidates,
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{
				setAutomaticPose: vi.fn(),
				snapshotState: () => ({
					hasManualControl: false,
					pitchRadians: 0,
					position: new Vec3(1, 2, 3),
					yawRadians: 0,
				}),
			} as unknown as FreeFlyCameraController,
			() => {},
		);
		await coordinator.requestSceneInterest(
			{
				ambientOutdoorEnvCellOwners: new Set(),
				radii: TEST_RADII,
				target: dungeonTarget({
					kind: "env-cell",
					envCellId: "0x00050100",
					landblockId: "0x0005ffff",
				}),
			},
			1,
		);
		expect(
			followCameraResidency(coordinator, {
				kind: "resolved",
				residency: {
					envCellId: null,
					landblockId: "0x0006ffff",
				},
				source: "outdoor",
			}),
		).toBe(false);
		candidates = null;
		expect(coordinator.syncFreeFlyCamera(TEST_PROJECTION).renderable).toBe(
			false,
		);
		expect(coordinator.sceneInterest()?.target.kind).toBe("dungeon");
		coordinator.dispose();
	});

	it("waits for complete topology and ignores unrelated layer failures", async () => {
		const setAutomaticPose = vi.fn();
		const statuses: string[] = [];
		let boundsAvailable = false;
		let activationReady = false;
		const { emit, runtime } = createRuntime({
			sceneActivationStatus: (receipt) =>
				activationReady
					? { kind: "ready", receipt }
					: { kind: "pending", receipt },
			queryEnvCellBounds: () =>
				boundsAvailable ? new AABB3(Vec3.zero(), new Vec3(2, 2, 2)) : null,
			queryEnvCellPointContainment: () => true,
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{ setAutomaticPose } as unknown as FreeFlyCameraController,
			(status) => statuses.push(status),
		);
		await coordinator.requestSceneInterest(
			{
				ambientOutdoorEnvCellOwners: new Set(),
				radii: TEST_RADII,
				target: resolvedFromResidency({
					envCellId: "0x01020001",
					landblockId: "0x0102ffff",
				}),
			},
			1,
		);
		emit({
			kind: "scene-content-failed",
			layer: LandblockLayerKind.Terrain,
			message: "terrain exploded",
			residency: { envCellId: null, landblockId: "0x0102ffff" },
			revision: 1 as never,
		});
		boundsAvailable = true;
		activationReady = true;
		coordinator.pollSceneActivation();

		expect(setAutomaticPose).toHaveBeenCalledOnce();
		expect(statuses.at(-1)).toBe("Initial camera placement applied.");
		coordinator.dispose();
	});

	it("places the audio listener with the camera only while that is switched on", () => {
		const setAudioListener = vi.fn();
		const { runtime } = createRuntime({ setAudioListener });
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{
				setAutomaticPose: vi.fn(),
				snapshotState: () => ({
					hasManualControl: false,
					pitchRadians: 0,
					position: new Vec3(1, 2, 3),
					yawRadians: 0,
				}),
			} as unknown as FreeFlyCameraController,
			() => {},
		);

		coordinator.syncFreeFlyCamera(TEST_PROJECTION);
		expect(setAudioListener).toHaveBeenCalledTimes(1);

		// Off leaves the listener wherever it was rather than moving it somewhere arbitrary.
		coordinator.setAudioFollowsCamera(false);
		coordinator.syncFreeFlyCamera(TEST_PROJECTION);
		expect(setAudioListener).toHaveBeenCalledTimes(1);

		coordinator.setAudioFollowsCamera(true);
		coordinator.syncFreeFlyCamera(TEST_PROJECTION);
		expect(setAudioListener).toHaveBeenCalledTimes(2);
		coordinator.dispose();
	});

	it("surfaces overlapping containment as ambiguity without choosing a cell", () => {
		const setPrimaryView = vi.fn();
		const statuses: string[] = [];
		const state = {
			hasManualControl: false,
			pitchRadians: 0,
			position: new Vec3(1, 2, 3),
			yawRadians: 0,
		};
		const { runtime } = createRuntime({
			queryWorldPointResidencyCandidates: () => ({
				envCells: [
					{
						containsPoint: true,
						envCellId: "0x01020001",
						landblockId: "0x0102ffff",
					},
					{
						containsPoint: true,
						envCellId: "0x01020002",
						landblockId: "0x0102ffff",
					},
				],
				outdoor: {
					envCellId: null,
					landblockId: "0x0102ffff",
				},
			}),
			setPrimaryView,
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{
				setAutomaticPose: vi.fn(),
				snapshotState: () => state,
			} as unknown as FreeFlyCameraController,
			(status) => statuses.push(status),
		);

		const sync = coordinator.syncFreeFlyCamera(TEST_PROJECTION);

		expect(setPrimaryView).not.toHaveBeenCalled();
		expect(sync).toMatchObject({
			location: { residency: { kind: "ambiguous" } },
			renderable: false,
		});
		expect(statuses).toEqual([
			"Camera residency is ambiguous across EnvCells: 0x01020001, 0x01020002.",
		]);
		coordinator.dispose();
	});

	it("uses the host CE94 portal placement instead of overlapping point containment", () => {
		const setPrimaryView = vi.fn();
		const statuses: string[] = [];
		const queryWorldPointResidencyCandidates = vi.fn(() => ({
			envCells: [
				{
					containsPoint: true,
					envCellId: "0xce940102" as const,
					landblockId: "0xce94ffff" as const,
				},
				{
					containsPoint: true,
					envCellId: "0xce940109" as const,
					landblockId: "0xce94ffff" as const,
				},
			],
			outdoor: {
				envCellId: null,
				landblockId: "0xce94ffff" as const,
			},
		}));
		const { runtime } = createRuntime({
			hasEnvCellScope: () => true,
			queryWorldPointResidencyCandidates,
			setPrimaryView,
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{
				setAutomaticPose: vi.fn(),
				snapshotState: () => ({
					hasManualControl: false,
					pitchRadians: 0,
					position: new Vec3(1, 2, 3),
					yawRadians: 0,
				}),
			} as unknown as FreeFlyCameraController,
			(status) => statuses.push(status),
		);

		const position = sceneVec3(new Vec3(39_576, 22, -28_584));
		for (const envCellId of [
			"0xce94010a",
			"0xce940108",
			"0xce940109",
		] as const) {
			coordinator.syncPhysicalCamera(
				{
					position,
					residency: { envCellId, landblockId: "0xce94ffff" },
				},
				TEST_PROJECTION,
			);
		}
		const sync = coordinator.syncPhysicalCamera(
			{
				position,
				residency: {
					envCellId: "0xce940109",
					landblockId: "0xce94ffff",
				},
			},
			TEST_PROJECTION,
		);

		expect(queryWorldPointResidencyCandidates).not.toHaveBeenCalled();
		expect(statuses).toEqual([
			"Camera residency follows host placement 0xce94010a.",
			"Camera residency follows host placement 0xce940108.",
			"Camera residency follows host placement 0xce940109.",
		]);
		expect(sync).toMatchObject({
			location: {
				residency: {
					kind: "resolved",
					residency: {
						envCellId: "0xce940109",
						landblockId: "0xce94ffff",
					},
					source: "host-physical-camera",
				},
			},
			renderable: true,
		});
		expect(setPrimaryView).toHaveBeenCalledWith(
			expect.objectContaining({
				camera: expect.objectContaining({
					placement: expect.objectContaining({
						envCellId: "0xce940109",
						landblockId: "0xce94ffff",
					}),
				}),
				extent: TEST_PROJECTION.extent,
			}),
		);
		expect(coordinator.presentedPlacement()).toEqual({
			position,
			residency: {
				envCellId: "0xce940109",
				landblockId: "0xce94ffff",
			},
		});
		coordinator.dispose();
	});

	it("uses boom-cast residency without re-running ambiguous point containment", () => {
		const setPrimaryView = vi.fn();
		const queryWorldPointResidencyCandidates = vi.fn();
		const { runtime } = createRuntime({
			hasEnvCellScope: () => true,
			queryWorldPointResidencyCandidates,
			setPrimaryView,
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{
				setAutomaticPose: vi.fn(),
				snapshotState: () => ({
					hasManualControl: false,
					pitchRadians: 0,
					position: new Vec3(1, 2, 3),
					yawRadians: 0,
				}),
			} as unknown as FreeFlyCameraController,
			() => {},
		);
		const position = sceneVec3(new Vec3(39_576, 22, -28_584));

		const sync = coordinator.syncBoomCamera(
			{
				position,
				residency: {
					envCellId: "0xce940109",
					landblockId: "0xce94ffff",
				},
			},
			1.2,
			-0.3,
			TEST_PROJECTION,
		);

		expect(queryWorldPointResidencyCandidates).not.toHaveBeenCalled();
		expect(sync).toEqual({
			location: {
				position,
				residency: {
					kind: "resolved",
					residency: {
						envCellId: "0xce940109",
						landblockId: "0xce94ffff",
					},
					source: "host-boom-camera",
				},
			},
			renderable: true,
		});
		expect(setPrimaryView).toHaveBeenCalledOnce();
		coordinator.dispose();
	});

	it("holds an unavailable host EnvCell without falling back to overlap or outdoors", () => {
		const setPrimaryView = vi.fn();
		const queryWorldPointResidencyCandidates = vi.fn();
		const statuses: string[] = [];
		const { runtime } = createRuntime({
			hasEnvCellScope: () => false,
			queryWorldPointResidencyCandidates,
			setPrimaryView,
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{
				setAutomaticPose: vi.fn(),
				snapshotState: () => ({
					hasManualControl: false,
					pitchRadians: 0,
					position: new Vec3(1, 2, 3),
					yawRadians: 0,
				}),
			} as unknown as FreeFlyCameraController,
			(status) => statuses.push(status),
		);

		const sync = coordinator.syncPhysicalCamera(
			{
				position: sceneVec3(new Vec3(39_576, 22, -28_584)),
				residency: {
					envCellId: "0xce940109",
					landblockId: "0xce94ffff",
				},
			},
			TEST_PROJECTION,
		);

		expect(sync).toMatchObject({
			location: { residency: { kind: "topology-unavailable" } },
			renderable: false,
		});
		expect(queryWorldPointResidencyCandidates).not.toHaveBeenCalled();
		expect(setPrimaryView).not.toHaveBeenCalled();
		expect(statuses).toEqual([
			"Host-selected EnvCell 0xce940109 is unavailable for camera rendering.",
		]);
		coordinator.dispose();
	});

	it("holds before the first host placement without re-deriving residency", () => {
		const queryWorldPointResidencyCandidates = vi.fn();
		const statuses: string[] = [];
		const { runtime } = createRuntime({
			hasEnvCellScope: () => true,
			queryWorldPointResidencyCandidates,
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{
				setAutomaticPose: vi.fn(),
				snapshotState: () => ({
					hasManualControl: false,
					pitchRadians: 0,
					position: new Vec3(1, 2, 3),
					yawRadians: 0,
				}),
			} as unknown as FreeFlyCameraController,
			(status) => statuses.push(status),
		);

		expect(coordinator.syncPhysicalCamera(null, TEST_PROJECTION)).toEqual({
			location: null,
			renderable: false,
		});
		coordinator.syncPhysicalCamera(
			{
				position: sceneVec3(new Vec3(39_576, 22, -28_584)),
				residency: {
					envCellId: "0xce940109",
					landblockId: "0xce94ffff",
				},
			},
			TEST_PROJECTION,
		);
		expect(queryWorldPointResidencyCandidates).not.toHaveBeenCalled();
		expect(statuses).toEqual([
			"Waiting for first host camera placement.",
			"Camera residency follows host placement 0xce940109.",
		]);
		coordinator.dispose();
	});

	it("carries the last host residency across the first free-fly frame", () => {
		const setPrimaryView = vi.fn();
		const queryWorldPointResidencyCandidates = vi.fn(() => ({
			envCells: [
				{
					containsPoint: true,
					envCellId: "0xce940102" as const,
					landblockId: "0xce94ffff" as const,
				},
				{
					containsPoint: true,
					envCellId: "0xce940109" as const,
					landblockId: "0xce94ffff" as const,
				},
			],
			outdoor: {
				envCellId: null,
				landblockId: "0xce94ffff" as const,
			},
		}));
		const state = {
			hasManualControl: false,
			pitchRadians: 0,
			position: new Vec3(39_576, 22, -28_584),
			yawRadians: 0,
		};
		const { runtime } = createRuntime({
			hasEnvCellScope: () => true,
			queryWorldPointResidencyCandidates,
			setPrimaryView,
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{
				setAutomaticPose: vi.fn(),
				snapshotState: () => state,
			} as unknown as FreeFlyCameraController,
			vi.fn(),
		);
		const placement = {
			position: sceneVec3(new Vec3(39_576, 22, -28_584)),
			residency: {
				envCellId: "0xce940109" as const,
				landblockId: "0xce94ffff" as const,
			},
		};

		coordinator.syncPhysicalCamera(placement, TEST_PROJECTION);
		coordinator.seedFreeFlyResidency(placement.residency);
		const handoff = coordinator.syncFreeFlyCamera(TEST_PROJECTION);

		expect(handoff).toMatchObject({
			location: {
				residency: {
					kind: "resolved",
					residency: placement.residency,
					source: "physical-handoff",
				},
			},
			renderable: true,
		});
		expect(queryWorldPointResidencyCandidates).not.toHaveBeenCalled();
		const laterFreeFly = coordinator.syncFreeFlyCamera(TEST_PROJECTION);
		expect(laterFreeFly.location?.residency.kind).toBe("ambiguous");
		expect(laterFreeFly.renderable).toBe(true);
		expect(queryWorldPointResidencyCandidates).toHaveBeenCalledOnce();
		expect(setPrimaryView).toHaveBeenLastCalledWith(
			expect.objectContaining({
				camera: expect.objectContaining({
					placement: expect.objectContaining({
						envCellId: "0xce940109",
					}),
				}),
				extent: TEST_PROJECTION.extent,
			}),
		);
		coordinator.dispose();
	});

	it("reclassifies an evicted EnvCell camera as outdoor before rendering", () => {
		const setPrimaryView = vi.fn();
		const state = {
			hasManualControl: false,
			pitchRadians: 0,
			position: new Vec3(1, 2, 3),
			yawRadians: 0,
		};
		let envCellResident = true;
		const { runtime } = createRuntime({
			queryWorldPointResidencyCandidates: () => ({
				envCells: envCellResident
					? [
							{
								containsPoint: true,
								envCellId: "0x01020001",
								landblockId: "0x0102ffff",
							},
						]
					: [],
				outdoor: { envCellId: null, landblockId: "0x0102ffff" },
			}),
			setPrimaryView,
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{
				setAutomaticPose: vi.fn(),
				snapshotState: () => state,
			} as unknown as FreeFlyCameraController,
			vi.fn(),
		);

		expect(coordinator.syncFreeFlyCamera(TEST_PROJECTION).renderable).toBe(
			true,
		);
		envCellResident = false;
		const sync = coordinator.syncFreeFlyCamera(TEST_PROJECTION);

		expect(sync).toMatchObject({
			location: {
				residency: {
					kind: "resolved",
					residency: {
						envCellId: null,
						landblockId: "0x0102ffff",
					},
					source: "outdoor",
				},
			},
			renderable: true,
		});
		expect(setPrimaryView).toHaveBeenLastCalledWith(
			expect.objectContaining({
				camera: expect.objectContaining({
					placement: expect.objectContaining({
						envCellId: null,
						landblockId: "0x0102ffff",
					}),
				}),
				extent: TEST_PROJECTION.extent,
			}),
		);
		coordinator.dispose();
	});

	it("does not reuse an evicted last residency when live containment is ambiguous", () => {
		const setPrimaryView = vi.fn();
		const state = {
			hasManualControl: false,
			pitchRadians: 0,
			position: new Vec3(1, 2, 3),
			yawRadians: 0,
		};
		let candidates: ScenePointResidencyCandidates["envCells"] = [
			{
				containsPoint: true,
				envCellId: "0x01020001" as const,
				landblockId: "0x0102ffff" as const,
			},
		];
		const { runtime } = createRuntime({
			queryWorldPointResidencyCandidates: () => ({
				envCells: candidates,
				outdoor: { envCellId: null, landblockId: "0x0102ffff" },
			}),
			setPrimaryView,
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{
				setAutomaticPose: vi.fn(),
				snapshotState: () => state,
			} as unknown as FreeFlyCameraController,
			vi.fn(),
		);

		coordinator.syncFreeFlyCamera(TEST_PROJECTION);
		candidates = [
			{
				containsPoint: true,
				envCellId: "0x01020002",
				landblockId: "0x0102ffff",
			},
			{
				containsPoint: true,
				envCellId: "0x01020003",
				landblockId: "0x0102ffff",
			},
		];
		const sync = coordinator.syncFreeFlyCamera(TEST_PROJECTION);

		expect(sync.renderable).toBe(false);
		expect(setPrimaryView).toHaveBeenCalledOnce();
		coordinator.dispose();
	});

	it("does not treat frame synchronization as fresh manual input", async () => {
		const statuses: string[] = [];
		const state = {
			hasManualControl: true,
			pitchRadians: 0,
			position: new Vec3(1, 2, 3),
			yawRadians: 0,
		};
		const { runtime } = createRuntime({
			sceneActivationStatus: (receipt) => ({ kind: "pending", receipt }),
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{
				setAutomaticPose: vi.fn(),
				snapshotState: () => state,
			} as unknown as FreeFlyCameraController,
			(status) => statuses.push(status),
		);
		await coordinator.requestSceneInterest(
			{
				ambientOutdoorEnvCellOwners: new Set(),
				radii: TEST_RADII,
				target: resolvedFromResidency({
					envCellId: "0x01020001",
					landblockId: "0x0102ffff",
				}),
			},
			1,
		);

		coordinator.syncFreeFlyCamera(TEST_PROJECTION);

		expect(statuses).toEqual([
			"Waiting for environment-cell topology for initial camera placement.",
		]);
		coordinator.dispose();
	});

	it("reports unavailable topology when the requested EnvCell layer is disabled", async () => {
		const statuses: string[] = [];
		const { runtime } = createRuntime();
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{ setAutomaticPose: vi.fn() } as unknown as FreeFlyCameraController,
			(status) => statuses.push(status),
		);

		await coordinator.requestSceneInterest(
			{
				ambientOutdoorEnvCellOwners: new Set(),
				radii: { ...TEST_RADII, envCellRadius: null },
				target: resolvedFromResidency({
					envCellId: "0x01020001",
					landblockId: "0x0102ffff",
				}),
			},
			1,
		);

		expect(statuses.at(-1)).toBe(
			"Environment-cell topology is unavailable for the requested scene interest.",
		);
		coordinator.dispose();
	});

	it("rejects an invalid exact DID when its landblock topology is already resident", async () => {
		const statuses: string[] = [];
		const { runtime } = createRuntime({
			hasEnvCellTopology: () => true,
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{ setAutomaticPose: vi.fn() } as unknown as FreeFlyCameraController,
			(status) => statuses.push(status),
		);

		await coordinator.requestSceneInterest(
			{
				ambientOutdoorEnvCellOwners: new Set(),
				radii: TEST_RADII,
				target: resolvedFromResidency({
					envCellId: "0x0102dead",
					landblockId: "0x0102ffff",
				}),
			},
			1,
		);

		expect(statuses.at(-1)).toBe(
			"Initial camera placement is outside selected EnvCell 0x0102dead.",
		);
		coordinator.dispose();
	});
	it("re-anchors the established radii on a landblock the camera reached", async () => {
		const updateSceneInterest = vi.fn(() => ({ revision: 1 }));
		const { runtime } = createRuntime({
			queryOutdoorTerrainSurface: () => ({
				height: 0,
				landblockId: "0x0102ffff",
			}),
			updateSceneInterest:
				updateSceneInterest as unknown as GamePresentationRuntime["updateSceneInterest"],
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{ setAutomaticPose: vi.fn() } as unknown as FreeFlyCameraController,
			() => {},
		);

		// Inert until a manual request establishes the radii to follow with.
		expect(
			followCameraResidency(coordinator, {
				kind: "resolved",
				residency: {
					envCellId: null,
					landblockId: "0x0103ffff",
				},
				source: "outdoor",
			}),
		).toBe(false);
		expect(updateSceneInterest).not.toHaveBeenCalled();
		expect(coordinator.sceneInterest()).toBeNull();

		await coordinator.requestSceneInterest(
			{
				ambientOutdoorEnvCellOwners: new Set(),
				radii: TEST_RADII,
				target: resolvedFromResidency({
					envCellId: null,
					landblockId: "0x0102ffff",
				}),
			},
			1,
		);
		coordinator.completeSceneActivation();

		expect(
			followCameraResidency(coordinator, {
				kind: "resolved",
				residency: {
					envCellId: null,
					landblockId: "0x0102ffff",
				},
				source: "outdoor",
			}),
		).toBe(false);
		expect(
			followCameraResidency(coordinator, {
				kind: "resolved",
				residency: {
					envCellId: null,
					landblockId: "0x0103ffff",
				},
				source: "outdoor",
			}),
		).toBe(true);
		expect(updateSceneInterest).toHaveBeenLastCalledWith({
			ambientOutdoorEnvCellOwners: new Set(),
			target: {
				kind: "outdoor",
				requested: { kind: "outdoor", landblockId: "0x0103ffff" },
			},
			radii: TEST_RADII,
		});
		expect(coordinator.sceneInterest()).toEqual({
			radii: TEST_RADII,
			residency: { envCellId: null, landblockId: "0x0103ffff" },
			target: {
				kind: "outdoor",
				requested: { kind: "outdoor", landblockId: "0x0103ffff" },
			},
		});
		coordinator.dispose();
	});

	it("declines to follow the camera it has not finished placing yet", async () => {
		const setAutomaticPose = vi.fn();
		const updateSceneInterest = vi.fn(() => ({ revision: 1 }));
		let terrainQueryable = false;
		const { emit, runtime } = createRuntime({
			queryOutdoorTerrainSurface: () =>
				terrainQueryable ? { height: 0, landblockId: "0x0103ffff" } : null,
			updateSceneInterest:
				updateSceneInterest as unknown as GamePresentationRuntime["updateSceneInterest"],
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{ setAutomaticPose } as unknown as FreeFlyCameraController,
			() => {},
		);
		// Request a landblock whose terrain has not arrived, so its placement stays pending.
		await coordinator.requestSceneInterest(
			{
				ambientOutdoorEnvCellOwners: new Set(),
				radii: TEST_RADII,
				target: resolvedFromResidency({
					envCellId: null,
					landblockId: "0x0103ffff",
				}),
			},
			1,
		);
		expect(setAutomaticPose).not.toHaveBeenCalled();
		updateSceneInterest.mockClear();

		// The camera still reports the landblock it is leaving; following it would undo the request.
		expect(
			followCameraResidency(coordinator, {
				kind: "resolved",
				residency: {
					envCellId: null,
					landblockId: "0x0102ffff",
				},
				source: "outdoor",
			}),
		).toBe(false);
		expect(updateSceneInterest).not.toHaveBeenCalled();
		expect(coordinator.sceneInterest()).toEqual({
			radii: TEST_RADII,
			residency: { envCellId: null, landblockId: "0x0103ffff" },
			target: {
				kind: "outdoor",
				requested: { kind: "outdoor", landblockId: "0x0103ffff" },
			},
		});

		terrainQueryable = true;
		emit({
			kind: "outdoor-terrain-source-available",
			landblockId: "0x0103ffff",
			revision: 1 as never,
		});

		expect(setAutomaticPose).toHaveBeenCalledOnce();
		coordinator.completeSceneActivation();
		expect(
			followCameraResidency(coordinator, {
				kind: "resolved",
				residency: {
					envCellId: null,
					landblockId: "0x0102ffff",
				},
				source: "outdoor",
			}),
		).toBe(true);
		coordinator.dispose();
	});
});

function followCameraResidency(
	coordinator: ExplorerCameraCoordinator,
	resolution: ExplorerResidencyResolution,
): boolean {
	const pending = coordinator.prepareFollowCameraResidency(resolution);
	if (!pending) return false;
	return coordinator.applyFollowCameraResidency(pending, {
		ambientOutdoorEnvCellOwners: new Set(),
		radii: pending.radii,
		target: {
			kind: "outdoor",
			requested: pending.target,
		},
	});
}

function createRuntime(
	overrides: Partial<{
		activateScene: GamePresentationRuntime["activateScene"];
		sceneActivationStatus: GamePresentationRuntime["sceneActivationStatus"];
		completeSceneActivation: GamePresentationRuntime["completeSceneActivation"];
		hasEnvCellScope: GamePresentationRuntime["hasEnvCellScope"];
		hasEnvCellTopology: GamePresentationRuntime["hasEnvCellTopology"];
		queryEnvCellBounds: GamePresentationRuntime["queryEnvCellBounds"];
		queryEnvCellPointContainment: GamePresentationRuntime["queryEnvCellPointContainment"];
		queryOutdoorTerrainSurface: GamePresentationRuntime["queryOutdoorTerrainSurface"];
		queryWorldPointResidencyCandidates: GamePresentationRuntime["queryWorldPointResidencyCandidates"];
		setAudioListener: GamePresentationRuntime["setAudioListener"];
		setPrimaryView: GamePresentationRuntime["setPrimaryView"];
		updateSceneInterest: GamePresentationRuntime["updateSceneInterest"];
	}> = {},
): {
	readonly emit: (event: SceneAvailabilityEvent) => void;
	readonly runtime: GamePresentationRuntime;
} {
	let listener: ((event: SceneAvailabilityEvent) => void) | null = null;
	const runtime = {
		activateScene:
			overrides.activateScene ??
			(async (request: SceneActivationRequest) => ({
				generation: request.generation,
				revision: 1 as never,
				requiredLayers: new Map(),
			})),
		sceneActivationStatus:
			overrides.sceneActivationStatus ??
			((receipt: SceneActivationReceipt) => ({ kind: "ready", receipt })),
		completeSceneActivation: overrides.completeSceneActivation ?? vi.fn(),
		hasEnvCellScope: overrides.hasEnvCellScope ?? (() => false),
		hasEnvCellTopology: overrides.hasEnvCellTopology ?? (() => false),
		queryEnvCellBounds: overrides.queryEnvCellBounds ?? (() => null),
		queryEnvCellPointContainment:
			overrides.queryEnvCellPointContainment ?? (() => null),
		queryOutdoorTerrainSurface:
			overrides.queryOutdoorTerrainSurface ?? (() => null),
		queryWorldPointResidencyCandidates:
			overrides.queryWorldPointResidencyCandidates ??
			(() => ({
				envCells: [],
				outdoor: { envCellId: null, landblockId: "0x0102ffff" },
			})),
		setAudioListener: overrides.setAudioListener ?? vi.fn(),
		setPrimaryView: overrides.setPrimaryView ?? vi.fn(),
		subscribeSceneAvailability: (
			nextListener: (event: SceneAvailabilityEvent) => void,
		) => {
			listener = nextListener;
			return () => {
				listener = null;
			};
		},
		updateSceneInterest:
			overrides.updateSceneInterest ?? (() => ({ revision: 1 })),
	} as Record<string, unknown>;
	const typedRuntime = runtime as unknown as GamePresentationRuntime;
	return {
		emit: (event) => listener?.(event),
		runtime: typedRuntime,
	};
}
