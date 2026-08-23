import { z } from "zod";
import {
	validateHostPlacedPath,
	validateHostPlacedPathShape,
} from "../motion/host-placed-path";

const finiteNumber = z.number().finite();
const nonNegativeInteger = z.number().int().nonnegative();
const guid = nonNegativeInteger.max(0xffff_ffff);

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
	landblockId: guid,
	coords: vector3Schema,
	rotation: quaternionSchema,
});

const spatialMembershipSchema = z.object({
	reachesOutdoors: z.boolean(),
	reachedEnvCellIds: z.array(guid),
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
			velocity: vector3Schema,
			acceleration: vector3Schema,
			omega: vector3Schema,
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

/**
 * The clip the host has an entity playing, projected for presentation.
 *
 * Narrow on purpose: the frontend advances within this clip's window at render rate, obeys the
 * host-derived terminal behavior, and never chooses the next clip. Which clip follows is link
 * resolution against host state the frontend does not have, so a successor arrives only as a
 * later view.
 *
 * There is no frame number. Host and frontend both advance by `framerate * dt`, so a phase offset
 * never accumulates, and entering a clip re-anchors both at the same frame regardless.
 */
const dynamicEntityPlayingClipSchema = z.object({
	animationId: guid,
	completion: z.enum(["hold", "loop"]),
	/** Negative plays the window backwards; zero holds. */
	framerate: finiteNumber,
	highFrame: z.number().int(),
	lowFrame: z.number().int(),
});

const dynamicEntityViewSchema = z.object({
	generation: nonNegativeInteger,
	identity: z.object({
		guid,
		wcid: guid,
		name: z.string(),
	}),
	presentation: z.object({
		content: z.object({
			/** Table this entity animates from, or `null` when neither it nor its setup declares one. */
			motionTableDid: guid.nullable(),
			setupDid: guid,
			soundTableDid: guid.nullable(),
			physicsEffectTableDid: guid.nullable(),
		}),
		appearance: appearanceSchema,
		objectScale: finiteNumber.positive(),
	}),
	physics: z.object({
		semanticMask: guid,
		participation: z.enum(["pose-only", "physical"]),
		noDraw: z.boolean(),
		hidden: z.boolean(),
		cloaked: z.boolean(),
		lighting: z.boolean(),
		defaultAnimation: z.boolean(),
		defaultScript: z.boolean(),
	}),
	placement: dynamicEntityPlacementSchema,
	/**
	 * Clip this entity is playing right now, or `null` when it animates nothing.
	 *
	 * A level, not an edge: every view states the current clip, so an entity realized late — or
	 * re-realized from a snapshot — starts playing without having witnessed the transition that
	 * selected it. Applying it is idempotent; swap only when it differs from what is playing.
	 */
	playingClip: dynamicEntityPlayingClipSchema.nullable(),
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
	kind: z.enum(["integrated", "teleport", "reset"]),
	path: dynamicEntityPathSchema,
});

const dynamicEntityAdvanceBatchSchema = z.object({
	hostTime: hostTimeSchema,
	durationMs: finiteNumber.nonnegative(),
	advances: z.array(dynamicEntityAdvanceSchema).nonempty(),
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
		kind: z.literal("advanced"),
		batch: dynamicEntityAdvanceBatchSchema,
	}),
]);

export type DynamicEntityView = z.infer<typeof dynamicEntityViewSchema>;
export type DynamicEntityWorldPlacement = Extract<
	DynamicEntityView["placement"],
	{ kind: "world" }
>;
export type DynamicEntityAttachedPlacement = Extract<
	DynamicEntityView["placement"],
	{ kind: "attached" }
>;
export type DynamicEntityAdvance = z.infer<typeof dynamicEntityAdvanceSchema>;
export type DynamicEntityPlayingClip = z.infer<
	typeof dynamicEntityPlayingClipSchema
>;
export type DynamicEntityAdvanceBatch = z.infer<
	typeof dynamicEntityAdvanceBatchSchema
>;
export type DynamicEntityEvent = z.infer<typeof dynamicEntityEventSchema>;

/** Validates the narrow Tauri boundary before mutable frontend state observes it. */
export function decodeDynamicEntityEvent(value: unknown): DynamicEntityEvent {
	const event = dynamicEntityEventSchema.parse(value);
	if (event.kind === "advanced") {
		for (const advance of event.batch.advances) {
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
	}
	return event;
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
	#lastAdvanceHostSeconds: number | null = null;
	readonly #nowSeconds: () => number;

	constructor(nowSeconds = () => performance.now() / 1_000) {
		this.#nowSeconds = nowSeconds;
	}

	/** Await the next current-state snapshot; deltas arriving first are superseded, not replayed. */
	awaitSnapshot(): void {
		this.#awaitingSnapshot = true;
		this.#timeline = null;
		this.#lastAdvanceHostSeconds = null;
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
			this.#lastAdvanceHostSeconds = event.snapshot.hostTime.seconds;
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
		if (event.kind === "advanced") {
			if (
				this.#lastAdvanceHostSeconds !== null &&
				event.batch.hostTime.seconds <= this.#lastAdvanceHostSeconds
			) {
				return false;
			}
			this.#lastAdvanceHostSeconds = event.batch.hostTime.seconds;
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
