import { describe, expect, it, vi } from "vitest";
import { sceneVec3 } from "../lib/assets/ac-frame";
import type { GameRuntime } from "../lib/game/runtime/game-runtime";
import type { SceneAvailabilityEvent } from "../lib/game/runtime/scene-availability";
import { LandblockLayerKind } from "../lib/game/runtime/scene-interest";
import type { SceneInterestRadii } from "../lib/game/runtime/types";
import { AABB3, Vec3 } from "../lib/game/math/types";
import type { ScenePointResidencyCandidates } from "../lib/game/scene";
import type { FreeFlyCameraController } from "./free-fly-camera-controller";
import { ExplorerCameraCoordinator } from "./explorer-camera-coordinator";

const TEST_RADII: SceneInterestRadii = {
	buildingRadius: 0,
	envCellRadius: 0,
	explicitObjectRadius: 0,
	generatedObjectRadius: 0,
	terrainRadius: 0,
};

describe("ExplorerCameraCoordinator", () => {
	it("focuses an explicitly selected valid EnvCell at its contained bounds center", () => {
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

		coordinator.requestSceneInterest(
			{
				envCellId: "0x01020001",
				landblockId: "0x0102ffff",
			},
			TEST_RADII,
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

	it("waits for complete topology and ignores unrelated layer failures", () => {
		const setAutomaticPose = vi.fn();
		const statuses: string[] = [];
		let boundsAvailable = false;
		const { emit, runtime } = createRuntime({
			queryEnvCellBounds: () =>
				boundsAvailable ? new AABB3(Vec3.zero(), new Vec3(2, 2, 2)) : null,
			queryEnvCellPointContainment: () => true,
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{ setAutomaticPose } as unknown as FreeFlyCameraController,
			(status) => statuses.push(status),
		);
		coordinator.requestSceneInterest(
			{
				envCellId: "0x01020001",
				landblockId: "0x0102ffff",
			},
			TEST_RADII,
		);
		emit({
			kind: "scene-content-failed",
			layer: LandblockLayerKind.Terrain,
			message: "terrain exploded",
			residency: { envCellId: null, landblockId: "0x0102ffff" },
			revision: 1 as never,
		});
		boundsAvailable = true;
		emit({
			kind: "env-cell-topology-available",
			landblockId: "0x0102ffff",
			revision: 1 as never,
		});

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

		coordinator.syncFreeFlyCamera();
		expect(setAudioListener).toHaveBeenCalledTimes(1);

		// Off leaves the listener wherever it was rather than moving it somewhere arbitrary.
		coordinator.setAudioFollowsCamera(false);
		coordinator.syncFreeFlyCamera();
		expect(setAudioListener).toHaveBeenCalledTimes(1);

		coordinator.setAudioFollowsCamera(true);
		coordinator.syncFreeFlyCamera();
		expect(setAudioListener).toHaveBeenCalledTimes(2);
		coordinator.dispose();
	});

	it("surfaces overlapping containment as ambiguity without choosing a cell", () => {
		const setPrimaryCamera = vi.fn();
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
			setPrimaryCamera,
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{
				setAutomaticPose: vi.fn(),
				snapshotState: () => state,
			} as unknown as FreeFlyCameraController,
			(status) => statuses.push(status),
		);

		const sync = coordinator.syncFreeFlyCamera();

		expect(setPrimaryCamera).not.toHaveBeenCalled();
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
		const setPrimaryCamera = vi.fn();
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
			setPrimaryCamera,
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
			coordinator.syncPhysicalCamera({
				position,
				residency: { envCellId, landblockId: "0xce94ffff" },
			});
		}
		const sync = coordinator.syncPhysicalCamera({
			position,
			residency: {
				envCellId: "0xce940109",
				landblockId: "0xce94ffff",
			},
		});

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
		expect(setPrimaryCamera).toHaveBeenCalledWith(
			expect.objectContaining({
				placement: expect.objectContaining({
					envCellId: "0xce940109",
					landblockId: "0xce94ffff",
				}),
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

	it("holds an unavailable host EnvCell without falling back to overlap or outdoors", () => {
		const setPrimaryCamera = vi.fn();
		const queryWorldPointResidencyCandidates = vi.fn();
		const statuses: string[] = [];
		const { runtime } = createRuntime({
			hasEnvCellScope: () => false,
			queryWorldPointResidencyCandidates,
			setPrimaryCamera,
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

		const sync = coordinator.syncPhysicalCamera({
			position: sceneVec3(new Vec3(39_576, 22, -28_584)),
			residency: {
				envCellId: "0xce940109",
				landblockId: "0xce94ffff",
			},
		});

		expect(sync).toMatchObject({
			location: { residency: { kind: "topology-unavailable" } },
			renderable: false,
		});
		expect(queryWorldPointResidencyCandidates).not.toHaveBeenCalled();
		expect(setPrimaryCamera).not.toHaveBeenCalled();
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

		expect(coordinator.syncPhysicalCamera(null)).toEqual({
			location: null,
			renderable: false,
		});
		coordinator.syncPhysicalCamera({
			position: sceneVec3(new Vec3(39_576, 22, -28_584)),
			residency: {
				envCellId: "0xce940109",
				landblockId: "0xce94ffff",
			},
		});
		expect(queryWorldPointResidencyCandidates).not.toHaveBeenCalled();
		expect(statuses).toEqual([
			"Waiting for first host camera placement.",
			"Camera residency follows host placement 0xce940109.",
		]);
		coordinator.dispose();
	});

	it("carries the last host residency across the first free-fly frame", () => {
		const setPrimaryCamera = vi.fn();
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
			setPrimaryCamera,
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

		coordinator.syncPhysicalCamera(placement);
		coordinator.seedFreeFlyResidency(placement.residency);
		const handoff = coordinator.syncFreeFlyCamera();

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
		const laterFreeFly = coordinator.syncFreeFlyCamera();
		expect(laterFreeFly.location?.residency.kind).toBe("ambiguous");
		expect(laterFreeFly.renderable).toBe(true);
		expect(queryWorldPointResidencyCandidates).toHaveBeenCalledOnce();
		expect(setPrimaryCamera).toHaveBeenLastCalledWith(
			expect.objectContaining({
				placement: expect.objectContaining({
					envCellId: "0xce940109",
				}),
			}),
		);
		coordinator.dispose();
	});

	it("reclassifies an evicted EnvCell camera as outdoor before rendering", () => {
		const setPrimaryCamera = vi.fn();
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
			setPrimaryCamera,
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{
				setAutomaticPose: vi.fn(),
				snapshotState: () => state,
			} as unknown as FreeFlyCameraController,
			vi.fn(),
		);

		expect(coordinator.syncFreeFlyCamera().renderable).toBe(true);
		envCellResident = false;
		const sync = coordinator.syncFreeFlyCamera();

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
		expect(setPrimaryCamera).toHaveBeenLastCalledWith(
			expect.objectContaining({
				placement: expect.objectContaining({
					envCellId: null,
					landblockId: "0x0102ffff",
				}),
			}),
		);
		coordinator.dispose();
	});

	it("does not reuse an evicted last residency when live containment is ambiguous", () => {
		const setPrimaryCamera = vi.fn();
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
			setPrimaryCamera,
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{
				setAutomaticPose: vi.fn(),
				snapshotState: () => state,
			} as unknown as FreeFlyCameraController,
			vi.fn(),
		);

		coordinator.syncFreeFlyCamera();
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
		const sync = coordinator.syncFreeFlyCamera();

		expect(sync.renderable).toBe(false);
		expect(setPrimaryCamera).toHaveBeenCalledOnce();
		coordinator.dispose();
	});

	it("does not treat frame synchronization as fresh manual input", () => {
		const statuses: string[] = [];
		const state = {
			hasManualControl: true,
			pitchRadians: 0,
			position: new Vec3(1, 2, 3),
			yawRadians: 0,
		};
		const { runtime } = createRuntime();
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{
				setAutomaticPose: vi.fn(),
				snapshotState: () => state,
			} as unknown as FreeFlyCameraController,
			(status) => statuses.push(status),
		);
		coordinator.requestSceneInterest(
			{
				envCellId: "0x01020001",
				landblockId: "0x0102ffff",
			},
			TEST_RADII,
		);

		coordinator.syncFreeFlyCamera();

		expect(statuses).toEqual([
			"Waiting for environment-cell topology for initial camera placement.",
		]);
		coordinator.dispose();
	});

	it("reports unavailable topology when the requested EnvCell layer is disabled", () => {
		const statuses: string[] = [];
		const { runtime } = createRuntime();
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{ setAutomaticPose: vi.fn() } as unknown as FreeFlyCameraController,
			(status) => statuses.push(status),
		);

		coordinator.requestSceneInterest(
			{
				envCellId: "0x01020001",
				landblockId: "0x0102ffff",
			},
			{ ...TEST_RADII, envCellRadius: null },
		);

		expect(statuses.at(-1)).toBe(
			"Environment-cell topology is unavailable for the requested scene interest.",
		);
		coordinator.dispose();
	});

	it("rejects an invalid exact DID when its landblock topology is already resident", () => {
		const statuses: string[] = [];
		const { runtime } = createRuntime({
			hasEnvCellTopology: () => true,
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{ setAutomaticPose: vi.fn() } as unknown as FreeFlyCameraController,
			(status) => statuses.push(status),
		);

		coordinator.requestSceneInterest(
			{
				envCellId: "0x0102dead",
				landblockId: "0x0102ffff",
			},
			TEST_RADII,
		);

		expect(statuses.at(-1)).toBe(
			"Initial camera placement is outside selected EnvCell 0x0102dead.",
		);
		coordinator.dispose();
	});
	it("re-anchors the established radii on a landblock the camera reached", () => {
		const updateSceneInterest = vi.fn(() => ({ revision: 1 }));
		const { runtime } = createRuntime({
			queryOutdoorTerrainSurface: () => ({
				height: 0,
				landblockId: "0x0102ffff",
			}),
			updateSceneInterest:
				updateSceneInterest as unknown as GameRuntime["updateSceneInterest"],
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{ setAutomaticPose: vi.fn() } as unknown as FreeFlyCameraController,
			() => {},
		);

		// Inert until a manual request establishes the radii to follow with.
		expect(
			coordinator.followCameraResidency({
				envCellId: null,
				landblockId: "0x0103ffff",
			}),
		).toBe(false);
		expect(updateSceneInterest).not.toHaveBeenCalled();
		expect(coordinator.sceneInterest()).toBeNull();

		coordinator.requestSceneInterest(
			{ envCellId: null, landblockId: "0x0102ffff" },
			TEST_RADII,
		);

		expect(
			coordinator.followCameraResidency({
				envCellId: null,
				landblockId: "0x0102ffff",
			}),
		).toBe(false);
		expect(
			coordinator.followCameraResidency({
				envCellId: null,
				landblockId: "0x0103ffff",
			}),
		).toBe(true);
		expect(updateSceneInterest).toHaveBeenLastCalledWith({
			anchorLandblockId: "0x0103ffff",
			radii: TEST_RADII,
		});
		expect(coordinator.sceneInterest()).toEqual({
			radii: TEST_RADII,
			residency: { envCellId: null, landblockId: "0x0103ffff" },
		});
		coordinator.dispose();
	});

	it("declines to follow the camera it has not finished placing yet", () => {
		const setAutomaticPose = vi.fn();
		const updateSceneInterest = vi.fn(() => ({ revision: 1 }));
		let terrainQueryable = false;
		const { emit, runtime } = createRuntime({
			queryOutdoorTerrainSurface: () =>
				terrainQueryable ? { height: 0, landblockId: "0x0103ffff" } : null,
			updateSceneInterest:
				updateSceneInterest as unknown as GameRuntime["updateSceneInterest"],
		});
		const coordinator = new ExplorerCameraCoordinator(
			runtime,
			{ setAutomaticPose } as unknown as FreeFlyCameraController,
			() => {},
		);
		// Request a landblock whose terrain has not arrived, so its placement stays pending.
		coordinator.requestSceneInterest(
			{ envCellId: null, landblockId: "0x0103ffff" },
			TEST_RADII,
		);
		expect(setAutomaticPose).not.toHaveBeenCalled();
		updateSceneInterest.mockClear();

		// The camera still reports the landblock it is leaving; following it would undo the request.
		expect(
			coordinator.followCameraResidency({
				envCellId: null,
				landblockId: "0x0102ffff",
			}),
		).toBe(false);
		expect(updateSceneInterest).not.toHaveBeenCalled();
		expect(coordinator.sceneInterest()).toEqual({
			radii: TEST_RADII,
			residency: { envCellId: null, landblockId: "0x0103ffff" },
		});

		terrainQueryable = true;
		emit({
			kind: "outdoor-terrain-source-available",
			landblockId: "0x0103ffff",
			revision: 1 as never,
		});

		expect(setAutomaticPose).toHaveBeenCalledOnce();
		expect(
			coordinator.followCameraResidency({
				envCellId: null,
				landblockId: "0x0102ffff",
			}),
		).toBe(true);
		coordinator.dispose();
	});
});

function createRuntime(
	overrides: Partial<{
		hasEnvCellScope: GameRuntime["hasEnvCellScope"];
		hasEnvCellTopology: GameRuntime["hasEnvCellTopology"];
		queryEnvCellBounds: GameRuntime["queryEnvCellBounds"];
		queryEnvCellPointContainment: GameRuntime["queryEnvCellPointContainment"];
		queryOutdoorTerrainSurface: GameRuntime["queryOutdoorTerrainSurface"];
		queryWorldPointResidencyCandidates: GameRuntime["queryWorldPointResidencyCandidates"];
		setAudioListener: GameRuntime["setAudioListener"];
		setPrimaryCamera: GameRuntime["setPrimaryCamera"];
		updateSceneInterest: GameRuntime["updateSceneInterest"];
	}> = {},
): {
	readonly emit: (event: SceneAvailabilityEvent) => void;
	readonly runtime: GameRuntime;
} {
	let listener: ((event: SceneAvailabilityEvent) => void) | null = null;
	const runtime = {
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
		setPrimaryCamera: overrides.setPrimaryCamera ?? vi.fn(),
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
	} as unknown as GameRuntime;
	return {
		emit: (event) => listener?.(event),
		runtime,
	};
}
