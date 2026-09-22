import { z } from "zod";
import { DYNAMIC_ENTITY_MAP_BLIP_CATEGORIES } from "../lib/game/map/map-blip-category";

const guid = z.number().int().nonnegative().max(0xffff_ffff);
/** World-owned projectile supply; pending appraisal identity is consumed by core. */
const projectileSupplySchema = z.discriminatedUnion("kind", [
	z
		.object({ kind: z.literal("pending"), appraisal: guid.nullable() })
		.strict()
		.readonly(),
	z
		.object({ kind: z.literal("not-applicable") })
		.strict()
		.readonly(),
	z
		.object({ kind: z.literal("finite"), count: guid })
		.strict()
		.readonly(),
	z
		.object({ kind: z.literal("unlimited") })
		.strict()
		.readonly(),
]);
export type ProjectileSupply = z.infer<typeof projectileSupplySchema>;

/** Server-authored icon-composition inputs shared by entity facts and inspection snapshots. */
export const clientIconAppearanceSchema = z
	.object({
		base: guid.positive().nullable(),
		overlay: guid.positive().nullable(),
		underlay: guid.positive().nullable(),
		uiEffects: guid,
	})
	.strict()
	.readonly();
/** Confirmed world access; loading descriptions never imply opening or closing. */
const worldContainerSchema = z.discriminatedUnion("kind", [
	z
		.object({ kind: z.literal("closed") })
		.strict()
		.readonly(),
	z
		.object({ kind: z.literal("open"), root: guid })
		.strict()
		.readonly(),
]);
export type WorldContainerState = z.infer<typeof worldContainerSchema>;
const slotSchema = z.discriminatedUnion("kind", [
	z
		.object({ kind: z.literal("pending") })
		.strict()
		.readonly(),
	z
		.object({ kind: z.literal("item"), index: guid })
		.strict()
		.readonly(),
	z
		.object({
			kind: z.literal("pack"),
			index: guid,
			entryKind: z.enum(["container", "foci"]),
		})
		.strict()
		.readonly(),
]);

/** World-produced identity facts; layout and selection never replay raw entity properties. */
const clientEntityFactsSchema = z
	.object({
		guid,
		description: z.discriminatedUnion("kind", [
			z
				.object({ kind: z.literal("pending") })
				.strict()
				.readonly(),
			z
				.object({
					kind: z.literal("known"),
					name: z.string(),
					/** Quantity only when world facts establish a stackable entity. */
					stackCount: guid.nullable(),
					/** Structure properties retain independent absence from server updates. */
					structure: z
						.object({ current: guid.nullable(), max: guid.nullable() })
						.strict()
						.readonly(),
					/** Server icon inputs, independent of scene residency or asset readiness. */
					icon: clientIconAppearanceSchema,
					/** Public classification for inventory type sorting. */
					itemType: guid,
					/** World-resolved category shared with map markers, used by selected-name styling. */
					mapCategory: z.enum(DYNAMIC_ENTITY_MAP_BLIP_CATEGORIES),
					/** World-derived slot compatibility; not a wield-requirements verdict. */
					equipLocations: guid.nullable(),
					/** World-owned equipment alternate-side capability for action-cell hints. */
					hasAlternateEquipSide: z.boolean(),
					/** Shared authored use shape, independent of target and busy state. */
					useCapability: z.enum([
						"unavailable",
						"unsupported",
						"direct",
						"targeted",
					]),
					/** Public activation spell; independent of the player's spellbook. */
					builtInSpell: guid.positive().nullable(),
					/** World-derived template equivalence and remaining supply. */
					consumable: z
						.object({
							identity: z
								.object({
									wcid: guid,
									category: z.enum([
										"food",
										"healing-kit",
										"charged-mana-stone",
									]),
								})
								.strict()
								.readonly(),
							availability: z.enum(["pending", "ready", "exhausted"]),
						})
						.strict()
						.readonly()
						.nullable(),
					/** Public description flags for selected-entity diagnostics. */
					objectFlags: guid,
					/** Server template identity, independent of scene residency. */
					wcid: guid.nullable(),
					/** Optional local catalog type, serialized by the shared enum. */
					weenieType: z.string().nullable(),
					/** Server aggregate across packs; null until received. */
					pyrealBalance: guid.nullable(),
					/** World-owned local-player burden ratio, unknown before hydration. */
					burden: z.number().finite().nonnegative().nullable(),
					healthQuery: z.enum(["eligible", "ineligible"]),
				})
				.strict()
				.readonly(),
		]),
		location: z.discriminatedUnion("kind", [
			z
				.object({ kind: z.literal("none") })
				.strict()
				.readonly(),
			z
				.object({
					kind: z.literal("contained"),
					parentGuid: guid,
					slot: slotSchema,
				})
				.strict()
				.readonly(),
			z
				.object({
					kind: z.literal("equipped"),
					wearerGuid: guid,
					// Accepted current locations, independent of description hydration.
					mask: guid.nullable(),
				})
				.strict()
				.readonly(),
		]),
		ownedByPlayer: z.boolean(),
		canPickUp: z.boolean(),
		/** Shared descendant membership; presentation must not reconstruct access. */
		worldContainerContent: z.boolean(),
		canReceiveGive: z.boolean(),
		scenePlacement: z.enum(["available", "unavailable"]),
		/** World-owned acquisition category, independent of rendering and disposition. */
		targeting: z.enum(["ineligible", "creature", "non-creature"]),
		/** Session-local confirmed-open state; null identifies every non-corpse entity. */
		corpse: z.enum(["unopened", "opened"]).nullable(),
		storage: z.discriminatedUnion("kind", [
			z
				.object({ kind: z.literal("not-established") })
				.strict()
				.readonly(),
			z
				.object({
					kind: z.literal("container"),
					roster: z.enum(["awaiting", "announced"]),
					/** Server item-slot limit; null until the container is hydrated. */
					itemCapacity: guid.nullable(),
					/** Server pack-slot limit for the container strip. */
					packCapacity: guid.nullable(),
				})
				.strict()
				.readonly(),
		]),
	})
	.strict()
	.readonly();

/** Complete semantic domain for initial connection or replacement after receiver loss. */
export const clientEntitySnapshotSchema = z
	.object({
		projectileSupply: projectileSupplySchema,
		entities: z.array(clientEntityFactsSchema),
		worldContainer: worldContainerSchema,
	})
	.strict();
/** One affected-record update of the semantic domain, not a render transaction. */
export const clientEntityDeltaSchema = z
	.object({
		/** Null retains the previous supply; unknown supply is an explicit pending value. */
		projectileSupply: projectileSupplySchema.nullable(),
		upserts: z.array(clientEntityFactsSchema),
		removed: z.array(guid),
		worldContainer: worldContainerSchema.nullable(),
	})
	.strict();

export type ClientEntityFacts = z.infer<typeof clientEntityFactsSchema>;
export type ClientEntitySnapshot = z.infer<typeof clientEntitySnapshotSchema>;
export type ClientEntityDelta = z.infer<typeof clientEntityDeltaSchema>;

/** An immutable accepted level; the UI groups it without another mutable inventory cache. */
export interface ClientEntityLevel {
	/** Supply accepted together with equipment and item quantities. */
	readonly projectileSupply: ProjectileSupply;
	/** Access accepted in the same commit as contents and their pickup eligibility. */
	readonly worldContainer: WorldContainerState;
	/** Local display invalidation only; not a wire sequence or transport identity. */
	readonly revision: number;
	/** GUID-keyed accepted facts; this map is never mutated after publication. */
	readonly entities: ReadonlyMap<number, ClientEntityFacts>;
	/** Root identity used to distinguish Main Pack from owned container items. */
	readonly playerGuid: number | null;
}

/** A retained display during recovery does not authorize acquisition from stale facts. */
export type ClientEntityRead =
	| { readonly kind: "pending" }
	| { readonly kind: "current"; readonly level: ClientEntityLevel };

/** Prepared replacement has no side effects until the session commits it. */
export interface PreparedClientEntities {
	/** The complete next immutable level. */
	readonly level: ClientEntityLevel;
}

function indexEntities(
	records: readonly ClientEntityFacts[],
): Map<number, ClientEntityFacts> {
	const indexed = new Map<number, ClientEntityFacts>();
	for (const record of records) {
		if (indexed.has(record.guid))
			throw new Error(`Duplicate semantic entity GUID ${record.guid}.`);
		indexed.set(record.guid, record);
	}
	return indexed;
}

function validateLevel(
	entities: ReadonlyMap<number, ClientEntityFacts>,
	playerGuid: number | null,
): void {
	if (playerGuid !== null && !entities.has(playerGuid))
		throw new Error("Semantic baseline is missing the local player identity.");
	for (const entity of entities.values()) {
		if (!entity.ownedByPlayer) continue;
		if (playerGuid === null)
			throw new Error("Owned entity has no established local player.");
		if (entity.guid === playerGuid)
			throw new Error("Local player cannot be an owned inventory item.");
		if (entity.location.kind === "none")
			throw new Error("Owned entity has no accepted storage relationship.");
		const parentGuid =
			entity.location.kind === "contained"
				? entity.location.parentGuid
				: entity.location.wearerGuid;
		const parent = entities.get(parentGuid);
		if (parent === undefined)
			throw new Error(`Owned entity ${entity.guid} has a missing parent.`);
		if (parentGuid !== playerGuid && !parent.ownedByPlayer)
			throw new Error("Owned entity has an unowned storage parent.");
	}
}

/** Session-owned semantic mirror. Producer callbacks never write Svelte state. */
export class ClientEntityMirror {
	#read: ClientEntityRead = { kind: "pending" };
	#revision = 0;

	read(): ClientEntityRead {
		return this.#read;
	}

	/** Retire current admission evidence while a full replacement is pending. */
	awaitSnapshot(): void {
		this.#read = { kind: "pending" };
	}

	prepareSnapshot(
		snapshot: ClientEntitySnapshot,
		playerGuid: number | null,
	): PreparedClientEntities {
		const entities = indexEntities(snapshot.entities);
		validateLevel(entities, playerGuid);
		return {
			level: {
				entities,
				playerGuid,
				worldContainer: snapshot.worldContainer,
				projectileSupply: snapshot.projectileSupply,
				revision: this.#revision + 1,
			},
		};
	}

	prepareDelta(delta: ClientEntityDelta): PreparedClientEntities | null {
		if (this.#read.kind === "pending") return null;
		if (
			delta.projectileSupply === null &&
			delta.worldContainer === null &&
			delta.upserts.length === 0 &&
			delta.removed.length === 0
		)
			throw new Error("Empty semantic entity delta.");
		const upserts = indexEntities(delta.upserts);
		const removals = new Set<number>();
		for (const id of delta.removed) {
			if (removals.has(id))
				throw new Error(`Duplicate semantic removal GUID ${id}.`);
			if (upserts.has(id))
				throw new Error(`Semantic GUID ${id} is both upserted and removed.`);
			removals.add(id);
		}
		const { level } = this.#read;
		const entities = new Map(level.entities);
		for (const id of removals) entities.delete(id);
		for (const [id, record] of upserts) entities.set(id, record);
		validateLevel(entities, level.playerGuid);
		return {
			level: {
				entities,
				projectileSupply:
					delta.projectileSupply === null
						? level.projectileSupply
						: delta.projectileSupply,
				worldContainer:
					delta.worldContainer === null
						? level.worldContainer
						: delta.worldContainer,
				playerGuid: level.playerGuid,
				revision: this.#revision + 1,
			},
		};
	}

	/** Install prepared data without callbacks, then let the session notify all consumers. */
	commit(prepared: PreparedClientEntities): void {
		this.#revision = prepared.level.revision;
		this.#read = { kind: "current", level: prepared.level };
	}
}
