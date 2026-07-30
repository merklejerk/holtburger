import { describe, expect, it, vi } from "vitest";
import type { GameRuntime } from "../lib/game/runtime/game-runtime";
import type { SceneAvailabilityEvent } from "../lib/game/runtime/scene-availability";
import { LandblockLayerKind } from "../lib/game/runtime/scene-interest";
import type { LoDConfig } from "../lib/game/runtime/types";
import { AABB3, Vec3 } from "../lib/game/math/types";
import type { ScenePointResidencyCandidates } from "../lib/game/scene";
import type { FreeFlyCameraController } from "./free-fly-camera-controller";
import { ExplorerCameraCoordinator } from "./explorer-camera-coordinator";

const TEST_LOD: LoDConfig = {
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
			TEST_LOD,
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
			TEST_LOD,
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

		const sync = coordinator.syncCameraResidency();

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

		expect(coordinator.syncCameraResidency().renderable).toBe(true);
		envCellResident = false;
		const sync = coordinator.syncCameraResidency();

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

		coordinator.syncCameraResidency();
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
		const sync = coordinator.syncCameraResidency();

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
			TEST_LOD,
		);

		coordinator.syncCameraResidency();

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
			{ ...TEST_LOD, envCellRadius: null },
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
			TEST_LOD,
		);

		expect(statuses.at(-1)).toBe(
			"Initial camera placement is outside selected EnvCell 0x0102dead.",
		);
		coordinator.dispose();
	});
});

function createRuntime(
	overrides: Partial<{
		hasEnvCellTopology: GameRuntime["hasEnvCellTopology"];
		queryEnvCellBounds: GameRuntime["queryEnvCellBounds"];
		queryEnvCellPointContainment: GameRuntime["queryEnvCellPointContainment"];
		queryWorldPointResidencyCandidates: GameRuntime["queryWorldPointResidencyCandidates"];
		setPrimaryCamera: GameRuntime["setPrimaryCamera"];
	}> = {},
): {
	readonly emit: (event: SceneAvailabilityEvent) => void;
	readonly runtime: GameRuntime;
} {
	let listener: ((event: SceneAvailabilityEvent) => void) | null = null;
	const runtime = {
		hasEnvCellTopology: overrides.hasEnvCellTopology ?? (() => false),
		queryEnvCellBounds: overrides.queryEnvCellBounds ?? (() => null),
		queryEnvCellPointContainment:
			overrides.queryEnvCellPointContainment ?? (() => null),
		queryWorldPointResidencyCandidates:
			overrides.queryWorldPointResidencyCandidates ??
			(() => ({
				envCells: [],
				outdoor: { envCellId: null, landblockId: "0x0102ffff" },
			})),
		setPrimaryCamera: overrides.setPrimaryCamera ?? vi.fn(),
		subscribeSceneAvailability: (
			nextListener: (event: SceneAvailabilityEvent) => void,
		) => {
			listener = nextListener;
			return () => {
				listener = null;
			};
		},
		updateSceneInterest: () => ({ revision: 1 }),
	} as unknown as GameRuntime;
	return {
		emit: (event) => listener?.(event),
		runtime,
	};
}
