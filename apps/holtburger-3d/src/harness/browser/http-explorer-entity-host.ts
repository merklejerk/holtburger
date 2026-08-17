import {
	decodeExplorerEntityMutationReceipt,
	type ExplorerEntityMutationReceipt,
	type ExplorerEntitySpawnRequest,
} from "../../explorer/explorer-entity-commands";
import {
	decodeDynamicEntityView,
	type DynamicEntityView,
} from "../../lib/game/runtime/dynamic-entity-feed";

/** Harness-only HTTP adapter over the same app-local Explorer driver used by Tauri commands. */
export class HttpExplorerEntityHost {
	readonly #baseUrl: URL;

	constructor(baseUrl: string) {
		this.#baseUrl = new URL(baseUrl);
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
}

async function postJson(baseUrl: URL, path: string, body: unknown): Promise<unknown> {
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
