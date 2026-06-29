import type { RuntimeDynamicSpawnRequest } from "../dynamic/dynamic-entity-controller";

export const FIRST_RUNTIME_SPAWN_FIXTURE = {
	// ACE evidence: W_HUMAN_CLASS / HUMAN = 1, SetupConst.HumanMale = 0x02000001.
	label: "ACE WCID 1 Human Male",
	setupModelId: 0x02000001,
	weenieClassId: 1,
} as const;

export function createFirstRuntimeSpawnFixtureRequest(
	options: {
		readonly landblockId?: number;
		readonly origin?: {
			readonly x: number;
			readonly y: number;
			readonly z: number;
		};
	} = {},
): RuntimeDynamicSpawnRequest {
	return {
		animationSelection: { kind: "none" },
		baseLocalPlacement: {
			orientation: { w: 1, x: 0, y: 0, z: 0 },
			origin: options.origin ?? { x: 0, y: 0, z: 0 },
		},
		setupModelId: FIRST_RUNTIME_SPAWN_FIXTURE.setupModelId,
		sourceResidence: {
			kind: "outdoor-landblock",
			landblockId: options.landblockId ?? 0xda55ffff,
		},
	};
}
