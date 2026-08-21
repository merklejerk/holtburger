import { describe, expect, it } from "vitest";

import type { GroundedCharacterDrive } from "./grounded-character-input";
import {
	decodeExplorerPossession,
	IDLE_MOTION_ORDER,
	MOTION_COMMAND,
	motionOrderFromDrive,
	motionOrderIsIdle,
	possessionModels,
	restrictToModelled,
} from "./explorer-entity-possession";

function drive(
	overrides: Partial<GroundedCharacterDrive> = {},
): GroundedCharacterDrive {
	return {
		gait: "run",
		lateral: null,
		longitudinal: null,
		turn: null,
		...overrides,
	};
}

const walkingEntity = decodeExplorerPossession({
	guid: 0xf0000001,
	modelledCommands: ["0x45000005", "0x44000007", "0x6500000d"],
	motionTableId: "0x09000001",
});

describe("motionOrderFromDrive", () => {
	it("selects the run or walk substate from gait rather than scaling one of them", () => {
		expect(
			motionOrderFromDrive(drive({ longitudinal: "forward" }), null).forward,
		).toEqual({ command: MOTION_COMMAND.runForward, speed: 1 });
		expect(
			motionOrderFromDrive(
				drive({ gait: "walk", longitudinal: "forward" }),
				null,
			).forward,
		).toEqual({ command: MOTION_COMMAND.walkForward, speed: 1 });
	});

	it("carries forward, sidestep, and turn independently so a body can walk and turn at once", () => {
		const order = motionOrderFromDrive(
			drive({ lateral: "right", longitudinal: "forward", turn: "left" }),
			null,
		);

		expect(order.forward?.command).toBe(MOTION_COMMAND.runForward);
		expect(order.sidestep?.command).toBe(MOTION_COMMAND.sidestepRight);
		expect(order.turn?.command).toBe(MOTION_COMMAND.turnLeft);
	});

	it("issues speeds as multipliers left at the authored rate", () => {
		const order = motionOrderFromDrive(
			drive({ longitudinal: "forward" }),
			null,
		);

		expect(order.forward?.speed).toBe(1);
	});

	it("treats a drive with no held axis as idle", () => {
		expect(motionOrderIsIdle(motionOrderFromDrive(drive(), null))).toBe(true);
		expect(motionOrderIsIdle(IDLE_MOTION_ORDER)).toBe(true);
	});
});

describe("restrictToModelled", () => {
	it("drops axes the possessed entity's table does not model", () => {
		const order = motionOrderFromDrive(
			drive({ lateral: "left", longitudinal: "forward", turn: "right" }),
			null,
		);

		const restricted = restrictToModelled(order, walkingEntity);

		expect(restricted.forward?.command).toBe(MOTION_COMMAND.runForward);
		expect(restricted.turn?.command).toBe(MOTION_COMMAND.turnRight);
		expect(restricted.sidestep).toBeNull();
	});

	it("keeps the stance, which is not a locomotion axis", () => {
		const restricted = restrictToModelled(
			{ ...IDLE_MOTION_ORDER, style: 0x8000003d },
			walkingEntity,
		);

		expect(restricted.style).toBe(0x8000003d);
	});
});

describe("possessionModels", () => {
	it("compares the host's reported commands case-insensitively", () => {
		expect(possessionModels(walkingEntity, MOTION_COMMAND.walkForward)).toBe(
			true,
		);
		expect(possessionModels(walkingEntity, MOTION_COMMAND.sidestepLeft)).toBe(
			false,
		);
	});
});

describe("decodeExplorerPossession", () => {
	it("accepts a release, which names no entity and models nothing", () => {
		expect(
			decodeExplorerPossession({
				guid: null,
				modelledCommands: [],
				motionTableId: null,
			}).guid,
		).toBeNull();
	});

	it("rejects a malformed command list rather than silently modelling nothing", () => {
		expect(() =>
			decodeExplorerPossession({
				guid: 1,
				modelledCommands: ["walk"],
				motionTableId: "0x09000001",
			}),
		).toThrow();
	});
});
