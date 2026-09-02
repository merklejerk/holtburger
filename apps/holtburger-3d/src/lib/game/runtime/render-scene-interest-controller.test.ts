import { describe, expect, it } from "vitest";
import type { LandblockOwnerId } from "../game-types";
import {
	LandblockLayerKind,
	type SceneInterestRequest,
} from "./scene-interest";
import { RenderSceneInterestController } from "./render-scene-interest-controller";

const RADII = {
	buildingRadius: 2,
	envCellRadius: null,
	explicitObjectRadius: null,
	generatedObjectRadius: null,
	terrainRadius: 2,
} as const;

function outdoor(landblockId: LandblockOwnerId): SceneInterestRequest {
	return {
		ambientOutdoorEnvCellOwners: new Set(),
		radii: RADII,
		target: {
			kind: "outdoor",
			requested: { kind: "outdoor", landblockId },
		},
	};
}

function dungeon(landblockId: LandblockOwnerId): SceneInterestRequest {
	return {
		ambientOutdoorEnvCellOwners: new Set(),
		radii: RADII,
		target: {
			kind: "dungeon",
			requested: { kind: "automatic-landblock", landblockId },
		},
	};
}

describe("RenderSceneInterestController", () => {
	it("rejects invalid policy before changing its state", () => {
		const controller = new RenderSceneInterestController();
		const invalid = {
			...outdoor("0xda55ffff"),
			radii: { ...RADII, terrainRadius: -1 },
		} satisfies SceneInterestRequest;

		expect(() => controller.follow(invalid)).toThrow("Invalid scene config");
		expect(controller.snapshot().interest).toHaveLength(0);
	});

	it("converges repeated four-corner movement without preloading the exit ring", () => {
		const controller = new RenderSceneInterestController();
		const corners = [
			"0xda55ffff",
			"0xdb55ffff",
			"0xdb56ffff",
			"0xda56ffff",
		] as const;

		const first = controller.follow(outdoor(corners[0]));
		expect(first.effectiveInterest).toHaveLength(25);
		for (const corner of [...corners.slice(1), ...corners, ...corners]) {
			controller.follow(outdoor(corner));
		}

		const converged = controller.snapshot().interest;
		expect(converged).toHaveLength(36);
		const repeated = controller.follow(outdoor(corners[0]));
		expect(repeated.effectiveInterest).toEqual(converged);
	});

	it("bounds sustained travel to the exit square", () => {
		const controller = new RenderSceneInterestController();
		for (const owner of [
			"0xda55ffff",
			"0xdb55ffff",
			"0xdc55ffff",
			"0xdd55ffff",
		] as const) {
			controller.follow(outdoor(owner));
		}

		const interest = controller.snapshot().interest;
		expect(interest).toHaveLength(30);
		expect(interest.has("0xd855ffff")).toBe(false);
		expect(interest.has("0xda55ffff")).toBe(true);
	});

	it("uses exact replacement for activation, dungeon, and clear transitions", () => {
		const controller = new RenderSceneInterestController();
		controller.follow(outdoor("0xda55ffff"));
		controller.follow(outdoor("0xdb55ffff"));

		const replacement = controller.replace(outdoor("0xdb55ffff"));
		expect(replacement.effectiveInterest).toHaveLength(25);
		expect(replacement.effectiveInterest).toEqual(replacement.nominalInterest);

		const indoor = controller.follow(dungeon("0x0005ffff"));
		expect(indoor.effectiveInterest).toEqual(
			new Map([["0x0005ffff", new Set([LandblockLayerKind.EnvCells])]]),
		);
		expect(controller.fogCoverage()).toBeNull();

		controller.clear();
		expect(controller.snapshot()).toEqual({
			interest: new Map(),
			resolvedTarget: null,
		});
	});

	it("keeps fog tied to nominal terrain radius", () => {
		const controller = new RenderSceneInterestController();
		controller.follow(outdoor("0xda55ffff"));
		controller.follow(outdoor("0xdb55ffff"));

		expect(controller.fogCoverage()).toEqual({ terrainRadius: 2 });
	});

	it("supports radius-zero follow and immediately drops newly disabled layers", () => {
		const controller = new RenderSceneInterestController();
		controller.follow(outdoor("0xda55ffff"));
		const zeroRadius = {
			...outdoor("0xdb55ffff"),
			radii: {
				buildingRadius: null,
				envCellRadius: null,
				explicitObjectRadius: null,
				generatedObjectRadius: null,
				terrainRadius: 0,
			},
		} satisfies SceneInterestRequest;

		const transition = controller.follow(zeroRadius);
		expect(transition.nominalInterest).toHaveLength(1);
		expect(transition.effectiveInterest).toHaveLength(9);
		expect(
			[...transition.effectiveInterest.values()].every(
				(layers) => layers.size === 1 && layers.has(LandblockLayerKind.Terrain),
			),
		).toBe(true);
	});
});
