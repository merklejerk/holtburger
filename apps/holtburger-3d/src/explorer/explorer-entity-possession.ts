import { z } from "zod";

import type { GroundedCharacterDrive } from "./grounded-character-input";

const datId = z.string().regex(/^0x[0-9a-f]{8}$/i);
const unsigned32 = z.number().int().min(0).max(0xffff_ffff);

/**
 * Motion-table commands the Explorer can issue, as full 32-bit values.
 *
 * The wire carries only the low 16 bits; the table keys on the full value whose high half
 * classifies the command. Forward locomotion is a substate while turning and sidestepping are
 * modifiers, which is what lets a body walk and turn at once.
 */
export const MOTION_COMMAND = {
	runForward: 0x4400_0007,
	sidestepLeft: 0x6500_0010,
	sidestepRight: 0x6500_000f,
	turnLeft: 0x6500_000e,
	turnRight: 0x6500_000d,
	walkBackwards: 0x4500_0006,
	walkForward: 0x4500_0005,
} as const;

/** Stances the Explorer offers. Values are full motion-table style commands. */
export const MOTION_STYLE = {
	bowCombat: 0x8000_003f,
	handCombat: 0x8000_003c,
	magic: 0x8000_0049,
	nonCombat: 0x8000_003d,
	swordCombat: 0x8000_003e,
	swordShieldCombat: 0x8000_0040,
	twoHandedSwordCombat: 0x8000_0044,
} as const;

export type MotionStyleName = keyof typeof MOTION_STYLE;

const explorerPossessionSchema = z.object({
	guid: unsigned32.nullable(),
	modelledCommands: z.array(datId),
	motionTableId: datId.nullable(),
});

/** What the host reported about the entity that was just possessed. */
export type ExplorerPossession = z.infer<typeof explorerPossessionSchema>;

export function decodeExplorerPossession(value: unknown): ExplorerPossession {
	return explorerPossessionSchema.parse(value);
}

/** One commanded motion and the multiplier it plays at. */
interface OrderedMotion {
	readonly command: number;
	/** Retail's `speedMod`: a multiplier on the selected motion, not metres per second. */
	readonly speed: number;
}

/** Semantic order for the possessed entity, in the four axes retail interprets. */
export interface ExplorerMotionOrder {
	readonly style: number | null;
	readonly forward: OrderedMotion | null;
	readonly sidestep: OrderedMotion | null;
	readonly turn: OrderedMotion | null;
}

export const IDLE_MOTION_ORDER: ExplorerMotionOrder = {
	forward: null,
	sidestep: null,
	style: null,
	turn: null,
};

/**
 * Translates held-key drive into a motion order for the possessed entity.
 *
 * The same four axes the camera controller already arbitrates, retargeted. Gait selects between the
 * walk and run substates rather than scaling one of them, because the table authors them as
 * different cycles with different root motion — which is the whole reason this path exists.
 *
 * Speeds stay at `1.0`: they are multipliers on the authored motion, and the Explorer has no reason
 * to play a cycle at anything other than its authored rate.
 */
export function motionOrderFromDrive(
	drive: GroundedCharacterDrive,
	style: number | null,
): ExplorerMotionOrder {
	const ordered = (command: number): OrderedMotion => ({ command, speed: 1 });
	const forward =
		drive.longitudinal === "forward"
			? ordered(
					drive.gait === "run"
						? MOTION_COMMAND.runForward
						: MOTION_COMMAND.walkForward,
				)
			: drive.longitudinal === "backward"
				? ordered(MOTION_COMMAND.walkBackwards)
				: null;
	const sidestep =
		drive.lateral === "left"
			? ordered(MOTION_COMMAND.sidestepLeft)
			: drive.lateral === "right"
				? ordered(MOTION_COMMAND.sidestepRight)
				: null;
	const turn =
		drive.turn === "left"
			? ordered(MOTION_COMMAND.turnLeft)
			: drive.turn === "right"
				? ordered(MOTION_COMMAND.turnRight)
				: null;

	return { forward, sidestep, style, turn };
}

/** Whether an order asks the entity to do anything at all. */
export function motionOrderIsIdle(order: ExplorerMotionOrder): boolean {
	return (
		order.forward === null && order.sidestep === null && order.turn === null
	);
}

/** Whether the possessed entity's table models one command, read from the host's report. */
export function possessionModels(
	possession: ExplorerPossession,
	command: number,
): boolean {
	const wanted = `0x${command.toString(16).padStart(8, "0")}`;
	return possession.modelledCommands.some(
		(modelled) => modelled.toLowerCase() === wanted,
	);
}

/**
 * Drops the axes the possessed entity's table cannot perform.
 *
 * Issuing an unmodelled command is harmless — selection reports it and nothing happens — but the
 * UX should not pretend it worked, and the host should not be asked for motion that cannot exist.
 */
export function restrictToModelled(
	order: ExplorerMotionOrder,
	possession: ExplorerPossession,
): ExplorerMotionOrder {
	const keep = (motion: OrderedMotion | null): OrderedMotion | null =>
		motion !== null && possessionModels(possession, motion.command)
			? motion
			: null;

	return {
		forward: keep(order.forward),
		sidestep: keep(order.sidestep),
		style: order.style,
		turn: keep(order.turn),
	};
}
