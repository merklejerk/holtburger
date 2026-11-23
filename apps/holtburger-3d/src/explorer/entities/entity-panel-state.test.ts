import { describe, expect, it } from "vitest";
import { Vec3 } from "../../lib/game/math/types";
import type { DynamicEntityView } from "../../lib/game/runtime/dynamic-entity-feed";
import { EXPLORER_TUNING } from "../explorer-tuning";
import type { ExplorerSceneInterestSnapshot } from "../camera/camera-coordinator";

import {
	cycleNearbyExplorerEntity,
	explorerEntityOperationTargets,
	isExplorerEntityWithinSceneInterest,
	refreshesExplorerEntityPanel,
} from "./entity-panel-state";

describe("Explorer entity panel state", () => {
	it("scopes operation feedback to an exact live generation", () => {
		const operation = {
			kind: "despawn",
			target: { guid: 0x70000001, generation: 4 },
		} as const;
		expect(
			explorerEntityOperationTargets(operation, {
				guid: 0x70000001,
				generation: 4,
			}),
		).toBe(true);
		expect(
			explorerEntityOperationTargets(operation, {
				guid: 0x70000001,
				generation: 5,
			}),
		).toBe(false);
		expect(
			explorerEntityOperationTargets(
				{ kind: "spawn" },
				{ guid: 0x70000001, generation: 4 },
			),
		).toBe(false);
	});

	it("keeps integrated host ticks out of panel state while publishing corrections", () => {
		const event = {
			kind: "ticked",
			batch: {
				hostTime: { seconds: 1 },
				durationMs: 1000 / 30,
				advances: [{ kind: "integrated" }],
			},
		} as const;

		expect(refreshesExplorerEntityPanel(event)).toBe(false);
		expect(
			refreshesExplorerEntityPanel({
				...event,
				batch: {
					...event.batch,
					advances: [{ ...event.batch.advances[0], kind: "teleport" }],
				},
			}),
		).toBe(true);
		expect(
			refreshesExplorerEntityPanel({
				kind: "removed",
			}),
		).toBe(true);
	});

	it("cycles nearby world-placed entities by distance within range while skipping far, possessed, and attached entities", () => {
		const worldEntity = (
			guid: number,
			x: number,
			landblockId = 0x0000ffff,
		): DynamicEntityView =>
			({
				generation: 1,
				identity: { guid, wcid: 1 },
				placement: {
					kind: "world",
					pose: {
						landblockId,
						coords: { x, y: 0, z: 0 },
						rotation: { w: 1, x: 0, y: 0, z: 0 },
					},
				},
			}) as unknown as DynamicEntityView;
		const attachedEntity = {
			generation: 1,
			identity: { guid: 99, wcid: 2 },
			placement: { kind: "attached", parent: 1 },
		} as unknown as DynamicEntityView;

		const maxDistance = EXPLORER_TUNING.entities.tabTargetMaxDistanceMeters;
		const entities = [
			worldEntity(10, 50),
			worldEntity(20, 10),
			worldEntity(30, 30),
			worldEntity(40, maxDistance + 25),
			attachedEntity,
		];
		const camera = new Vec3(0, 0, 0);

		expect(
			cycleNearbyExplorerEntity(entities, null, null, camera, 1, maxDistance),
		).toEqual({ guid: 20, generation: 1 });
		expect(
			cycleNearbyExplorerEntity(
				entities,
				{ guid: 20, generation: 1 },
				null,
				camera,
				1,
				maxDistance,
			),
		).toEqual({ guid: 30, generation: 1 });
		expect(
			cycleNearbyExplorerEntity(
				entities,
				{ guid: 30, generation: 1 },
				null,
				camera,
				1,
				maxDistance,
			),
		).toEqual({ guid: 10, generation: 1 });
		expect(
			cycleNearbyExplorerEntity(
				entities,
				{ guid: 10, generation: 1 },
				null,
				camera,
				1,
				maxDistance,
			),
		).toEqual({ guid: 20, generation: 1 });
		expect(
			cycleNearbyExplorerEntity(
				entities,
				{ guid: 20, generation: 1 },
				null,
				camera,
				-1,
				maxDistance,
			),
		).toEqual({ guid: 10, generation: 1 });
		expect(
			cycleNearbyExplorerEntity(entities, null, 20, camera, 1, maxDistance),
		).toEqual({ guid: 30, generation: 1 });
	});

	it("checks world-placed entity membership against outdoor and dungeon scene interest", () => {
		const worldEntity = (landblockId: number): DynamicEntityView =>
			({
				generation: 1,
				identity: { guid: 1, wcid: 1 },
				placement: {
					kind: "world",
					pose: {
						landblockId,
						coords: { x: 0, y: 0, z: 0 },
						rotation: { w: 1, x: 0, y: 0, z: 0 },
					},
				},
			}) as unknown as DynamicEntityView;

		const outdoorInterest: ExplorerSceneInterestSnapshot = {
			target: {
				kind: "outdoor",
				requested: { kind: "outdoor", landblockId: "0x1010ffff" },
			},
			residency: { landblockId: "0x1010ffff", envCellId: null },
			radii: { ...EXPLORER_TUNING.residency.defaultRadii, terrainRadius: 2 },
		};
		expect(
			isExplorerEntityWithinSceneInterest(
				worldEntity(0x1010ffff),
				outdoorInterest,
			),
		).toBe(true);
		expect(
			isExplorerEntityWithinSceneInterest(
				worldEntity(0x1210ffff),
				outdoorInterest,
			),
		).toBe(true);
		expect(
			isExplorerEntityWithinSceneInterest(
				worldEntity(0x1310ffff),
				outdoorInterest,
			),
		).toBe(false);

		const dungeonInterest: ExplorerSceneInterestSnapshot = {
			target: {
				kind: "dungeon",
				requested: {
					kind: "automatic-landblock",
					landblockId: "0x01f5ffff",
				},
			},
			residency: { landblockId: "0x01f5ffff", envCellId: null },
			radii: EXPLORER_TUNING.residency.defaultRadii,
		};
		expect(
			isExplorerEntityWithinSceneInterest(
				worldEntity(0x01f50100),
				dungeonInterest,
			),
		).toBe(true);
		expect(
			isExplorerEntityWithinSceneInterest(
				worldEntity(0x1010ffff),
				dungeonInterest,
			),
		).toBe(false);
	});
});
