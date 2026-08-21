import { z } from "zod";

import type { EnvCellId } from "../lib/game/game-types";
import type { SceneVec3 } from "../lib/assets/ac-frame";
import type { Vec3 } from "../lib/game/math/types";

/** One sphere sweep against static collision, in canonical scene axes. */
export interface BoomSweepRequest {
	readonly origin: SceneVec3;
	/** Interior cell containing `origin`, or `null` while outdoors. */
	readonly envCellId: EnvCellId | null;
	readonly direction: Vec3;
	readonly distance: number;
	readonly radius: number;
}

/**
 * How far a sphere may travel before static geometry stops it.
 *
 * Injected rather than imported so the boom stays testable without a host, and so the browser
 * harness can answer the same question over HTTP that the app answers over Tauri.
 */
export interface BoomSweepSource {
	sweep(request: BoomSweepRequest): Promise<number>;
}

const sweepDistanceSchema = z.number().finite().nonnegative();

/** Production Tauri source, isolated so boom policy remains browser-testable. */
export function tauriBoomSweepSource(): BoomSweepSource {
	return {
		sweep: async (request) => {
			const { invoke } = await import("@tauri-apps/api/core");
			return sweepDistanceSchema.parse(
				await invoke<unknown>("sweep_sphere_distance", {
					request: wireRequest(request),
				}),
			);
		},
	};
}

/** Harness HTTP source over the dev content host's mirror of the same command. */
export function httpBoomSweepSource(baseUrl: string): BoomSweepSource {
	const url = new URL("sphere-sweep", baseUrl);
	return {
		sweep: async (request) => {
			const response = await fetch(url, {
				body: JSON.stringify(wireRequest(request)),
				headers: { "content-type": "application/json" },
				method: "POST",
			});
			if (!response.ok) {
				throw new Error(
					`Sphere sweep failed (${response.status}): ${await response.text()}`,
				);
			}
			return sweepDistanceSchema.parse(await response.json());
		},
	};
}

/** The one place the boom's branded scene vectors become plain wire tuples. */
function wireRequest(request: BoomSweepRequest) {
	return {
		direction: [request.direction.x, request.direction.y, request.direction.z],
		distance: request.distance,
		envCellId: request.envCellId,
		origin: [request.origin.x, request.origin.y, request.origin.z],
		radius: request.radius,
	};
}
