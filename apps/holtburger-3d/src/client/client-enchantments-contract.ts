import { z } from "zod";

const u16 = z.number().int().nonnegative().max(0xffff);
const u32 = z.number().int().nonnegative().max(0xffff_ffff);

const enchantmentKeySchema = z.object({ spellId: u16, layer: u16 }).strict();

/** Shared world-owned affected-stat identity, independent of display labels. */
const affectedStatSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("attribute"), key: u32 }).strict(),
	z.object({ kind: z.literal("vital"), key: u32 }).strict(),
	z.object({ kind: z.literal("skill"), key: u32 }).strict(),
	z.object({ kind: z.literal("intProperty"), key: u32 }).strict(),
	z.object({ kind: z.literal("floatProperty"), key: u32 }).strict(),
	z.object({ kind: z.literal("armor") }).strict(),
	z.object({ kind: z.literal("damage") }).strict(),
	z.object({ kind: z.literal("damageVariance") }).strict(),
	z.object({ kind: z.literal("other"), key: z.tuple([u32, u32]) }).strict(),
]);

const enchantmentInstanceSchema = z
	.object({
		key: enchantmentKeySchema,
		spellCategory: u16,
		powerLevel: u32,
		kind: z.enum(["beneficial", "harmful", "vitae", "cooldown"]),
		remainingSeconds: z.number().finite().nonnegative().nullable(),
		statModType: u32,
		statModKey: u32,
		statModValue: z.number().finite(),
	})
	.strict();

const enchantmentGroupSchema = z
	.object({
		affectedStat: affectedStatSchema,
		/** Shared display name when an affected stat key is known. */
		statName: z.string().min(1).optional(),
		operation: z.enum(["additive", "multiplicative", "other"]),
		channel: z.enum(["ordinary", "attackSkills", "defenseSkills"]),
		spellCategory: u16,
		effective: enchantmentKeySchema,
		overridden: z.array(enchantmentKeySchema),
	})
	.strict();

export const resolvedEnchantmentsSchema = z
	.object({
		instances: z.array(enchantmentInstanceSchema),
		groups: z.array(enchantmentGroupSchema),
	})
	.strict();

export type ResolvedEnchantments = z.infer<typeof resolvedEnchantmentsSchema>;

export function decodeResolvedEnchantments(
	value: unknown,
): ResolvedEnchantments {
	return resolvedEnchantmentsSchema.parse(value);
}
