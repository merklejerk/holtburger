import { z } from "zod";
import type { HostTransport } from "../lib/host/host-transport";

const duration = z.number().finite().nonnegative();
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** Strict projection of the finite authority vocabulary; no arbitrary metric registry. */
const nativeSnapshotSchema = z
	.object({
		generation: count.positive(),
		recording: z.boolean(),
		elapsedMs: duration,
		pendingScopes: count,
		authority: z.array(
			z
				.object({
					scope: z.enum(["network_batch", "command_batch", "physics_tick"]),
					sampleCount: count.positive(),
					meanMs: duration,
				})
				.strict(),
		),
		forwarding: z
			.object({
				sampleCount: count,
				meanMs: duration.nullable(),
			})
			.strict(),
	})
	.strict();

/** Independent native elapsed window; durations may include awaits. */
export type NativePerformanceSnapshot = z.infer<typeof nativeSnapshotSchema>;

/** A boundary's coverage must remain explicit when it cannot supply observations. */
export type NativePerformanceState =
	| { readonly kind: "available"; readonly snapshot: NativePerformanceSnapshot }
	| { readonly kind: "pending" }
	| { readonly kind: "unavailable"; readonly reason: string }
	| {
			readonly kind: "failed";
			readonly reason: string;
			/** Preserve already observed native work when final delivery fails during retirement. */
			readonly lastSnapshot: NativePerformanceSnapshot | null;
	  };

/** App-local adapter; the authority's world/event loop is not part of this request path. */
export interface NativePerformanceSource {
	control(
		action: "start" | "snapshot" | "stop",
		generation: number,
	): Promise<NativePerformanceSnapshot>;
}

export function clientNativePerformance(
	transport: HostTransport,
): NativePerformanceSource {
	return {
		async control(action, generation) {
			const response = nativeSnapshotSchema.parse(
				await transport.invoke("client_performance", {
					request: { action, generation },
				}),
			);
			if (response.generation !== generation)
				throw new Error(
					"Native performance response belongs to a different capture.",
				);
			if (action === "start" && !response.recording)
				throw new Error("Native performance capture did not start.");
			if (action === "stop" && response.recording)
				throw new Error("Native performance capture did not stop.");
			return response;
		},
	};
}
