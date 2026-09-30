import { z } from "zod";

const u32 = z.number().int().nonnegative().max(0xffff_ffff);
const decimal = z.string().regex(/^(0|[1-9]\d*)$/);
const statId = z.string().min(1);
const enchantmentKey = z.object({ spellId: u32, layer: u32 }).strict();

/** Shared target identity; only a core-provided quote can authorize a spend. */
const statTargetSchema = z.union([
	z.object({ Attribute: statId }).strict(),
	z.object({ Vital: statId }).strict(),
	z.object({ Skill: statId }).strict(),
]);
export type StatTarget = z.infer<typeof statTargetSchema>;

export const progressionIntentSchema = z.union([
	z
		.object({
			Raise: z.object({ target: statTargetSchema, ranks: u32 }).strict(),
		})
		.strict(),
	z
		.object({ RaiseMax: z.object({ target: statTargetSchema }).strict() })
		.strict(),
	z.object({ Train: z.object({ skill: statId }).strict() }).strict(),
]);
export type ProgressionIntent = z.infer<typeof progressionIntentSchema>;

const modifierContribution = z
	.object({
		operation: z.enum(["additive", "multiplicative", "other"]),
		channel: z.enum(["ordinary", "attackSkills", "defenseSkills"]),
		effective: enchantmentKey,
		overridden: z.array(enchantmentKey),
		value: z.number().finite(),
	})
	.strict();
const modifierBreakdown = z
	.object({
		contributions: z.array(modifierContribution),
		multiplier: z.number().finite(),
		additive: z.number().finite(),
	})
	.strict();
const finalization = z
	.object({
		before_rounding: z.number().finite(),
		rounded: z.number().finite(),
		minimum: z.number().finite(),
		result: u32,
	})
	.strict();
const formulaAttribute = z
	.object({
		attribute: statId,
		base: u32,
		effective: u32,
		modifiers: z.array(modifierContribution),
	})
	.strict();
const attributeFormula = z
	.object({
		first: formulaAttribute,
		second: formulaAttribute.nullable(),
		divisor: u32,
		base_before_rounding: z.number().finite(),
		effective_before_rounding: z.number().finite(),
		base_result: u32,
		effective_result: u32,
	})
	.strict();
const attribute = z
	.object({
		attr_type: statId,
		ranks: u32,
		start: u32,
		spent_xp: u32,
		next_rank_xp: u32.nullable(),
		base: u32,
		current: u32,
		breakdown: z
			.object({ modifiers: modifierBreakdown, finalization })
			.strict(),
	})
	.strict();
const vital = z
	.object({
		vital_type: statId,
		ranks: u32,
		start: u32,
		spent_xp: u32,
		next_rank_xp: u32.nullable(),
		base: u32,
		buffed_max: u32,
		current: u32,
		breakdown: z
			.object({
				formula: attributeFormula.nullable(),
				modifiers: modifierBreakdown,
				finalization,
			})
			.strict(),
	})
	.strict();
const skill = z
	.object({
		skill_type: statId,
		ranks: u32,
		init: u32,
		spent_xp: u32,
		next_rank_xp: u32.nullable(),
		base: u32,
		current: u32,
		training: z.enum(["Unusable", "Untrained", "Trained", "Specialized"]),
		trained_cost: u32,
		specialized_cost: u32,
		breakdown: z
			.object({
				formula: z.union([
					z.literal("NoFormula"),
					z.literal("Unusable"),
					z.object({ Applied: attributeFormula }).strict(),
				]),
				base_bonuses: z.array(
					z
						.object({
							source: z.enum([
								"AllSkills",
								"SkilledMelee",
								"SkilledMissile",
								"SkilledMagic",
								"Enlightenment",
								"JackOfAllTrades",
								"SpecializedLuminance",
							]),
							value: u32,
						})
						.strict(),
				),
				current_bonuses: z.array(
					z
						.object({
							source: z.enum([
								"AllSkills",
								"SkilledMelee",
								"SkilledMissile",
								"SkilledMagic",
								"Enlightenment",
								"JackOfAllTrades",
								"SpecializedLuminance",
							]),
							value: u32,
						})
						.strict(),
				),
				vitae: z.number().finite(),
				modifiers: modifierBreakdown,
				wide_modifiers: z.array(modifierContribution),
				wide_additive_rounded: z.number().finite(),
				finalization,
			})
			.strict(),
	})
	.strict();

export const characterSheetSchema = z
	.object({
		character: u32,
		/** Server-owned identity and localized selected character title. */
		name: z.string().nullable(),
		title: z.string().nullable(),
		/** Exact luminance capacity; null means it has not been provided. */
		maximumLuminance: decimal.nullable(),
		level: z
			.object({
				level: u32,
				currentXp: decimal,
				unspentXp: decimal,
				unspentSkillPoints: u32,
				availableLuminance: decimal,
				nextLevelXp: decimal,
				xpIntoLevel: decimal,
				xpForNextLevel: decimal,
			})
			.strict(),
		attributes: z.array(attribute),
		vitals: z.array(vital),
		skills: z.array(
			z
				.object({
					stat: skill,
					description: z.string().nullable(),
					availableInEor: z.boolean(),
				})
				.strict(),
		),
		armor: z.number().int().min(-0x8000_0000).max(0x7fff_ffff),
		resistances: z
			.object({
				slash: z.number().finite(),
				pierce: z.number().finite(),
				bludgeon: z.number().finite(),
				fire: z.number().finite(),
				cold: z.number().finite(),
				acid: z.number().finite(),
				electric: z.number().finite(),
				nether: z.number().finite(),
			})
			.strict(),
		/** Current vitae multiplier; one means no penalty. */
		vitae: z.number().finite(),
		guardedTargets: z.array(statTargetSchema),
	})
	.strict();
export type CharacterSheet = z.infer<typeof characterSheetSchema>;

const unavailableWorld = z.union([
	z.enum([
		"CharacterUnavailable",
		"TargetUnavailable",
		"NotTrainable",
		"AlreadyTrained",
		"SkillNotTrained",
		"InvalidRankCount",
		"RankCap",
		"InconsistentExperience",
	]),
	z
		.object({
			InsufficientXp: z.object({ required: u32, available: decimal }).strict(),
		})
		.strict(),
	z
		.object({
			InsufficientCredits: z.object({ required: u32, available: u32 }).strict(),
		})
		.strict(),
]);
const unavailable = z.union([
	z.enum(["CharacterNotReady", "AwaitingTargetUpdate"]),
	z.object({ World: unavailableWorld }).strict(),
]);
export type ProgressionUnavailable = z.infer<typeof unavailable>;
export const progressionQuoteSchema = z
	.object({
		scope_id: u32,
		quote: z
			.object({
				character: u32,
				intent: progressionIntentSchema,
				target_state: z
					.object({
						training: skill.shape.training.nullable(),
						ranks: u32,
						spent_xp: u32,
					})
					.strict(),
				resulting_ranks: u32,
				xp_spent: u32,
				credits_spent: u32,
				available_xp: decimal,
				available_credits: u32,
			})
			.strict(),
	})
	.strict();
export type ProgressionQuote = z.infer<typeof progressionQuoteSchema>;

const progressionEvaluation = z
	.object({
		intent: progressionIntentSchema,
		result: z.union([
			z.object({ Ok: progressionQuoteSchema }).strict(),
			z.object({ Err: unavailable }).strict(),
		]),
	})
	.strict();
export type ProgressionEvaluation = z.infer<typeof progressionEvaluation>;
export const progressionEvaluatedSchema = z
	.object({
		requestId: u32,
		evaluations: z.array(progressionEvaluation),
	})
	.strict();

const rejection = z.union([
	z.enum([
		"CharacterNotReady",
		"WrongScope",
		"WrongCharacter",
		"AwaitingTargetUpdate",
		"StaleQuote",
	]),
	z.object({ Unavailable: unavailableWorld }).strict(),
]);
export const progressionFeedbackSchema = z.union([
	z
		.object({ Submitted: z.object({ target: statTargetSchema }).strict() })
		.strict(),
	z
		.object({
			Rejected: z
				.object({ intent: progressionIntentSchema, reason: rejection })
				.strict(),
		})
		.strict(),
	z
		.object({
			DispatchFailed: z
				.object({ intent: progressionIntentSchema, message: z.string() })
				.strict(),
		})
		.strict(),
]);
export type ProgressionFeedback = z.infer<typeof progressionFeedbackSchema>;

export function progressionTarget(intent: ProgressionIntent): StatTarget {
	if ("Train" in intent) return { Skill: intent.Train.skill };
	if ("Raise" in intent) return intent.Raise.target;
	return intent.RaiseMax.target;
}

export function progressionIntentKey(intent: ProgressionIntent): string {
	return JSON.stringify(intent);
}

export function progressionTargetKey(target: StatTarget): string {
	return JSON.stringify(target);
}
