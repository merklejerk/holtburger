import { z } from "zod";

/** Numeric display minutes in one Dereth day, independent of its real-time duration. */
export const MINUTES_PER_GAME_DAY = 24 * 60;

/** User-scoped formatting; no operating-system timezone is involved. */
export const clientClockFormatSchema = z.enum(["12-hour", "24-hour"]);
export type ClientClockFormat = z.infer<typeof clientClockFormatSchema>;

/** Local visual choices; server-following modes carry no inactive override values. */
export const clientEnvironmentOverridesSchema = z
	.object({
		time: z.discriminatedUnion("kind", [
			z
				.object({ kind: z.literal("server") })
				.strict()
				.readonly(),
			z
				.object({
					kind: z.literal("fixed"),
					/** Selected display minute, converted to a day fraction at the presentation boundary. */
					minuteOfDay: z
						.number()
						.int()
						.min(0)
						.max(MINUTES_PER_GAME_DAY - 1),
				})
				.strict()
				.readonly(),
		]),
		weather: z.discriminatedUnion("kind", [
			z
				.object({ kind: z.literal("server") })
				.strict()
				.readonly(),
			z
				.object({
					kind: z.literal("preset"),
					/** Region record scope checked before applying the saved index. */
					sourceRecordId: z.string().regex(/^0x[0-9a-f]{8}$/i),
					/** Authored region version checked against the active content. */
					sourceVersion: z.number().int().nonnegative(),
					/** Distinct authored variant, even when names repeat. */
					dayGroupIndex: z.number().int().nonnegative(),
					/** Exact name checked against the indexed group to detect stale choices. */
					dayGroupName: z.string(),
				})
				.strict()
				.readonly(),
		]),
	})
	.strict()
	.readonly();
export type ClientEnvironmentOverrides = z.infer<
	typeof clientEnvironmentOverridesSchema
>;

/** Explicit first-run policy. */
export const CLIENT_CLOCK_FORMAT_DEFAULT: ClientClockFormat = "24-hour";
export const CLIENT_ENVIRONMENT_OVERRIDES_DEFAULT = {
	time: { kind: "server" },
	weather: { kind: "server" },
} as const satisfies ClientEnvironmentOverrides;
