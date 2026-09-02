import type { LandblockOwnerId } from "../lib/game/game-types";
import {
	getLandblockCoordinates,
	normalizeLandblockOwner,
} from "../lib/game/landblocks";
import { z } from "zod";

/** Current Explorer policy radius for collision simulation, independent from render residency radii. */
const SIMULATION_INTEREST_RADIUS = 2;

/** Keep acquired collision owners for one extra landblock beyond the nominal follow radius. */
const SIMULATION_INTEREST_EXIT_MARGIN = 1;

/** Complete host replacement of the collision owners required by application policy. */
export interface SimulationInterestRequest {
	/** Monotonic replacement revision within the current frontend lifetime. */
	readonly revision: number;
	/** Complete normalized collision-owner set selected by application policy. */
	readonly landblockIds: readonly LandblockOwnerId[];
}

/** Host acknowledgement for one revisioned simulation-interest replacement. */
export interface SimulationInterestReceipt {
	/** Revision copied from the corresponding request. */
	readonly revision: number;
	/** Whether this request remained current through the atomic scene commit. */
	readonly committed: boolean;
	/** Requested owners for which static collision content does not exist. */
	readonly unavailableLandblockIds: readonly LandblockOwnerId[];
}

const simulationInterestReceiptSchema = z.object({
	revision: z.number().int().nonnegative(),
	committed: z.boolean(),
	unavailableLandblockIds: z.array(
		z.string().transform(normalizeLandblockOwner),
	),
});

/** Validate one untrusted transport acknowledgement before policy observes it. */
export function decodeSimulationInterestReceipt(
	value: unknown,
): SimulationInterestReceipt {
	return simulationInterestReceiptSchema.parse(value);
}

/** Injectable boundary that keeps host transport mechanics out of interest policy. */
export interface SimulationInterestTransport {
	replace(
		request: SimulationInterestRequest,
	): Promise<SimulationInterestReceipt>;
}

interface CurrentPublication {
	/** Revision used to prevent an older failure from clearing newer state. */
	readonly revision: number;
	/** Shared result returned while this publication remains current. */
	readonly promise: Promise<SimulationInterestReceipt>;
}

interface CurrentInterest {
	/** Normalized application anchor associated with the replacement. */
	readonly anchorLandblockId: LandblockOwnerId;
	/** Complete effective owner set submitted for this revision. */
	readonly landblockIds: readonly LandblockOwnerId[];
	/** Host publication, absent after a retryable current failure. */
	readonly publication: CurrentPublication | null;
}

/** Owns Explorer simulation-interest revisions without observing render-layer settings. */
export class SimulationInterestController {
	readonly #transport: SimulationInterestTransport;
	#revision = 0;
	#current: CurrentInterest | null = null;

	constructor(transport: SimulationInterestTransport) {
		this.#transport = transport;
	}

	/** Follow physical movement with bounded owner retention. */
	follow(
		anchorLandblockId: LandblockOwnerId,
	): Promise<SimulationInterestReceipt> {
		const anchor = normalizeLandblockOwner(anchorLandblockId);
		return this.#request(
			anchor,
			computeEffectiveSimulationInterest(
				anchor,
				this.#current?.landblockIds ?? [],
			),
		);
	}

	/** Replace collision interest with the exact nominal destination square. */
	replace(
		anchorLandblockId: LandblockOwnerId,
	): Promise<SimulationInterestReceipt> {
		const anchor = normalizeLandblockOwner(anchorLandblockId);
		return this.#request(anchor, computeSimulationInterest(anchor));
	}

	/** Preserve an already-current anchor, otherwise replace with its exact nominal square. */
	ensure(
		anchorLandblockId: LandblockOwnerId,
	): Promise<SimulationInterestReceipt> {
		const anchor = normalizeLandblockOwner(anchorLandblockId);
		const current = this.#current;
		if (current?.anchorLandblockId !== anchor) return this.replace(anchor);
		if (current.publication !== null) return current.publication.promise;
		return this.#request(anchor, current.landblockIds);
	}

	#request(
		anchor: LandblockOwnerId,
		landblockIds: readonly LandblockOwnerId[],
	): Promise<SimulationInterestReceipt> {
		const current = this.#current;
		if (
			current !== null &&
			current.publication !== null &&
			sameOwners(current.landblockIds, landblockIds)
		) {
			this.#current = { ...current, anchorLandblockId: anchor };
			return current.publication.promise;
		}

		const revision = ++this.#revision;
		const promise = this.#transport
			.replace({
				landblockIds,
				revision,
			})
			.then((receipt) => validateReceipt(receipt, revision))
			.catch((error: unknown) => {
				// A failed current request may be retried. Never roll an older failure over a newer anchor.
				if (this.#current?.publication?.revision === revision) {
					this.#current = { ...this.#current, publication: null };
				}
				throw error;
			});
		this.#current = {
			anchorLandblockId: anchor,
			landblockIds,
			publication: { promise, revision },
		};
		return promise;
	}

	/** Whether one completed receipt still names the controller's current anchor revision. */
	isCurrent(anchorLandblockId: LandblockOwnerId, revision: number): boolean {
		const anchor = normalizeLandblockOwner(anchorLandblockId);
		return (
			this.#current?.anchorLandblockId === anchor &&
			this.#current.publication?.revision === revision
		);
	}
}

/** Derive the exact normalized owner square for one simulation anchor. */
export function computeSimulationInterest(
	anchorLandblockId: LandblockOwnerId,
): readonly LandblockOwnerId[] {
	const anchor = getLandblockCoordinates(
		normalizeLandblockOwner(anchorLandblockId),
	);
	const owners: LandblockOwnerId[] = [];
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

/** Union nominal owners with prior owners still inside the current exit square. */
export function computeEffectiveSimulationInterest(
	anchorLandblockId: LandblockOwnerId,
	previousOwners: readonly LandblockOwnerId[],
): readonly LandblockOwnerId[] {
	const anchor = getLandblockCoordinates(
		normalizeLandblockOwner(anchorLandblockId),
	);
	const owners = new Set(computeSimulationInterest(anchorLandblockId));
	for (const previousOwner of previousOwners) {
		const owner = normalizeLandblockOwner(previousOwner);
		const coordinates = getLandblockCoordinates(owner);
		const distance = Math.max(
			Math.abs(coordinates.x - anchor.x),
			Math.abs(coordinates.y - anchor.y),
		);
		if (
			distance <=
			SIMULATION_INTEREST_RADIUS + SIMULATION_INTEREST_EXIT_MARGIN
		) {
			owners.add(owner);
		}
	}
	return [...owners].sort();
}

function sameOwners(
	left: readonly LandblockOwnerId[],
	right: readonly LandblockOwnerId[],
): boolean {
	if (left.length !== right.length) return false;
	const rightOwners = new Set(right);
	return left.every((owner) => rightOwners.has(owner));
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
