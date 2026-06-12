import type {
	StaticBakeBatchInput,
	StaticBakeBatchResult,
	StaticBaker,
} from "../contracts";
import { StaticObjectCompatibilityBaker } from "../objects/bake/static-object-compatibility-baker";
import { TerrainGeometryStaticBaker } from "../terrain/bake/terrain-geometry-baker";
import { handleStaticBakeWorkerRequest } from "./worker-handler";
import type { StaticBakeWorkerGlobalPort } from "./protocol";

class StaticBakeWorkerRouter implements StaticBaker {
	readonly #staticObjectBaker: StaticBaker;
	readonly #terrainBaker: StaticBaker;

	constructor(options: {
		readonly staticObjectBaker: StaticBaker;
		readonly terrainBaker: StaticBaker;
	}) {
		this.#staticObjectBaker = options.staticObjectBaker;
		this.#terrainBaker = options.terrainBaker;
	}

	bake(input: StaticBakeBatchInput): Promise<StaticBakeBatchResult> {
		if (input.domain === "outdoor-terrain") {
			return this.#terrainBaker.bake(input);
		}
		if (input.domain === "outdoor-buildings" || input.domain === "outdoor-detail") {
			return this.#staticObjectBaker.bake(input);
		}

		return Promise.reject(
			new Error(`Static bake worker does not support ${input.domain}.`),
		);
	}
}

const workerPort = self as unknown as StaticBakeWorkerGlobalPort;
const baker = new StaticBakeWorkerRouter({
	staticObjectBaker: new StaticObjectCompatibilityBaker(),
	terrainBaker: new TerrainGeometryStaticBaker(),
});

workerPort.addEventListener("message", (event) => {
	void handleStaticBakeWorkerRequest(
		baker,
		event.data,
		(response) => workerPort.postMessage(response),
	);
});
