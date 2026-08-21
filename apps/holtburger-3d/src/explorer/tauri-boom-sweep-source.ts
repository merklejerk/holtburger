import { z } from "zod";

import {
	boomSweepWireRequest,
	type BoomSweepSource,
} from "../lib/game/controls/boom-sweep-source";

const sweepDistanceSchema = z.number().finite().nonnegative();

/** Production Tauri source, isolated so boom policy remains browser-testable. */
export function tauriBoomSweepSource(): BoomSweepSource {
	return {
		sweep: async (request) => {
			const { invoke } = await import("@tauri-apps/api/core");
			return sweepDistanceSchema.parse(
				await invoke<unknown>("sweep_sphere_distance", {
					request: boomSweepWireRequest(request),
				}),
			);
		},
	};
}
