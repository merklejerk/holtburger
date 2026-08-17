import { z } from "zod";

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

const motionDirectiveSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("turn-to-heading"),
		desiredHeading: finiteNumber,
		speed: finiteNumber,
	}),
	z.object({
		kind: z.literal("turn-to-object"),
		target: guid,
		desiredHeading: finiteNumber.nullable(),
		speed: finiteNumber,
	}),
]);

const dynamicEntityViewSchema = z.object({
	generation: nonNegativeInteger,
	identity: z.object({
		guid,
		wcid: guid,
		name: z.string(),
	}),
	presentation: z.object({
		content: z.object({
			setupDid: guid,
			motionTableDid: guid.nullable(),
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
	placement: z.object({
		pose: worldPositionSchema,
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
	}),
	motion: z
		.object({
			currentStyle: nonNegativeInteger.max(0xffff).nullable(),
			forwardCommand: nonNegativeInteger.max(0xffff).nullable(),
			sidestepCommand: nonNegativeInteger.max(0xffff).nullable(),
			turnCommand: nonNegativeInteger.max(0xffff).nullable(),
			forwardSpeed: finiteNumber.nullable(),
			sidestepSpeed: finiteNumber.nullable(),
			turnSpeed: finiteNumber.nullable(),
			directive: motionDirectiveSchema.nullable(),
		})
		.nullable(),
});

const hostTimeSchema = z.object({ seconds: finiteNumber.nonnegative() });

const dynamicEntitySnapshotSchema = z.object({
	hostTime: hostTimeSchema,
	entities: z.array(dynamicEntityViewSchema),
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
]);

export type DynamicEntityView = z.infer<typeof dynamicEntityViewSchema>;
export type DynamicEntitySnapshot = z.infer<typeof dynamicEntitySnapshotSchema>;
export type DynamicEntityEvent = z.infer<typeof dynamicEntityEventSchema>;

/** Validates the narrow Tauri boundary before mutable frontend state observes it. */
export function decodeDynamicEntityEvent(value: unknown): DynamicEntityEvent {
	return dynamicEntityEventSchema.parse(value);
}

/** Current focused entity mirror with explicit snapshot-recovery state. */
export class DynamicEntityMirror {
	#awaitingSnapshot = true;
	#entities = new Map<number, DynamicEntityView>();
	#timeline: { hostSeconds: number; frontendSeconds: number } | null = null;
	readonly #nowSeconds: () => number;

	constructor(nowSeconds = () => performance.now() / 1_000) {
		this.#nowSeconds = nowSeconds;
	}

	/** Enter recovery without treating queued deltas as a reconstruction protocol. */
	awaitSnapshot(): void {
		this.#awaitingSnapshot = true;
		this.#timeline = null;
	}

	/** Apply one validated snapshot or ordered live mutation. */
	apply(event: DynamicEntityEvent): void {
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
			this.#awaitingSnapshot = false;
			return;
		}

		if (this.#awaitingSnapshot) return;
		if (event.kind === "upserted") {
			const current = this.#entities.get(event.entity.identity.guid);
			if (
				current !== undefined &&
				current.generation > event.entity.generation
			) {
				return;
			}
			this.#entities.set(event.entity.identity.guid, event.entity);
			return;
		}

		const current = this.#entities.get(event.guid);
		if (current?.generation === event.generation) {
			this.#entities.delete(event.guid);
		}
	}

	/** Stable current population for UI and presentation reconciliation. */
	entities(): readonly DynamicEntityView[] {
		return [...this.#entities.values()].sort(
			(left, right) => left.identity.guid - right.identity.guid,
		);
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
