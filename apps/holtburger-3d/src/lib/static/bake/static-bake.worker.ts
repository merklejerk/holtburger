import type {
	StaticBakeBatchInput,
	StaticBakeBatchResult,
	StaticBaker,
} from "../contracts";
import { EnvCellSystemBaker } from "../env-cells/bake/env-cell-system-baker";
import { StaticObjectCompatibilityBaker } from "../objects/bake/static-object-compatibility-baker";
import { TerrainGeometryStaticBaker } from "../terrain/bake/terrain-geometry-baker";
import { handleStaticBakeWorkerRequest } from "./worker-handler";
import type { StaticBakeWorkerGlobalPort } from "./protocol";

class StaticBakeWorkerRouter implements StaticBaker {
	readonly #landblockEnvCellsBaker: StaticBaker;
	readonly #staticObjectBaker: StaticBaker;
	readonly #terrainBaker: StaticBaker;

	constructor(options: {
		readonly landblockEnvCellsBaker: StaticBaker;
		readonly staticObjectBaker: StaticBaker;
		readonly terrainBaker: StaticBaker;
	}) {
		this.#landblockEnvCellsBaker = options.landblockEnvCellsBaker;
		this.#staticObjectBaker = options.staticObjectBaker;
		this.#terrainBaker = options.terrainBaker;
	}

	bake(input: StaticBakeBatchInput): Promise<StaticBakeBatchResult> {
		if (input.domain === "outdoor-terrain") {
			return this.#terrainBaker.bake(input);
		}
		if (
			input.domain === "outdoor-buildings" ||
			input.domain === "outdoor-explicit-objects" ||
			input.domain === "outdoor-generated-scenery"
		) {
			return this.#staticObjectBaker.bake(input);
		}
		if (input.domain === "env-cell-system") {
			return this.#landblockEnvCellsBaker.bake(input);
		}

		return Promise.reject(
			new Error(`Static bake worker does not support ${input.domain}.`),
		);
	}
}

const workerPort = self as unknown as StaticBakeWorkerGlobalPort;
const baker = new StaticBakeWorkerRouter({
	landblockEnvCellsBaker: new EnvCellSystemBaker(),
	staticObjectBaker: new StaticObjectCompatibilityBaker(),
	terrainBaker: new TerrainGeometryStaticBaker(),
});

workerPort.addEventListener("message", (event) => {
	void handleStaticBakeWorkerRequest(baker, event.data, (response) =>
		workerPort.postMessage(response),
	);
});
