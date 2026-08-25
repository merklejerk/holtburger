import type { LandblockId } from "../lib/game/game-types";
import {
	getLandblockCoordinates,
	normalizeLandblockOwner,
} from "../lib/game/landblocks";
import { z } from "zod";

/** Current Explorer policy radius for collision simulation, independent from render residency radii. */
const SIMULATION_INTEREST_RADIUS = 2;

/** Complete host replacement of the collision owners required by application policy. */
export interface SimulationInterestRequest {
	/** Monotonic replacement revision within the current frontend lifetime. */
	readonly revision: number;
	/** Complete normalized collision-owner set selected by application policy. */
	readonly landblockIds: readonly LandblockId[];
}

/** Host acknowledgement for one revisioned simulation-interest replacement. */
export interface SimulationInterestReceipt {
	/** Revision copied from the corresponding request. */
	readonly revision: number;
	/** Whether this request remained current through the atomic scene commit. */
	readonly committed: boolean;
	/** Requested owners for which static collision content does not exist. */
	readonly unavailableLandblockIds: readonly LandblockId[];
}

const simulationInterestReceiptSchema = z.object({
	revision: z.number().int().nonnegative(),
	committed: z.boolean(),
	unavailableLandblockIds: z.array(z.string()),
});

/** Validate one untrusted transport acknowledgement before policy observes it. */
export function decodeSimulationInterestReceipt(
	value: unknown,
): SimulationInterestReceipt {
	return simulationInterestReceiptSchema.parse(value);
}

/** Injectable boundary that keeps Tauri mechanics out of interest policy. */
export interface SimulationInterestTransport {
	replace(
		request: SimulationInterestRequest,
	): Promise<SimulationInterestReceipt>;
}

interface CurrentRequest {
	/** Normalized application anchor associated with the replacement. */
	readonly anchorLandblockId: LandblockId;
	/** Revision used to prevent an older failure from clearing newer state. */
	readonly revision: number;
	/** Shared result returned when the same anchor is requested again. */
	readonly promise: Promise<SimulationInterestReceipt>;
}

/** Owns Explorer simulation-interest revisions without observing render-layer settings. */
export class SimulationInterestController {
	readonly #transport: SimulationInterestTransport;
	#revision = 0;
	#current: CurrentRequest | null = null;

	constructor(transport: SimulationInterestTransport) {
		this.#transport = transport;
	}

	/** Replace collision interest when, and only when, the application anchor changes. */
	request(anchorLandblockId: LandblockId): Promise<SimulationInterestReceipt> {
		const anchor = normalizeLandblockOwner(anchorLandblockId);
		if (this.#current?.anchorLandblockId === anchor) {
			return this.#current.promise;
		}

		const revision = ++this.#revision;
		const promise = this.#transport
			.replace({
				landblockIds: computeSimulationInterest(anchor),
				revision,
			})
			.then((receipt) => validateReceipt(receipt, revision))
			.catch((error: unknown) => {
				// A failed current request may be retried. Never roll an older failure over a newer anchor.
				if (this.#current?.revision === revision) this.#current = null;
				throw error;
			});
		this.#current = { anchorLandblockId: anchor, promise, revision };
		return promise;
	}

	/** Whether one completed receipt still names the controller's current anchor revision. */
	isCurrent(anchorLandblockId: LandblockId, revision: number): boolean {
		const anchor = normalizeLandblockOwner(anchorLandblockId);
		return (
			this.#current?.anchorLandblockId === anchor &&
			this.#current?.revision === revision
		);
	}
}

/** Derive the exact normalized owner square for one simulation anchor. */
export function computeSimulationInterest(
	anchorLandblockId: LandblockId,
): readonly LandblockId[] {
	const anchor = getLandblockCoordinates(
		normalizeLandblockOwner(anchorLandblockId),
	);
	const owners: LandblockId[] = [];
	for (
		let y = anchor.y - SIMULATION_INTEREST_RADIUS;
		y <= anchor.y + SIMULATION_INTEREST_RADIUS;
		y += 1
	) {
		for (
			let x = anchor.x - SIMULATION_INTEREST_RADIUS;
			x <= anchor.x + SIMULATION_INTEREST_RADIUS;
			x += 1
		) {
			if (x < 0 || x > 0xff || y < 0 || y > 0xff) continue;
			owners.push(
				`0x${x.toString(16).padStart(2, "0")}${y
					.toString(16)
					.padStart(2, "0")}ffff`,
			);
		}
	}
	return owners;
}

function validateReceipt(
	receipt: SimulationInterestReceipt,
	revision: number,
): SimulationInterestReceipt {
	if (receipt.revision !== revision) {
		throw new Error(
			`Simulation-interest receipt ${receipt.revision} does not match request ${revision}.`,
		);
	}
	return receipt;
}
