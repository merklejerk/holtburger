import { z } from "zod";
import {
	validateHostPlacedPath,
	validateHostPlacedPathShape,
} from "../motion/host-placed-path";
import { DYNAMIC_ENTITY_PRESENTATION_CLASSES } from "../dynamic-entity-presentation-class";

const finiteNumber = z.number().finite();
const nonNegativeInteger = z.number().int().nonnegative();
const guid = nonNegativeInteger.max(0xffff_ffff);

declare const cellIdBrand: unique symbol;
/** Exact AC world-position cell identity, distinct from a normalized landblock owner. */
export type CellId = number & { readonly [cellIdBrand]: "CellId" };
const cellIdSchema = guid.transform((value): CellId => value as CellId);

/** Validate and brand one exact AC cell identity at a typed construction boundary. */
export function cellId(value: number): CellId {
	return cellIdSchema.parse(value);
}

const vector3Schema = z.object({
	x: finiteNumber,
	y: finiteNumber,
	z: finiteNumber,
});

const quaternionSchema = z.object({
	w: finiteNumber,
	x: finiteNumber,
	y: finiteNumber,
	z: finiteNumber,
});

const worldPositionSchema = z.object({
	// Wire spelling follows WorldPosition; the value is an exact cell, never a terrain owner.
	landblockId: cellIdSchema,
	coords: vector3Schema,
	rotation: quaternionSchema,
});

const spatialMembershipSchema = z.object({
	reachesOutdoors: z.boolean(),
	reachedEnvCellIds: z.array(cellIdSchema),
});

const appearanceSchema = z.object({
	paletteDid: guid.nullable(),
	subPalettes: z.array(
		z.object({
			paletteDid: guid,
			offset: nonNegativeInteger,
			colorCount: nonNegativeInteger,
		}),
	),
	textureChanges: z.array(
		z.object({
			partIndex: nonNegativeInteger.max(0xff),
			oldTextureDid: guid,
			newTextureDid: guid,
		}),
	),
	partChanges: z.array(
		z.object({
			partIndex: nonNegativeInteger.max(0xff),
			gfxObjDid: guid,
		}),
	),
});

const parentLocationSchema = z.enum([
	"none",
	"right-hand",
	"left-hand",
	"shield",
	"belt",
	"quiver",
	"heraldry",
	"mouth",
	"left-weapon",
	"left-unarmed",
]);

const placementSchema = z.enum([
	"default",
	"right-hand-combat",
	"right-hand-non-combat",
	"left-hand",
	"belt",
	"quiver",
	"shield",
	"left-weapon",
	"left-unarmed",
	"unknown0-a",
	"unknown0-f",
	"unknown14",
	"unknown1-e",
	"unknown20",
	"special-crossbow-bolt",
	"missile-flight",
	"unknown3-c",
	"unknown63",
	"resting",
	"other",
	"hook",
	"unknown68",
	"unknown69",
	"unknown6-a",
	"unknown78",
	"random1",
	"random2",
	"random3",
	"random4",
	"random5",
	"random6",
	"random7",
	"random8",
	"random9",
	"random10",
	"unknown84",
	"unknown-f0",
	"unknown3-f2",
]);

const dynamicEntityPlacementSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("world"),
			pose: worldPositionSchema,
			spatialMembership: spatialMembershipSchema,
			contact: z.enum(["unknown", "airborne", "sliding", "grounded"]),
			sampleMode: z.enum([
				"authoritative-only",
				"simulating-motion-state",
				"simulating-velocity",
				"suspended",
			]),
		})
		.strict(),
	z
		.object({
			kind: z.literal("attached"),
			parent: guid,
			parentLocation: parentLocationSchema,
			placement: placementSchema,
		})
		.strict(),
]);

/** Current motion-derived presentation level selected by the authoritative host cursor. */
const dynamicEntityMotionSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("playing"),
		animationId: guid,
		completion: z.enum(["hold", "loop"]),
		/** Negative plays the window backwards. */
		framerate: finiteNumber,
		highFrame: z.number().int(),
		lowFrame: z.number().int(),
	}),
	z.object({
		kind: z.literal("settled"),
		animationId: guid,
		/** Exact integral frame at which the authoritative cursor is resting. */
		frame: z.number().int(),
	}),
]);

const dynamicEntityViewSchema = z.object({
	generation: nonNegativeInteger,
	identity: z.object({
		guid,
		wcid: guid,
	}),
	display: z.object({
		/** Required producer-resolved display name. */
		name: z.string(),
		/** Optional validated authored level. */
		level: nonNegativeInteger.nullable(),
	}),
	presentation: z.object({
		/** Producer-resolved presentation class; consumers never reconstruct it from radar color. */
		entityClass: z.enum(DYNAMIC_ENTITY_PRESENTATION_CLASSES),
		content: z.object({
			/** Table this entity animates from, or `null` when neither it nor its setup declares one. */
			motionTableDid: guid.nullable(),
			setupDid: guid,
			soundTableDid: guid.nullable(),
			physicsEffectTableDid: guid.nullable(),
		}),
		appearance: appearanceSchema,
		objectScale: finiteNumber.positive(),
		/** Producer-resolved retail radar presentation facts. */
		radar: z.object({
			blipColor: z.enum([
				"Default",
				"Blue",
				"Gold",
				"White",
				"Purple",
				"Red",
				"Pink",
				"Green",
				"Yellow",
				"Cyan",
				"BrightGreen",
			]),
			behavior: z
				.enum([
					"Undefined",
					"ShowNever",
					"ShowMovement",
					"ShowAttacking",
					"ShowAlways",
				])
				.nullable(),
			/** `PropertyFloat::ObviousRadarRange` in metres. */
			obviousRange: finiteNumber.nonnegative().nullable(),
		}),
	}),
	physics: z.object({
		semanticMask: guid,
		participation: z.enum(["pose-only", "physical"]),
		noDraw: z.boolean(),
		hidden: z.boolean(),
		cloaked: z.boolean(),
		/** Current whole-object translucency in the inclusive unit interval. */
		translucency: finiteNumber.min(0).max(1),
		lighting: z.boolean(),
		defaultAnimation: z.boolean(),
		defaultScript: z.boolean(),
	}),
	placement: dynamicEntityPlacementSchema,
	/**
	 * Motion presentation held right now, or `null` when it animates nothing.
	 *
	 * A level, not an edge: every view states the current presentation, so an entity realized late
	 * or re-realized from a snapshot reconstructs it without witnessing the selecting transition.
	 * Applying it is idempotent; swap only when it differs from what is already presented.
	 */
	motion: dynamicEntityMotionSchema.nullable(),
});

const hostTimeSchema = z.object({ seconds: finiteNumber.nonnegative() });

const dynamicEntitySnapshotSchema = z.object({
	hostTime: hostTimeSchema,
	entities: z.array(dynamicEntityViewSchema),
});

const dynamicEntityPathPointSchema = z.object({
	pose: worldPositionSchema,
	spatialMembership: spatialMembershipSchema,
});
const dynamicEntityPathSchema = z.object({
	initial: dynamicEntityPathPointSchema,
	legs: z
		.array(
			z.object({
				endFraction: finiteNumber,
				end: dynamicEntityPathPointSchema,
			}),
		)
		.nonempty(),
});

const dynamicEntityAdvanceSchema = z.object({
	entity: dynamicEntityViewSchema,
	kind: z.enum(["integrated", "correction-snap", "teleport", "reset"]),
	path: dynamicEntityPathSchema,
});

const dynamicEntityTickBatchSchema = z
	.object({
		hostTime: hostTimeSchema,
		durationMs: finiteNumber.nonnegative(),
		advances: z.array(dynamicEntityAdvanceSchema),
		updates: z.array(dynamicEntityViewSchema),
	})
	.refine((batch) => batch.advances.length > 0 || batch.updates.length > 0, {
		message: "Dynamic-entity tick must contain an advance or update.",
	});

const dynamicEntityEventSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("snapshot"),
		snapshot: dynamicEntitySnapshotSchema,
	}),
	z.object({
		kind: z.literal("upserted"),
		entity: dynamicEntityViewSchema,
	}),
	z.object({
		kind: z.literal("removed"),
		guid,
		generation: nonNegativeInteger,
	}),
	z.object({
		kind: z.literal("ticked"),
		batch: dynamicEntityTickBatchSchema,
	}),
]);

export type DynamicEntityView = z.infer<typeof dynamicEntityViewSchema>;
export type DynamicEntitySnapshot = z.infer<typeof dynamicEntitySnapshotSchema>;
export type DynamicEntityWorldPlacement = Extract<
	DynamicEntityView["placement"],
	{ kind: "world" }
>;
export type DynamicEntityAttachedPlacement = Extract<
	DynamicEntityView["placement"],
	{ kind: "attached" }
>;
export type DynamicEntityAdvance = z.infer<typeof dynamicEntityAdvanceSchema>;
export type DynamicEntityMotion = z.infer<typeof dynamicEntityMotionSchema>;
export type DynamicEntityTickBatch = z.infer<
	typeof dynamicEntityTickBatchSchema
>;
export type DynamicEntityEvent = z.infer<typeof dynamicEntityEventSchema>;

/** Validates the narrow host boundary before mutable frontend state observes it. */
export function decodeDynamicEntityEvent(value: unknown): DynamicEntityEvent {
	const event = dynamicEntityEventSchema.parse(value);
	if (event.kind === "ticked") {
		const seen = new Set<number>();
		for (const advance of event.batch.advances) {
			if (seen.has(advance.entity.identity.guid))
				throw new Error(
					`Dynamic-entity tick contains duplicate GUID 0x${advance.entity.identity.guid.toString(16).padStart(8, "0")}.`,
				);
			seen.add(advance.entity.identity.guid);
			if (advance.entity.placement.kind !== "world") {
				throw new Error(
					`Dynamic-entity advance targets attached GUID 0x${advance.entity.identity.guid.toString(16).padStart(8, "0")}.`,
				);
			}
			if (advance.kind === "integrated") {
				validateHostPlacedPath(advance.path, event.batch.durationMs);
			} else {
				validateHostPlacedPathShape(advance.path);
			}
		}
		for (const update of event.batch.updates) {
			if (seen.has(update.identity.guid))
				throw new Error(
					`Dynamic-entity tick contains duplicate GUID 0x${update.identity.guid.toString(16).padStart(8, "0")}.`,
				);
			seen.add(update.identity.guid);
		}
	}
	return event;
}

/** Validates the snapshot embedded in the client lifecycle replacement contract. */
export function decodeDynamicEntitySnapshot(
	value: unknown,
): DynamicEntitySnapshot {
	return dynamicEntitySnapshotSchema.parse(value);
}

/** Validate one focused current entity returned by a diagnostic host boundary. */
export function decodeDynamicEntityView(value: unknown): DynamicEntityView {
	return dynamicEntityViewSchema.parse(value);
}

/** Current focused entity mirror with explicit awaiting-snapshot hydration state. */
export class DynamicEntityMirror {
	#awaitingSnapshot = true;
	#entities = new Map<number, DynamicEntityView>();
	#timeline: { hostSeconds: number; frontendSeconds: number } | null = null;
	#lastTickHostSeconds: number | null = null;
	readonly #nowSeconds: () => number;

	constructor(nowSeconds = () => performance.now() / 1_000) {
		this.#nowSeconds = nowSeconds;
	}

	/** Await the next current-state snapshot; deltas arriving first are superseded, not replayed. */
	awaitSnapshot(): void {
		this.#awaitingSnapshot = true;
		this.#timeline = null;
		this.#lastTickHostSeconds = null;
	}

	/** Apply one validated snapshot or ordered live mutation and report whether current state changed. */
	apply(event: DynamicEntityEvent): boolean {
		if (event.kind === "snapshot") {
			const replacement = new Map<number, DynamicEntityView>();
			for (const entity of event.snapshot.entities) {
				const entityGuid = entity.identity.guid;
				if (replacement.has(entityGuid)) {
					throw new Error(
						`Dynamic-entity snapshot contains duplicate GUID 0x${entityGuid.toString(16).padStart(8, "0")}.`,
					);
				}
				replacement.set(entityGuid, entity);
			}
			this.#entities = replacement;
			this.#timeline = {
				hostSeconds: event.snapshot.hostTime.seconds,
				frontendSeconds: this.#nowSeconds(),
			};
			this.#lastTickHostSeconds = event.snapshot.hostTime.seconds;
			this.#awaitingSnapshot = false;
			return true;
		}

		if (this.#awaitingSnapshot) return false;
		if (event.kind === "upserted") {
			const current = this.#entities.get(event.entity.identity.guid);
			if (
				current !== undefined &&
				current.generation > event.entity.generation
			) {
				return false;
			}
			this.#entities.set(event.entity.identity.guid, event.entity);
			return current !== event.entity;
		}
		if (event.kind === "ticked") {
			if (
				this.#lastTickHostSeconds !== null &&
				event.batch.hostTime.seconds <= this.#lastTickHostSeconds
			) {
				return false;
			}
			this.#lastTickHostSeconds = event.batch.hostTime.seconds;
			const seen = new Set<number>();
			let changed = false;
			for (const advance of event.batch.advances) {
				const entityGuid = advance.entity.identity.guid;
				if (seen.has(entityGuid)) {
					throw new Error(
						`Dynamic-entity advance contains duplicate GUID 0x${entityGuid.toString(16).padStart(8, "0")}.`,
					);
				}
				seen.add(entityGuid);
				const current = this.#entities.get(entityGuid);
				if (current?.generation !== advance.entity.generation) continue;
				this.#entities.set(entityGuid, advance.entity);
				changed = true;
			}
			for (const update of event.batch.updates) {
				const entityGuid = update.identity.guid;
				if (seen.has(entityGuid)) {
					throw new Error(
						`Dynamic-entity tick contains duplicate GUID 0x${entityGuid.toString(16).padStart(8, "0")}.`,
					);
				}
				seen.add(entityGuid);
				const current = this.#entities.get(entityGuid);
				if (current?.generation !== update.generation) continue;
				this.#entities.set(entityGuid, update);
				changed = true;
			}
			return changed;
		}

		const current = this.#entities.get(event.guid);
		if (current?.generation === event.generation) {
			this.#entities.delete(event.guid);
			return true;
		}
		return false;
	}

	/** Stable current population for UI and presentation reconciliation. */
	entities(): readonly DynamicEntityView[] {
		return [...this.#entities.values()].sort(
			(left, right) => left.identity.guid - right.identity.guid,
		);
	}

	/** Read one exact current generation without sorting or allocating the whole population. */
	entity(guid: number, generation: number): DynamicEntityView | null {
		const current = this.#entities.get(guid);
		return current?.generation === generation ? current : null;
	}

	/** Whether deltas are intentionally being ignored pending replacement state. */
	isAwaitingSnapshot(): boolean {
		return this.#awaitingSnapshot;
	}

	/** Map the frontend clock onto the host monotonic timeline established by the snapshot. */
	hostTimeSeconds(frontendSeconds = this.#nowSeconds()): number | null {
		return this.#timeline === null
			? null
			: this.#timeline.hostSeconds +
					(frontendSeconds - this.#timeline.frontendSeconds);
	}
}
