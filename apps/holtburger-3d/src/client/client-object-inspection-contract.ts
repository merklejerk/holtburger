import { z } from "zod";
import { clientIconAppearanceSchema } from "./client-entity-mirror";

const u32 = z.number().int().nonnegative().max(0xffff_ffff);
const i32 = z.number().int().min(-0x8000_0000).max(0x7fff_ffff);
const finiteNumber = z.number().finite();
const enchantmentPolaritySchema = z.enum(["beneficial", "harmful"]).nullable();
const enchantedValueSchema = <T extends z.ZodTypeAny>(value: T) =>
	z
		.object({
			effective: value,
			unbuffed: value.nullable(),
			enchantment: enchantmentPolaritySchema,
		})
		.strict();

/** Frontend examination intent; the host maps it to the existing identify command. */
export const objectInspectionTargetSchema = z.object({ guid: u32 }).strict();

/**
 * Name of a Rust semantic enum whose complete vocabulary is owned by shared game data.
 *
 * These names are deliberately open so a newer host can surface an explicit unknown label rather
 * than making the entire inspection unreadable. Object and discriminant shapes remain strict.
 */
const semanticEnumName = z.string().trim().min(1);

const capacitySchema = z
	.object({ items: u32.nullable(), containers: u32.nullable() })
	.strict();
const itemStatusSchema = z
	.object({
		bonded: z.enum(["destroy", "slippery", "normal", "bonded"]).nullable(),
		attuned: z.enum(["Normal", "Attuned", "Sticky"]).nullable(),
		retained: z.boolean().nullable(),
		isOpen: z.boolean().nullable(),
		isLocked: z.boolean().nullable(),
		sellable: z.boolean().nullable(),
		ivoryable: z.boolean().nullable(),
	})
	.strict();
const countSchema = z.object({ current: u32.nullable(), max: u32 }).strict();
const vitalRangeSchema = z.object({ current: u32, max: u32 }).strict();
const protectionsSchema = z
	.object({
		slashing: enchantedValueSchema(finiteNumber),
		piercing: enchantedValueSchema(finiteNumber),
		bludgeoning: enchantedValueSchema(finiteNumber),
		fire: enchantedValueSchema(finiteNumber),
		cold: enchantedValueSchema(finiteNumber),
		acid: enchantedValueSchema(finiteNumber),
		lightning: enchantedValueSchema(finiteNumber),
		nether: enchantedValueSchema(finiteNumber),
	})
	.strict();
const bonusSchema = z
	.object({
		kind: z.enum([
			"attack",
			"defense",
			"missileDefense",
			"magicDefense",
			"elementalDamage",
			"manaConversion",
			"criticalFrequency",
		]),
		value: enchantedValueSchema(finiteNumber),
	})
	.strict();

const wieldRequirementSchema = z.discriminatedUnion("type", [
	z
		.object({
			type: z.enum(["skill", "raw-skill"]),
			data: z.object({ skill: semanticEnumName, difficulty: i32 }).strict(),
		})
		.strict(),
	z
		.object({
			type: z.enum(["attribute", "raw-attribute"]),
			data: z
				.object({
					attribute: z.enum([
						"undef",
						"strength",
						"endurance",
						"quickness",
						"coordination",
						"focus",
						"self-attr",
					]),
					difficulty: i32,
				})
				.strict(),
		})
		.strict(),
	z
		.object({
			type: z.enum(["vital", "raw-vital"]),
			data: z
				.object({
					vital: z.enum([
						"undef",
						"max-health",
						"health",
						"max-stamina",
						"stamina",
						"max-mana",
						"mana",
					]),
					difficulty: i32,
				})
				.strict(),
		})
		.strict(),
	z
		.object({
			type: z.literal("level"),
			data: z.object({ level: i32 }).strict(),
		})
		.strict(),
	z
		.object({
			type: z.literal("training"),
			data: z
				.object({
					skill: semanticEnumName,
					level: z.enum(["inactive", "untrained", "trained", "specialized"]),
				})
				.strict(),
		})
		.strict(),
	z
		.object({
			type: z.literal("int-stat"),
			data: z.object({ property: semanticEnumName, value: i32 }).strict(),
		})
		.strict(),
	z
		.object({
			type: z.literal("bool-stat"),
			data: z
				.object({ property: semanticEnumName, value: z.boolean() })
				.strict(),
		})
		.strict(),
	z
		.object({
			type: z.literal("creature-type"),
			data: z.object({ creatureType: semanticEnumName }).strict(),
		})
		.strict(),
	z
		.object({
			type: z.literal("heritage"),
			data: z
				.object({
					heritage: z.enum([
						"invalid",
						"aluvian",
						"gharundim",
						"sho",
						"viamontian",
						"shadowbound",
						"gearknight",
						"tumerok",
						"lugian",
						"empyrean",
						"penumbraen",
						"undead",
						"olthoi",
						"olthoi-acid",
					]),
				})
				.strict(),
		})
		.strict(),
]);

const unitEffectTypes = [
	"armor-cleaving",
	"slash-cleaving",
	"pierce-cleaving",
	"bludgeon-cleaving",
	"acid-cleaving",
	"cold-cleaving",
	"electric-cleaving",
	"fire-cleaving",
	"nether-cleaving",
	"magic-absorption",
	"multistrike",
] as const;
const effectSchema = z.discriminatedUnion("type", [
	z.object({ type: z.enum(unitEffectTypes) }).strict(),
	z
		.object({
			type: z.enum(["biting-strike", "crushing-blow"]),
			data: finiteNumber,
		})
		.strict(),
	z.object({ type: z.literal("cleaving"), data: i32 }).strict(),
	z
		.object({
			type: z.literal("slayer"),
			data: z
				.object({ creatureType: semanticEnumName, bonus: finiteNumber })
				.strict(),
		})
		.strict(),
]);

const itemInspectionSchema = z
	.object({
		artwork: clientIconAppearanceSchema
			.unwrap()
			.extend({ itemType: u32 })
			.strict()
			.readonly(),
		value: u32.nullable(),
		burden: u32.nullable(),
		capacity: capacitySchema,
		material: z
			.object({ materialType: semanticEnumName, workmanship: finiteNumber })
			.strict()
			.nullable(),
		tinkering: z.object({ count: i32 }).strict().nullable(),
		spellcraft: i32.nullable(),
		mana: z
			.object({
				kind: z.enum(["mana", "charge"]),
				current: i32,
				max: i32.nullable(),
				secondsLeft: finiteNumber.nullable(),
			})
			.strict()
			.nullable(),
		status: itemStatusSchema,
		stack: countSchema.nullable(),
		uses: countSchema.nullable(),
		armor: enchantedValueSchema(i32).nullable(),
		weapon: z
			.object({
				damage: enchantedValueSchema(
					z.object({ min: finiteNumber, max: finiteNumber }).strict(),
				),
				damageType: u32,
				weaponSkill: semanticEnumName.nullable(),
				speed: enchantedValueSchema(u32).nullable(),
				weaponType: semanticEnumName.nullable(),
			})
			.strict()
			.nullable(),
		protections: protectionsSchema.nullable(),
		bonuses: z.array(bonusSchema),
		wieldRequirements: z.array(wieldRequirementSchema),
		inscription: z
			.object({ text: z.string(), scribe: z.string().nullable() })
			.strict()
			.nullable(),
		imbuedEffects: u32,
		effects: z.array(effectSchema),
		useText: z.string().nullable(),
		spells: z.array(
			z.object({ id: u32, activeEnchantment: z.boolean() }).strict(),
		),
	})
	.strict();

const creatureInspectionSchema = z
	.object({
		creatureType: semanticEnumName.nullable(),
		health: enchantedValueSchema(vitalRangeSchema),
		attributesAndVitals: z
			.object({
				attributes: z
					.object({
						strength: enchantedValueSchema(u32),
						endurance: enchantedValueSchema(u32),
						coordination: enchantedValueSchema(u32),
						quickness: enchantedValueSchema(u32),
						focus: enchantedValueSchema(u32),
						selfAttr: enchantedValueSchema(u32),
					})
					.strict(),
				stamina: enchantedValueSchema(vitalRangeSchema),
				mana: enchantedValueSchema(vitalRangeSchema),
			})
			.strict()
			.nullable(),
	})
	.strict();

const objectInspectionSchema = z
	.object({
		guid: u32,
		name: z.string(),
		description: z.string().nullable(),
		level: u32.nullable(),
		details: z.discriminatedUnion("kind", [
			z
				.object({ kind: z.literal("item"), details: itemInspectionSchema })
				.strict(),
			z
				.object({
					kind: z.literal("creature"),
					details: creatureInspectionSchema,
				})
				.strict(),
		]),
	})
	.strict();

/** One authoritative identify-response outcome, correlated only by the protocol's target GUID. */
const objectInspectionResultSchema = z
	.object({
		guid: u32,
		outcome: z.discriminatedUnion("kind", [
			z
				.object({
					kind: z.literal("ready"),
					inspection: objectInspectionSchema,
				})
				.strict(),
			z.object({ kind: z.literal("rejected") }).strict(),
			z.object({ kind: z.literal("missing") }).strict(),
		]),
	})
	.strict();

type DeepReadonly<T> = T extends readonly (infer Item)[]
	? readonly DeepReadonly<Item>[]
	: T extends object
		? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
		: T;

export type ObjectInspectionResult = DeepReadonly<
	z.infer<typeof objectInspectionResultSchema>
>;
export type ObjectInspection = Extract<
	ObjectInspectionResult["outcome"],
	{ kind: "ready" }
>["inspection"];
/** Item-specific immutable inspection payload selected by the shared world layer. */
export type ItemInspection = Extract<
	ObjectInspection["details"],
	{ kind: "item" }
>["details"];
/** Creature-specific immutable inspection payload selected by the shared world layer. */
export type CreatureInspection = Extract<
	ObjectInspection["details"],
	{ kind: "creature" }
>["details"];

export function decodeObjectInspectionResult(
	value: unknown,
): ObjectInspectionResult {
	return objectInspectionResultSchema.parse(value);
}
