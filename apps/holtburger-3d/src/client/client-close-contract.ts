import { z } from "zod";

/** Renderer preparation is acknowledged before Electron seals IPC and shuts down native owners. */
export const clientClosePreparationSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("prepared") }).strict(),
	z.object({ kind: z.literal("failed"), diagnostic: z.string() }).strict(),
]);

/** A preparation failure still permits native best-effort shutdown with failure status. */
export type ClientClosePreparation = z.infer<
	typeof clientClosePreparationSchema
>;

/** Preserve individual aggregate causes when crossing the renderer/native diagnostic boundary. */
export function clientFailureDiagnostic(error: unknown): string {
	if (error instanceof AggregateError)
		return `${error.message}\n${error.errors.map(clientFailureDiagnostic).join("\n")}`;
	return error instanceof Error ? error.message : String(error);
}
