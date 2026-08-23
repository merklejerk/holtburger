import { z } from "zod";

import type { CharacterDrive } from "../lib/game/controls/character-input-controller";

const datId = z.string().regex(/^0x[0-9a-f]{8}$/i);
const unsigned32 = z.number().int().min(0).max(0xffff_ffff);
const generation = z.number().int().nonnegative().safe();

/** Stances the Explorer offers. Values are full motion-table style commands. */
export const MOTION_STYLE = {
	bowCombat: 0x8000_003f,
	dualWieldCombat: 0x8000_0046,
	handCombat: 0x8000_003c,
	magic: 0x8000_0049,
	nonCombat: 0x8000_003d,
	swordCombat: 0x8000_003e,
	swordShieldCombat: 0x8000_0040,
	twoHandedSwordCombat: 0x8000_0044,
} as const;

export type MotionStyleName = keyof typeof MOTION_STYLE;

const locomotionSource = z.enum([
	"target-authored",
	"standard-fallback-with-target-presentation",
	"standard-fallback-without-target-presentation",
]);

const jumpPresentation = z.enum([
	"ready-and-falling",
	"ready-only",
	"falling-only",
	"stance-default",
]);

const possessionStanceCapability = z.object({
	chargeDurationMs: z.number().int().positive().safe(),
	jumpPresentation,
	run: locomotionSource,
	sidestep: locomotionSource,
	style: unsigned32,
	turn: locomotionSource,
	walk: locomotionSource,
});

const possessionRunRateCapability = z
	.object({
		initial: z.number().finite(),
		maximum: z.number().finite(),
		minimum: z.number().finite(),
	})
	.strict();

/** Capability and target-presentation quality for one host-modelled stance. */
export type PossessionStanceCapability = z.infer<
	typeof possessionStanceCapability
>;

const activePossession = z.object({
	acceptedStance: unsigned32,
	entityGeneration: generation,
	guid: unsigned32,
	motionTableId: datId,
	possessionGeneration: generation,
	runRateCapability: possessionRunRateCapability,
	stances: z.array(possessionStanceCapability),
});

const releasedPossession = z.object({
	acceptedStance: z.null(),
	entityGeneration: z.null(),
	guid: z.null(),
	motionTableId: z.null(),
	possessionGeneration: generation,
	runRateCapability: z.null(),
	stances: z.array(possessionStanceCapability).length(0),
});

const explorerPossessionSchema = z.union([
	activePossession,
	releasedPossession,
]);

/** What the host reported about the current possession ownership epoch. */
export type ExplorerPossession = z.infer<typeof explorerPossessionSchema>;

/** Mutable accepted controls for one exact live possession generation. */
export interface ExplorerPossessionControls {
	readonly stance: number;
	readonly runRateScalar: number;
}

export function decodeExplorerPossession(value: unknown): ExplorerPossession {
	return explorerPossessionSchema.parse(value);
}

/** Complete coalescible semantic intent sent to the host-owned possession controller. */
export interface ExplorerPossessionIntent {
	readonly drive: CharacterDrive;
	readonly possessionGeneration: number;
	readonly revision: number;
	readonly runRateScalar: number;
	readonly stance: number;
}

/** Ordered lifecycle request carrying the complete intent snapshot at the browser edge. */
export type ExplorerPossessionEventRequest = ExplorerPossessionIntent &
	(
		| { readonly kind: "begin-jump"; readonly sequence: number }
		| {
				readonly extent: number;
				readonly kind: "release-jump";
				readonly sequence: number;
		  }
		| { readonly kind: "reset"; readonly sequence: number }
	);

const possessionIntentResult = z.enum([
	"accepted",
	"ignored-stale-possession",
	"ignored-stale-revision",
]);

export type PossessionIntentResult = z.infer<typeof possessionIntentResult>;

export function decodePossessionIntentResult(
	value: unknown,
): PossessionIntentResult {
	return possessionIntentResult.parse(value);
}

const possessionEventQueueResult = z.enum([
	"queued",
	"ignored-stale-possession",
	"ignored-duplicate",
]);

const possessionEventRejection = z.enum([
	"charge-not-active",
	"nonphysical-response",
	"unsupported-contact",
	"airborne",
	"constrained",
]);

const possessionEventOutcomeKind = z.union([
	z
		.object({
			kind: z.enum(["charge-accepted", "charge-continues", "jump-released"]),
			presentation: jumpPresentation,
		})
		.strict(),
	z.object({ kind: z.literal("reset") }).strict(),
	z
		.object({ kind: z.literal("rejected"), reason: possessionEventRejection })
		.strict(),
]);

const possessionEventOutcome = z
	.object({
		possessionGeneration: z.number().int().nonnegative(),
		sequence: z.number().int().nonnegative(),
		result: possessionEventOutcomeKind,
	})
	.strict();

const possessionEventOutcomes = z.array(possessionEventOutcome).nonempty();

export type PossessionEventOutcome = z.infer<typeof possessionEventOutcome>;

export function decodePossessionEventOutcome(
	value: unknown,
): PossessionEventOutcome {
	return possessionEventOutcome.parse(value);
}

/** Validate one non-empty fixed-tick publication without discarding its transaction boundary. */
export function decodePossessionEventOutcomes(
	value: unknown,
): PossessionEventOutcome[] {
	return possessionEventOutcomes.parse(value);
}

const possessionEventQueueReceipt = z
	.object({
		result: possessionEventQueueResult,
		outcomes: z.array(possessionEventOutcome),
	})
	.strict();

export type PossessionEventQueueReceipt = z.infer<
	typeof possessionEventQueueReceipt
>;

export function decodePossessionEventQueueReceipt(
	value: unknown,
): PossessionEventQueueReceipt {
	return possessionEventQueueReceipt.parse(value);
}

const possessionActiveMotionProbe = z
	.object({ command: unsigned32, speed: z.number().finite() })
	.strict();

const possessionMotionProbe = z
	.object({
		clip: z
			.object({
				animationId: unsigned32,
				completion: z.enum(["hold", "loop"]),
				framerate: z.number().finite(),
				highFrame: z.number().int(),
				lowFrame: z.number().int(),
			})
			.strict()
			.nullable(),
		entityGeneration: generation,
		effectivePlanarSpeed: z.number().finite().nullable(),
		guid: unsigned32,
		modifiers: z.array(possessionActiveMotionProbe),
		physicalStatus: z.enum(["solved", "substep-budget-exceeded"]).nullable(),
		possessionGeneration: generation,
		requestedRunRate: z.number().finite(),
		style: unsigned32,
		substate: possessionActiveMotionProbe,
	})
	.strict();

export type PossessionMotionProbe = z.infer<typeof possessionMotionProbe>;

export function decodePossessionMotionProbe(
	value: unknown,
): PossessionMotionProbe | null {
	return value === null ? null : possessionMotionProbe.parse(value);
}

/** Finds a modelled stance without letting the frontend reconstruct host capability policy. */
export function possessionStance(
	possession: Extract<ExplorerPossession, { guid: number }>,
	style: number,
): PossessionStanceCapability | null {
	return (
		possession.stances.find((capability) => capability.style === style) ?? null
	);
}
