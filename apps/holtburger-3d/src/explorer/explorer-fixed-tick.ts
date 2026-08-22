import { z } from "zod";
import {
	decodeHostKinematicBoomTick,
	type HostKinematicBoomTick,
} from "../lib/game/motion/host-kinematic-boom-path";
import {
	decodeDynamicEntityEvent,
	type DynamicEntityEvent,
} from "../lib/game/runtime/dynamic-entity-feed";

const envelopeSchema = z
	.object({
		epoch: z.number().int().positive().safe(),
		hostTime: z.object({ seconds: z.number().finite().nonnegative() }).strict(),
		durationMs: z.number().finite().positive(),
		entityAdvances: z.array(z.unknown()),
		boom: z.unknown().nullable(),
	})
	.strict();

/** One decoded app-local fixed epoch with entity and boom presentation still phase-aligned. */
export interface ExplorerFixedTickEnvelope {
	/** Host monotonic publication sequence; gaps identify omitted or delayed envelopes. */
	readonly epoch: number;
	/** Host monotonic time sampled once for the complete envelope. */
	readonly hostTime: { readonly seconds: number };
	/** Positive playback duration shared by every path in this envelope. */
	readonly durationMs: number;
	/** Existing entity advance event, or null when only the camera needs publication. */
	readonly entityEvent: Extract<
		DynamicEntityEvent,
		{ kind: "advanced" }
	> | null;
	/** Current host boom result, or null while no boom session is active. */
	readonly boom: HostKinematicBoomTick | null;
}

/** Validate the atomic Explorer boundary before either presentation consumer observes it. */
export function decodeExplorerFixedTickEnvelope(
	value: unknown,
): ExplorerFixedTickEnvelope {
	const parsed = envelopeSchema.parse(value);
	const entityEvent =
		parsed.entityAdvances.length === 0
			? null
			: (decodeDynamicEntityEvent({
					kind: "advanced",
					batch: {
						hostTime: parsed.hostTime,
						durationMs: parsed.durationMs,
						advances: parsed.entityAdvances,
					},
				}) as Extract<DynamicEntityEvent, { kind: "advanced" }>);
	const boom =
		parsed.boom === null
			? null
			: decodeHostKinematicBoomTick(parsed.boom, parsed.durationMs);
	if (entityEvent === null && boom === null) {
		throw new Error(
			"Explorer fixed-tick envelope must contain a presentation result.",
		);
	}
	return {
		epoch: parsed.epoch,
		hostTime: parsed.hostTime,
		durationMs: parsed.durationMs,
		entityEvent,
		boom,
	};
}
