import {
	decodeExplorerEntityMutationReceipt,
	type ExplorerEntityMutationReceipt,
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

/** Harness-only HTTP adapter over the same app-local Explorer driver used by Tauri commands. */
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
		return this.#interest.request(anchorLandblockId);
	}

	async spawn(request: ExplorerEntitySpawnRequest): Promise<DynamicEntityView> {
		return decodeDynamicEntityView(
			await postJson(this.#baseUrl, "explorer-entity-spawn", request),
		);
	}

	async despawn(
		guid: number,
		generation: number,
	): Promise<ExplorerEntityMutationReceipt> {
		return decodeExplorerEntityMutationReceipt(
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

	/** Advances one exact harness-controlled epoch; null means no frontend-relevant change. */
	async tick(durationMilliseconds: number): Promise<DynamicEntityEvent | null> {
		const value = await postJson(this.#baseUrl, "explorer-entity-tick", {
			durationMilliseconds,
		});
		return value === null ? null : decodeDynamicEntityEvent(value);
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
