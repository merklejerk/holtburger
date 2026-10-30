import { z } from "zod";

/** Terminal connection causes shared by native app lifetime and client presentation. */
export const clientExitCauseSchema = z.enum([
	"explicit-disconnect",
	"server-disconnect",
	"startup-failure",
	"runtime-failure",
	"host-shutdown",
]);

const exitRequestedSchema = z
	.object({
		cause: clientExitCauseSchema,
		diagnostic: z.string(),
	})
	.strict();

/** Redacted terminal diagnostic; carries no renderer/gameplay implementation dependencies. */
export type ClientExitRequested = z.infer<typeof exitRequestedSchema>;

/** Strictly validates the redacted terminal diagnostic. */
export function decodeClientExitRequested(value: unknown): ClientExitRequested {
	return exitRequestedSchema.parse(value);
}
