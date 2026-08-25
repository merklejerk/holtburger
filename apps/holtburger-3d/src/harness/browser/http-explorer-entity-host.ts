import {
	type ExplorerEntityRelocationRequest,
	type ExplorerEntitySpawnRequest,
	type LaunchExplorerEntityRequest,
} from "../../explorer/explorer-entity-commands";
import {
	decodeDynamicEntityEvent,
	decodeDynamicEntityView,
	type DynamicEntityEvent,
	type DynamicEntityView,
} from "../../lib/game/runtime/dynamic-entity-feed";
import {
	decodeSimulationInterestReceipt,
	SimulationInterestController,
	type SimulationInterestRequest,
	type SimulationInterestReceipt,
} from "../../explorer/simulation-interest";
import type { LandblockId } from "../../lib/game/game-types";
import {
	decodeExplorerPossession,
	decodePossessionEventOutcome,
	decodePossessionEventQueueReceipt,
	decodePossessionIntentResult,
	decodePossessionMotionProbe,
	type ExplorerPossession,
	type ExplorerPossessionEventRequest,
	type ExplorerPossessionIntent,
	type PossessionEventOutcome,
	type PossessionEventQueueReceipt,
	type PossessionIntentResult,
	type PossessionMotionProbe,
} from "../../explorer/explorer-entity-possession";
import {
	decodeExplorerFixedTickEnvelope,
	type ExplorerFixedTickEnvelope,
} from "../../explorer/explorer-fixed-tick";
import {
	decodeHostKinematicBoomIdentity,
	type HostKinematicBoomIdentity,
} from "../../lib/game/motion/host-kinematic-boom-path";

export interface PossessionTickResponse {
	readonly envelope: ExplorerFixedTickEnvelope | null;
	readonly outcomes: readonly PossessionEventOutcome[];
}

/** Browser-harness registration request mirroring the production host command shape. */
export interface HttpKinematicBoomStartRequest {
	readonly possessionGeneration: number;
	readonly guid: number;
	readonly entityGeneration: number;
	readonly initialReach: number;
	readonly minimumReach: number;
	readonly maximumReach: number;
	readonly inputSequence: number;
	readonly viewDirection: readonly [number, number, number];
	readonly cumulativeZoomDisplacement: number;
	readonly projectionRevision: number;
	readonly clearanceRadius: number;
}

/** Browser-harness intent request mirroring the production host command shape. */
export interface HttpKinematicBoomIntentRequest extends HostKinematicBoomIdentity {
	readonly inputSequence: number;
	readonly viewDirection: readonly [number, number, number];
	readonly cumulativeZoomDisplacement: number;
}

/** Browser-harness projection-clearance request mirroring the production host command shape. */
export interface HttpKinematicBoomClearanceRequest extends HostKinematicBoomIdentity {
	readonly projectionRevision: number;
	readonly clearanceRadius: number;
}

/** Harness-only HTTP adapter over the same app-local Explorer driver used by host commands. */
export class HttpExplorerEntityHost {
	readonly #baseUrl: URL;
	readonly #interest: SimulationInterestController;
	#interestSession: Promise<number> | null = null;

	constructor(baseUrl: string) {
		this.#baseUrl = new URL(baseUrl);
		this.#interest = new SimulationInterestController({
			replace: (request) => this.#replaceSimulationInterest(request),
		});
	}

	/** Load the same camera-centered collision-owner policy used by the production Explorer. */
	ensureSimulationInterest(
		anchorLandblockId: LandblockId,
	): Promise<SimulationInterestReceipt> {
		return this.#interest.request(anchorLandblockId).then((receipt) => {
			if (!receipt.committed) {
				throw new Error(
					`Collision interest for ${anchorLandblockId} was superseded before the operation could start.`,
				);
			}
			if (!this.#interest.isCurrent(anchorLandblockId, receipt.revision)) {
				throw new Error(
					`Collision interest for ${anchorLandblockId} changed before the operation could start.`,
				);
			}
			if (
				receipt.unavailableLandblockIds.some(
					(owner) => owner.toLowerCase() === anchorLandblockId.toLowerCase(),
				)
			) {
				throw new Error(
					`Collision content is unavailable for ${anchorLandblockId}.`,
				);
			}
			return receipt;
		});
	}

	async spawn(
		request: ExplorerEntitySpawnRequest,
	): Promise<DynamicEntityEvent> {
		return decodeDynamicEntityEvent(
			await postJson(this.#baseUrl, "explorer-entity-spawn", request),
		);
	}

	async despawn(guid: number, generation: number): Promise<DynamicEntityEvent> {
		return decodeDynamicEntityEvent(
			await postJson(this.#baseUrl, "explorer-entity-despawn", {
				guid,
				generation,
			}),
		);
	}

	async launch(
		request: LaunchExplorerEntityRequest,
	): Promise<DynamicEntityView> {
		return decodeDynamicEntityView(
			await postJson(this.#baseUrl, "explorer-entity-launch", request),
		);
	}

	async relocate(
		request: ExplorerEntityRelocationRequest,
	): Promise<DynamicEntityEvent> {
		return decodeDynamicEntityEvent(
			await postJson(this.#baseUrl, "explorer-entity-relocate", request),
		);
	}

	async possess(guid: number | null): Promise<ExplorerPossession> {
		return decodeExplorerPossession(
			await postJson(this.#baseUrl, "explorer-entity-possess", { guid }),
		);
	}

	async setPossessionIntent(
		request: ExplorerPossessionIntent,
	): Promise<PossessionIntentResult> {
		return decodePossessionIntentResult(
			await postJson(this.#baseUrl, "explorer-possession-intent", request),
		);
	}

	async queuePossessionEvent(
		request: ExplorerPossessionEventRequest,
	): Promise<PossessionEventQueueReceipt> {
		return decodePossessionEventQueueReceipt(
			await postJson(this.#baseUrl, "explorer-possession-event", request),
		);
	}

	async startKinematicBoom(
		request: HttpKinematicBoomStartRequest,
	): Promise<HostKinematicBoomIdentity> {
		return decodeHostKinematicBoomIdentity(
			await postJson(this.#baseUrl, "kinematic-boom/start", request),
		);
	}

	async setKinematicBoomIntent(
		request: HttpKinematicBoomIntentRequest,
	): Promise<unknown> {
		return postJson(this.#baseUrl, "kinematic-boom/intent", request);
	}

	async setKinematicBoomClearance(
		request: HttpKinematicBoomClearanceRequest,
	): Promise<unknown> {
		return postJson(this.#baseUrl, "kinematic-boom/clearance", request);
	}

	async stopKinematicBoom(
		identity: HostKinematicBoomIdentity,
	): Promise<boolean> {
		const value = await postJson(
			this.#baseUrl,
			"kinematic-boom/stop",
			identity,
		);
		if (typeof value !== "boolean") {
			throw new Error("Kinematic boom host returned an invalid stop receipt.");
		}
		return value;
	}

	/** Advances one possession tick while retaining lifecycle outcomes beside body delivery. */
	async tickPossession(
		durationMilliseconds: number,
	): Promise<PossessionTickResponse> {
		const value = await postJson(this.#baseUrl, "explorer-possession-tick", {
			durationMilliseconds,
		});
		if (typeof value !== "object" || value === null)
			throw new Error("Possession tick response must be an object.");
		const response = value as Record<string, unknown>;
		if (!Array.isArray(response.outcomes))
			throw new Error("Possession tick outcomes must be an array.");
		return {
			envelope:
				response.envelope === null
					? null
					: decodeExplorerFixedTickEnvelope(response.envelope),
			outcomes: response.outcomes.map(decodePossessionEventOutcome),
		};
	}

	async possessionMotionProbe(): Promise<PossessionMotionProbe | null> {
		return decodePossessionMotionProbe(
			await postJson(this.#baseUrl, "explorer-possession-probe", {}),
		);
	}

	/** Advances one exact harness-controlled epoch; null means no frontend-relevant change. */
	async tick(
		durationMilliseconds: number,
	): Promise<ExplorerFixedTickEnvelope | null> {
		const value = await postJson(this.#baseUrl, "explorer-entity-tick", {
			durationMilliseconds,
		});
		return value === null ? null : decodeExplorerFixedTickEnvelope(value);
	}

	async #replaceSimulationInterest(
		request: SimulationInterestRequest,
	): Promise<SimulationInterestReceipt> {
		this.#interestSession ??= postJson(
			this.#baseUrl,
			"simulation-interest-session",
			{},
		).then((value) => {
			if (!Number.isSafeInteger(value) || (value as number) < 1)
				throw new Error(
					"Simulation-interest host returned an invalid session.",
				);
			return value as number;
		});
		return decodeSimulationInterestReceipt(
			await postJson(this.#baseUrl, "simulation-interest", {
				...request,
				session: await this.#interestSession,
			}),
		);
	}
}

async function postJson(
	baseUrl: URL,
	path: string,
	body: unknown,
): Promise<unknown> {
	const response = await fetch(new URL(path, baseUrl), {
		body: JSON.stringify(body),
		headers: { "content-type": "application/json" },
		method: "POST",
	});
	if (!response.ok) {
		throw new Error(
			`Explorer entity host ${path} failed (${response.status}): ${await response.text()}`,
		);
	}
	return response.json();
}
