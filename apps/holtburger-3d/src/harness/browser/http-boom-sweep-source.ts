import { z } from "zod";

import {
	boomSweepWireRequest,
	type BoomSweepSource,
} from "../../lib/game/controls/boom-sweep-source";

const sweepDistanceSchema = z.number().finite().nonnegative();

/** Harness adapter over the dev content host's mirror of the canonical sweep command. */
export function httpBoomSweepSource(baseUrl: string): BoomSweepSource {
	const url = new URL("sphere-sweep", baseUrl);
	return {
		sweep: async (request) => {
			const response = await fetch(url, {
				body: JSON.stringify(boomSweepWireRequest(request)),
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
