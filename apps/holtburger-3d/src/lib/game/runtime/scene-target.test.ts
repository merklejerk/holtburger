import { describe, expect, it, vi } from "vitest";

import type { LandblockProfileSource } from "../../assets/landblock-profile-source";
import {
	SceneInterestRequestCoordinator,
	SceneInterestTargetUnavailableError,
	enumerateAmbientEnvCellOwners,
	resolveSceneInterestRequest,
	resolveSceneInterestTarget,
} from "./scene-target";

const TEST_RADII = {
	buildingRadius: 1,
	envCellRadius: 1,
	explicitObjectRadius: null,
	generatedObjectRadius: null,
	terrainRadius: 1,
} as const;

function profileSource(
	loadLandblockProfile: LandblockProfileSource["loadLandblockProfile"],
): LandblockProfileSource {
	return { loadLandblockProfile };
}

describe("resolveSceneInterestTarget", () => {
	it("keeps explicit outdoor intent out of profile lookup", async () => {
		const load = vi.fn();
		const target = {
			kind: "outdoor" as const,
			landblockId: "0x0005ffff" as const,
		};

		expect(
			await resolveSceneInterestTarget(target, profileSource(load)),
		).toEqual({
			kind: "outdoor",
			requested: target,
		});
		expect(load).not.toHaveBeenCalled();
	});

	it("maps profile classes while preserving automatic and exact-cell intent", async () => {
		const load = vi.fn(async (landblockId: string) =>
			landblockId === "0x0005ffff"
				? {
						landblockId: "0x0005ffff" as const,
						sceneClass: "dungeon-only" as const,
					}
				: {
						landblockId: "0x0102ffff" as const,
						sceneClass: "outdoor-with-env-cells" as const,
					},
		);
		const source = profileSource(load);
		const automatic = {
			kind: "automatic-landblock" as const,
			landblockId: "0x0005ffff" as const,
		};
		const exact = {
			envCellId: "0x00050100" as const,
			kind: "env-cell" as const,
			landblockId: "0x0005ffff" as const,
		};

		expect(await resolveSceneInterestTarget(automatic, source)).toEqual({
			kind: "dungeon",
			requested: automatic,
		});
		expect(await resolveSceneInterestTarget(exact, source)).toEqual({
			kind: "dungeon",
			requested: exact,
		});
		expect(
			await resolveSceneInterestTarget(
				{
					kind: "env-cell",
					envCellId: "0x01020001",
					landblockId: "0x0102ffff",
				},
				source,
			),
		).toEqual({
			kind: "outdoor",
			requested: {
				kind: "env-cell",
				envCellId: "0x01020001",
				landblockId: "0x0102ffff",
			},
		});
	});

	it("surfaces absent profile as an actionable error", async () => {
		await expect(
			resolveSceneInterestTarget(
				{
					kind: "automatic-landblock",
					landblockId: "0x0103ffff",
				},
				profileSource(async () => null),
			),
		).rejects.toBeInstanceOf(SceneInterestTargetUnavailableError);
	});
});

describe("resolveSceneInterestRequest", () => {
	it("clips ambient owners to world bounds and keeps only profiles with EnvCells", async () => {
		const loads: string[] = [];
		let activeLoads = 0;
		let maximumActiveLoads = 0;
		const source = profileSource(async (landblockId) => {
			loads.push(landblockId);
			activeLoads += 1;
			maximumActiveLoads = Math.max(maximumActiveLoads, activeLoads);
			await Promise.resolve();
			activeLoads -= 1;
			if (landblockId === "0x0000ffff") {
				return {
					landblockId,
					sceneClass: "outdoor-with-env-cells" as const,
				};
			}
			if (landblockId === "0x0100ffff") {
				return {
					landblockId,
					sceneClass: "outdoor-only" as const,
				};
			}
			if (landblockId === "0x0001ffff") {
				return {
					landblockId,
					sceneClass: "dungeon-only" as const,
				};
			}
			return null;
		});
		const request = await resolveSceneInterestRequest(
			{
				kind: "outdoor",
				landblockId: "0x0000ffff",
			},
			{ ...TEST_RADII, envCellRadius: 1 },
			source,
		);

		expect(loads).toHaveLength(4);
		expect(loads).toEqual([
			"0x0000ffff",
			"0x0100ffff",
			"0x0001ffff",
			"0x0101ffff",
		]);
		expect(maximumActiveLoads).toBe(4);
		expect(request.ambientOutdoorEnvCellOwners).toEqual(
			new Set(["0x0000ffff"]),
		);
		expect(request.target).toEqual({
			kind: "outdoor",
			requested: {
				kind: "outdoor",
				landblockId: "0x0000ffff",
			},
		});
	});

	it("does not expand dungeon targets into ambient owners", async () => {
		const load = vi.fn(async () => ({
			landblockId: "0x0005ffff" as const,
			sceneClass: "dungeon-only" as const,
		}));
		const target = {
			kind: "automatic-landblock" as const,
			landblockId: "0x0005ffff" as const,
		};

		expect(
			await resolveSceneInterestRequest(
				target,
				TEST_RADII,
				profileSource(load),
			),
		).toEqual({
			ambientOutdoorEnvCellOwners: new Set(),
			radii: TEST_RADII,
			target: { kind: "dungeon", requested: target },
		});
		expect(load).toHaveBeenCalledOnce();
	});

	it("does not request candidate profiles when EnvCell radius is disabled", async () => {
		const load = vi.fn();
		const target = {
			kind: "outdoor" as const,
			landblockId: "0x0102ffff" as const,
		};

		expect(
			await resolveSceneInterestRequest(
				target,
				{ ...TEST_RADII, envCellRadius: null },
				profileSource(load),
			),
		).toEqual({
			ambientOutdoorEnvCellOwners: new Set(),
			radii: { ...TEST_RADII, envCellRadius: null },
			target: { kind: "outdoor", requested: target },
		});
		expect(load).not.toHaveBeenCalled();
	});

	it("enumerates a clipped square without importing non-owner suffixes", () => {
		expect(
			enumerateAmbientEnvCellOwners(
				{ kind: "outdoor", landblockId: "0x0000ffff" },
				{ ...TEST_RADII, envCellRadius: 1 },
			),
		).toEqual(["0x0000ffff", "0x0100ffff", "0x0001ffff", "0x0101ffff"]);
		expect(
			enumerateAmbientEnvCellOwners(
				{ kind: "outdoor", landblockId: "0xffffffff" },
				{ ...TEST_RADII, envCellRadius: 1 },
			),
		).toEqual(["0xfefeffff", "0xfffeffff", "0xfeffffff", "0xffffffff"]);
	});
});

describe("SceneInterestRequestCoordinator", () => {
	it("makes stale profile completions non-current", async () => {
		const radii = {
			buildingRadius: null,
			envCellRadius: null,
			explicitObjectRadius: null,
			generatedObjectRadius: null,
			terrainRadius: 0,
		} as const;
		let releaseFirst: ((value: null) => void) | undefined;
		const load = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						releaseFirst = resolve;
					}),
			)
			.mockResolvedValue({
				landblockId: "0x0102ffff",
				sceneClass: "outdoor-only" as const,
			});
		const coordinator = new SceneInterestRequestCoordinator(
			profileSource(load),
		);
		const first = coordinator.request(
			{
				kind: "automatic-landblock",
				landblockId: "0x0005ffff",
			},
			radii,
		);
		const second = coordinator.request(
			{
				kind: "automatic-landblock",
				landblockId: "0x0102ffff",
			},
			radii,
		);
		expect(coordinator.isCurrent(first.revision)).toBe(false);
		expect(coordinator.isCurrent(second.revision)).toBe(true);
		releaseFirst?.(null);
		await first.promise.catch(() => undefined);
		await expect(second.promise).resolves.toEqual({
			ambientOutdoorEnvCellOwners: new Set(),
			radii,
			target: {
				kind: "outdoor",
				requested: {
					kind: "automatic-landblock",
					landblockId: "0x0102ffff",
				},
			},
		});
		coordinator.invalidate();
		expect(coordinator.isCurrent(second.revision)).toBe(false);
	});

	it("keeps a superseded composite candidate resolution non-current", async () => {
		const radii = {
			buildingRadius: 1,
			envCellRadius: 1,
			explicitObjectRadius: null,
			generatedObjectRadius: null,
			terrainRadius: 1,
		} as const;
		let releaseCandidate: (() => void) | undefined;
		const load = vi.fn(async (landblockId: string) => {
			if (landblockId === "0x0000ffff") {
				await new Promise<void>((resolve) => {
					releaseCandidate = resolve;
				});
			}
			return null;
		});
		const coordinator = new SceneInterestRequestCoordinator(
			profileSource(load),
		);
		const first = coordinator.request(
			{ kind: "outdoor", landblockId: "0x0000ffff" },
			radii,
		);
		const second = coordinator.request(
			{ kind: "outdoor", landblockId: "0x0100ffff" },
			{ ...radii, envCellRadius: null },
		);

		expect(coordinator.isCurrent(first.revision)).toBe(false);
		expect(coordinator.isCurrent(second.revision)).toBe(true);
		await expect(second.promise).resolves.toMatchObject({
			ambientOutdoorEnvCellOwners: new Set(),
		});
		releaseCandidate?.();
		await expect(first.promise).resolves.toMatchObject({
			ambientOutdoorEnvCellOwners: new Set(),
		});
		expect(coordinator.isCurrent(first.revision)).toBe(false);
		coordinator.invalidate();
	});
});
