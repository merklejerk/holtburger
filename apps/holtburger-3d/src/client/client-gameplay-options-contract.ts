import { z } from "zod";

/** Narrow set of server-saved options owned by the Gameplay settings surface. */
const gameplayOptionSchema = z.enum([
	"craftSuccessDialog",
	"confirmRareUse",
	"allowItemGive",
	"ignoreTradeRequests",
	"ignoreAllegianceRequests",
	"useDeception",
	"shareBirthDate",
	"shareAge",
	"shareDeaths",
	"shareTitles",
	"shareChessRank",
	"shareFishingSkill",
]);
export type ClientGameplayOption = z.infer<typeof gameplayOptionSchema>;
/** Complete mirrored state; missing option keys are a broken host contract. */
export const gameplayPreferencesSchema = z.record(
	gameplayOptionSchema,
	z.boolean(),
);
export type ClientGameplayPreferences = z.infer<
	typeof gameplayPreferencesSchema
>;
