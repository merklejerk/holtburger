import { z } from "zod";

/** Editor limit bounds matching work for user-authored patterns. */
const ENTITY_ALERT_PATTERN_LIMIT = 256;
const matchSchema = z
	.object({
		mode: z.enum(["exact", "glob"]),
		pattern: z.string().trim().min(1).max(ENTITY_ALERT_PATTERN_LIMIT),
	})
	.strict()
	.refine(
		(match) => match.mode !== "glob" || !globTokens(match.pattern).error,
		{
			message: "A glob cannot end with an unescaped backslash.",
		},
	)
	.readonly();
/** Persisted character-local alert; compiled matching and encounters stay session-local. */
export const entityAlertRuleSchema = z
	.object({
		/** Stable identity for edit/delete controls. */
		id: z.string().min(1),
		/** Enabled rules contribute matches, highlights and detections. */
		enabled: z.boolean(),
		/** Exact names preserve literal glob characters when added from an entity. */
		match: matchSchema,
	})
	.strict()
	.readonly();
export type EntityAlertRule = z.infer<typeof entityAlertRuleSchema>;

/** Shared canonical key for duplicate rejection, independent of enabled state. */
function entityAlertKey(match: EntityAlertRule["match"]): string {
	return `${match.mode}:${JSON.stringify(
		match.mode === "glob"
			? globTokens(match.pattern).tokens
			: [...match.pattern.trim().toLowerCase()].map((character) => ({
					literal: character,
				})),
	)}`;
}

/** Only exact-name rules own the row toggle; matching globs remain independent. */
export function findExactEntityAlert(
	rules: readonly EntityAlertRule[],
	name: string,
): EntityAlertRule | undefined {
	const normalized = name.trim().toLowerCase();
	return rules.find(
		(rule) =>
			rule.match.mode === "exact" &&
			rule.match.pattern.trim().toLowerCase() === normalized,
	);
}

/** Validate duplicate IDs and equivalent matching specifications at the persistence boundary. */
export const entityAlertRulesSchema = z
	.array(entityAlertRuleSchema)
	.superRefine((rules, context) => {
		const ids = new Set<string>();
		const matches = new Set<string>();
		for (const rule of rules) {
			if (ids.has(rule.id))
				context.addIssue({
					code: "custom",
					message: "Alert IDs must be unique.",
				});
			if (matches.has(entityAlertKey(rule.match)))
				context.addIssue({
					code: "custom",
					message: "An alert for this pattern already exists.",
				});
			ids.add(rule.id);
			matches.add(entityAlertKey(rule.match));
		}
	})
	.readonly();

type GlobToken = "*" | "?" | { readonly literal: string };
function globTokens(pattern: string): { tokens: GlobToken[]; error: boolean } {
	const tokens: GlobToken[] = [];
	let escaped = false;
	for (const character of pattern.trim().toLowerCase()) {
		if (escaped) {
			tokens.push({ literal: character });
			escaped = false;
		} else if (character === "\\") escaped = true;
		else if (character === "*" || character === "?") {
			if (character !== "*" || tokens.at(-1) !== "*") tokens.push(character);
		} else tokens.push({ literal: character });
	}
	return { tokens, error: escaped };
}

/** Whole-name matcher with bounded O(pattern × name) work; no regex backtracking. */
export function compileEntityAlert(
	match: EntityAlertRule["match"],
): (name: string) => boolean {
	const valid = matchSchema.parse(match);
	const normalized = valid.pattern.toLowerCase();
	if (valid.mode === "exact")
		return (name) => name.trim().toLowerCase() === normalized;
	const { tokens } = globTokens(valid.pattern);
	return (name) => {
		const characters = [...name.trim().toLowerCase()];
		let previous = new Array<boolean>(characters.length + 1).fill(false);
		previous[0] = true;
		for (const token of tokens) {
			const next = new Array<boolean>(characters.length + 1).fill(false);
			next[0] = token === "*" && previous[0];
			for (let index = 1; index <= characters.length; index++) {
				next[index] =
					token === "*"
						? previous[index] || next[index - 1]
						: previous[index - 1] &&
							(token === "?" || token.literal === characters[index - 1]);
			}
			previous = next;
		}
		return previous[characters.length];
	};
}
