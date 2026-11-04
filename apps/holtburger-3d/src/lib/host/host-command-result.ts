import { z } from "zod";

/** Source rejection facts preserved through stdio, Electron IPC, and the diagnostic HTTP host. */
const resourceFailureSchema = z.object({
	kind: z.enum(["missing", "pruned", "invalid"]),
	namespace: z.string(),
	file_id: z.number().int().nonnegative().max(0xffffffff),
});

/** Operational failures have no resource classification and must not become optional content. */
export const hostCommandErrorSchema = z.object({
	code: z.string(),
	message: z.string(),
	resource: resourceFailureSchema.optional(),
});

/** Serializable command rejection consumed by the renderer adapter. */
export type HostCommandFailure = z.infer<typeof hostCommandErrorSchema>;

/** Explicit IPC outcome; Electron does not preserve custom properties on rejected Errors. */
const hostCommandResultSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("ok"), value: z.unknown() }),
	z.object({ kind: z.literal("failed"), error: hostCommandErrorSchema }),
]);

/** Main-process reply carried as data through Electron's isolated bridge. */
export type HostCommandResult = z.infer<typeof hostCommandResultSchema>;

/** A rejected command with source facts, reconstructed after the process boundary. */
export class HostCommandError extends Error {
	readonly failure: HostCommandFailure;

	constructor(failure: HostCommandFailure, options?: ErrorOptions) {
		super(failure.message, options);
		this.name = "HostCommandError";
		this.failure = failure;
	}
}

/** Validate the bridge contract independently of individual command response decoders. */
export function unwrapHostCommandResult(value: unknown): unknown {
	const result = hostCommandResultSchema.parse(value);
	if (result.kind === "failed") throw new HostCommandError(result.error);
	return result.value;
}

/** Only entirely source-classified failures can be contained; mixed aggregates remain fatal. */
export function isContentFailure(error: unknown): boolean {
	return everyHostFailure(error, (failure) => failure.resource !== undefined);
}

/** Capacity rejection is transient; a later acquisition may try again without an automatic retry. */
export function isHostCapacityFailure(error: unknown): boolean {
	return everyHostFailure(
		error,
		(failure) =>
			failure.code === "pending_limit" && failure.resource === undefined,
	);
}

/** Preserve contextual causes while requiring every aggregate branch to satisfy one policy. */
function everyHostFailure(
	error: unknown,
	accepts: (failure: HostCommandFailure) => boolean,
): boolean {
	const ancestors = new Set<unknown>();
	function visit(value: unknown): boolean {
		if (ancestors.has(value)) return false;
		ancestors.add(value);
		try {
			if (value instanceof HostCommandError) return accepts(value.failure);
			if (value instanceof AggregateError)
				return (
					value.errors.length > 0 &&
					value.errors.every(visit) &&
					(value.cause === undefined || visit(value.cause))
				);
			return value instanceof Error && value.cause !== undefined
				? visit(value.cause)
				: false;
		} finally {
			ancestors.delete(value);
		}
	}
	return visit(error);
}

/** The dev host uses the same typed rejection as stdio; response/schema errors remain operational. */
export async function checkHostHttpResponse(response: Response): Promise<void> {
	if (!response.ok)
		throw new HostCommandError(
			hostCommandErrorSchema.parse(await response.json()),
		);
}
